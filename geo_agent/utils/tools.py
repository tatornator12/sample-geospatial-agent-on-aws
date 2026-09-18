"""
Strands tool definitions for geospatial analysis
"""
import json
import logging
import os
import re
import tempfile
import unicodedata
from datetime import datetime
from io import BytesIO
import boto3
import math
import numpy as np
import rasterio

from strands import tool
from strands_tools import calculator as calculator_tool
from .geocode_utils import get_polygon_of_aoi, geojson_str_to_gdf, haversine_distance
from .sentinel_utils import get_filtered_images
from .ndvi_utils import calculate_ndvi_stats, calculate_ndwi_stats, calculate_nbr_stats
from .aws_utils import download_from_s3, download_geometry_from_s3, list_files_in_s3

import config

logger = logging.getLogger(__name__)


def _slugify(text: str) -> str:
    """ASCII-safe slug for S3 keys / filenames.

    Strips accents (e.g. "Rondônia" -> "rondonia"), lowercases, and collapses
    spaces/punctuation to underscores. Non-ASCII characters in S3 keys break the
    frontend geometry proxy (Unicode normalization mismatch -> HTTP 500), so all
    geometry filenames must be ASCII.
    """
    if not text:
        return "unnamed"
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    norm = re.sub(r"[^a-z0-9]+", "_", norm.lower()).strip("_")
    return norm or "unnamed"


def _log_mem(tag: str) -> None:
    """Log current and peak process RSS so crashes leave a memory trail.

    Uses only the stdlib: peak RSS from resource.getrusage (KB on Linux) and
    current RSS from /proc/self/status. Best-effort — never raises.
    """
    try:
        import resource
        peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
        cur_mb = -1.0
        try:
            with open("/proc/self/status") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        cur_mb = int(line.split()[1]) / 1024.0
                        break
        except Exception:
            pass
        logger.info("🧠 MEM[%s] current=%.0fMB peak=%.0fMB", tag, cur_mb, peak_mb)
    except Exception:
        pass

#####################################
### UTILITY TOOLS
#####################################

# Built-in calculator tool from strands_tools
calculator = calculator_tool

# re-use previous assets that were generated
@tool
async def list_session_assets() -> str:
    """List all session assets (geometries, images, analysis). Use to reuse existing data and avoid regeneration.
    
    Returns: JSON with asset metadata
    
    Call this in multi-turn conversations to check if data already exists before regenerating."""

    session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
    
    # Get all assets in the session
    assets = list_files_in_s3(config.S3_BUCKET_NAME, f"session_data/{session_id}/")
    
    # Emit result marker for frontend parsing
    result = {
        "session_id": session_id,
        "assets": assets
    }
    result_json = json.dumps(result, indent=2)
    print(f"\n<tool_result_output>\n{result_json}\n</tool_result_output>\n")
    return result_json

# visualization tool for sending map data to map
@tool
async def display_visual(s3_url: str, title: str, description: str = "") -> str:
    """Display geometry or imagery (TCI, NDVI, NDWI, NBR) on map.
    
    Args:
        s3_url: S3 URL to GeoJSON or raster
        title: Display title
        description: Optional details
    
    Returns: JSON with display metadata
    
    Call IMMEDIATELY after each result: geometry → display, TCI → display, NDVI → display. Don't batch."""
    result = {"status": "success"}
    result_json = json.dumps(result, indent=2)
    
    return result_json


def _presigned_vsicurl(s3_url: str, expires: int = 600) -> str:
    """A GDAL-readable HTTPS path for a private session raster.

    GDAL then serves downsampled reads from the COG's overviews with HTTP range requests
    instead of downloading the whole file — the same path TiTiler uses for the map.
    """
    bucket, key = s3_url[len("s3://"):].split("/", 1)
    url = boto3.client("s3").generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires
    )
    return f"/vsicurl/{url}"


def _inspection_key(session_id: str, s3_url: str, fmt: str) -> str:
    """session_data/<sid>/inspections/<raster basename>.<jpg|png> — the UI derives the same key."""
    basename = s3_url.rsplit("/", 1)[-1]
    stem = basename.rsplit(".", 1)[0] if "." in basename else basename
    return f"session_data/{session_id}/inspections/{stem}.{'jpg' if fmt == 'jpeg' else 'png'}"


@tool
async def inspect_image(s3_url: str, title: str, question: str = "") -> dict:
    """LOOK at a raster before you use it. Returns the actual image so you can see clouds,
    haze, snow, nodata gaps, and the land cover over the area of interest.

    Args:
        s3_url: A session raster: the tci_s3_url from get_rasters (true colour), or an index /
            change map from run_bandmath / run_change_detection
        title: Short caption shown with the image (e.g. "Sentinel-2 true colour, Hyde Park, 2026-08-21")
        question: Optional: what you want to check (e.g. "is the park obscured by cloud?")

    Returns: the image plus JSON facts: width/height, nodata_pct, the value range and colour
    ramp used (indices), bounds, and preview_s3_url (where exactly what you saw is saved).

    Call it on the TCI right after get_rasters and BEFORE display_visual or any analysis, then
    say in ONE sentence what you see. Reject the scene (get_rasters again with exclude_dates)
    when the area is obscured or aoi_cloud_pct + aoi_nodata_pct exceeds 30."""
    from .inspection import render_preview

    session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)

    def _error(message: str) -> dict:
        logger.warning(f"👁️ inspect_image failed for {s3_url}: {message}")
        return {"status": "error", "content": [{"text": json.dumps({"error": message, "s3_url": s3_url})}]}

    if not isinstance(s3_url, str) or not s3_url.startswith("s3://") or "/" not in s3_url[5:]:
        return _error("s3_url must be a session raster of the form s3://bucket/key")

    try:
        started = datetime.now()
        rendered = render_preview(_presigned_vsicurl(s3_url), style_hint=s3_url)
        key = _inspection_key(session_id, s3_url, rendered.fmt)
        boto3.client("s3").put_object(
            Bucket=config.S3_BUCKET_NAME, Key=key, Body=rendered.data,
            ContentType="image/jpeg" if rendered.fmt == "jpeg" else "image/png",
        )
        preview_s3_url = f"s3://{config.S3_BUCKET_NAME}/{key}"
        elapsed = (datetime.now() - started).total_seconds()
        logger.info(f"👁️ inspect_image: {title} → {rendered.meta['width']}x{rendered.meta['height']} "
                    f"{rendered.fmt} {len(rendered.data) // 1024} KB in {elapsed:.1f}s → {preview_s3_url}")
    except ValueError as e:
        return _error(str(e))
    except Exception as e:
        return _error(f"{type(e).__name__}: {str(e)[:200]}")

    facts = rendered.summary_json(
        title=title, question=question, source_s3_url=s3_url, preview_s3_url=preview_s3_url,
        render_seconds=round(elapsed, 1),
    )
    return {
        "status": "success",
        "content": [
            {"image": {"format": rendered.fmt, "source": {"bytes": rendered.data}}},
            {"text": facts},
        ],
    }

#####################################
# GEOCODING TOOLS
#####################################

@tool
def bbox_around_point(lon: float, lat: float, distance_offset_meters: int = 2000) -> str:
    """Create bounding box around point.
    
    Args:
        lon: Longitude
        lat: Latitude
        distance_offset_meters: Buffer distance (default 2000m)
    
    Returns: GeoJSON polygon"""
    try:
        # Validate inputs
        lon = float(lon)
        lat = float(lat)
        distance_offset_meters = int(distance_offset_meters)
        
        # Equatorial radius (km) taken from https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html
        earth_radius_meters = 6378137
        lat_offset = math.degrees(distance_offset_meters / earth_radius_meters)
        lon_offset = math.degrees(distance_offset_meters / (earth_radius_meters * math.cos(math.radians(lat))))
        
        # Round coordinates to avoid floating point precision issues
        coords = [
            [round(lon - lon_offset, 8), round(lat - lat_offset, 8)],
            [round(lon - lon_offset, 8), round(lat + lat_offset, 8)],
            [round(lon + lon_offset, 8), round(lat + lat_offset, 8)],
            [round(lon + lon_offset, 8), round(lat - lat_offset, 8)],
            [round(lon - lon_offset, 8), round(lat - lat_offset, 8)],
        ]
        
        result = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords]
            },
            "properties": {
                "center": [round(lon, 8), round(lat, 8)],
                "radius_meters": distance_offset_meters
            }
        }
        
        # Return as JSON string for better compatibility
        return json.dumps(result, separators=(',', ':'))
        
    except (ValueError, TypeError) as e:
        error_msg = f"Invalid input parameters: {e}"
        print(f"ERROR: {error_msg}")
        return json.dumps({"error": error_msg})
    except Exception as e:
        error_msg = f"Unexpected error in bbox_around_point: {e}"
        print(f"ERROR: {error_msg}")
        return json.dumps({"error": error_msg})

