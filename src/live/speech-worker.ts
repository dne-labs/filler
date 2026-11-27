import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { InferenceError, missingExecutable } from '../diagnostics.js';

type Pending = { resolve: (value: string) => void; reject: (error: Error) => void };

export class PersistentSpeechWorker {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: Pending;

  constructor(private readonly python: string, private readonly workerPath = fileURLToPath(new URL('../../workers/speech/worker.py', import.meta.url))) {}

  async run(_command: string, args: string[]): Promise<string> {
    const defaultWorkerPath = fileURLToPath(new URL('../../workers/speech/worker.py', import.meta.url));
    const workerArgs = args[0] === defaultWorkerPath ? args.slice(1) : args;
    return this.request({ action: 'transcribe', args: workerArgs });
  }

  async enroll(audio: string): Promise<number[]> {
    const response = JSON.parse(await this.request({ action: 'enroll', audio })) as { embedding: number[] };
    return response.embedding;
  }

  private request(payload: unknown): Promise<string> {
    this.ensureStarted();
    if (this.pending) throw new InferenceError('Speech worker is already processing audio.');
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.child!.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  close(): void { this.child?.kill('SIGTERM'); this.child = undefined; }

  private ensureStarted(): void {
    if (this.child) return;
    const child = spawn(this.python, [this.workerPath, '--serve'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    child.stderr.pipe(process.stderr);
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      const pending = this.pending;
      this.pending = undefined;
      if (!pending) return;
      try {
        const response = JSON.parse(line) as { ok: boolean; result?: unknown; error?: string };
        if (!response.ok) pending.reject(new InferenceError(response.error ?? 'Speech inference failed.'));
        else pending.resolve(JSON.stringify(response.result));
      } catch {
        pending.reject(new InferenceError('Speech worker returned an invalid response.'));
      }
    });
    child.once('error', () => {
      this.pending?.reject(missingExecutable(this.python));
      this.pending = undefined;
      this.child = undefined;
    });
    child.once('exit', code => {
      this.pending?.reject(new InferenceError(`Speech worker stopped with code ${code}. Run npm run doctor.`));
      this.pending = undefined;
      this.child = undefined;
    });
  }
}
