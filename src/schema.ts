import { z } from 'zod';

const text = z.string().trim().min(1);
const time = z.number().finite().nonnegative();
const interval = { start: time, end: time };
const validInterval = (v: { start: number; end: number }) => v.end > v.start;
const word = z.object({ id: text, ...interval, text }).refine(validInterval, 'end must exceed start');
const turn = z.object({ ...interval, speaker: text }).refine(validInterval, 'end must exceed start');
export const rawSchema = z.object({
  schemaVersion: z.literal(1), duration: time,
  words: z.array(word), turns: z.array(turn),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((r, ctx) => {
  const ids = new Set<string>();
  for (const w of r.words) {
    if (ids.has(w.id)) ctx.addIssue({ code: 'custom', message: `Duplicate word ${w.id}` });
    ids.add(w.id);
  }
  for (const v of [...r.words, ...r.turns]) {
    if (v.end > r.duration + 0.02) ctx.addIssue({ code: 'custom', message: 'Interval exceeds audio duration' });
  }
});
const segment = z.object({
  id: text, ...interval, text, speaker: text.nullable(),
  attribution: z.enum(['assigned', 'overlap', 'boundary', 'insufficient']).optional(),
  candidates: z.array(z.object({ speaker: text, coverage: z.number().min(0).max(1) })).optional(),
}).refine(validInterval, 'end must exceed start');
export const meetingSchema = z.object({
  title: text, speakers: z.record(text, text), segments: z.array(segment),
  insights: z.array(z.object({
    id: text, kind: z.enum(['action', 'decision', 'disagreement', 'consensus', 'unresolved']),
    text, owner: text.nullable().default(null), evidence: z.array(text).min(1),
    status: z.enum(['suggested', 'confirmed']),
  })),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((m, ctx) => {
  const known = (id: string) => Object.hasOwn(m.speakers, id);
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set<string>();
  for (const s of m.segments) {
    if (ids.has(s.id)) fail(`Duplicate segment ${s.id}`);
    ids.add(s.id);
    if (s.speaker !== null && !known(s.speaker)) fail(`Unknown speaker ${s.speaker}`);
    if (s.candidates?.some(c => !known(c.speaker))) fail('Unknown candidate speaker');
    if (s.attribution && (s.attribution === 'assigned') !== (s.speaker !== null)) fail('Attribution contradicts speaker');
  }
  const insightIds = new Set<string>();
  for (const i of m.insights) {
    if (insightIds.has(i.id)) fail(`Duplicate insight ${i.id}`);
    insightIds.add(i.id);
    if (i.owner !== null && !known(i.owner)) fail(`Unknown owner ${i.owner}`);
    if (i.evidence.some(id => !ids.has(id))) fail('Invalid evidence reference');
  }
});
export type Raw = z.infer<typeof rawSchema>;
export type Meeting = z.infer<typeof meetingSchema>;
export type Word = Raw['words'][number];
export type Turn = Raw['turns'][number];
