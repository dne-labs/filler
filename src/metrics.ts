/** Case/punctuation-insensitive English WER; not speaker-attributed WER. */
export function wordErrorRate(reference: string, hypothesis: string) {
  const tokenize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, '').trim().split(/\s+/u).filter(Boolean);
  const r = tokenize(reference); const h = tokenize(hypothesis);
  if (!r.length) throw new Error('WER requires a nonempty reference');
  let previous = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const current = [i];
    for (let j = 1; j <= h.length; j++) current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
    previous = current;
  }
  const errors = previous[h.length]!;
  return { errors, referenceWords: r.length, hypothesisWords: h.length, wer: errors / r.length };
}
