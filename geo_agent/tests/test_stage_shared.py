"""stage_shared.sh stages a world-readable build context whatever the caller's umask.

Oct 22: a promotion ran under umask 077, stage_shared.sh copied the shared code into each agent's
build context as 600 files in a 700 directory, and the three stable runtimes it deployed died at
start with "PermissionError: [Errno 13] Permission denied: '/app/_geo_agent/config.py'" (the image
COPYs the context as root and runs as uid 1000).

These tests run a copy of the real script under umask 077 against a synthetic platform and agent in
a temp directory (shared sources that are themselves 600, which rsync -a would keep, and stale 600
files from an earlier run, whose modes cp and `>` would keep), then check every staged file is
world-readable and every staged directory world-traversable. Nothing is written inside the repo.
"""
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

GEO_AGENT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = GEO_AGENT_DIR.parent
STAGE = GEO_AGENT_DIR / "stage_shared.sh"
MODULE = "fake_agent"

pytestmark = pytest.mark.skipif(
    not all(shutil.which(tool) for tool in ("bash", "rsync", "git")),
    reason="stage_shared.sh needs bash, rsync and git",
)


def _write(path: Path, text: str, mode: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(mode)
    return path


def _run_under_umask_077(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    # The script is run through bash with the caller's umask set to 077, as on Oct 22.
    return subprocess.run(
        ["bash", "-c", 'umask 077 && exec bash "$0" "$@"', *args],
        cwd=cwd, capture_output=True, text=True, timeout=60,
    )


@pytest.fixture
def layout(tmp_path):
    """A copy of the real script and platform Dockerfile beside synthetic shared code, and an agent
    directory (its own git repo) holding stale 600 files from an earlier run."""
    src = tmp_path / "geo_agent"
    src.mkdir()
    shutil.copy(STAGE, src / "stage_shared.sh")
    shutil.copy(GEO_AGENT_DIR / "Dockerfile_geospatial_agent_on_aws", src / "Dockerfile_geospatial_agent_on_aws")
    _write(src / "requirements.txt", "boto3\n", 0o600)
    # Shared sources that are 600 / 700 themselves: rsync -a keeps the source's modes.
    _write(src / "config.py", "BUCKET = 'x'\n", 0o600)
    _write(src / "utils" / "__init__.py", "", 0o600)
    _write(src / "utils" / "nested" / "tool.py", "X = 1\n", 0o600)
    (src / "utils" / "nested").chmod(0o700)
    (src / "utils").chmod(0o700)
    _write(src / "data" / "catalogue.json", "{}\n", 0o600)
    (src / "data").chmod(0o700)

    agent = tmp_path / "agents" / "fake-agent"
    agent.mkdir(parents=True)
    _write(agent / f"{MODULE}.py", "import config\n", 0o600)               # tracked, written under 077
    _write(agent / "requirements-agent.txt", "duckdb==1.0.0\n", 0o600)     # tracked
    _write(agent / ".gitignore", ".env\n_geo_agent/\nDockerfile\nrequirements.txt\n", 0o644)
    # Stale output of an earlier staging run under umask 077.
    _write(agent / "Dockerfile", "stale\n", 0o600)
    _write(agent / "requirements.txt", "stale\n", 0o600)
    _write(agent / "_geo_agent" / "config.py", "stale\n", 0o600)
    (agent / "_geo_agent").chmod(0o700)
    # A gitignored secret: never made readable.
    _write(agent / ".env", "TOKEN=not-a-real-token\n", 0o600)
    subprocess.run(["git", "init", "-q"], cwd=agent, check=True)
    subprocess.run(["git", "add", f"{MODULE}.py", "requirements-agent.txt", ".gitignore"], cwd=agent, check=True)
    return src, agent


def _assert_world_readable(path: Path):
    mode = path.stat().st_mode
    if stat.S_ISDIR(mode):
        assert mode & 0o005 == 0o005, f"{path} is {oct(mode & 0o777)}: not world-traversable"
    else:
        assert mode & 0o004, f"{path} is {oct(mode & 0o777)}: not world-readable"


def test_staging_under_umask_077_leaves_every_staged_file_world_readable(layout):
    src, agent = layout
    result = _run_under_umask_077(str(src / "stage_shared.sh"), str(agent), MODULE, cwd=src.parent)
    assert result.returncode == 0, result.stderr

    staged = agent / "_geo_agent"
    assert (staged / "config.py").read_text() == "BUCKET = 'x'\n"            # the stale copy was replaced
    assert (staged / "utils" / "nested" / "tool.py").is_file()
    assert (staged / "data" / "catalogue.json").is_file()
    every = [staged, *staged.rglob("*")]
    assert len(every) >= 7
    for path in every:
        _assert_world_readable(path)

    # The generated files in the agent directory, both stale 600 before the run.
    assert "python -m fake_agent" in (agent / "Dockerfile").read_text()
    assert "duckdb==1.0.0" in (agent / "requirements.txt").read_text()
    for name in ("Dockerfile", "requirements.txt", f"{MODULE}.py", "requirements-agent.txt"):
        _assert_world_readable(agent / name)

    # The gitignored env file is left exactly as it was.
    assert stat.S_IMODE((agent / ".env").stat().st_mode) == 0o600


def test_regenerating_only_the_dockerfile_fixes_a_stale_600_dockerfile(layout):
    src, agent = layout
    result = _run_under_umask_077(str(src / "stage_shared.sh"), str(agent), MODULE, "dockerfile", cwd=src.parent)
    assert result.returncode == 0, result.stderr
    assert "GENERATED by stage_shared.sh" in (agent / "Dockerfile").read_text()
    _assert_world_readable(agent / "Dockerfile")


DEPLOY_SCRIPTS = [
    "geo_agent/deploy.sh",
    "geo_agent/deploy_with_langfuse.sh",
    "agents/methane-hunter/deploy.sh",
    "agents/ai-archaeologist/deploy.sh",
    "agents/dark-vessels/deploy.sh",
    "scripts/promote.sh",
]


@pytest.mark.parametrize("script", DEPLOY_SCRIPTS)
def test_every_deploy_path_sets_umask_022_before_it_writes(script):
    lines = (REPO_ROOT / script).read_text().splitlines()
    assert "umask 022" in lines, f"{script} has no umask 022 line"
    first_write = next((i for i, line in enumerate(lines)
                        if "stage_shared.sh ." in line or line.startswith("run cp ") or "./deploy.sh)" in line), None)
    assert first_write is not None, f"{script}: no staging, cp or deploy line found"
    assert lines.index("umask 022") < first_write, f"{script} sets its umask after it writes"