@tool
async def create_bbox_from_coordinates(geometry_json: str, location: str = "custom_area") -> str:
    """Create geometry file from user-drawn coordinates, Point, or Polygon GeoJSON.
    
    Args:
        geometry_json: GeoJSON string containing Point or Polygon features
        location: Name for the geometry (default: "custom_area")
    
    Returns: JSON with geometry_s3_url and coordinates
    
    Handles:
    - Single Point: Creates 2km bbox around point
    - Polygon: Saves as-is (if within size limit)
    - FeatureCollection: Extracts first feature
    
    Output format matches bbox_around_point for consistency."""

    max_size_km2=config.MAX_CUSTOM_AREA_SIZE_KM2

    try:
        session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
        bucket_name = config.S3_BUCKET_NAME
        
        # Parse the GeoJSON
        geojson_data = json.loads(geometry_json)
        
        # Handle FeatureCollection vs single Feature
        if geojson_data.get('type') == 'FeatureCollection':
            if not geojson_data.get('features'):
                return json.dumps({"error": "FeatureCollection is empty"})
            feature = geojson_data['features'][0]
        elif geojson_data.get('type') == 'Feature':
            feature = geojson_data
        else:
            # Assume it's a geometry object directly
            feature = {
                "type": "Feature",
                "geometry": geojson_data,
                "properties": {}
            }
        
        geometry = feature['geometry']
        geometry_type = geometry['type']
        
        logger.info(f"📍 Creating geometry file for {location} (type: {geometry_type})")
        
        # Handle Point - create bbox around it
        if geometry_type == 'Point':
            coords = geometry['coordinates']
            lon, lat = coords[0], coords[1]
            
            logger.info(f"   Point coordinates: ({lat:.6f}, {lon:.6f})")
            
            # Create 2km bounding box using existing function
            bbox_geojson_str = bbox_around_point(lon, lat, 2000)
            
            # Convert to GeoDataFrame
            gdf = geojson_str_to_gdf(bbox_geojson_str)
            if gdf is None or gdf.empty:
                return json.dumps({"error": f"Failed to create bounding box for point"})
            
            # Save to S3
            s3_client = boto3.client('s3')
            clean_location = _slugify(location)
            s3_key = f"session_data/{session_id}/geometries/point_bbox_{clean_location}.geojson"
            
            geojson_str = gdf.to_json()
            
            s3_client.put_object(
                Bucket=bucket_name,
                Key=s3_key,
                Body=geojson_str.encode('utf-8'),
                ContentType='application/geo+json'
            )
            
            s3_url = f"s3://{bucket_name}/{s3_key}"
            logger.info(f"✅ Point bbox saved to {s3_url}")
            
            return json.dumps({
                "geometry_s3_url": s3_url,
                "location": clean_location,
                "type": "point_bbox",
                "center": {"lat": round(lat, 6), "lon": round(lon, 6)},
                "radius_meters": 2000
            })
        
        # Handle Polygon or MultiPolygon - save as-is
        elif geometry_type in ['Polygon', 'MultiPolygon']:
            # Convert to GeoDataFrame
            gdf = geojson_str_to_gdf(json.dumps(feature))
            if gdf is None or gdf.empty:
                return json.dumps({"error": f"Failed to parse {geometry_type}"})
            
            # Calculate centroid for reference
            gdf_wgs84 = gdf.to_crs('EPSG:4326')
            centroid = gdf_wgs84.geometry.centroid.iloc[0]
            centroid_lat = centroid.y
            centroid_lon = centroid.x
            
            # Calculate area
            gdf_projected = gdf.to_crs('EPSG:6933')
            area_m2 = gdf_projected.geometry.area.sum()
            area_km2 = area_m2 / 1_000_000
            
            logger.info(f"   Polygon area: {area_km2:.2f} km²")
            logger.info(f"   Centroid: ({centroid_lat:.6f}, {centroid_lon:.6f})")
            
            # Check if polygon exceeds maximum size
            if area_km2 > max_size_km2:
                error_msg = (
                    f"Polygon area ({area_km2:.2f} km²) exceeds maximum allowed size ({max_size_km2:.2f} km²). "
                    f"Please provide a smaller area or increase the max_size_km2 parameter."
                )
                logger.warning(f"⚠️ {error_msg}")
                return json.dumps({
                    "error": error_msg,
                    "area_km2": round(area_km2, 2),
                    "max_allowed_km2": max_size_km2,
                    "centroid": {"lat": round(centroid_lat, 6), "lon": round(centroid_lon, 6)}
                })
            
            # Save to S3
            s3_client = boto3.client('s3')
            clean_location = _slugify(location)
            s3_key = f"session_data/{session_id}/geometries/polygon_{clean_location}.geojson"
            
            geojson_str = gdf.to_json()
            
            s3_client.put_object(
                Bucket=bucket_name,
                Key=s3_key,
                Body=geojson_str.encode('utf-8'),
                ContentType='application/geo+json'
            )
            
            s3_url = f"s3://{bucket_name}/{s3_key}"
            logger.info(f"✅ Polygon saved to {s3_url}")
            
            return json.dumps({
                "geometry_s3_url": s3_url,
                "location": clean_location,
                "type": "polygon",
                "area_km2": round(area_km2, 2),
                "centroid": {"lat": round(centroid_lat, 6), "lon": round(centroid_lon, 6)}
            })
        
        else:
            return json.dumps({"error": f"Unsupported geometry type: {geometry_type}. Only Point, Polygon, and MultiPolygon are supported."})
            
    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON: {str(e)}"
        logger.error(error_msg)
        return json.dumps({"error": error_msg})
    except Exception as e:
        error_msg = f"Error creating geometry file: {str(e)}"
        logger.error(error_msg)
        return json.dumps({"error": error_msg})


@tool
async def find_location_boundary(location: str) -> str:
    """Get exact OSM boundary polygon for named location.
    
    Args:
        location: Place name (e.g., "Central Park", "Paris")
    
    Returns: JSON with geometry_s3_url and location name
    
    Use for: Getting precise boundaries of parks, cities, regions from OpenStreetMap"""
    try:
        session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
        bucket_name = config.S3_BUCKET_NAME

        polygon = get_polygon_of_aoi(location)
        if polygon is None or polygon.empty:
            return f"❌ No polygon found for {location}"
        else:
            polygon = polygon.to_crs(epsg=4326)

        # Save to S3 as GeoJSON
        s3_client = boto3.client('s3')

        # Clean location name for filename
        clean_location = _slugify(location)
        s3_key = f"session_data/{session_id}/geometries/polygon_{clean_location}.geojson"

        # Convert to GeoJSON string
        geojson_str = polygon.to_json()

        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=geojson_str.encode('utf-8'),
            ContentType='application/geo+json'
        )

        s3_url = f"s3://{bucket_name}/{s3_key}"

        logger.info(f"✅ Polygon saved to {s3_url}")

        return json.dumps({
            "geometry_s3_url": s3_url,
            "location": clean_location})
        
    except Exception as e:
        error_msg = f"❌ Error getting polygon for {location}: {str(e)}"
        logger.error(error_msg)
        return error_msg


@tool
async def get_best_geometry(location: str, osm_s3_url: str, reference_lat: float, reference_lon: float, max_area_km2: float = 100) -> str:
    """Validate OSM geometry against reference coords. Returns best geometry (OSM or bbox fallback).
    
    Args:
        location: Place name
        osm_s3_url: OSM polygon from find_location_boundary
        reference_lat: Lat from find_address_candidates (candidate.location.y)
        reference_lon: Lon from find_address_candidates (candidate.location.x)
        max_area_km2: Max area threshold (default 100)
    
    Returns: JSON with validated geometry_s3_url, source type, validation details
    
    Workflow: Call find_address_candidates + find_location_boundary in parallel → get_best_geometry validates → use returned geometry_s3_url"""
    try:
        session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
        bucket_name = config.S3_BUCKET_NAME

        # Convert to float
        reference_lat = float(reference_lat)
        reference_lon = float(reference_lon)
        max_area_km2 = float(max_area_km2)

        logger.info(f"🔍 Validating geometry for {location}")
        logger.info(f"   Reference coords: ({reference_lat:.4f}, {reference_lon:.4f})")
        logger.info(f"   Max area allowed: {max_area_km2} km²")

        # 1. Try to load OSM geometry
        try:
            osm_gdf = download_geometry_from_s3(osm_s3_url)
        except Exception as e:
            logger.warning(f"⚠️ Failed to load OSM geometry: {e}")
            osm_gdf = None

        # 2. Check if OSM geometry is empty or failed to load
        if osm_gdf is None or osm_gdf.empty:
            logger.warning("⚠️ OSM geometry is empty or failed to load")
            reason = "OSM geometry empty or invalid"
            # Fallback: create bbox from coordinates
            return await _create_fallback_bbox(location, reference_lat, reference_lon, reason, session_id, bucket_name)

        # 3. Calculate area in km²
        # Project to equal-area projection (EPSG:6933) for accurate area calculation
        osm_gdf_projected = osm_gdf.to_crs('EPSG:6933')
        area_m2 = osm_gdf_projected.geometry.area.sum()
        area_km2 = area_m2 / 1_000_000

        logger.info(f"   OSM area: {area_km2:.2f} km²")

        if area_km2 > max_area_km2:
            logger.warning(f"⚠️ OSM area too large ({area_km2:.1f} km² > {max_area_km2} km²)")
            reason = f"OSM too large ({area_km2:.1f} km²)"
            return await _create_fallback_bbox(location, reference_lat, reference_lon, reason, session_id, bucket_name)

        # 4. Calculate centroid in WGS84
        osm_gdf_wgs84 = osm_gdf.to_crs('EPSG:4326')
        centroid = osm_gdf_wgs84.geometry.centroid.iloc[0]
        centroid_lat = centroid.y
        centroid_lon = centroid.x

        logger.info(f"   OSM centroid: ({centroid_lat:.4f}, {centroid_lon:.4f})")

        # 5. Calculate distance between OSM centroid and reference coordinates
        distance_km = haversine_distance(centroid_lat, centroid_lon, reference_lat, reference_lon)

        logger.info(f"   Distance from reference: {distance_km:.2f} km")

        # 6. Adaptive distance threshold based on area
        # Larger areas can have centroids further from search coordinates
        # Use square root of area as a reasonable scaling factor
        min_threshold_km = 10  # Minimum threshold for small areas
        adaptive_threshold_km = max(min_threshold_km, math.sqrt(area_km2) * 2)
        max_threshold_km = 50  # Cap at 50km to avoid accepting wrong locations
        distance_threshold_km = min(adaptive_threshold_km, max_threshold_km)

        logger.info(f"   Distance threshold: {distance_threshold_km:.2f} km")

        if distance_km > distance_threshold_km:
            logger.warning(f"⚠️ OSM centroid too far from reference ({distance_km:.1f} km > {distance_threshold_km:.1f} km)")
            reason = f"OSM centroid too far ({distance_km:.1f} km from reference)"
            return await _create_fallback_bbox(location, reference_lat, reference_lon, reason, session_id, bucket_name)

        # 7. OSM validated! Return it
        logger.info(f"✅ OSM geometry validated successfully")

        return json.dumps({
            "geometry_s3_url": osm_s3_url,
            "source": "osm",
            "location": location,
            "validation": {
                "area_km2": round(area_km2, 2),
                "distance_km": round(distance_km, 2),
                "threshold_km": round(distance_threshold_km, 2),
                "osm_centroid": {"lat": round(centroid_lat, 6), "lon": round(centroid_lon, 6)},
                "reference_coords": {"lat": round(reference_lat, 6), "lon": round(reference_lon, 6)}
            },
            "reason": f"OSM validated (area: {area_km2:.1f} km², distance: {distance_km:.1f} km)"
        })

    except Exception as e:
        error_msg = f"❌ Error validating geometry for {location}: {str(e)}"
        logger.error(error_msg)
        # On error, fallback to bbox
        try:
            return await _create_fallback_bbox(location, reference_lat, reference_lon, f"Validation error: {str(e)}", session_id, bucket_name)
        except:
            return json.dumps({"error": error_msg})


async def _create_fallback_bbox(location: str, lat: float, lon: float, reason: str, session_id: str, bucket_name: str) -> str:
    """Helper function to create fallback bounding box when OSM validation fails"""
    logger.info(f"📦 Creating fallback 2km bounding box")
    logger.info(f"   Reason: {reason}")

    # Create 2km bounding box
    bbox_geojson_str = bbox_around_point(lon, lat, 2000)

    # Convert to GeoDataFrame
    gdf = geojson_str_to_gdf(bbox_geojson_str)
    if gdf is None or gdf.empty:
        raise Exception(f"Failed to create bounding box for {location}")

    # Save to S3 as GeoJSON
    s3_client = boto3.client('s3')
    clean_location = _slugify(location)
    s3_key = f"session_data/{session_id}/geometries/bbox_{clean_location}.geojson"

    # Convert to GeoJSON
    geojson_str = gdf.to_json()

    s3_client.put_object(
        Bucket=bucket_name,
        Key=s3_key,
        Body=geojson_str.encode('utf-8'),
        ContentType='application/geo+json'
    )

    s3_url = f"s3://{bucket_name}/{s3_key}"
    logger.info(f"✅ Fallback bbox saved to {s3_url}")

    return json.dumps({
        "geometry_s3_url": s3_url,
        "source": "bbox",
        "location": location,
        "reason": reason,
        "fallback": True
    })


