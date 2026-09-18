/**
 * What the docent says out loud. The caption band shows one thing: the last spoken paragraph
 * of the agent's message. Tables and horizontal rules are never spoken (they exist for the
 * transcript drawer), heading, blockquote and list markers are stripped, and the result is
 * capped so it fits three caption lines. Works on partial text too: while the agent is still
 * typing a table, the band keeps showing the sentence before it instead of table fragments.
 */

const CAPTION_MAX_CHARS = 320;

/** Lines that are read, not spoken: table rows, table separators, horizontal rules. */
function isSilentLine(line: string): boolean {
  return /^\s*\|/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

export function docentCaption(text: string): string {
  const cleaned = text.replace(/\r/g, '').trim();
  if (!cleaned) return '';
  const spoken = cleaned
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .filter((line) => !isSilentLine(line))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
  let last = spoken[spoken.length - 1] || '';
  last = last
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .trim();
  if (last.length > CAPTION_MAX_CHARS) {
    const tail = last.slice(-CAPTION_MAX_CHARS);
    const cut = tail.search(/[.!?]\s+[A-Z]/);
    last = cut >= 0 ? tail.slice(cut + 2) : `…${tail}`;
  }
  return last;
}
