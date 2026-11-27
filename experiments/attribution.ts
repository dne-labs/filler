/** Deterministic timestamp-policy experiment, NOT an ASR/diarization accuracy benchmark. */
import { writeFile } from 'node:fs/promises';
import { align } from '../src/align.js';
import type { Raw, Turn } from '../src/schema.js';
const cases: { name: string; turns: Turn[]; expected: string | null }[] = [
  { name: 'clean', turns: [{ start: 0, end: 2, speaker: 'A' }], expected: 'A' },
  { name: 'simultaneous-tie', turns: [{ start: 0, end: 2, speaker: 'A' }, { start: 0, end: 2, speaker: 'B' }], expected: null },
  { name: 'short-interruption', turns: [{ start: 0, end: 2, speaker: 'A' }, { start: 0.9, end: 1.1, speaker: 'B' }], expected: null },
  { name: 'speaker-boundary', turns: [{ start: 0, end: 0.5, speaker: 'A' }, { start: 0.5, end: 2, speaker: 'B' }], expected: null },
  { name: 'silence', turns: [], expected: null },
  { name: 'weak-support', turns: [{ start: 0, end: 0.2, speaker: 'A' }], expected: null },
  { name: 'duplicate-fragments', turns: [{ start: 0, end: 0.4, speaker: 'A' }, { start: 0, end: 0.4, speaker: 'A' }], expected: null },
];
const results = cases.map(c => {
  const raw: Raw = { schemaVersion: 1, duration: 2, words: [{ id: 'w', start: 0, end: 1, text: 'synthetic' }], turns: c.turns, metadata: {} };
  const baseline = [...c.turns].sort((a, b) => Math.min(1, b.end) - Math.max(0, b.start) - (Math.min(1, a.end) - Math.max(0, a.start)))[0]?.speaker ?? null;
  const s = align(raw).segments[0]!;
  return { name: c.name, expected: c.expected, maximumOverlapBaseline: baseline, conservative: s.speaker, reason: s.attribution };
});
const output = {
  experiment: 'Hand-authored timestamp attribution policy; seven cases; no acoustic model',
  baselineAgreement: results.filter(r => r.maximumOverlapBaseline === r.expected).length,
  conservativeAgreement: results.filter(r => r.conservative === r.expected).length,
  cases: results.length, results,
  limitation: 'Expected abstention labels are designed for this policy. This is a regression experiment, not evidence of better real-world speaker recognition. Abstention trades assignment coverage for fewer unsupported labels.',
};
await writeFile('experiments/results/attribution.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