#####################################
### SATELLITE IMAGERY RETRIEVAL TOOLS
#####################################

def _raster_result_json(result: dict, location: str) -> dict:
    """The JSON the imagery tools return for one scene (shared by get_rasters and the
    two-date fetch). aoi_* fields come from the Sentinel-2 scene-classification layer over the
    AOI polygon (null when the scene has no SCL asset); candidates are the other ranked
    scenes in the window so the agent knows whether a better one exists."""
    quality = result.get("aoi_quality") or {}
    return {
        "location": str(location),
        "date_used": result['date'][:10],
        "tci_s3_url": result.get('tci_s3_url', ''),
        "red_s3_url": result.get('red_s3_url', ''),
        "green_s3_url": result.get('green_s3_url', ''),
        "blue_s3_url": result.get('blue_s3_url', ''),
        "nir_s3_url": result.get('nir_s3_url', ''),
        "nir08_s3_url": result.get('nir08_s3_url', ''),
        "swir2_s3_url": result.get('swir2_s3_url', ''),
        "cloud_pct": result.get('cloud_pct'),
        "tile_id": result.get('tile_id', ''),
        "coverage_pct": result.get('coverage_pct', ''),
        "aoi_clear_pct": quality.get("clear_pct"),
        "aoi_cloud_pct": None if not quality else round(quality.get("cloud_pct", 0) + quality.get("shadow_pct", 0), 1),
        "aoi_snow_pct": quality.get("snow_pct"),
        "aoi_nodata_pct": quality.get("nodata_pct"),
        "candidates": result.get("candidates", []),
    }


@tool
async def get_rasters(location: str, geometry_s3_url: str = None, current_date_str: str = None,
                      max_cloud: float = 30, exclude_dates: str = "") -> str:
    """Get Sentinel-2 satellite imagery bands. Searches BACKWARDS 60 days from current_date_str.

    Args:
        location: Place name (for filenames)
        geometry_s3_url: Boundary from find_location_boundary or create_bbox_from_coordinates
        current_date_str: END date of 60-day search window (YYYY-MM-DD). Searches from (date - 60 days) to date.
            For PRE-event imagery: use a date BEFORE the event (e.g., "2024-12-31" for Jan 2025 fire).
            For POST-event imagery: use a date 1-2 months AFTER the event (e.g., "2025-03-01" for Jan 2025 fire).
        max_cloud: Max cloud % (default 30, retries at 80 if no results)
        exclude_dates: Comma-separated YYYY-MM-DD dates of scenes you inspected and rejected;
            the next-ranked scene in the same window is returned instead

    Returns: JSON with tci_s3_url, red_s3_url, green_s3_url, nir_s3_url, nir08_s3_url, swir2_s3_url,
    date_used, cloud_pct (whole tile), aoi_clear_pct / aoi_cloud_pct (clouds+shadow) / aoi_snow_pct /
    aoi_nodata_pct (measured over YOUR area from the scene classification; null if unavailable),
    and candidates (other scenes in the window as date, cloud_pct, coverage_pct).

    Use date_used in subsequent analysis calls. For comparisons, call this twice with different dates that bracket the event.
    Then inspect_image(tci_s3_url) before displaying or analysing."""
    if not current_date_str:
        current_date_str = datetime.today().strftime("%Y-%m-%d")
    from .inspection import parse_exclude_dates
    excluded = parse_exclude_dates(exclude_dates)
    
    status_msg = f"🔍 STEP 1: Searching for satellite images 📅 Date: {current_date_str}\n☁️ Max cloud: {max_cloud}%"
    if excluded:
        status_msg += f"\n🚫 Excluding rejected scenes: {', '.join(excluded)}"
    logger.info(status_msg)
    _log_mem("get_rasters:start")

    if geometry_s3_url:
        # Download geometry from S3 (GeoJSON format)
        aoi_gdf = download_geometry_from_s3(geometry_s3_url)
        print(aoi_gdf)
    else:
        print("fallback geocode")
        geocode_result = await find_location_boundary(location)
        geocode_result = json.loads(geocode_result) #cast as a json
        aoi_gdf = download_geometry_from_s3(geocode_result["geometry_s3_url"])
        
    bands = ["red", "green", "blue", "nir", "nir08", "swir2"]
    images = get_filtered_images(aoi_gdf, bands=bands, max_cloud=max_cloud, current_date_str=current_date_str,
                                 location=location, exclude_dates=excluded)

    logger.info(f"✅ STEP 1 RESULT: Found {len(images)} images")

    if not images:
        logger.info("⚠️ STEP 1 RETRY: No images found, trying with higher cloud coverage (80%)")
        images = get_filtered_images(aoi_gdf, bands=bands, max_cloud=80, current_date_str=current_date_str,
                                     location=location, exclude_dates=excluded)
        logger.info(f"✅ STEP 1 RETRY RESULT: Found {len(images)} images")
        
    if not images:
        error_msg = f"❌ STEP 1 FAILED: No satellite images found for {location} on {current_date_str}"
        if excluded:
            error_msg += f" (after excluding {', '.join(excluded)})"
        logger.error(error_msg)
        return error_msg
    
    result = images[0]
    quality = result.get("aoi_quality") or {}
    success_msg = (f"✅ STEP 1 SUCCESS: Image found with {result.get('cloud_pct', 'N/A')}% tile cloud, "
                   f"AOI clear {quality.get('clear_pct', 'n/a')}%\n🛰️ Date: {result.get('date', 'Unknown')}")
    logger.info(success_msg)
    
    out = json.dumps(_raster_result_json(result, location))
    
    _log_mem("get_rasters:end")
    return out


def _fetch_and_map_rasters(aoi_gdf, location, current_date_str, max_cloud, exclude_dates=()):
    """Synchronous worker: search + clip + upload Sentinel-2 bands for ONE date.

    Returns a dict matching get_rasters' output shape, or None if no image found.
    Safe to run in a thread (get_filtered_images uses unique temp dirs + S3 keys).
    """
    bands = ["red", "green", "blue", "nir", "nir08", "swir2"]
    images = get_filtered_images(aoi_gdf, bands=bands, max_cloud=max_cloud,
                                 current_date_str=current_date_str, location=location,
                                 exclude_dates=exclude_dates)
    if not images:
        images = get_filtered_images(aoi_gdf, bands=bands, max_cloud=80,
                                     current_date_str=current_date_str, location=location,
                                     exclude_dates=exclude_dates)
    if not images:
        return None
    return _raster_result_json(images[0], location)


@tool
async def get_rasters_for_dates(location: str, date1_str: str, date2_str: str,
                                geometry_s3_url: str = None, max_cloud: float = 30,
                                exclude_dates: str = "") -> str:
    """Fetch Sentinel-2 imagery for TWO dates IN PARALLEL. Use this for change
    detection / before-after comparisons instead of calling get_rasters twice — it
    resolves the geometry once and fetches both dates concurrently (~2x faster).

    Args:
        location: Place name (for filenames)
        date1_str: First date YYYY-MM-DD (END of 60-day search window, e.g. PRE-event)
        date2_str: Second date YYYY-MM-DD (END of 60-day search window, e.g. POST-event)
        geometry_s3_url: Boundary from find_location_boundary / get_best_geometry / create_bbox_from_coordinates
        max_cloud: Max cloud % (default 30, retries at 80)
        exclude_dates: Comma-separated YYYY-MM-DD dates of scenes you inspected and rejected
            (applies to both windows; a date only ever falls in one of them)

    Returns: JSON {"date1": {...}, "date2": {...}} where each object has the same
    fields as get_rasters (tci_s3_url, band URLs, date_used, cloud_pct, aoi_clear_pct,
    aoi_cloud_pct, aoi_nodata_pct, candidates). Feed the band URLs straight into
    run_change_detection after inspecting both TCIs."""
    from concurrent.futures import ThreadPoolExecutor
    from .inspection import parse_exclude_dates
    excluded = parse_exclude_dates(exclude_dates)

    logger.info(f"🔍 Fetching rasters for TWO dates in parallel: {date1_str} + {date2_str}"
                + (f" (excluding {', '.join(excluded)})" if excluded else ""))
    _log_mem("get_rasters_for_dates:start")

    # Resolve geometry once (shared, read-only, by both date fetches)
    if geometry_s3_url:
        aoi_gdf = download_geometry_from_s3(geometry_s3_url)
    else:
        geocode_result = json.loads(await find_location_boundary(location))
        aoi_gdf = download_geometry_from_s3(geocode_result["geometry_s3_url"])

    # Fetch both dates concurrently; each fetch also clips/uploads its bands in parallel.
    with ThreadPoolExecutor(max_workers=2) as ex:
        f1 = ex.submit(_fetch_and_map_rasters, aoi_gdf, location, date1_str, max_cloud, excluded)
        f2 = ex.submit(_fetch_and_map_rasters, aoi_gdf, location, date2_str, max_cloud, excluded)
        r1, r2 = f1.result(), f2.result()

    missing = [d for d, r in ((date1_str, r1), (date2_str, r2)) if not r]
    if missing:
        return json.dumps({"error": f"No satellite images found for {location} on: {', '.join(missing)}"})

    logger.info(f"✅ Both dates fetched in parallel: {r1['date_used']} + {r2['date_used']}")
    _log_mem("get_rasters_for_dates:end")
    return json.dumps({"date1": r1, "date2": r2})


#####################################
### BANDMATH TOOLS
#####################################

