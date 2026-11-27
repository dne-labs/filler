import { meetingSchema } from './schema.js';
// Encode Markdown/HTML control characters; explicit anchors use array positions, never untrusted IDs.
const escape = (s: string) => s.replace(/[&<>\\`*_{}\[\]()#!|\r\n]/g, c => `&#${c.charCodeAt(0)};`);
export function report(input: unknown): string {
  const m = meetingSchema.parse(input);
  const anchors = new Map(m.segments.map((s, i) => [s.id, `segment-${i}`]));
  const lines = [`# ${escape(m.title)}`, '', '## Transcript', ''];
  for (const s of [...m.segments].sort((a, b) => a.start - b.start)) {
    lines.push(`<a id="${anchors.get(s.id)}"></a>`, `### ${escape(s.id)}`, '',
      `${s.start.toFixed(2)}–${s.end.toFixed(2)}s | ${escape(s.speaker === null ? 'Unknown speaker' : m.speakers[s.speaker]!)}`,
      ...(s.attribution ? [`Attribution: ${s.attribution}`] : []), '', escape(s.text), '');
  }
  lines.push('## Insights', '');
  if (!m.insights.length) lines.push('No insights supplied. Automatic extraction has not run.', '');
  for (const i of m.insights) lines.push(`- **${i.kind} / ${i.status}**: ${escape(i.text)}`,
    `  Owner: ${escape(i.owner === null ? 'Unassigned' : m.speakers[i.owner]!)}. Evidence: ${i.evidence.map(id => `[${escape(id)}](#${anchors.get(id)})`).join(', ')}.`);
  return lines.join('\n') + '\n';
}
