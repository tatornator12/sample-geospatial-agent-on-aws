/**
 * The stage's punctuation, for every place the agent's words are shown (the answer in the step
 * column, the transcript): an em dash the model slipped in (the prompts forbid it, the habit
 * survives) reads as a comma. "A — B" becomes "A, B"; a range "2024–2025" reads "2024 to 2025".
 * A horizontal rule on its own line ("---", the same habit) is dropped: the prompts forbid it and
 * the column's paragraphs already separate the steps from the report. Table rows keep their pipes.
 */
export function stagePunctuation(text: string): string {
  return text
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')   // a range: 2024–2025 reads "2024 to 2025"
    .replace(/\s*[—–]\s*/g, ', ');
}
