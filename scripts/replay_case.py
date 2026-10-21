"""What every replay-case builder shares (agents/methane-hunter/build_replay_case.py,
agents/ai-archaeologist/build_replay_case.py, scripts/build_earth_replay_case.py).

    saw_by_tool(text)   what the agent said after each inspect_image call, by toolUseId: the
                        recorded call's `saw`, which the stage prints as "Saw: ..." under the chip
                        (ChatSidebar.tsx recordedSaw; utils/narration.ts boundedSaw bounds it)
    house_style(text)   the saved copy in the house style: no em or en dashes
    shown(path)         a path for the console, relative to here when it can be (an --out outside
                        the repo prints as given)
    write_sid(path, sid)  the take's full session id, for scripts/replay_numbers.py
"""
import json
import os
import re
from pathlib import Path

from eval import tool_spans

# The stage reads at most this much of a recorded `saw` (narration.ts boundedSaw slices 2,000).
SAW_MAX_CHARS = 2000


def house_style(text: str) -> str:
    """Dashes as the house style writes them: a range between two numbers reads "to", an empty
    table cell stays empty, any other dash becomes a comma. Nothing else is touched."""
    text = re.sub(r"\|\s*[\u2013\u2014]\s*\|", "| |", text)
    text = re.sub(r"(\d)\s*[\u2013\u2014]\s*(\d)", r"\1 to \2", text)
    return re.sub(r"\s*[\u2013\u2014]\s*", ", ", text)


BULLET_RE = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+(.+)$")


def saw_by_tool(text: str) -> dict[str, str]:
    """The prose between each inspect_image call and the next tool call (or the end), by toolUseId,
    at most SAW_MAX_CHARS, in the house style. Calls the agent said nothing after are left out.

    Looks the agent took together (N inspect_image calls in a row, nothing said between them) are
    answered in one block; when that block is a list of exactly N items, item i is what the agent
    said it saw in look i (in the order it asked), word for word. Otherwise the block stays with the
    last look, as the live stage shows it."""
    spans = tool_spans(text)
    out: dict[str, str] = {}
    run: list[str] = []  # the looks taken together so far
    for i, (start, end, name) in enumerate(spans):
        if name != "inspect_image":
            run = []
            continue
        try:
            tool_id = json.loads(text[start:end]).get("toolUseId")
        except json.JSONDecodeError:
            tool_id = None
        nxt = spans[i + 1][0] if i + 1 < len(spans) else len(text)
        prose = text[end:nxt].strip()
        if isinstance(tool_id, str) and tool_id:
            run.append(tool_id)
        if not prose:
            continue  # the next look in the same breath, or nothing said
        items = [m.group(1).strip() for m in map(BULLET_RE.match, prose.splitlines()) if m]
        if len(run) > 1 and len(items) == len(run):
            for look, item in zip(run, items):
                out[look] = house_style(item)[:SAW_MAX_CHARS].strip()
        elif run:
            out[run[-1]] = house_style(prose)[:SAW_MAX_CHARS].strip()
        run = []
    return out


def styled_params(params: dict) -> dict:
    """A recorded call's inputs with the words it shows the room (a layer's title and description, a
    look's question) in the house style; everything else as the agent passed it."""
    return {k: house_style(v) if k in ("title", "description", "question") and isinstance(v, str) else v
            for k, v in params.items()}


def shown(path: Path) -> str:
    try:
        rel = os.path.relpath(path)
    except ValueError:  # another drive (Windows)
        return str(path)
    return str(Path(path).resolve()) if rel.startswith("..") else rel


def write_sid(path: str | None, sid: str) -> None:
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(sid + "\n")