#TODO: more general run_bandmath approach (similar to calculator, calculate any spectral index), 
#also enable differencing of images
@tool
async def run_bandmath(
    location: str,
    index_type: str,
    band1_url: str,
    band2_url: str,
    date_str: str = None,
    geometry_s3_url: str = None
) -> str:
    """Calculate spectral indices (NDVI, NDWI, NBR). ALWAYS pass date_str and geometry_s3_url!
    
    Args:
        location: Place name
        index_type: Type of index - "NDVI", "NDWI", or "NBR"
        band1_url: First band URL (red for NDVI, green for NDWI, nir08 for NBR)
        band2_url: Second band URL (nir for NDVI/NDWI, swir2 for NBR)
        date_str: Date from get_rasters (CRITICAL for unique filenames)
        geometry_s3_url: Geometry for clipping
    
    Returns: JSON with statistics, area per class, and S3 URL for the calculated index
    
    Index Types:
    - NDVI (Vegetation): band1=red, band2=nir
      Classes: (-1,0]=no vegetation (water, rock, structures), (0,0.5]=light vegetation (shrubs, grass, fields), 
               (0.5,0.7]=dense vegetation (plantations), (0.7,1]=very dense vegetation (rainforest)
      Use for: Vegetation health, deforestation, crop monitoring, land cover analysis
      
    - NDWI (Water): band1=green, band2=nir
      Classes: >0.3=water, 0.1-0.3=vegetation/moisture, 0-0.1=built-up, <0=other
      Use for: Flood monitoring, drought analysis, reservoir levels, water body mapping
      
    - NBR (Burn): band1=nir08 (20m), band2=swir2 (20m)
      Classes: >0.1=unburned, -0.1 to 0.1=moderate burn, <-0.1=high severity burn
      Use for: Wildfire damage assessment, burn severity mapping, post-fire recovery"""

    
    index_type = index_type.upper()
    
    if index_type not in ["NDVI", "NDWI", "NBR"]:
        return json.dumps({"error": f"Invalid index_type: {index_type}. Must be NDVI, NDWI, or NBR"})
    
    try:
        # NDVI calculation
        if index_type == "NDVI":
            status_msg = f"🌿 VEGETATION ANALYSIS: Calculating NDVI\n📍 Location: {location}\n📅 Date: {date_str or 'today'}\n🔴 Red band: {band1_url[:50]}...\n🟢 NIR band: {band2_url[:50]}..."
            logger.info(status_msg)
            
            stats = await calculate_ndvi_stats(band1_url, band2_url, date_str, geometry_s3_url, location)
            
            success_msg = f"✅ NDVI SUCCESS: Very Dense={stats['very_dense_vegetation_percentage']:.1f}%, Dense={stats['dense_vegetation_percentage']:.1f}%, Light={stats['light_vegetation_percentage']:.1f}%, None={stats['no_vegetation_percentage']:.1f}%"
            logger.info(success_msg)
            
            return json.dumps({
                "index_type": "NDVI",
                "min": stats['min'],
                "max": stats['max'],
                "mean": stats['mean'],
                "median": stats['median'],
                "count": stats['count'],
                "no_vegetation_percentage": stats['no_vegetation_percentage'],
                "no_vegetation_area_m2": stats['no_vegetation_area_m2'],
                "light_vegetation_percentage": stats['light_vegetation_percentage'],
                "light_vegetation_area_m2": stats['light_vegetation_area_m2'],
                "dense_vegetation_percentage": stats['dense_vegetation_percentage'],
                "dense_vegetation_area_m2": stats['dense_vegetation_area_m2'],
                "very_dense_vegetation_percentage": stats['very_dense_vegetation_percentage'],
                "very_dense_vegetation_area_m2": stats['very_dense_vegetation_area_m2'],
                "location": location,
                "result_s3_url": stats.get('ndvi_s3_url', '')
            })
        
        # NDWI calculation
        elif index_type == "NDWI":
            status_msg = f"🌊 WATER ANALYSIS: Calculating NDWI\n📍 Location: {location}\n📅 Date: {date_str or 'today'}\n🟢 Green band: {band1_url[:50]}...\n🟤 NIR band: {band2_url[:50]}..."
            logger.info(status_msg)
            
            stats = await calculate_ndwi_stats(band1_url, band2_url, date_str, geometry_s3_url, location)
            
            success_msg = f"✅ NDWI SUCCESS: Water={stats['water_percentage']:.1f}%, Non-water={stats['non_water_percentage']:.1f}%"
            logger.info(success_msg)
            
            return json.dumps({
                "index_type": "NDWI",
                "mean": stats['mean'],
                "water_percentage": stats['water_percentage'],
                "water_area_m2": stats['water_area_m2'],
                "non_water_percentage": stats['non_water_percentage'],
                "non_water_area_m2": stats['non_water_area_m2'],
                "location": location,
                "result_s3_url": stats.get('ndwi_s3_url', '')
            })
        
        # NBR calculation
        elif index_type == "NBR":
            status_msg = f"🔥 FIRE ANALYSIS: Calculating NBR\n📍 Location: {location}\n📅 Date: {date_str or 'today'}\n🟤 NIR08 band (20m): {band1_url[:50]}...\n🟠 SWIR2 band (20m): {band2_url[:50]}..."
            logger.info(status_msg)
            
            stats = await calculate_nbr_stats(band1_url, band2_url, date_str, geometry_s3_url, location)
            
            success_msg = f"✅ NBR SUCCESS: High severity={stats['high_severity_percentage']:.1f}%, Moderate={stats['moderate_severity_percentage']:.1f}%, Unburned={stats['unburned_percentage']:.1f}%"
            logger.info(success_msg)
            
            return json.dumps({
                "index_type": "NBR",
                "mean": stats['mean'],
                "high_severity_percentage": stats['high_severity_percentage'],
                "high_severity_area_m2": stats['high_severity_area_m2'],
                "moderate_severity_percentage": stats['moderate_severity_percentage'],
                "moderate_severity_area_m2": stats['moderate_severity_area_m2'],
                "unburned_percentage": stats['unburned_percentage'],
                "unburned_area_m2": stats['unburned_area_m2'],
                "location": location,
                "result_s3_url": stats.get('nbr_s3_url', '')
            })
            
    except Exception as e:
        error_msg = f"❌ {index_type} ANALYSIS ERROR: {str(e)}"
        logger.error(error_msg)
        return json.dumps({"error": error_msg})


#####################################
### IMPACT CALCULATION TOOLS
#####################################

@tool
async def calculate_environmental_impact(affected_area_m2: float, index_type: str) -> str:
    """Calculate environmental impact metrics based on affected area and index type.
    
    Args:
        affected_area_m2: Affected area in square meters
        index_type: Type of index used - "NDVI", "NBR", or "NDWI"
    
    Returns: JSON with impact metrics:
        - vegetation_co2: CO2 sequestration impact (kg) for NDVI
        - burn_co2: CO2 emissions from burning (kg) for NBR
        - water_quantity: Water volume (m³) for NDWI
        - affected_area_km2: Area in km² for reference
    
    Impact Calculations:
    - NDVI (Vegetation): vegetation_co2 = area × 0.0025 kg/m² (annual CO2 sequestration)
      Use for: Estimating carbon sequestration loss from deforestation
    - NBR (Burn): burn_co2 = area × 0.015 kg/m² (CO2 released from burning)
      Use for: Estimating carbon emissions from wildfires
    - NDWI (Water): water_quantity = area × 0.001 m³/m² (1mm water depth)
      Use for: Estimating water volume in floods or reservoirs
    
    Example:
        For 1 km² (1,000,000 m²) of burned forest:
        burn_co2 = 1,000,000 × 0.015 = 15,000 kg = 15 metric tons CO2"""
    
    try:
        # Validate inputs
        affected_area_m2 = float(affected_area_m2)
        index_type = index_type.upper()
        
        if index_type not in config.IMPACT_METRICS:
            return json.dumps({
                "error": f"Invalid index_type: {index_type}. Must be NDVI, NBR, or NDWI"
            })
        
        if affected_area_m2 <= 0:
            return json.dumps({
                "error": f"Invalid affected_area_m2: {affected_area_m2}. Must be positive"
            })
        
        # Get impact metrics for the index type
        metrics = config.IMPACT_METRICS[index_type]
        
        # Convert area to km² for readability
        affected_area_km2 = affected_area_m2 / 1_000_000
        
        logger.info(f"🌍 IMPACT CALCULATION: {index_type}")
        logger.info(f"   Area: {affected_area_km2:.2f} km² ({affected_area_m2:,.0f} m²)")
        
        # Base result with common fields
        result = {
            "index_type": index_type,
            "affected_area_m2": round(affected_area_m2, 2),
            "affected_area_km2": round(affected_area_km2, 4)
        }
        
        # Add only relevant metrics based on index type
        if index_type == "NDVI" or index_type == "CHANGE_DETECTION":
            vegetation_co2_kg = affected_area_m2 * metrics["vegetation_co2_per_m2"]
            vegetation_co2_tons = vegetation_co2_kg / 1000
            
            result["vegetation_co2_kg"] = round(vegetation_co2_kg, 2)
            result["vegetation_co2_tons"] = round(vegetation_co2_tons, 2)
            if index_type == "CHANGE_DETECTION":
                result["interpretation"] = f"The detected land change area of {affected_area_km2:.2f} km² represents approximately {vegetation_co2_tons:.2f} metric tons of potential CO2 sequestration capacity affected per year"
            else:
                result["interpretation"] = f"This vegetation area sequesters approximately {vegetation_co2_tons:.2f} metric tons of CO2 per year"
            
            logger.info(f"   🌱 Vegetation CO2 sequestration: {vegetation_co2_tons:.2f} metric tons/year")
            
        elif index_type == "NBR":
            burn_co2_kg = affected_area_m2 * metrics["burn_co2_per_m2"]
            burn_co2_tons = burn_co2_kg / 1000
            
            result["burn_co2_kg"] = round(burn_co2_kg, 2)
            result["burn_co2_tons"] = round(burn_co2_tons, 2)
            result["interpretation"] = f"The burned area released approximately {burn_co2_tons:.2f} metric tons of CO2 into the atmosphere"
            
            logger.info(f"   🔥 Burn CO2 emissions: {burn_co2_tons:.2f} metric tons")
            
        elif index_type == "NDWI":
            water_quantity_m3 = affected_area_m2 * metrics["water_quantity_per_m2"]
            
            result["water_quantity_m3"] = round(water_quantity_m3, 2)
            result["water_quantity_liters"] = round(water_quantity_m3 * 1000, 2)
            result["interpretation"] = f"The water body contains approximately {water_quantity_m3:,.0f} cubic meters ({water_quantity_m3 * 1000:,.0f} liters) of water"
            
            logger.info(f"   💧 Water volume: {water_quantity_m3:,.0f} m³ ({water_quantity_m3 * 1000:,.0f} liters)")
        
        logger.info(f"✅ IMPACT CALCULATION SUCCESS")
        
        return json.dumps(result, indent=2)
        
    except ValueError as e:
        error_msg = f"Invalid input values: {str(e)}"
        logger.error(f"❌ IMPACT CALCULATION ERROR: {error_msg}")
        return json.dumps({"error": error_msg})
        
    except Exception as e:
        error_msg = f"Unexpected error in impact calculation: {str(e)}"
        logger.error(f"❌ IMPACT CALCULATION ERROR: {error_msg}")
        return json.dumps({"error": error_msg})


#####################################
### CHANGE DETECTION TOOLS
#####################################

