export const REPORT_VERSION = 2;
export const APP_VERSION = '1.1.0';
export const TESTS = [
  { id: 'direct-video', title: 'The regular player', description: 'First, let’s try a regular video player. Press play and check whether the picture moves.', mode: 'direct', dimensions: 'player' },
  { id: 'app-style-canvas', title: 'The app-style preview', description: 'This uses a hidden player and the original metadata check, like the app’s preview.', mode: 'hidden', dimensions: 'original' },
  { id: 'hidden-live-dimensions', title: 'A different size check', description: 'The player is still hidden. This time, the preview reads the picture size directly from the player.', mode: 'hidden', dimensions: 'player' },
  { id: 'visible-live-dimensions', title: 'A visible source player', description: 'The small source player stays visible below the preview. Check whether the large picture moves.', mode: 'visible', dimensions: 'player' },
];
const finite = value => Number.isFinite(value) ? value : null;
export const validDimensions = ({ width, height } = {}) => Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
export function safeError(error) {
  return { name: String(error?.name || 'Error').slice(0, 80), message: String(error?.message || 'Media operation failed').replace(/(?:blob:|file:|https?:)[^\s"'<>]+/g, '[source]').slice(0, 300) };
}
export function mediaSnapshot(video) {
  return {
    width: finite(video.videoWidth), height: finite(video.videoHeight), duration: finite(video.duration),
    currentTime: finite(video.currentTime), readyState: video.readyState, networkState: video.networkState,
    paused: video.paused, ended: video.ended, seeking: video.seeking,
    muted: video.muted, volume: finite(video.volume), playbackRate: finite(video.playbackRate),
    error: video.error ? { code: video.error.code, ...safeError(video.error) } : null,
  };
}
export function releaseVideo(video) {
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}
// Original mode deliberately preserves the app helper's detached element and default preload.
// Both modes add a deadline and cleanup so the diagnostic page itself cannot wait forever.
export function probeMetadata(src, { mode, mount, timeoutMs = 8000, signal, createVideo = () => document.createElement('video') }) {
  return new Promise(resolve => {
    const video = createVideo();
    const started = performance.now();
    const events = [];
    let finished = false;
    let timer;
    const names = ['loadstart', 'loadedmetadata', 'loadeddata', 'resize', 'canplay', 'stalled', 'suspend', 'error', 'abort'];
    function finish(status) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      names.forEach(name => video.removeEventListener(name, onEvent));
      signal?.removeEventListener('abort', onAbort);
      const snapshot = mediaSnapshot(video);
      const result = { mode, status, elapsedMs: Math.round(performance.now() - started), validDimensions: validDimensions(snapshot), snapshot, events };
      releaseVideo(video);
      resolve(result);
    }
    function onAbort() { finish('cancelled'); }
    function onEvent(event) {
      if (events.length < 40) events.push({ event: event.type, elapsedMs: Math.round(performance.now() - started), ...mediaSnapshot(video) });
      if (event.type === 'error') return finish('error');
      if (mode === 'original' && event.type === 'loadedmetadata') return finish('resolved');
      if (mode === 'updated' && ['loadedmetadata', 'loadeddata', 'resize', 'canplay'].includes(event.type) && validDimensions({ width: video.videoWidth, height: video.videoHeight })) finish('resolved');
    }
    if (signal?.aborted) { finish('cancelled'); return; }
    names.forEach(name => video.addEventListener(name, onEvent));
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    if (mode === 'updated') {
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.className = 'probe-video';
      mount?.append(video);
    }
    video.src = src;
    if (mode === 'updated') video.load();
  });
}
