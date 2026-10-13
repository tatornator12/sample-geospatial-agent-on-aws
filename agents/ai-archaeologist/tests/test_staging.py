"""The image only contains shared code that geo_agent/stage_shared.sh copies. If an agent module
starts importing a shared module that is not staged, the image would crash at import on AgentCore;
this test fails first."""
import ast
import re
from pathlib import Path

import pytest

AGENT_DIR = Path(__file__).resolve().parents[1]
GEO_AGENT_DIR = AGENT_DIR.parents[1] / "geo_agent"
STAGE = GEO_AGENT_DIR / "stage_shared.sh"
AGENT_MODULES = ["_paths.py", "archaeo_config.py", "ai_archaeologist.py", "site_tools.py", "earthwork_profile.py"]


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


def test_the_agent_never_shadows_the_platform_config_or_the_standard_library():
    assert not (AGENT_DIR / "config.py").exists()
    assert not (AGENT_DIR / "profile.py").exists(), "profile.py would shadow the standard library (cProfile imports it)"


def test_deploy_stages_through_the_shared_script_with_this_entrypoint():
    deploy = (AGENT_DIR / "deploy.sh").read_text()
    assert "../../geo_agent/stage_shared.sh . ai_archaeologist\n" in deploy
    assert "../../geo_agent/stage_shared.sh . ai_archaeologist dockerfile" in deploy
    assert "--entrypoint ai_archaeologist.py" in deploy
    assert "EARTHDATA_TOKEN" not in deploy and "FIRMS_MAP_KEY" not in deploy
    if not (AGENT_DIR / "Dockerfile").exists():   # generated, gitignored
        pytest.skip("run ../../geo_agent/stage_shared.sh . ai_archaeologist to generate the Dockerfile")
    generated = (AGENT_DIR / "Dockerfile").read_text()
    assert "python -m ai_archaeologist" in generated and "python -m geospatial_agent_on_aws" not in generated


def test_the_catalogue_ships_in_the_image_and_env_files_never_do():
    ignore = (AGENT_DIR / ".dockerignore").read_text().splitlines()
    assert "**/.env" in ignore and "**/.env.*" in ignore
    assert not any(line.strip() in ("data", "data/", "*.json") for line in ignore)
    assert (AGENT_DIR / "data" / "sites_v1.json").is_file()
    assert "--exclude '.env*'" in STAGE.read_text()
