"""Shared code reaches the image only through geo_agent/stage_shared.sh: every `config` / `utils`
import the agent makes is on the allowlist, the agent shadows neither the platform's config nor a
package (coverage, profile), the deploy stages with this entrypoint and never passes the GFW token,
and the records ship in the image while env files never do."""
import ast
import re
from pathlib import Path

import pytest

AGENT_DIR = Path(__file__).resolve().parents[1]
GEO_AGENT_DIR = AGENT_DIR.parents[1] / "geo_agent"
STAGE = GEO_AGENT_DIR / "stage_shared.sh"
AGENT_MODULES = ["_paths.py", "vessels_config.py", "dark_vessels.py", "vessel_store.py", "pass_tools.py", "ais_tools.py",
                 "forecast_tools.py", "tasking_tools.py", "ais_coverage.py", "cfar.py", "plan.py", "predict.py", "reach.py"]


def _allowlist():
    text = STAGE.read_text()

    def array(name):
        m = re.search(rf"^{name}=\(\n(.*?)^\)", text, re.S | re.M)
        assert m, f"{name} array not found in stage_shared.sh"
        return [line.strip() for line in m.group(1).splitlines() if line.strip() and not line.strip().startswith("#")]
    return array("SHARED_FILES"), array("SHARED_DIRS")


def _shared_imports():
    found = set()
    for name in AGENT_MODULES:
        tree = ast.parse((AGENT_DIR / name).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    if a.name.split(".")[0] in ("config", "utils"):
                        found.add((a.name.split(".")[0], a.name))
            elif isinstance(node, ast.ImportFrom) and node.module and node.module.split(".")[0] in ("config", "utils"):
                found.add((node.module.split(".")[0], node.module))
    return found


def test_every_shared_import_is_staged():
    files, dirs = _allowlist()
    imports = _shared_imports()
    assert imports, "expected the agent to use shared code"
    for top, full in imports:
        if top == "config":
            assert "config.py" in files
        else:
            assert "utils" in dirs
            assert (GEO_AGENT_DIR / (full.replace(".", "/") + ".py")).exists(), f"{full} does not exist in geo_agent/"


def test_the_agent_never_shadows_the_platform_config_or_a_package():
    for name in ("config.py", "profile.py", "coverage.py"):
        assert not (AGENT_DIR / name).exists(), f"{name} would shadow the platform's config or a package"


def test_deploy_stages_with_this_entrypoint_and_never_passes_the_gfw_token():
    deploy = (AGENT_DIR / "deploy.sh").read_text()
    assert "../../geo_agent/stage_shared.sh . dark_vessels\n" in deploy
    assert "../../geo_agent/stage_shared.sh . dark_vessels dockerfile" in deploy
    assert "--entrypoint dark_vessels.py" in deploy
    assert 'STABLE_AGENT_NAME="dark_vessels"' in deploy and 'DEV_AGENT_NAME="dark_vessels_dev"' in deploy
    assert "GFW" not in deploy.split("Launching agent")[1]
    if not (AGENT_DIR / "Dockerfile").exists():   # generated, gitignored
        pytest.skip("run ../../geo_agent/stage_shared.sh . dark_vessels to generate the Dockerfile")
    generated = (AGENT_DIR / "Dockerfile").read_text()
    assert "python -m dark_vessels" in generated and "python -m geospatial_agent_on_aws" not in generated


def test_the_records_ship_in_the_image_and_env_files_never_do():
    ignore = (AGENT_DIR / ".dockerignore").read_text().splitlines()
    assert "**/.env" in ignore and "**/.env.*" in ignore
    assert not any(line.strip() in ("data", "data/", "*.json", "*.geojson") for line in ignore)
    assert (AGENT_DIR / "data" / "passes_v1.json").is_file() and (AGENT_DIR / "data" / "reserve_v1.geojson").is_file()
    assert "--exclude '.env*'" in STAGE.read_text()