@tool
async def scan_region_change(
    region: str,
    year1: int,
    month1: int,
    year2: int,
    month2: int,
    top_n: int = 20,
    geometry_s3_url: str = None,
    bbox: list = None,
    min_change_score: float = 0.25,
    min_separation_km: float = 3.0,
    min_neighbors: int = 2,
) -> str:
    """Scan an entire country or large region for land surface change hotspots using Clay AI embeddings.

    This is a FAST broad-area scan (seconds to minutes) that identifies WHERE change happened
    at 1.28km resolution across an entire country. Use the returned hotspot bboxes to drill
    into specific areas with run_change_detection for pixel-level detail.

    IMPORTANT: Very large countries (USA, Brazil, China, Canada, India) may take too long.
    For these, suggest scanning a specific state/region instead. Medium countries (Colombia,
    Peru, Costa Rica, etc.) work well.

    Args:
        region: Whole country or US state name (e.g. "Colombia", "Colorado"). For a
            named SUB-REGION, also pass geometry_s3_url (see below) - do NOT rely on the name.
        year1: Earlier year (e.g. 2020)
        month1: Earlier month (1-12)
        year2: Later year (e.g. 2025)
        month2: Later month (1-12)
        top_n: Number of top hotspots to return (default 20)
        min_change_score: Minimum change score (0-1) a cell must exceed to count as
            changed (default 0.25). Higher = fewer, more confident changes and a more
            credible "% changed" statistic; lower (e.g. 0.15) is more permissive.
        min_separation_km: Spatially thin hotspots so each is at least this many km from
            the others (default 3.0 ≈ 2 grid cells). Raise to ~8-10 for very spread-out,
            distinct hotspots; set 0 to disable. Ranking is deterministic (change_score,
            then similarity, then location), so the same top hotspots return every run.
        min_neighbors: Coherence filter (default 2). A hotspot cell must have at least this
            many changed neighbors (8-connected on the 1.28km grid), which drops isolated
            single-cell hits that are usually cloud/edge noise rather than real change
            fronts. Set 0 to disable.
        bbox: OPTIONAL [west, south, east, north] in degrees. PREFERRED way to scan a
            NAMED SUB-REGION (valley, basin, metro, mountain range): pass the area's
            approximate extent directly. Do NOT pass the parent state/country name.
        geometry_s3_url: OPTIONAL. For a NAMED SUB-REGION (valley, county, metro, basin,
            mountain range, national forest - anything smaller than a whole supported
            country/state), geocode the area first (find_location_boundary +
            get_best_geometry) and pass the resulting geometry here; the scan then covers
            only that area's bounding box. Leave unset only for a whole supported
            country/US-state named in `region`.

    Returns: JSON with:
        - summary: total cells scanned, area covered, % changed, timing
        - hotspots: Top N areas ranked by change severity, each with center_lat/lon and bbox for drill-in
        - hotspot_geometry_s3_url: GeoJSON of hotspot locations for map display

    Workflow:
    1. User asks: "Where has deforestation occurred in Colombia between 2020 and 2025?"
    2. Call scan_region_change("Colombia", 2020, 6, 2025, 6)
    3. display_visual(hotspot_geometry_s3_url) to show hotspots on map
    4. Present hotspot results with locations and severity
    5. User selects a hotspot → use its bbox with get_rasters + run_change_detection for detailed analysis

    For very large countries (USA, Brazil, China, India, Canada, Australia):
    - Suggest scanning a sub-region: "Colorado", "Rondônia State", "New South Wales"
    - Or use a custom bbox for a specific area of interest

    Coverage: Global Sentinel-2 archive, Jan 2017 - April 2026, monthly resolution.
    Resolution: 1.28km grid cells (each cell is one Clay v1.5 embedding).
    Method: Cosine similarity between embedding vectors — semantically aware, ignores seasonal noise.
    """
    from .lgnd_embeddings import scan_region_change as _scan_region, COUNTRY_BBOXES

    try:
        region_lower = region.lower().strip()
        # Resolve the scan bbox. Priority:
        #   1. An explicit bbox [west, south, east, north] in degrees - best for a
        #      named sub-region whose extent the caller knows (valley/basin/metro).
        #   2. A geocoded geometry (geometry_s3_url) -> use its bounds.
        #   3. An EXACT match in the known whole-country/state table.
        # We intentionally do NOT substring-match the name against the table, so
        # "San Luis Valley, Colorado" never collapses to the whole Colorado bbox.
        if bbox is not None:
            try:
                if isinstance(bbox, str):
                    bbox = [float(x) for x in bbox.strip("[]() ").split(",")]
                w, s, e, n = (float(v) for v in bbox)
                bbox = (w, s, e, n)
                logger.info("REGION SCAN (explicit bbox): %s %s, %d-%02d -> %d-%02d",
                            region, bbox, year1, month1, year2, month2)
            except Exception:
                return json.dumps({"error": f"Invalid bbox {bbox!r}; expected [west, south, east, north] in degrees."})
        elif geometry_s3_url:
            try:
                geom_gdf = download_geometry_from_s3(geometry_s3_url).to_crs("EPSG:4326")
                minx, miny, maxx, maxy = (float(v) for v in geom_gdf.total_bounds)
                bbox = (minx, miny, maxx, maxy)
                logger.info("REGION SCAN (geocoded sub-region): %s bbox=%s, %d-%02d -> %d-%02d",
                            region, bbox, year1, month1, year2, month2)
            except Exception as e:
                return json.dumps({"error": f"Could not read geometry for '{region}': {e}"})
        elif region_lower in COUNTRY_BBOXES:
            bbox = COUNTRY_BBOXES[region_lower]
            logger.info("REGION SCAN: %s (%s), %d-%02d -> %d-%02d",
                        region, bbox, year1, month1, year2, month2)
        else:
            return json.dumps({
                "error": (
                    f"'{region}' is not a recognized whole country or US state. If it is a "
                    f"sub-region (valley, county, metro, basin, park, mountain range, etc.), "
                    f"pass its extent directly as bbox=[west, south, east, north] in degrees "
                    f"(or geometry_s3_url from a geocoded boundary). Do NOT substitute the "
                    f"parent state/country."
                ),
                "supported_whole_regions_sample": sorted(COUNTRY_BBOXES.keys())[:20],
            })

        # Check if region is very large (>20 geohashes would be excessive)
        from .lgnd_embeddings import _get_geohashes_for_bbox
        scan_geohashes = _get_geohashes_for_bbox(bbox[0], bbox[1], bbox[2], bbox[3])
        if len(scan_geohashes) > 20:
            return json.dumps({
                "error": f"Region '{region}' spans {len(scan_geohashes)} geohash partitions (max 20). "
                         f"Please scan a smaller sub-region."
            })

        result = _scan_region(
            bbox=bbox,
            year1=year1,
            month1=month1,
            year2=year2,
            month2=month2,
            top_n=top_n,
            min_change_score=min_change_score,
            min_separation_km=min_separation_km,
            min_neighbors=min_neighbors,
        )

        if "error" in result:
            return json.dumps(result)

        # Build GeoJSON for map display: ALL changed cells as a density layer,
        # colored by change_score, with the top-N hotspots tagged (tier="top",
        # plus rank) so the frontend can highlight them distinctly.
        all_cells = result.get("_all_cells", [])
        change_geojson = {
            "type": "FeatureCollection",
            "features": []
        }
        for c in all_cells:
            b = c.get("bbox")
            if not b:
                continue
            rank = c.get("rank")
            feature = {
                "type": "Feature",
                "properties": {
                    "change_score": c.get("change_score", 0),
                    "rank": rank,
                    "tier": "top" if rank else "change",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [b["west"], b["south"]],
                        [b["east"], b["south"]],
                        [b["east"], b["north"]],
                        [b["west"], b["north"]],
                        [b["west"], b["south"]],
                    ]]
                }
            }
            change_geojson["features"].append(feature)

        # Fallback: if for some reason _all_cells is empty, fall back to the
        # top-N hotspots so the map still shows something.
        if not change_geojson["features"]:
            for h in result.get("hotspots", []):
                if h.get("bbox"):
                    b = h["bbox"]
                    change_geojson["features"].append({
                        "type": "Feature",
                        "properties": {
                            "change_score": h["change_score"],
                            "rank": h["rank"],
                            "tier": "top",
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[
                                [b["west"], b["south"]],
                                [b["east"], b["south"]],
                                [b["east"], b["north"]],
                                [b["west"], b["north"]],
                                [b["west"], b["south"]],
                            ]]
                        }
                    })

        # Save change GeoJSON to S3
        s3_client = boto3.client('s3')
        session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
        bucket_name = config.S3_BUCKET_NAME
        clean_region = _slugify(region)
        s3_key = f"session_data/{session_id}/geometries/scan_hotspots_{clean_region}_{year1}{month1:02d}_to_{year2}{month2:02d}.geojson"

        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=json.dumps(change_geojson).encode('utf-8'),
            ContentType='application/geo+json'
        )
        hotspot_s3_url = f"s3://{bucket_name}/{s3_key}"

        # Strip the internal full-cell list so it does not bloat the LLM context;
        # the model still gets the ranked top-N hotspots for narration.
        cells_shown = len(change_geojson["features"])
        result.pop("_all_cells", None)

        # Enhance result with region metadata
        result["region"] = region
        result["hotspot_geometry_s3_url"] = hotspot_s3_url
        result["cells_displayed"] = cells_shown
        result["method"] = "Clay v1.5 foundation model embeddings (LGND/Source Cooperative)"
        result["resolution"] = "1.28km grid cells"
        result["interpretation"] = (
            f"Scanned {result['summary']['total_cells_scanned']:,} cells "
            f"({result['summary']['area_scanned_km2']:,.0f} km²) using peak-season "
            f"{result['summary'].get('month_name', '')} imagery. "
            f"{result['summary']['cells_with_change']:,} cells ({result['summary']['change_percentage']:.1f}%) "
            f"show significant change. The map layer (hotspot_geometry_s3_url) shows ALL "
            f"{cells_shown:,} changed cells colored by change score, with the top "
            f"{len(result.get('hotspots', []))} hotspots highlighted. "
            f"Display hotspot_geometry_s3_url on the map, then drill into a specific hotspot "
            f"with run_change_detection."
        )
        # Include drill-in recommendation prominently
        if "drill_in_recommendation" in result:
            result["IMPORTANT_for_drill_in"] = result["drill_in_recommendation"]

        logger.info(f"✅ REGION SCAN COMPLETE: {result['summary']['total_cells_scanned']:,} cells, "
                    f"{result['summary']['cells_with_change']} changed, "
                    f"{result['summary']['total_time_s']:.1f}s")

        return json.dumps(result)

    except Exception as e:
        error_msg = f"❌ REGION SCAN ERROR: {type(e).__name__}: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({"error": error_msg})


