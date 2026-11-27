import { readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { transcribe } from '../src/pipeline.js';
import { wordErrorRate } from '../src/metrics.js';

const { values } = parseArgs({ options: { audio: { type: 'string' }, reference: { type: 'string' }, out: { type: 'string' }, python: { type: 'string' } } });
if (!values.audio || !values.reference || !values.out) throw new Error('Required: --audio FILE --reference TEXT_FILE --out NEW_JSON [--python PATH]');
const reference = await readFile(values.reference, 'utf8');
wordErrorRate(reference, '');
const audioSha256 = createHash('sha256').update(await readFile(values.audio)).digest('hex');
const file = await open(values.out, 'wx');
try {
  const runs = [];
  for (const computeType of ['int8', 'float32'] as const) {
    const { raw } = await transcribe(values.audio, { python: values.python, computeType, language: 'en' });
    const hypothesis = raw.words.map(w => w.text).join(' ');
    runs.push({ computeType, duration: raw.duration, hypothesis, ...wordErrorRate(reference, hypothesis), metadata: raw.metadata });
    console.log(`Completed ${computeType}: ${raw.words.length} words`);
  }
  await file.writeFile(JSON.stringify({ audioSha256, cpu: cpus()[0]?.model, node: process.version, runs,
    scope: 'Single English public-speech clip, CPU ASR only. Sequential cold worker processes; snapshot resolution/cache and model load grouped separately from ASR. No speaker or overlap accuracy measured. Not a general speedup claim.' }, null, 2) + '\n');
} catch (error) {
  await file.writeFile(JSON.stringify({ status: 'failed', audioSha256, error: error instanceof Error ? error.message : 'Unknown failure' }) + '\n');
  throw error;
} finally { await file.close(); }
