"""Charset-safe httpx client factory for the ArcGIS Enterprise MCP.

The ArcGIS Enterprise MCP server returns JSON-RPC bodies declared as
ISO-8859-1 (accented place names such as "Aripuanã" / "Pacaás" arrive as
latin-1 bytes). The mcp SDK's streamable-HTTP client parses those bytes as
UTF-8 (JSONRPCMessage.model_validate_json(content) at streamable_http.py:385),
which raises "Invalid JSON: invalid unicode code point" and makes every
Strands-routed MCP tool (reverse_geocode, find_address_candidates,
search_portal_content, query_data, ...) fail at call time.

Fix: an httpx *response event hook* that, for buffered (non event-stream)
responses, re-encodes an ISO-8859-1 body to UTF-8 by rewriting the response's
cached bytes in place. It does NOT rebuild the response object — an earlier
attempt that returned a brand-new httpx.Response broke the mcp session's
initialize handshake ("Connection closed") because the streaming internals the
session relies on were discarded. Mutating the cached content leaves the
response (and any SSE stream) intact.

Pass this to streamablehttp_client(..., httpx_client_factory=charset_safe_httpx_client_factory).
Validated against the live MCP through the full initialize + list_tools +
call_tool handshake (reverse_geocode -> "Aripuanã" decodes correctly).
"""
import httpx


async def _transcode_iso8859_1_to_utf8(response: httpx.Response) -> None:
    """httpx response hook: rewrite ISO-8859-1 JSON bodies to UTF-8 in place.

    SSE (text/event-stream) responses are left untouched so streaming is
    preserved. Bodies that are already valid UTF-8 are left unchanged.
    """
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        return
    # Buffer the body (safe for the JSON responses the mcp client parses).
    await response.aread()
    try:
        response.content.decode("utf-8")  # already valid UTF-8 -> leave as-is
    except UnicodeDecodeError:
        # Rewrite the cached bytes so response.content / model_validate_json see UTF-8.
        response._content = response.content.decode("iso-8859-1").encode("utf-8")


def charset_safe_httpx_client_factory(
    headers: dict | None = None,
    timeout: httpx.Timeout | None = None,
    auth: httpx.Auth | None = None,
) -> httpx.AsyncClient:
    """mcp McpHttpClientFactory-compatible factory (headers, timeout, auth).

    Returns an httpx.AsyncClient whose response hook transcodes ISO-8859-1 JSON
    responses to UTF-8, keeping the standard Strands/mcp integration working
    against the ArcGIS Enterprise MCP.
    """
    return httpx.AsyncClient(
        headers=headers,
        timeout=timeout if timeout is not None else httpx.Timeout(30.0),
        auth=auth,
        follow_redirects=True,
        event_hooks={"response": [_transcode_iso8859_1_to_utf8]},
    )
