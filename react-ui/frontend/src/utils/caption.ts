/**
 * What the docent says out loud. The caption band shows one thing: the last spoken paragraph
 * of the agent's message. Tables and horizontal rules are never spoken (they exist for the
 * transcript drawer), heading, blockquote and list markers are stripped, and the result is
 * capped so it fits the band. While the agent is still typing (`partial`), only complete
 * sentences are spoken: the band holds the previous sentence until the next one finishes,
 * instead of showing a sentence assembling word by word.
 */

const CAPTION_MAX_CHARS = 280;

/** Lines that are read, not spoken: table rows, table separators, horizontal rules. */
function isSilentLine(line: string): boolean {
  return /^\s*\|/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

/** Strip heading, blockquote and list markers from a paragraph. */
function stripMarkers(paragraph: string): string {
  return paragraph
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .trim();
}

/** The paragraph up to the end of its last complete sentence, or '' if none has finished. */
function completeSentences(paragraph: string): string {
  const sentenceEnd = /[.!?][)"'”’\]*_]*(?=\s|$)/g;
  let end = -1;
  for (let m = sentenceEnd.exec(paragraph); m !== null; m = sentenceEnd.exec(paragraph)) {
    end = m.index + m[0].length;
  }
  return end === -1 ? '' : paragraph.slice(0, end).trim();
}

export function docentCaption(text: string, opts: { partial?: boolean } = {}): string {
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
  if (spoken.length === 0) return '';
  let last = stripMarkers(spoken[spoken.length - 1]);
  if (opts.partial) {
    const finished = completeSentences(last);
    // Nothing finished in the newest paragraph yet: keep saying the previous one.
    last = finished || (spoken.length > 1 ? stripMarkers(spoken[spoken.length - 2]) : '');
    if (!last) return '';
  }
  if (last.length > CAPTION_MAX_CHARS) {
    const tail = last.slice(-CAPTION_MAX_CHARS);
    const cut = tail.search(/[.!?]\s+[A-Z]/);
    last = cut >= 0 ? tail.slice(cut + 2) : `…${tail}`;
  }
  return last;
}
