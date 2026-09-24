"""Make the platform's shared code (geo_agent's `config` and `utils`) importable.

The Methane Hunter reuses the Earth Analyst's shared tools (display_visual, inspect_image,
create_bbox_from_coordinates, get_rasters) and helpers instead of copying them. Two layouts:

  - In the container image, `stage_shared.sh` has copied geo_agent/{config.py,utils,data} into
    `_geo_agent/` next to this file (the Docker build context is this directory, so the image
    cannot reach ../../geo_agent).
  - In the repository (local runs, tests), `_geo_agent/` may be absent; the real `geo_agent/`
    two directories up is used instead.

The staged copy wins when present so the image never falls back to a path that does not exist
inside it. This module must be imported before anything that does `import config` or
`from utils ...`.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STAGED = os.path.join(HERE, "_geo_agent")
REPO_GEO_AGENT = os.path.normpath(os.path.join(HERE, "..", "..", "geo_agent"))


def _looks_like_geo_agent(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "config.py")) and os.path.isdir(os.path.join(path, "utils"))


def shared_code_dir() -> str:
    """The directory that provides `config.py` and `utils/`."""
    for candidate in (STAGED, REPO_GEO_AGENT):
        if _looks_like_geo_agent(candidate):
            return candidate
    raise RuntimeError(
        "Shared platform code not found. Run ./stage_shared.sh (image builds) or keep this "
        "agent inside the repository next to geo_agent/."
    )


def install() -> str:
    """Put the shared code first on sys.path (idempotent) and return its directory."""
    path = shared_code_dir()
    if path not in sys.path:
        sys.path.insert(0, path)
    return path


install()
