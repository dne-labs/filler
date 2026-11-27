import { rawSchema, meetingSchema, type Raw, type Meeting, type Turn } from './schema.js';

type Span = [number, number];
function union(spans: Span[]): Span[] {
  const result: Span[] = [];
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(end, previous[1]);
    else result.push([start, end]);
  }
  return result;
}

/** Coverage is temporal support, NOT a calibrated model confidence. */
export function align(input: Raw, title = 'Recorded meeting', minimumCoverage = 0.6): Meeting {
  const raw = rawSchema.parse(input);
  if (!Number.isFinite(minimumCoverage) || minimumCoverage <= 0 || minimumCoverage > 1) throw new Error('Invalid coverage threshold');
  const speakers = Object.fromEntries([...new Set(raw.turns.map(t => t.speaker))].sort().map(s => [s, s]));
  const turns = [...raw.turns].sort((a, b) => a.start - b.start);
  const words = [...raw.words].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  let active: Turn[] = [];
  const segments = words.map(w => {
    while (cursor < turns.length && turns[cursor]!.start < w.end) active.push(turns[cursor++]!);
    active = active.filter(t => t.end > w.start);
    const bySpeaker = new Map<string, Span[]>();
    for (const t of active) {
      const span: Span = [Math.max(t.start, w.start), Math.min(t.end, w.end)];
      if (span[1] > span[0]) bySpeaker.set(t.speaker, [...(bySpeaker.get(t.speaker) ?? []), span]);
    }
    const groups = [...bySpeaker].map(([speaker, spans]) => ({ speaker, spans: union(spans) }));
    const candidates = groups.map(g => ({ speaker: g.speaker, coverage: Math.min(1, g.spans.reduce((n, [a, b]) => n + b - a, 0) / (w.end - w.start)) }))
      .sort((a, b) => b.coverage - a.coverage || a.speaker.localeCompare(b.speaker));
    const concurrent = groups.some((g, i) => groups.slice(i + 1).some(h => g.spans.some(a => h.spans.some(b => Math.min(a[1], b[1]) > Math.max(a[0], b[0])))));
    const attribution = concurrent ? 'overlap' : candidates.length > 1 ? 'boundary' : (candidates[0]?.coverage ?? 0) >= minimumCoverage ? 'assigned' : 'insufficient';
    return { ...w, speaker: attribution === 'assigned' ? candidates[0]!.speaker : null, attribution, candidates };
  });
  return meetingSchema.parse({ title, speakers, segments, insights: [], metadata: { ...raw.metadata, duration: raw.duration, minimumCoverage, insightExtraction: 'not-run' } });
}
