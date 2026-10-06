FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app

# Install minimal system dependencies
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y \
    wget \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Miniforge (conda-forge-only base, ships mamba + Python 3.12; ARM64 required for
# AgentCore). Pinned to a specific release and checksum so the base never drifts.
#
# Why Miniforge and not Miniconda: Miniconda's base is built from Anaconda's `defaults`
# channel. Installing the conda-forge geo stack on top of it mixes the two channels, and
# they ship overlapping shared libraries (libxml2 in particular). During the geo install
# conda-forge's libxml2-16 clobbered defaults' libxml2 and the later unlink deleted the
# shared libxml2.so.16 - libgdal then failed to load at runtime ("libxml2.so.16: cannot
# open shared object file") and the container crash-looped. A single-channel base with
# strict channel priority removes that class of failure entirely.
ARG MINIFORGE_VERSION=25.11.0-1
ARG MINIFORGE_SHA256=43a3783f9e121088f1c92b131b4305b9ebf159424ad2543dfcfc0f1952b5e127
RUN --mount=type=cache,target=/tmp/conda_cache \
    INSTALLER=/tmp/conda_cache/Miniforge3-${MINIFORGE_VERSION}-Linux-aarch64.sh && \
    if [ ! -f "$INSTALLER" ]; then \
        wget -q "https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}/Miniforge3-${MINIFORGE_VERSION}-Linux-aarch64.sh" -O "$INSTALLER"; \
    fi && \
    echo "${MINIFORGE_SHA256}  $INSTALLER" | sha256sum -c - && \
    bash "$INSTALLER" -b -p /opt/conda && \
    /opt/conda/bin/conda clean -afy

# Add conda to PATH. Strict channel priority means every package resolves from conda-forge;
# nothing can be silently satisfied from another channel.
ENV PATH="/opt/conda/bin:$PATH"
ENV CONDA_ALWAYS_YES=true
ENV CONDA_AUTO_UPDATE_CONDA=false
ENV CONDA_CHANNEL_PRIORITY=strict

# Copy requirements first for better Docker layer caching
COPY requirements.txt requirements.txt

# Install geospatial packages via conda-forge (handles all C dependencies)
# Updated package versions compatible with Python 3.12
# Ultra-optimized: Use mamba for 10-20x faster dependency resolution (~130s saved!)
#
# sqlite/libsqlite are pinned on purpose. proj and libspatialite depend on the `sqlite` CLI
# package; its current linux-aarch64 builds need readline 8.3 + icu 78, which the solver would
# rather not upgrade in the base, so left to itself it "satisfies" the dependency with the
# ancient monolithic sqlite 3.32.3 build. That package ships its own lib/libsqlite3.so.0 and
# clobbers the real libsqlite, and libgdal then fails to load (undefined symbol
# sqlite3_total_changes64). Pinning both to one modern version forces a coherent solve.
RUN --mount=type=cache,target=/opt/conda/pkgs \
    --mount=type=cache,target=/root/.conda/pkgs \
    mamba install -c conda-forge -y \
    libsqlite=3.52.0 \
    sqlite=3.52.0 \
    gdal=3.12.1 \
    fiona=1.10.1 \
    shapely=2.1.2 \
    geopandas=1.1.2 \
    pyproj=3.7.2 \
    numpy=2.4.0 \
    pandas=2.3.3 \
    rasterio=1.5.0 \
    rasterstats=0.20.0 \
    scipy \
    geopy=2.4.1 \
    osmnx=2.0.7 \
    proj=9.7.1 \
    geos=3.14.1 \
    && conda clean -afy

# Install remaining Python packages via pip
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install aws-opentelemetry-distro>=0.10.0
# Fail the build, not the runtime, if the native geo stack cannot load. Importing rasterio
# pulls libgdal and every shared library behind it; a broken environment surfaces here in
# seconds instead of as a crash loop on AgentCore.
RUN python -c "import rasterio, fiona, geopandas, shapely, pyproj, osmnx, rasterstats; print('geo stack ok', rasterio.__version__, geopandas.__version__)"

# Set AWS environment variables
ENV AWS_REGION=us-east-1
ENV AWS_DEFAULT_REGION=us-east-1
ENV DOCKER_CONTAINER=1

# Bound GDAL memory. By default GDAL sizes its block cache to ~5% of the HOST's
# RAM (not the container's cgroup limit), which can balloon and trigger an
# out-of-memory kill during raster reads/writes (especially with parallel tiers).
# Pin the cache to 256 MB and cap GDAL's worker threads so peak memory is bounded.
ENV GDAL_CACHEMAX=256
ENV GDAL_NUM_THREADS=2

# Speed up Cloud-Optimized GeoTIFF reads over HTTP (/vsicurl). Without these,
# GDAL issues extra directory-listing/probe requests on every COG open, which
# adds seconds to each band clip, CRS probe, and change-detection read.
#   - DISABLE_READDIR_ON_OPEN: skip the per-open directory listing (biggest win)
#   - allowed extensions: don't probe for sidecar files, only GeoTIFFs
#   - HTTP/2 multiplexing + range caching for fewer, faster round-trips
ENV GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR
ENV CPL_VSIL_CURL_ALLOWED_EXTENSIONS=.tif,.tiff,.TIF,.TIFF
ENV GDAL_HTTP_MULTIPLEX=YES
ENV GDAL_HTTP_VERSION=2
ENV VSI_CACHE=TRUE
ENV VSI_CACHE_SIZE=67108864
ENV GDAL_INGESTED_BYTES_AT_OPEN=32768

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
EXPOSE 8000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

# Copy project files
COPY . .

CMD if [ "$DISABLE_ADOT_OBSERVABILITY" = "true" ]; then exec python -m geospatial_agent_on_aws; else exec opentelemetry-instrument python -m geospatial_agent_on_aws; fi