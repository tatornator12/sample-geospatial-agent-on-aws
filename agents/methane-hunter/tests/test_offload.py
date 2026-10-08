"""The tools' blocking bodies run on worker threads, so tool calls the agent issues together overlap."""
import asyncio
import inspect
import time

import pytest


@pytest.fixture()
def offload(tools):
    return tools.offload


def test_offloaded_tools_run_in_parallel_and_keep_their_signature(offload):
    @offload
    async def slow(area: str, days: int = 7) -> str:
        """Scan an area.

        Args:
            area: The area.
            days: How many days.
        """
        time.sleep(0.3)        # a blocking body, as the real tools have (S3, rasterio, HTTP)
        return f"{area}:{days}"

    async def nine():
        return await asyncio.gather(*(slow(f"a{i}", days=i) for i in range(9)))

    started = time.time()
    out = asyncio.run(nine())
    assert time.time() - started < 1.2, "nine 0.3 s bodies must overlap, not run one after another"
    assert out == [f"a{i}:{i}" for i in range(9)]
    # The framework reads the schema from the signature and the docstring: both survive the wrap.
    assert list(inspect.signature(slow).parameters) == ["area", "days"]
    assert slow.__doc__.startswith("Scan an area.") and slow.__name__ == "slow"
    assert inspect.iscoroutinefunction(slow)


def test_offloaded_tool_errors_surface_unchanged(offload):
    @offload
    async def broken() -> str:
        raise ValueError("as written")

    with pytest.raises(ValueError, match="as written"):
        asyncio.run(broken())
