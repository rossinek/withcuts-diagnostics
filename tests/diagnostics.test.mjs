import test from 'node:test';
import assert from 'node:assert/strict';
import { probeMetadata, validDimensions, safeError } from '../site/diagnostics.js';
class FakeVideo extends EventTarget {
  videoWidth = 0; videoHeight = 0; duration = NaN; currentTime = 0;
  readyState = 0; networkState = 0; paused = true; ended = false; seeking = false;
  muted = false; volume = 1; playbackRate = 1; error = null;
  pause() { this.paused = true; }
  removeAttribute(name) { delete this[name]; }
  load() { this.loads = (this.loads || 0) + 1; }
  remove() { this.removed = true; }
  emit(type) { this.dispatchEvent(new Event(type)); }
}
function start(mode, options = {}) {
  const video = new FakeVideo();
  const mounted = [];
  const promise = probeMetadata('blob:private-source', { mode, createVideo: () => video, mount: { append: v => mounted.push(v) }, timeoutMs: 30, ...options });
  return { video, promise, mounted };
}
test('original probe faithfully accepts zero metadata; report flags it as unusable', async () => {
  const { video, promise, mounted } = start('original');
  video.emit('loadedmetadata');
  const result = await promise;
  assert.equal(result.status, 'resolved');
  assert.equal(result.validDimensions, false);
  assert.equal(mounted.length, 0);
  assert.equal(video.removed, true);
  assert.equal(video.src, undefined);
  assert.equal(result.snapshot.duration, null);
});
test('updated probe waits for nonzero dimensions arriving after loadedmetadata', async () => {
  const { video, promise, mounted } = start('updated');
  assert.equal(mounted.length, 1);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.preload, 'metadata');
  video.emit('loadedmetadata');
  video.videoWidth = 1080; video.videoHeight = 1920; video.emit('resize');
  const result = await promise;
  assert.equal(result.status, 'resolved');
  assert.equal(result.validDimensions, true);
  assert.equal(result.snapshot.width, 1080);
  assert.deepEqual(result.events.map(e => e.event), ['loadedmetadata', 'resize']);
});
test('missing metadata terminates with timeout and releases the decoder', async () => {
  const { video, promise } = start('original', { timeoutMs: 5 });
  assert.equal((await promise).status, 'timeout');
  assert.equal(video.removed, true);
  assert.equal(video.loads, 1);
});
test('media errors are captured without local source URLs', async () => {
  const { video, promise } = start('updated');
  video.error = { code: 4, message: 'Cannot load blob:private-source' }; video.emit('error');
  const result = await promise;
  assert.equal(result.status, 'error');
  assert.equal(result.snapshot.error.code, 4);
  assert.ok(!JSON.stringify(result).includes('private-source'));
});
test('cancellation settles and removes event listeners', async () => {
  const controller = new AbortController();
  const { video, promise } = start('updated', { signal: controller.signal });
  controller.abort();
  const result = await promise;
  const before = result.events.length;
  video.emit('loadedmetadata');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.events.length, before);
  assert.equal(video.removed, true);
});
test('already-aborted probes never set a source', async () => {
  const controller = new AbortController(); controller.abort();
  const { video, promise } = start('original', { signal: controller.signal });
  assert.equal((await promise).status, 'cancelled');
  assert.equal(video.src, undefined);
});
test('invalid dimensions never count as usable', () => {
  for (const width of [0, -1, Infinity, NaN, undefined]) assert.equal(validDimensions({ width, height: 100 }), false);
  assert.equal(validDimensions({ width: 1920, height: 1080 }), true);
});
test('file URLs are redacted from error messages', () => {
  assert.equal(safeError({ message: 'Failed file:///private/name.mov' }).message, 'Failed [source]');
});
