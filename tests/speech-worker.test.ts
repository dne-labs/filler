import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PersistentSpeechWorker } from '../src/live/speech-worker.js';

test('persistent speech worker reuses one process across updates', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/fake-speech-worker.mjs', import.meta.url));
  const worker = new PersistentSpeechWorker(process.execPath, fixture);
  try {
    const first = JSON.parse(await worker.run('ignored', ['worker.py', '--audio', 'one.wav']));
    const second = JSON.parse(await worker.run('ignored', ['worker.py', '--audio', 'two.wav']));
    assert.equal(first.pid, second.pid);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
  } finally { worker.close(); }
});
