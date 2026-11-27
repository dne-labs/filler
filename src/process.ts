import { spawn } from 'node:child_process';
export interface RunOptions { timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv }
/** No shell interpolation. Bound wall time and combined captured output. */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: options.env ?? process.env });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let size = 0; let failure: Error | undefined;
    const stop = (reason: string) => { failure ??= new Error(reason); child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(`${command} timed out`), options.timeoutMs ?? 30 * 60_000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxBytes ?? 32 * 1024 * 1024)) stop(`${command} exceeded output limit`);
      else chunks.push(chunk);
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      // Do not echo arbitrary worker diagnostics: model errors can include private paths/tokens.
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}; run the worker directly for diagnostics`));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}