@tool
async def run_change_detection(
    location: str,
    red_s3_url_date1: str,
    nir_s3_url_date1: str,
    green_s3_url_date1: str,
    red_s3_url_date2: str,
    nir_s3_url_date2: str,
    green_s3_url_date2: str,
    date1_str: str,
    date2_str: str,
    geometry_s3_url: str = None,
    nir08_s3_url_date1: str = None,
    swir2_s3_url_date1: str = None,
    nir08_s3_url_date2: str = None,
    swir2_s3_url_date2: str = None,
    blue_s3_url_date1: str = None,
    blue_s3_url_date2: str = None,
) -> str:
    """Detect land surface changes between two dates using multi-index spectral analysis.
    Produces two change maps: a spectral index composite and iMAD. (Embedding-based
    change is handled separately by the scan_region_change tool.)

    REQUIRES calling get_rasters TWICE first (once per date) to obtain band URLs.

    Args:
        location: Place name (for filenames)
        red_s3_url_date1: Red band S3 URL for earlier date
        nir_s3_url_date1: NIR band S3 URL for earlier date
        green_s3_url_date1: Green band S3 URL for earlier date
        red_s3_url_date2: Red band S3 URL for later date
        nir_s3_url_date2: NIR band S3 URL for later date
        green_s3_url_date2: Green band S3 URL for later date
        date1_str: Earlier date (YYYY-MM-DD) from get_rasters date_used
        date2_str: Later date (YYYY-MM-DD) from get_rasters date_used
        geometry_s3_url: Geometry for clipping (from find_location_boundary or create_bbox_from_coordinates)
        nir08_s3_url_date1: Optional NIR08 (20m) for date 1 — enables NBR in composite
        swir2_s3_url_date1: Optional SWIR2 (20m) for date 1 — enables NBR in composite
        nir08_s3_url_date2: Optional NIR08 (20m) for date 2 — enables NBR in composite
        swir2_s3_url_date2: Optional SWIR2 (20m) for date 2 — enables NBR in composite
        blue_s3_url_date1: Optional Blue band (10m) for date 1 — enables BSI (Bare Soil Index) for construction detection
        blue_s3_url_date2: Optional Blue band (10m) for date 2 — enables BSI

    Returns: JSON with change statistics (per-class areas and percentages), change_map_s3_url for visualization

    The output raster uses values 0-1 (composite change score). Display with display_visual — the frontend
    renders it with a reversed RdYlGn colormap (green=no change, yellow=moderate, red=high change).

    Workflow:
    1. get_rasters(date1) + get_rasters(date2) in PARALLEL
    2. run_change_detection(all band URLs from both dates)
    3. display_visual(geometry) then display_visual(change_map_s3_url)
    """
    import shutil
    from .raster_utils import clip_raster_v2
    from .aws_utils import download_geometry_from_s3
    from .change_detection_utils import (
        compute_index_delta,
        compute_bsi_delta,
        compute_composite_change_score,
        compute_change_statistics,
        imad_change_score,
    )

    temp_dir = tempfile.mkdtemp(prefix='change_detect_')

    try:
        s3_client = boto3.client('s3')
        session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
        bucket_name = config.S3_BUCKET_NAME

        logger.info(f"🔄 CHANGE DETECTION: {location}")
        logger.info(f"   Date 1: {date1_str}, Date 2: {date2_str}")
        _log_mem("change_detection:start")

        # Guard rail: run_change_detection is pixel-level and only processes a
        # single Sentinel-2 tile (~110 km across). If the AOI is larger than one
        # tile can cover, the result would silently represent just a sliver of the
        # requested area while appearing to cover all of it. Reject oversized AOIs
        # up front (before any downloads) and route the caller to scan_region_change.
        if geometry_s3_url:
            try:
                guard_gdf = download_geometry_from_s3(geometry_s3_url)
                area_km2 = float(guard_gdf.to_crs("EPSG:6933").geometry.area.sum()) / 1_000_000
                if area_km2 > config.MAX_CHANGE_DETECTION_AREA_KM2:
                    logger.warning("⚠️ CHANGE DETECTION: AOI too large (%.0f km² > %d km²) — routing to scan_region_change",
                                   area_km2, config.MAX_CHANGE_DETECTION_AREA_KM2)
                    return json.dumps({
                        "error": (
                            f"The area for '{location}' is ~{area_km2:,.0f} km², which is too large for "
                            f"pixel-level change detection (limit {config.MAX_CHANGE_DETECTION_AREA_KM2:,} km²). "
                            f"run_change_detection processes a single Sentinel-2 tile (~110 km across), so it "
                            f"would only cover a small part of this area and misrepresent the result."
                        ),
                        "area_km2": round(area_km2, 1),
                        "max_area_km2": config.MAX_CHANGE_DETECTION_AREA_KM2,
                        "recommended_tool": "scan_region_change",
                        "recommendation": (
                            "Use scan_region_change for a broad hotspot scan of the whole region, then drill "
                            "into a specific hotspot (under ~100 km²) with run_change_detection for detail."
                        ),
                    })
            except Exception as guard_err:
                # If the area check itself fails, don't block the analysis — log and continue.
                logger.warning("Change detection area guard skipped (%s): %s",
                               type(guard_err).__name__, guard_err)

        # --- Helper to download a band from S3 ---
        def download_band(s3_url, label):
            b, k = s3_url.replace('s3://', '').split('/', 1)
            local = f"{temp_dir}/{label}.tif"
            s3_client.download_file(b, k, local)
            return local

        # --- Download 10m bands for both dates ---
        red1_path = download_band(red_s3_url_date1, "red_d1")
        nir1_path = download_band(nir_s3_url_date1, "nir_d1")
        green1_path = download_band(green_s3_url_date1, "green_d1")
        red2_path = download_band(red_s3_url_date2, "red_d2")
        nir2_path = download_band(nir_s3_url_date2, "nir_d2")
        green2_path = download_band(green_s3_url_date2, "green_d2")

        # --- Decide decimation factor from the base (10m) band size ---
        # Downsampling large AOIs cuts band-read + iMAD cost ~N^2 with negligible
        # visual impact (change maps are displayed downsampled anyway). Small AOIs
        # stay full resolution.
        from rasterio.enums import Resampling
        with rasterio.open(red1_path) as src:
            _native_max = max(src.width, src.height)
        decimate = config.CHANGE_DETECTION_DOWNSAMPLE if _native_max >= 1024 else 1

        def _read_band(path):
            """Read band 1, decimated by `decimate` with averaging resampling."""
            with rasterio.open(path) as src:
                oh = max(1, src.height // decimate)
                ow = max(1, src.width // decimate)
                return src.read(1, out_shape=(oh, ow), resampling=Resampling.average)

        # --- Read arrays (decimated to a common 10m-equivalent grid) ---
        with rasterio.open(red1_path) as src:
            oh = max(1, src.height // decimate)
            ow = max(1, src.width // decimate)
            red1 = src.read(1, out_shape=(oh, ow), resampling=Resampling.average)
            # Scale the transform so the decimated raster stays correctly georeferenced
            # (keeps per-pixel area, and therefore change-area stats, accurate).
            transform = src.transform * src.transform.scale(src.width / ow, src.height / oh)
            profile = src.profile.copy()
            profile.update({"width": ow, "height": oh, "transform": transform})

        nir1 = _read_band(nir1_path)
        green1 = _read_band(green1_path)
        red2 = _read_band(red2_path)
        nir2 = _read_band(nir2_path)
        green2 = _read_band(green2_path)

        # --- Download optional 20m bands ---
        nir08_1 = nir08_2 = swir2_1 = swir2_2 = None
        if all([nir08_s3_url_date1, swir2_s3_url_date1, nir08_s3_url_date2, swir2_s3_url_date2]):
            nir08_1_path = download_band(nir08_s3_url_date1, "nir08_d1")
            swir2_1_path = download_band(swir2_s3_url_date1, "swir2_d1")
            nir08_2_path = download_band(nir08_s3_url_date2, "nir08_d2")
            swir2_2_path = download_band(swir2_s3_url_date2, "swir2_d2")
            nir08_1 = _read_band(nir08_1_path)
            swir2_1 = _read_band(swir2_1_path)
            nir08_2 = _read_band(nir08_2_path)
            swir2_2 = _read_band(swir2_2_path)

        # --- Download optional blue band (10m) ---
        blue1 = blue2 = None
        if blue_s3_url_date1 and blue_s3_url_date2:
            blue1_path = download_band(blue_s3_url_date1, "blue_d1")
            blue2_path = download_band(blue_s3_url_date2, "blue_d2")
            blue1 = _read_band(blue1_path)
            blue2 = _read_band(blue2_path)

        # ===================================================================
        # Run Tier 1 (spectral index) and Tier 2 (iMAD) in parallel
        # ===================================================================
        from concurrent.futures import ThreadPoolExecutor, as_completed

        clean_location = _slugify(location)

        # Prepare geometry clipping resources once (shared by both tiers)
        aoi_gdf = None
        aoi_path = None
        if geometry_s3_url:
            aoi_gdf = download_geometry_from_s3(geometry_s3_url)
            with rasterio.open(red1_path) as src:
                aoi_gdf = aoi_gdf.to_crs(src.crs)
            aoi_path = f"{temp_dir}/aoi.geojson"
            aoi_gdf.to_file(aoi_path, driver='GeoJSON')

        def run_tier1():
            """Tier 1: Spectral index differencing (NDVI + NDWI + NBR)."""
            deltas = {}
            deltas["NDVI"] = compute_index_delta(red1, nir1, red2, nir2, "NDVI")
            logger.info(f"   ✅ NDVI delta computed (mean={np.mean(deltas['NDVI']):.4f})")

            deltas["NDWI"] = compute_index_delta(green1, nir1, green2, nir2, "NDWI")
            logger.info(f"   ✅ NDWI delta computed (mean={np.mean(deltas['NDWI']):.4f})")

            if nir08_1 is not None:
                nbr_delta_20m = compute_index_delta(nir08_1, swir2_1, nir08_2, swir2_2, "NBR")
                from scipy.ndimage import zoom
                scale_y = red1.shape[0] / nbr_delta_20m.shape[0]
                scale_x = red1.shape[1] / nbr_delta_20m.shape[1]
                nbr_delta_10m = zoom(nbr_delta_20m, (scale_y, scale_x), order=0)
                nbr_delta_10m = nbr_delta_10m[:red1.shape[0], :red1.shape[1]]
                deltas["NBR"] = nbr_delta_10m.astype(np.float32)
                logger.info(f"   ✅ NBR delta computed (mean={np.mean(deltas['NBR']):.4f})")
            else:
                logger.info("   ℹ️ NBR skipped (20m bands not provided)")

            # BSI delta (optional — needs blue + swir2 + red + nir)
            if blue1 is not None and swir2_1 is not None:
                from scipy.ndimage import zoom as _zoom_bsi
                # Resample SWIR2 from 20m to 10m
                sy = red1.shape[0] / swir2_1.shape[0]
                sx = red1.shape[1] / swir2_1.shape[1]
                swir2_1_10m = _zoom_bsi(swir2_1, (sy, sx), order=0)[:red1.shape[0], :red1.shape[1]]
                swir2_2_10m = _zoom_bsi(swir2_2, (sy, sx), order=0)[:red1.shape[0], :red1.shape[1]]
                deltas["BSI"] = compute_bsi_delta(red1, swir2_1_10m, nir1, blue1,
                                                   red2, swir2_2_10m, nir2, blue2)
                logger.info(f"   ✅ BSI delta computed (mean={np.mean(deltas['BSI']):.4f})")
            else:
                logger.info("   ℹ️ BSI skipped (blue or swir2 bands not provided)")

            composite = compute_composite_change_score(deltas)
            logger.info(f"   ✅ Tier 1 composite: mean={np.mean(composite):.4f}, max={np.max(composite):.4f}")

            # Write temp raster
            t1_temp = f"{temp_dir}/tier1_temp.tif"
            t1_profile = profile.copy()
            t1_profile.update({'driver': 'GTiff', 'dtype': rasterio.float32, 'count': 1})
            with rasterio.open(t1_temp, 'w', **t1_profile) as dst:
                dst.write_band(1, composite)

            # Clip
            t1_cog = f"{temp_dir}/tier1_cog.tif"
            if aoi_path:
                clip_raster_v2(aoi_path, t1_temp, t1_cog)
            else:
                shutil.copy(t1_temp, t1_cog)

            # Upload
            s3_key = f"session_data/{session_id}/rasters/change_detection_{clean_location}_{date1_str}_to_{date2_str}.tif"
            s3_client.upload_file(t1_cog, bucket_name, s3_key)
            url = f"s3://{bucket_name}/{s3_key}"
            logger.info(f"   ✅ Tier 1 change map uploaded: {url}")

            # Stats
            with rasterio.open(t1_cog) as src:
                data = src.read(1)
                t = src.transform
                pix_area = abs(t.a) * abs(t.e)
            stats = compute_change_statistics(data, pix_area)

            return {"url": url, "stats": stats, "indices_used": list(deltas.keys())}

        def run_tier2_imad():
            """Tier 2: iMAD on normalized spectral indices (NDVI, NDWI, optionally NBR).

            Using indices instead of raw bands suppresses atmospheric/illumination
            noise that causes false positives, while iMAD adds multivariate
            statistical rigor on top.
            """
            try:
                eps = 1e-10

                # Compute NDVI for both dates: (NIR - Red) / (NIR + Red)
                ndvi_d1 = (nir1.astype(np.float64) - red1.astype(np.float64)) / (nir1 + red1 + eps)
                ndvi_d2 = (nir2.astype(np.float64) - red2.astype(np.float64)) / (nir2 + red2 + eps)

                # Compute NDWI for both dates: (Green - NIR) / (Green + NIR)
                ndwi_d1 = (green1.astype(np.float64) - nir1.astype(np.float64)) / (green1 + nir1 + eps)
                ndwi_d2 = (green2.astype(np.float64) - nir2.astype(np.float64)) / (green2 + nir2 + eps)

                bands_d1 = [ndvi_d1, ndwi_d1]
                bands_d2 = [ndvi_d2, ndwi_d2]

                # Add NBR if 20m bands are available
                if nir08_1 is not None:
                    from scipy.ndimage import zoom as _zoom
                    nbr_d1_20m = (nir08_1.astype(np.float64) - swir2_1.astype(np.float64)) / (nir08_1 + swir2_1 + eps)
                    nbr_d2_20m = (nir08_2.astype(np.float64) - swir2_2.astype(np.float64)) / (nir08_2 + swir2_2 + eps)
                    # Resample 20m NBR to 10m
                    sy = red1.shape[0] / nbr_d1_20m.shape[0]
                    sx = red1.shape[1] / nbr_d1_20m.shape[1]
                    nbr_d1 = _zoom(nbr_d1_20m, (sy, sx), order=0)[:red1.shape[0], :red1.shape[1]]
                    nbr_d2 = _zoom(nbr_d2_20m, (sy, sx), order=0)[:red1.shape[0], :red1.shape[1]]
                    bands_d1.append(nbr_d1)
                    bands_d2.append(nbr_d2)

                image1 = np.stack(bands_d1, axis=0)
                image2 = np.stack(bands_d2, axis=0)

                n_idx = image1.shape[0]
                logger.info(f"   🔬 iMAD: Running on {n_idx} indices, {image1.shape[1]}x{image1.shape[2]} pixels")

                imad_score = imad_change_score(image1, image2, max_iter=30, tol=1e-3)
                logger.info(f"   ✅ iMAD score: mean={np.mean(imad_score):.4f}, max={np.max(imad_score):.4f}")

                # Write temp raster
                t2_temp = f"{temp_dir}/imad_temp.tif"
                t2_profile = profile.copy()
                t2_profile.update({'driver': 'GTiff', 'dtype': rasterio.float32, 'count': 1})
                with rasterio.open(t2_temp, 'w', **t2_profile) as dst:
                    dst.write_band(1, imad_score)

                # Clip
                t2_cog = f"{temp_dir}/imad_cog.tif"
                if aoi_path:
                    clip_raster_v2(aoi_path, t2_temp, t2_cog)
                else:
                    shutil.copy(t2_temp, t2_cog)

                # Upload
                s3_key = f"session_data/{session_id}/rasters/change_detection_imad_{clean_location}_{date1_str}_to_{date2_str}.tif"
                s3_client.upload_file(t2_cog, bucket_name, s3_key)
                url = f"s3://{bucket_name}/{s3_key}"
                logger.info(f"   ✅ iMAD change map uploaded: {url}")

                # Stats
                with rasterio.open(t2_cog) as src:
                    data = src.read(1)
                    t = src.transform
                    pix_area = abs(t.a) * abs(t.e)
                stats = compute_change_statistics(data, pix_area)

                return {"url": url, "stats": stats}

            except Exception as e:
                logger.error(f"   ⚠️ iMAD failed (Tier 1 still available): {e}", exc_info=True)
                return None

        # Run Tier 1 (spectral composite) and Tier 2 (iMAD) in parallel.
        # NOTE: embedding-based change detection is intentionally handled by the
        # dedicated country/state-wide scan_region_change tool, not here. Keeping
        # this tool to two tiers also bounds its peak memory footprint.
        with ThreadPoolExecutor(max_workers=2) as executor:
            tier1_future = executor.submit(run_tier1)
            tier2_future = executor.submit(run_tier2_imad)

            tier1_result = tier1_future.result()
            tier2_result = tier2_future.result()
        _log_mem("change_detection:after_tiers")

        # --- Build combined result ---
        stats = tier1_result["stats"]
        result = {
            "index_type": "CHANGE_DETECTION",
            "location": location,
            "date1": date1_str,
            "date2": date2_str,
            "indices_used": tier1_result["indices_used"],
            "change_map_s3_url": tier1_result["url"],
            "no_change_percentage": stats["no_change_pct"],
            "no_change_area_m2": stats["no_change_area_m2"],
            "low_change_percentage": stats["low_change_pct"],
            "low_change_area_m2": stats["low_change_area_m2"],
            "moderate_change_percentage": stats["moderate_change_pct"],
            "moderate_change_area_m2": stats["moderate_change_area_m2"],
            "high_change_percentage": stats["high_change_pct"],
            "high_change_area_m2": stats["high_change_area_m2"],
            "mean_change_score": stats["mean_change_score"],
            "max_change_score": stats["max_change_score"],
            "total_changed_area_m2": stats["moderate_change_area_m2"] + stats["high_change_area_m2"],
        }

        # Add iMAD results if available
        if tier2_result:
            imad_stats = tier2_result["stats"]
            result["imad_change_map_s3_url"] = tier2_result["url"]
            result["imad_no_change_percentage"] = imad_stats["no_change_pct"]
            result["imad_high_change_percentage"] = imad_stats["high_change_pct"]
            result["imad_mean_change_score"] = imad_stats["mean_change_score"]
            result["imad_total_changed_area_m2"] = imad_stats["moderate_change_area_m2"] + imad_stats["high_change_area_m2"]

        logger.info(f"✅ CHANGE DETECTION SUCCESS: Tier1 No change={stats['no_change_pct']:.1f}%, "
                     f"Low={stats['low_change_pct']:.1f}%, Moderate={stats['moderate_change_pct']:.1f}%, "
                     f"High={stats['high_change_pct']:.1f}%")
        if tier2_result:
            logger.info(f"   iMAD: No change={imad_stats['no_change_pct']:.1f}%, "
                         f"High={imad_stats['high_change_pct']:.1f}%")

        return json.dumps(result)

    except Exception as e:
        error_msg = f"❌ CHANGE DETECTION ERROR: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return json.dumps({"error": error_msg})

    finally:
        try:
            import shutil as _shutil
            if os.path.exists(temp_dir):
                _shutil.rmtree(temp_dir)
        except Exception:
            pass


#####################################
### PROTECTED AREA CONTEXT (ArcGIS Enterprise WDPA via MCP)
#####################################

def _call_arcgis_mcp(tool_name: str, arguments: dict, timeout: float = 60.0) -> dict:
    """Call a tool on the ArcGIS Enterprise MCP server and return its structuredContent.

    The Living Atlas WDPA service is hosted on ArcGIS Online and is NOT directly
    reachable with the Enterprise token (returns 498 Invalid Token). The Enterprise
    MCP brokers access server-side, so we query through it instead of hitting the
    service URL directly. Auth is the Bearer header (verified against the live
    endpoint). The server handles tools/call statelessly, so a single POST works.
    """
    import httpx

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {config.ARCGIS_MCP_TOKEN}",
    }
    resp = httpx.post(config.ARCGIS_MCP_URL, json=payload, headers=headers, timeout=timeout)
    resp.raise_for_status()

    # Response may be plain JSON or an SSE event stream depending on server mode.
    # NOTE: the server returns ISO-8859-1 (accented WDPA names), and httpx's
    # resp.json() force-decodes as UTF-8 and would crash. Parse resp.text, which
    # honors the charset from the Content-Type header.
    if "text/event-stream" in resp.headers.get("content-type", ""):
        data = None
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                data = json.loads(line[len("data:"):].strip())
                break
        if data is None:
            raise RuntimeError("No data event in MCP SSE response")
    else:
        data = json.loads(resp.text)

    if data.get("error"):
        raise RuntimeError(f"MCP error: {data['error']}")
    result = data.get("result", {})
    if result.get("isError"):
        raise RuntimeError(f"MCP tool '{tool_name}' returned an error: {result}")
    return result.get("structuredContent", {}) or {}


def _esri_rings_to_shapely(rings):
    """Convert Esri polygon 'rings' (coords already in lon/lat) to a shapely geometry.

    Honors Esri ring orientation: clockwise (negative signed area) rings are
    exteriors, counter-clockwise (positive) rings are holes. Returns a
    (Multi)Polygon or None if nothing usable.
    """
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    def signed_area(ring):
        s = 0.0
        for i in range(len(ring) - 1):
            x1, y1 = ring[i][0], ring[i][1]
            x2, y2 = ring[i + 1][0], ring[i + 1][1]
            s += (x1 * y2 - x2 * y1)
        return s / 2.0

    exteriors, holes = [], []
    for ring in rings:
        if len(ring) < 4:
            continue
        (holes if signed_area(ring) > 0 else exteriors).append(ring)
    if not exteriors:
        exteriors = [r for r in rings if len(r) >= 4]
        holes = []
    if not exteriors:
        return None

    geom = unary_union([Polygon(r) for r in exteriors])
    if holes:
        hole_union = unary_union([Polygon(h) for h in holes])
        if not hole_union.is_empty:
            geom = geom.difference(hole_union)
    return None if geom.is_empty else geom


@tool
async def protected_area_context(location: str, geometry_s3_url: str) -> str:
    """Find protected areas (WDPA) intersecting the analysis AOI and summarize protection status.

    Pulls authoritative World Database of Protected Areas polygons from ArcGIS
    Enterprise (via MCP) for the AOI's bounding box, then returns:
      - protected_areas_geojson_s3_url: boundaries to overlay (pass to display_visual)
      - protected_areas_found + names/designations/IUCN categories
      - overlap_pct: approximate % of the AOI that falls inside protected areas
      - iucn_breakdown + total reported area

    Args:
        location: Place name (used for labeling and the output filename)
        geometry_s3_url: AOI geometry from get_best_geometry / create_bbox_from_coordinates

    Returns: JSON summary. After calling, overlay the boundaries with
    display_visual(protected_areas_geojson_s3_url, "Protected Areas").

    Use to answer "is this change inside a protected area?" and to overlay reserve
    boundaries on a focused AOI (a city/park/hotspot, not a whole country)."""
    try:
        import geopandas as gpd
        from shapely.geometry import mapping
        from shapely.ops import unary_union
        from pyproj import Transformer

        session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
        bucket_name = config.S3_BUCKET_NAME

        # 1. Load AOI, compute its 4326 bounding box
        aoi_gdf = download_geometry_from_s3(geometry_s3_url)
        if aoi_gdf is None or aoi_gdf.empty:
            return json.dumps({"error": f"Could not load AOI geometry from {geometry_s3_url}"})
        aoi_gdf = aoi_gdf.to_crs(epsg=4326)
        minx, miny, maxx, maxy = (float(v) for v in aoi_gdf.total_bounds)

        # 2. Query WDPA polygons intersecting the AOI bbox, through the MCP
        layer_url = f"{config.WDPA_SERVICE_URL}/{config.WDPA_POLYGON_LAYER_ID}"
        envelope = json.dumps({
            "xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
            "spatialReference": {"wkid": 4326},
        })
        sc = _call_arcgis_mcp("query_data", {
            "layerOrTableUrl": layer_url,
            "geometry": envelope,
            "geometryType": "esriGeometryEnvelope",
            "spatialRelationship": "esriSpatialRelIntersects",
            "returnGeometry": True,
            "pageSize": 200,
        })
        records = sc.get("resultRecords", []) or []
        total_matching = sc.get("totalMatchingRecords", len(records))

        if not records:
            return json.dumps({
                "location": location,
                "protected_areas_found": 0,
                "overlap_pct": 0.0,
                "message": f"No protected areas intersect the AOI for {location}.",
            })

        # 3. Reproject 3857 -> 4326 (service returns Web Mercator), build GeoJSON + shapes
        to_wgs84 = Transformer.from_crs(3857, 4326, always_xy=True)
        features, shapes_4326, iucn_counts = [], [], {}
        for rec in records:
            rings = (rec.get("geometry") or {}).get("rings")
            if not rings:
                continue
            rings_wgs = [[list(to_wgs84.transform(x, y)) for x, y in ring] for ring in rings]
            shp = _esri_rings_to_shapely(rings_wgs)
            if shp is None:
                continue
            attrs = rec.get("attributes", {})
            iucn = attrs.get("iucn_cat") or "Unknown"
            iucn_counts[iucn] = iucn_counts.get(iucn, 0) + 1
            features.append({
                "type": "Feature",
                "properties": {
                    "name": attrs.get("name_eng") or attrs.get("name") or "Protected Area",
                    "designation": attrs.get("desig_eng"),
                    "iucn_cat": iucn,
                    "status_yr": attrs.get("status_yr"),
                    "rep_area_km2": attrs.get("rep_area"),
                    "gov_type": attrs.get("gov_type"),
                    "__layer_type": "protected_area",
                },
                "geometry": mapping(shp),
            })
            shapes_4326.append(shp)

        if not features:
            return json.dumps({
                "location": location, "protected_areas_found": 0, "overlap_pct": 0.0,
                "message": "Protected areas matched but no usable geometry was returned.",
            })

        # 4. Overlap: intersect AOI with PA union in equal-area CRS (EPSG:6933, meters)
        pa_ea = gpd.GeoDataFrame(geometry=shapes_4326, crs="EPSG:4326").to_crs("EPSG:6933")
        aoi_ea = aoi_gdf.to_crs("EPSG:6933")
        aoi_geom = unary_union(list(aoi_ea.geometry))
        pa_geom = unary_union(list(pa_ea.geometry))
        aoi_area = aoi_geom.area
        inter_area_m2 = aoi_geom.intersection(pa_geom).area if aoi_area > 0 else 0.0
        overlap_pct = round((inter_area_m2 / aoi_area) * 100, 1) if aoi_area > 0 else 0.0
        protected_area_within_aoi_km2 = round(inter_area_m2 / 1_000_000, 2)

        # 5. Save overlay GeoJSON to S3 (rendered through the existing display path)
        fc = {"type": "FeatureCollection", "features": features,
              "locationName": f"Protected Areas near {location}"}
        clean = _slugify(location)
        s3_key = f"session_data/{session_id}/geometries/protected_areas_{clean}.geojson"
        boto3.client('s3').put_object(
            Bucket=bucket_name, Key=s3_key,
            Body=json.dumps(fc).encode('utf-8'), ContentType='application/geo+json')
        s3_url = f"s3://{bucket_name}/{s3_key}"

        # 6. Summaries
        areas = [{
            "name": f["properties"]["name"],
            "designation": f["properties"]["designation"],
            "iucn_cat": f["properties"]["iucn_cat"],
            "status_yr": f["properties"]["status_yr"],
        } for f in features[:15]]
        total_rep_area = round(sum((f["properties"].get("rep_area_km2") or 0) for f in features), 1)

        result = {
            "location": location,
            "protected_areas_geojson_s3_url": s3_url,
            "protected_areas_found": int(total_matching),
            "protected_areas_returned": len(features),
            "overlap_pct": overlap_pct,
            "protected_area_within_aoi_km2": protected_area_within_aoi_km2,
            "total_reported_area_km2": total_rep_area,
            "iucn_breakdown": iucn_counts,
            "areas": areas,
            "note": ("overlap_pct and protected_area_within_aoi_km2 measure how much of the AOI "
                     "falls inside protected-area boundaries. To estimate how much of the DETECTED "
                     "CHANGE is protected, multiply the changed area by overlap_pct/100."),
        }
        result_json = json.dumps(result, indent=2)
        print(f"\n<tool_result_output>\n{result_json}\n</tool_result_output>\n")
        return result_json

    except Exception as e:
        error_msg = f"❌ Error fetching protected-area context for {location}: {str(e)}"
        logger.error(error_msg)
        logger.exception("protected_area_context error")
        return json.dumps({"error": error_msg})


@tool
async def display_protected_area_by_name(name: str, country_iso3: str = None) -> str:
    """Fetch a named protected area's FULL boundary from WDPA and return GeoJSON to display.

    Unlike protected_area_context (which only returns protected areas that INTERSECT an
    AOI), this looks a protected area up BY NAME and returns its complete boundary polygon
    — so it works even when the park is nowhere near the current analysis area. Use when the
    user asks to "show" / "display" a specific named protected area (e.g. "show me
    Bahuaja-Sonene National Park").

    Args:
        name: Protected area name or fragment (e.g. "Bahuaja-Sonene", "Tambopata").
        country_iso3: Optional ISO3 country code (e.g. "PER", "BRA") to disambiguate.

    Returns: JSON with protected_areas_geojson_s3_url (pass to
    display_visual(url, "<name>")), plus the matched name, designation, IUCN category and
    reported area. If several match, the largest by reported area is returned."""
    try:
        from shapely.geometry import mapping
        from pyproj import Transformer

        session_id = os.environ.get('AGENT_SESSION_ID', config.DEFAULT_SESSION_ID)
        bucket_name = config.S3_BUCKET_NAME

        safe_name = name.replace("'", "''")
        where = f"name_eng LIKE '%{safe_name}%'"
        if country_iso3:
            where += f" AND iso3 = '{country_iso3.strip().upper()}'"

        layer_url = f"{config.WDPA_SERVICE_URL}/{config.WDPA_POLYGON_LAYER_ID}"
        sc = _call_arcgis_mcp("query_data", {
            "layerOrTableUrl": layer_url,
            "where": where,
            "returnGeometry": True,
            "pageSize": 10,
            "orderByFields": [{"fieldName": "rep_area", "order": "DESC"}],
        })
        records = sc.get("resultRecords", []) or []
        if not records:
            return json.dumps({
                "error": f"No protected area found matching '{name}'"
                         + (f" in {country_iso3}" if country_iso3 else "")
                         + ". Try a shorter name fragment or a different spelling.",
            })

        # Pick the record with the largest reported area (the main park, not a
        # small private reserve that shares the name).
        best = max(records, key=lambda r: (r.get("attributes", {}).get("rep_area") or 0))
        rings = (best.get("geometry") or {}).get("rings")
        if not rings:
            return json.dumps({"error": f"Matched '{name}' but it returned no boundary geometry."})

        to_wgs84 = Transformer.from_crs(3857, 4326, always_xy=True)
        rings_wgs = [[list(to_wgs84.transform(x, y)) for x, y in ring] for ring in rings]
        shp = _esri_rings_to_shapely(rings_wgs)
        if shp is None:
            return json.dumps({"error": f"Matched '{name}' but its geometry could not be built."})

        # Generalize for display — large parks can have 10k+ vertices. ~0.001° (~100m)
        # keeps the shape faithful while keeping the GeoJSON payload light.
        simplified = shp.simplify(0.001, preserve_topology=True)
        if not simplified.is_empty:
            shp = simplified

        attrs = best.get("attributes", {})
        matched_name = attrs.get("name_eng") or attrs.get("name") or name
        feature = {
            "type": "Feature",
            "properties": {
                "name": matched_name,
                "designation": attrs.get("desig_eng"),
                "iucn_cat": attrs.get("iucn_cat"),
                "status_yr": attrs.get("status_yr"),
                "rep_area_km2": attrs.get("rep_area"),
                "gov_type": attrs.get("gov_type"),
                "__layer_type": "protected_area",
            },
            "geometry": mapping(shp),
        }
        fc = {"type": "FeatureCollection", "features": [feature],
              "locationName": matched_name}

        clean = _slugify(matched_name)
        s3_key = f"session_data/{session_id}/geometries/protected_area_named_{clean}.geojson"
        boto3.client('s3').put_object(
            Bucket=bucket_name, Key=s3_key,
            Body=json.dumps(fc).encode('utf-8'), ContentType='application/geo+json')
        s3_url = f"s3://{bucket_name}/{s3_key}"

        result = {
            "protected_areas_geojson_s3_url": s3_url,
            "name": matched_name,
            "designation": attrs.get("desig_eng"),
            "iucn_cat": attrs.get("iucn_cat"),
            "status_yr": attrs.get("status_yr"),
            "reported_area_km2": attrs.get("rep_area"),
            "matches_found": int(sc.get("totalMatchingRecords", len(records))),
            "note": "Display with display_visual(protected_areas_geojson_s3_url, name).",
        }
        result_json = json.dumps(result, indent=2)
        print(f"\n<tool_result_output>\n{result_json}\n</tool_result_output>\n")
        return result_json

    except Exception as e:
        error_msg = f"❌ Error fetching protected area '{name}': {str(e)}"
        logger.error(error_msg)
        logger.exception("display_protected_area_by_name error")
        return json.dumps({"error": error_msg})
