import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { run } from './process.js';
import { rawSchema } from './schema.js';
import { align } from './align.js';

export type WorkerRunner = (command: string, args: string[]) => Promise<string>;
export interface Options { python?: string; model?: string; revision?: string; device?: 'cpu' | 'cuda'; computeType?: 'int8' | 'float16' | 'float32'; diarize?: boolean; speakers?: number; language?: string; initialPrompt?: string; hotwords?: string; beamSize?: number; workerRunner?: WorkerRunner }
const probeSchema = z.object({ streams: z.array(z.object({ channels: z.number().int().positive(), sample_rate: z.string() })).min(1), format: z.object({ duration: z.coerce.number().finite().positive() }) });
export async function transcribe(input: string, options: Options = {}) {
  const source = resolve(input);
  if (!(await stat(source)).isFile()) throw new Error('Input must be a local audio file');
  if (options.speakers !== undefined && (!Number.isInteger(options.speakers) || options.speakers < 1 || options.speakers > 32)) throw new Error('speakers must be an integer from 1 to 32');
  if (options.speakers !== undefined && !options.diarize) throw new Error('--speakers requires --diarize');
  const start = performance.now();
  const probe = probeSchema.parse(JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', source], { timeoutMs: 30_000 })));
  if (probe.format.duration > 7200) throw new Error('Prototype limit: two hours per recording');
  const temp = await mkdtemp(join(tmpdir(), 'filler-'));
  try {
    const wav = join(temp, 'audio.wav');
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', source, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { timeoutMs: 300_000 });
    const args = [fileURLToPath(new URL('../workers/speech/worker.py', import.meta.url)), '--audio', wav,
      '--model', options.model ?? 'Systran/faster-whisper-tiny.en', '--revision', options.revision ?? 'main',
      '--device', options.device ?? 'cpu', '--compute-type', options.computeType ?? (options.device === 'cuda' ? 'float16' : 'int8')];
    if (options.diarize) args.push('--diarize');
    if (options.speakers) args.push('--speakers', String(options.speakers));
    if (options.language) args.push('--language', options.language);
    if (options.initialPrompt) args.push('--initial-prompt', options.initialPrompt);
    if (options.hotwords) args.push('--hotwords', options.hotwords);
    args.push('--beam-size', String(options.beamSize ?? 3));
    const execute = options.workerRunner ?? run;
    const raw = rawSchema.parse(JSON.parse(await execute(options.python ?? process.env.FILLER_PYTHON ?? 'python', args)));
    raw.metadata = { ...raw.metadata, sourceChannels: probe.streams[0]!.channels, sourceSampleRate: Number(probe.streams[0]!.sample_rate), normalization: 'first audio stream; mono 16kHz PCM; original unmodified', pipelineSeconds: (performance.now() - start) / 1000 };
    return { raw, meeting: align(raw) };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
