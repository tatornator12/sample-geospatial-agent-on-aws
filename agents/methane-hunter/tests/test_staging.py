"""The image only contains shared code that stage_shared.sh copies. If an agent module starts
importing a shared module that is not staged, the image would crash at import on AgentCore;
this test fails first."""
import ast
import re
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parents[1]
GEO_AGENT_DIR = AGENT_DIR.parents[1] / "geo_agent"
AGENT_MODULES = ["_paths.py", "methane_config.py", "methane_hunter.py", "methane_tools.py"]


def _allowlist():
    text = (AGENT_DIR / "stage_shared.sh").read_text()

    def array(name):
        m = re.search(rf"^{name}=\(\n(.*?)^\)", text, re.S | re.M)
        assert m, f"{name} array not found in stage_shared.sh"
        return [line.strip() for line in m.group(1).splitlines() if line.strip() and not line.strip().startswith("#")]
    return array("SHARED_FILES"), array("SHARED_DIRS")


def _shared_imports():
    """(top-level module, submodule) pairs for every `import config` / `from utils.x import`."""
    found = set()
    for name in AGENT_MODULES:
        tree = ast.parse((AGENT_DIR / name).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    top = a.name.split(".")[0]
                    if top in ("config", "utils"):
                        found.add((top, a.name))
            elif isinstance(node, ast.ImportFrom) and node.module:
                top = node.module.split(".")[0]
                if top in ("config", "utils"):
                    found.add((top, node.module))
    return found


def test_every_shared_import_is_staged():
    files, dirs = _allowlist()
    imports = _shared_imports()
    assert imports, "expected the agent to use shared code"
    for top, full in imports:
        if top == "config":
            assert "config.py" in files, "agent imports the platform config but stage_shared.sh does not copy it"
        else:
            assert "utils" in dirs
            module_file = GEO_AGENT_DIR / (full.replace(".", "/") + ".py")
            assert module_file.exists(), f"{full} does not exist in geo_agent/"


def test_staged_items_exist_in_the_platform():
    files, dirs = _allowlist()
    for f in files:
        assert (GEO_AGENT_DIR / f).is_file(), f
    for d in dirs:
        assert (GEO_AGENT_DIR / d).is_dir(), d


def test_the_agent_never_shadows_the_platform_config():
    assert not (AGENT_DIR / "config.py").exists(), (
        "an agent-level config.py would shadow the platform config the shared utils import")


def test_dockerfile_is_generated_from_the_platform_with_only_the_entrypoint_changed(tmp_path):
    platform = (GEO_AGENT_DIR / "Dockerfile_geospatial_agent_on_aws").read_text()
    assert "python -m geospatial_agent_on_aws" in platform
    script = (AGENT_DIR / "stage_shared.sh").read_text()
    assert "sed 's/python -m geospatial_agent_on_aws/python -m methane_hunter/g'" in script


def test_env_files_never_enter_the_build_context():
    ignore = (AGENT_DIR / ".dockerignore").read_text().splitlines()
    assert "**/.env" in ignore and "**/.env.*" in ignore
    assert "--exclude '.env*'" in (AGENT_DIR / "stage_shared.sh").read_text()
