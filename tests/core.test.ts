import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { align } from '../src/align.js';
import { rawSchema, meetingSchema, type Raw } from '../src/schema.js';
import { report } from '../src/report.js';
import { run } from '../src/process.js';

const raw = (turns: Raw['turns']): Raw => ({ schemaVersion: 1, duration: 5, words: [{ id: 'w1', start: 1, end: 2, text: 'hello' }], turns, metadata: {} });
test('assign only supported single-speaker words', () => {
  const s = align(raw([{ start: 0, end: 3, speaker: 'S1' }])).segments[0]!;
  assert.equal(s.speaker, 'S1'); assert.equal(s.candidates![0]!.coverage, 1);
});
test('simultaneous speech abstains even with a dominant speaker', () => {
  const s = align(raw([{ start: 0, end: 3, speaker: 'S1' }, { start: 1.9, end: 2.1, speaker: 'S2' }])).segments[0]!;
  assert.equal(s.speaker, null); assert.equal(s.attribution, 'overlap');
});
test('speaker transitions are ambiguous, not simultaneous speech', () => {
  const s = align(raw([{ start: 0, end: 1.5, speaker: 'S1' }, { start: 1.5, end: 3, speaker: 'S2' }])).segments[0]!;
  assert.equal(s.speaker, null); assert.equal(s.attribution, 'boundary');
});
test('duplicate turns do not inflate coverage', () => {
  const s = align(raw([{ start: 1, end: 1.4, speaker: 'S1' }, { start: 1, end: 1.4, speaker: 'S1' }])).segments[0]!;
  assert.equal(s.speaker, null); assert.ok(Math.abs(s.candidates![0]!.coverage - 0.4) < 1e-8);
});
test('empty diarization never invents a speaker', () => assert.equal(align(raw([])).segments[0]!.speaker, null));
test('unsorted and nested words remain correctly aligned', () => {
  const r = raw([{ start: 3, end: 4, speaker: 'B' }, { start: 0, end: 2, speaker: 'A' }]);
  r.words = [{ id: 'wide', start: 0, end: 5, text: 'wide' }, { id: 'short', start: 1, end: 1.2, text: 'short' }];
  assert.equal(align(r).segments[1]!.speaker, 'A');
});
test('invalid timestamps, duplicates, and out-of-range intervals fail', () => {
  for (const change of [ { start: NaN }, { start: true }, { end: 0 }, { end: 7 } ]) {
    const r = raw([]); Object.assign(r.words[0]!, change); assert.throws(() => rawSchema.parse(r));
  }
  const r = raw([]); r.words.push(r.words[0]!); assert.throws(() => rawSchema.parse(r));
});
test('legacy meeting remains readable; bad evidence and owners rejected', async () => {
  const m = meetingSchema.parse(JSON.parse(await readFile('examples/meeting.json', 'utf8')));
  assert.match(report(m), /\]\(#segment-2\)/);
  m.insights[0]!.evidence = ['missing']; assert.throws(() => meetingSchema.parse(m));
  m.insights[0]!.evidence = ['s1']; m.insights[0]!.owner = 'missing'; assert.throws(() => meetingSchema.parse(m));
});
test('unknown owner stays unknown and Markdown is escaped', () => {
  const m = align(raw([])); m.segments[0]!.text = '<script>alert(1)</script>';
  m.insights = [{ id: 'i1', kind: 'action', text: 'Run a test', owner: null, evidence: ['w1'], status: 'suggested' }];
  const rendered = report(m); assert.match(rendered, /Owner: Unassigned/); assert.ok(!rendered.includes('<script>'));
});
test('subprocess arguments are literal; failures and timeout propagate', async () => {
  const literal = 'a; echo unsafe $(pwd)';
  assert.equal(await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal]), literal);
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(3)']), /code 3/);
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 }), /timed out/);
  await assert.rejects(run(process.execPath, ['-e', 'console.log("x".repeat(1000))'], { maxBytes: 50 }), /output limit/);
});

test('WER counts edits and rejects empty references', async () => {
  const { wordErrorRate } = await import('../src/metrics.js');
  assert.equal(wordErrorRate('Hello, WORLD!', 'hello world').wer, 0);
  assert.equal(wordErrorRate('one two three', 'one four').errors, 2);
  assert.equal(wordErrorRate('one', 'one two three').wer, 2);
  assert.throws(() => wordErrorRate('', 'word'));
});

test('CLI writes a complete result and refuses to overwrite it', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'filler-test-'));
  const out = join(root, 'run');
  const args = ['--import', 'tsx', 'src/cli.ts', 'align', 'examples/raw-overlap.json', '--out', out];
  try {
    await run(process.execPath, args);
    const m = meetingSchema.parse(JSON.parse(await readFile(join(out, 'meeting.json'), 'utf8')));
    assert.deepEqual(m.segments.map(s => s.speaker), ['S1', null, 'S2']);
    assert.match(await readFile(join(out, 'report.md'), 'utf8'), /Attribution: overlap/);
    await assert.rejects(run(process.execPath, args), /code 1/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
