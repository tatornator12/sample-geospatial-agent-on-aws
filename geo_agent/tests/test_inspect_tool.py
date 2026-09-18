"""Unit tests for the inspect_image tool (utils/tools.py): ToolResult shape, S3 key, errors.

S3 and the renderer are patched; nothing leaves the process.
"""
import asyncio
import json

import pytest

import rasterio.errors


class FakeS3:
    def __init__(self):
        self.puts = []

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://signed.example/{Params['Bucket']}/{Params['Key']}?sig=1"

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


@pytest.fixture()
def tool_env(tools_module, monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(tools_module.boto3, "client", lambda *_a, **_k: fake)
    monkeypatch.setenv("AGENT_SESSION_ID", "sess-1234")
    monkeypatch.setattr(tools_module.config, "S3_BUCKET_NAME", "test-bucket")
    return fake


def _run(coro):
    return asyncio.run(coro)


def test_inspection_key_mirrors_raster_basename(tools_module):
    key = tools_module._inspection_key(
        "sess-1234", "s3://b/session_data/sess-1234/rasters/tci_clipped_hyde_park_2026-08-21.tif", "jpeg")
    assert key == "session_data/sess-1234/inspections/tci_clipped_hyde_park_2026-08-21.jpg"
    key = tools_module._inspection_key("s", "s3://b/x/ndvi_clipped_loc_2026-08-21.tif", "png")
    assert key == "session_data/s/inspections/ndvi_clipped_loc_2026-08-21.png"


def test_presigned_vsicurl_wraps_a_signed_https_url(tools_module, tool_env):
    path = tools_module._presigned_vsicurl("s3://test-bucket/session_data/s/rasters/tci.tif")
    assert path.startswith("/vsicurl/https://signed.example/test-bucket/session_data/s/rasters/tci.tif")


def test_inspect_image_returns_image_block_and_saves_preview(tools_module, tool_env, monkeypatch):
    inspection = __import__("utils.inspection", fromlist=["render_preview"])
    fake_png = b"\x89PNG\r\n\x1a\nfake"
    monkeypatch.setattr(
        inspection, "render_preview",
        lambda path, max_edge=1024, style_hint=None: inspection.Rendered(
            fake_png, "png", {"width": 300, "height": 200, "nodata_pct": 1.5, "style": "ndvi"}),
    )

    result = _run(tools_module.inspect_image(
        "s3://test-bucket/session_data/sess-1234/rasters/ndvi_clipped_loc_2026-08-21.tif",
        "NDVI, test", question="where is the vegetation?"))

    assert result["status"] == "success"
    image, text = result["content"]
    assert image == {"image": {"format": "png", "source": {"bytes": fake_png}}}
    facts = json.loads(text["text"])
    assert facts["title"] == "NDVI, test"
    assert facts["question"] == "where is the vegetation?"
    assert facts["preview_s3_url"] == (
        "s3://test-bucket/session_data/sess-1234/inspections/ndvi_clipped_loc_2026-08-21.png")
    assert facts["nodata_pct"] == 1.5 and facts["width"] == 300

    (put,) = tool_env.puts
    assert put["Bucket"] == "test-bucket"
    assert put["Key"] == "session_data/sess-1234/inspections/ndvi_clipped_loc_2026-08-21.png"
    assert put["Body"] == fake_png and put["ContentType"] == "image/png"


def test_inspect_image_jpeg_gets_jpg_extension_and_content_type(tools_module, tool_env, monkeypatch):
    inspection = __import__("utils.inspection", fromlist=["render_preview"])
    monkeypatch.setattr(
        inspection, "render_preview",
        lambda path, max_edge=1024, style_hint=None: inspection.Rendered(b"\xff\xd8jpeg", "jpeg", {"width": 1, "height": 1}),
    )
    result = _run(tools_module.inspect_image("s3://test-bucket/session_data/s/rasters/tci_clipped_x_2026-01-01.tif", "TCI"))
    assert result["content"][0]["image"]["format"] == "jpeg"
    assert tool_env.puts[0]["Key"].endswith("/inspections/tci_clipped_x_2026-01-01.jpg")
    assert tool_env.puts[0]["ContentType"] == "image/jpeg"


@pytest.mark.parametrize("bad", ["not-a-url", "https://example.com/x.tif", "s3://bucket-only", "", None])
def test_inspect_image_rejects_non_session_urls(tools_module, tool_env, bad):
    result = _run(tools_module.inspect_image(bad, "x"))
    assert result["status"] == "error"
    assert "s3://bucket/key" in json.loads(result["content"][0]["text"])["error"]
    assert tool_env.puts == []


def test_inspect_image_missing_object_is_an_error_result_not_an_exception(tools_module, tool_env, monkeypatch):
    inspection = __import__("utils.inspection", fromlist=["render_preview"])

    def boom(path, max_edge=1024, style_hint=None):
        raise rasterio.errors.RasterioIOError("HTTP response code: 404")

    monkeypatch.setattr(inspection, "render_preview", boom)
    result = _run(tools_module.inspect_image("s3://test-bucket/session_data/s/rasters/missing.tif", "x"))
    assert result["status"] == "error"
    err = json.loads(result["content"][0]["text"])
    assert "RasterioIOError" in err["error"] and "404" in err["error"]
    assert tool_env.puts == []


def test_inspect_image_unrenderable_raster_is_an_error_result(tools_module, tool_env, monkeypatch):
    inspection = __import__("utils.inspection", fromlist=["render_preview"])
    monkeypatch.setattr(inspection, "render_preview",
                        lambda *a, **k: (_ for _ in ()).throw(ValueError("raster has no valid pixels")))
    result = _run(tools_module.inspect_image("s3://test-bucket/session_data/s/rasters/empty.tif", "x"))
    assert result["status"] == "error"
    assert json.loads(result["content"][0]["text"])["error"] == "raster has no valid pixels"
