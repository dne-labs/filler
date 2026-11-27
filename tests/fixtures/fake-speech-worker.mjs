import { createInterface } from 'node:readline';
let count = 0;
for await (const line of createInterface({ input: process.stdin })) {
  JSON.parse(line);
  count++;
  process.stdout.write(`${JSON.stringify({ ok: true, result: { pid: process.pid, count } })}\n`);
}
