import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { report } from './report.js';
import { align } from './align.js';
import { rawSchema } from './schema.js';
import { transcribe } from './pipeline.js';

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, python: { type: 'string' }, model: { type: 'string' }, revision: { type: 'string' },
    device: { type: 'string' }, 'compute-type': { type: 'string' }, diarize: { type: 'boolean', default: false }, speakers: { type: 'string' }, language: { type: 'string' },
  } });
  const [command, input] = positionals;
  if (!input || positionals.length !== 2 || !['report', 'align', 'transcribe'].includes(command ?? '')) throw new Error('Usage: report MEETING.json | align RAW.json --out NEW_DIR | transcribe AUDIO --out NEW_DIR [--diarize] [--python PATH]');
  if (command === 'report') { console.log(report(JSON.parse(await readFile(input, 'utf8')))); return; }
  if (!values.out) throw new Error('--out is required; use a new directory for each run');
  const out = resolve(values.out);
  // Exclusive directory creation prevents overwriting a prior recording or result.
  await mkdir(out, { recursive: false });
  try {
    const result = command === 'align'
      ? (() => readFile(input, 'utf8').then(s => { const raw = rawSchema.parse(JSON.parse(s)); return { raw, meeting: align(raw) }; }))()
      : transcribe(input, {
          python: values.python, model: values.model, revision: values.revision,
          device: values.device ? z.enum(['cpu', 'cuda']).parse(values.device) : undefined,
          computeType: values['compute-type'] ? z.enum(['int8', 'float16', 'float32']).parse(values['compute-type']) : undefined,
          diarize: values.diarize, speakers: values.speakers ? Number(values.speakers) : undefined, language: values.language,
        });
    const { raw, meeting } = await result;
    await writeFile(join(out, 'raw.json'), JSON.stringify(raw, null, 2) + '\n');
    await writeFile(join(out, 'meeting.json'), JSON.stringify(meeting, null, 2) + '\n');
    await writeFile(join(out, 'report.md'), report(meeting));
    console.log(`Saved ${meeting.segments.length} words; ${meeting.segments.filter(s => s.speaker === null).length} unassigned. Results: ${out}`);
  } catch (error) {
    await writeFile(join(out, 'FAILED.txt'), 'Run failed. No successful result should be inferred. See CLI error.\n');
    throw error;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Run failed'); process.exitCode = 1; });
