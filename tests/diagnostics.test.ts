import test from 'node:test';import assert from 'node:assert/strict';
import {processFailure,missingExecutable,publicFailure} from '../src/diagnostics.js';
import {run} from '../src/process.js';
test('known missing dependencies produce fixes without leaking stderr',()=>{const error=processFailure('python',"ModuleNotFoundError: No module named 'faster_whisper'\nAuthorization: Bearer sk-private",1);assert.match(error.message,/Speech dependencies/);assert.ok(!error.message.includes('sk-private'));});
test('gated models and missing executables have distinct diagnoses',()=>{assert.match(processFailure('python','GatedRepoError',1).message,/Model access denied/);assert.match(missingExecutable('ffprobe').message,/FFmpeg/);assert.match(missingExecutable('/private/python').message,/FILLER_PYTHON/);});
test('unknown errors never expose arbitrary content',()=>{assert.ok(!publicFailure(new Error('secret value')).includes('secret'));});
test('real failed subprocess stderr is classified',async()=>{await assert.rejects(run(process.execPath,['-e',"console.error(\"ModuleNotFoundError: No module named 'faster_whisper'\");process.exit(1)"]),/Speech dependencies/);await assert.rejects(run('/nonexistent/filler-python',[]),/Python executable/);});
