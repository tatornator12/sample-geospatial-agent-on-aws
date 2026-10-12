/**
 * The stage's punctuation, for every place the agent's words are shown (the answer in the step
 * column, the transcript): an em dash the model slipped in (the prompts forbid it, the habit
 * survives) reads as a comma. "A — B" becomes "A, B"; a range "2024–2025" reads "2024 to 2025".
 */
export function stagePunctuation(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')   // a range: 2024–2025 reads "2024 to 2025"
    .replace(/\s*[—–]\s*/g, ', ');
}
