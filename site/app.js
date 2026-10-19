import { APP_VERSION, REPORT_VERSION, TESTS, probeMetadata, mediaSnapshot, releaseVideo, validDimensions, safeError, reportSummary } from './diagnostics.js';

const $ = id => document.getElementById(id);
let source;
let run;
let history = [];
let step = 0;
let video;
let activeTest;
let disposePlayer;
let probeController;
let runToken = 0;
let selectedPicture;
let selectedAudio;
let isComplete = false;
let sharing = false;
const eventsToCapture = ['loadstart', 'loadedmetadata', 'loadeddata', 'resize', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'suspend', 'ended', 'error', 'abort', 'emptied', 'timeupdate'];
const clock = seconds => { const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const bytes = size => `${(size / 1024 / 1024).toFixed(1)} MB`;
function environment() {
  return {
    userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language,
    maxTouchPoints: navigator.maxTouchPoints, viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
    secureContext: isSecureContext, visibilityState: document.visibilityState,
    capabilities: { videoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype, webShare: !!navigator.share, fileShareCheck: !!navigator.canShare, clipboard: !!navigator.clipboard, webCodecs: 'VideoDecoder' in window },
    mediaSupport: Object.fromEntries(['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="hvc1"', 'video/quicktime'].map(type => [type, document.createElement('video').canPlayType(type)])),
  };
}
function updateSnapshot() {
  if (activeTest && video) activeTest.finalSnapshot = mediaSnapshot(video);
}
function report() {
  updateSnapshot();
  const currentRun = run ? structuredClone(run) : null;
  if (currentRun) currentRun.summary = reportSummary(currentRun);
  return {
    schemaVersion: REPORT_VERSION, appVersion: APP_VERSION, generatedAt: new Date().toISOString(),
    scope: 'Safari/browser diagnostics; native app export is not tested.',
    privacy: 'No video, audio, frames, file names or source URLs are included. Device details and notes are entered by the user.',
    environment: environment(),
    device: { model: $('device-model').value.trim(), osVersion: $('os-version').value.trim() },
    notes: $('notes').value.trim(),
    previousRuns: history,
    currentRun,
  };
}
function reportText() { return JSON.stringify(report(), null, 2); }
function updateReport() {
  if (!run) return;
  $('report-preview').textContent = reportText();
  $('report-state').textContent = isComplete ? 'REPORT READY' : 'PARTIAL REPORT';
}
function stopPlayer() {
  updateSnapshot();
  disposePlayer?.();
  disposePlayer = undefined;
  video = undefined;
  activeTest = undefined;
}
function archiveRun() {
  if (!run) return;
  run.finishedAt = new Date().toISOString();
  run.summary = reportSummary(run);
  history.push(structuredClone(run));
  if (history.length > 5) history.shift();
}
function setBusy(busy) {
  document.body.dataset.running = String(busy);
  $('file-input').disabled = busy;
  $('sample-button').disabled = busy;
  $('repeat-button').disabled = busy;
}
async function selectSource(nextSource) {
  ++runToken;
  probeController?.abort();
  stopPlayer();
  archiveRun();
  if (source?.kind === 'local-file') URL.revokeObjectURL(source.url);
  source = nextSource;
  await beginRun();
}
async function beginRun() {
  const token = ++runToken;
  probeController?.abort();
  probeController = new AbortController();
  stopPlayer();
  isComplete = false;
  step = 0;
  run = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), source: source.report, metadata: {}, playback: [], interruptions: [] };
  $('checks-section').hidden = false;
  $('report-section').hidden = false;
  $('player-section').hidden = true;
  $('checks-complete').hidden = true;
  $('metadata-progress').hidden = false;
  $('metadata-progress').textContent = 'Reading video information. This can take up to 16 seconds…';
  $('metadata-results').replaceChildren();
  $('test-count').textContent = 'PREPARING';
  $('file-summary').textContent = source.display;
  setBusy(true);
  $('checks-section').scrollIntoView({ block: 'start', behavior: 'instant' });
  updateReport();
  try {
    for (const mode of ['original', 'updated']) {
      const result = await probeMetadata(source.url, { mode, signal: probeController.signal, mount: $('metadata-progress') });
      if (token !== runToken) return;
      run.metadata[mode] = result;
      const row = document.createElement('div'); row.className = 'result-row';
      const title = document.createElement('span'); title.textContent = mode === 'original' ? 'Original metadata check' : 'Updated metadata check';
      const value = document.createElement('span'); value.textContent = `${result.validDimensions ? `${result.snapshot.width} × ${result.snapshot.height}` : result.status === 'resolved' ? 'Invalid dimensions' : result.status} · ${result.elapsedMs} ms`;
      row.append(title, value); $('metadata-results').append(row);
      updateReport();
    }
    $('metadata-progress').hidden = true;
    setupTest();
  } catch (error) {
    run.setupError = safeError(error);
    $('metadata-progress').textContent = 'The information check could not finish. You can still share the report below.';
    updateReport();
  } finally { if (token === runToken) setBusy(false); }
}
function setupTest() {
  stopPlayer();
  const config = TESTS[step];
  const started = performance.now();
  const record = { id: config.id, mode: config.mode, dimensionSource: config.dimensions, startedAt: new Date().toISOString(), events: [], playAttempts: [], canvas: { drawAttempts: 0, drawCallsSucceeded: 0, skippedNoFrame: 0, skippedInvalidDimensions: 0, errors: [], note: 'Successful draw calls do not prove that a visible picture was produced. See the user observation.' }, observation: null };
  activeTest = record;
  run.playback.push(record);
  selectedPicture = undefined; selectedAudio = undefined;
  document.querySelectorAll('input[name=picture], input[name=audio]').forEach(input => { input.checked = false; });
  $('next-button').disabled = true;
  $('next-button').textContent = step === TESTS.length - 1 ? 'Finish checks →' : 'Next check →';
  $('test-count').textContent = `${step + 1} OF ${TESTS.length}`;
  $('progress-fill').style.width = `${(step + 1) / TESTS.length * 100}%`;
  $('test-title').textContent = config.title;
  $('test-description').textContent = config.description;
  $('player-section').hidden = false;
  $('preview-empty').hidden = false;
  $('visible-video').hidden = true;
  $('canvas').hidden = true;
  $('source-preview').hidden = true;
  $('play-button').textContent = 'Play test';
  $('play-button').disabled = false;
  $('seek').value = 0; $('seek').disabled = true;
  $('time-display').textContent = '0:00 / 0:00';
  $('playback-status').textContent = 'Press play, then try moving the slider.';

  const el = document.createElement('video');
  el.playsInline = true; el.preload = 'metadata'; el.muted = false;
  video = el;
  if (config.mode === 'direct') {
    el.id = 'visible-video';
    $('visible-video').replaceWith(el);
    el.hidden = true;
  } else if (config.mode === 'hidden') {
    el.className = 'hidden-source';
    document.body.append(el);
  } else {
    $('source-preview').append(el);
    $('source-preview').hidden = false;
  }
  const canvas = $('canvas');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  let raf;
  let frameId;
  let timeout;
  let hasStarted = false;
  let lastTimeEvent = -1;
  let disposed = false;
  let frameCallbackCount = 0;
  let frameSize;
  let lastRaf = 0;
  let lastQuality;

  function logEvent(event) {
    if (disposed) return;
    const elapsed = Math.round(performance.now() - started);
    if (event.type !== 'timeupdate' || elapsed - lastTimeEvent >= 1000) {
      if (event.type === 'timeupdate') lastTimeEvent = elapsed;
      if (record.events.length < 160) record.events.push({ event: event.type, elapsedMs: elapsed, ...mediaSnapshot(el) });
      else record.eventsTruncated = true;
    }
    const duration = el.duration;
    $('time-display').textContent = `${clock(el.currentTime)} / ${clock(duration)}`;
    $('seek').disabled = !Number.isFinite(duration) || duration <= 0;
    if (Number.isFinite(duration) && duration > 0) $('seek').value = Math.round(el.currentTime / duration * 1000);
    $('play-button').textContent = el.paused ? (hasStarted ? 'Play' : 'Play test') : 'Pause';
    if (event.type === 'playing') {
      clearTimeout(timeout);
      $('playback-status').textContent = config.dimensions === 'original' && !run.metadata.original?.validDimensions
        ? 'Playback started, but the original size check returned no usable picture size.'
        : 'Playback started. Check the picture and try the slider.';
    }
    if (event.type === 'ended') $('playback-status').textContent = 'Playback finished. You can replay it or continue.';
    if (event.type === 'error') {
      clearTimeout(timeout);
      $('playback-status').textContent = `The browser could not load this video (media error ${el.error?.code || 'unknown'}). You can continue or share the report.`;
    }
    if (event.type === 'waiting' && hasStarted) $('playback-status').textContent = 'Waiting for video data… You can continue if it stays here.';
  }
  eventsToCapture.forEach(name => el.addEventListener(name, logEvent));
  // Capture presentation callbacks without using them as proof of a visible image.
  function onFrame(_now, metadata) {
    if (disposed) return;
    frameCallbackCount++;
    record.frameCallbacks = { count: frameCallbackCount, mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames, width: metadata.width, height: metadata.height };
    frameId = el.requestVideoFrameCallback(onFrame);
  }
  if (el.requestVideoFrameCallback) frameId = el.requestVideoFrameCallback(onFrame);
  function draw(now) {
    if (disposed) return;
    raf = requestAnimationFrame(draw);
    if (config.mode === 'direct' || !hasStarted || now - lastRaf < 1000 / 30) return;
    lastRaf = now;
    record.canvas.drawAttempts++;
    if (el.readyState < 2) { record.canvas.skippedNoFrame++; return; }
    const dims = config.dimensions === 'original'
      ? (run.metadata.original?.status === 'resolved' ? run.metadata.original.snapshot : undefined)
      : { width: el.videoWidth, height: el.videoHeight };
    if (!validDimensions(dims)) { record.canvas.skippedInvalidDimensions++; context.clearRect(0, 0, canvas.width, canvas.height); return; }
    const width = Math.min(960, dims.width);
    const height = Math.max(1, Math.round(width * dims.height / dims.width));
    const size = `${width}x${height}`;
    if (frameSize !== size) {
      // Bound the canvas even for extremely tall / malformed inputs.
      const scale = Math.min(1, 960 / height);
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      frameSize = size;
      record.canvas.outputSize = { width: canvas.width, height: canvas.height };
      record.canvas.sourceSize = { width: dims.width, height: dims.height };
    }
    try {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(el, 0, 0, dims.width, dims.height, 0, 0, canvas.width, canvas.height);
      record.canvas.drawCallsSucceeded++;
    } catch (error) {
      if (record.canvas.errors.length < 5) record.canvas.errors.push(safeError(error));
      $('playback-status').textContent = 'The browser could not draw the preview. This has been added to the report.';
    }
  }
  raf = requestAnimationFrame(draw);
  // Match the app player's initial fragment in the canvas cases.
  el.src = config.mode === 'direct' ? source.url : `${source.url}#t=0.001`;
  function startPlayback() {
    if (!el.paused) { el.pause(); return; }
    hasStarted = true;
    record.startedByUser = true;
    $('preview-empty').hidden = true;
    if (config.mode === 'direct') el.hidden = false;
    else canvas.hidden = false;
    const attempt = { elapsedMs: Math.round(performance.now() - started), status: 'pending' };
    record.playAttempts.push(attempt);
    $('playback-status').textContent = 'Starting playback…';
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (disposed) return;
      attempt.exceededTimeout = true;
      $('playback-status').textContent = 'Playback has not started after 10 seconds. Please record what you see or skip this check.';
      updateReport();
    }, 10000);
    // Invoke play synchronously from the button gesture for iOS media policies.
    try {
      el.play().then(() => {
        attempt.status = 'resolved';
        if (disposed) return;
        clearTimeout(timeout);
        updateReport();
      }, error => {
        attempt.status = 'rejected'; attempt.error = safeError(error);
        if (disposed) return;
        clearTimeout(timeout);
        $('playback-status').textContent = `Playback could not start (${error.name || 'error'}). You can continue and share the report.`;
        updateReport();
      });
    } catch (error) {
      clearTimeout(timeout); attempt.status = 'rejected'; attempt.error = safeError(error);
      $('playback-status').textContent = 'Playback could not start. Please continue and share the report.';
    }
  }
  $('play-button').onclick = startPlayback;
  $('restart-button').onclick = () => { try { el.currentTime = 0; if (el.paused) startPlayback(); } catch (error) { record.seekError = safeError(error); } };
  $('seek').oninput = () => {
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    try { el.currentTime = Number($('seek').value) / 1000 * el.duration; record.userSeekCount = (record.userSeekCount || 0) + 1; }
    catch (error) { record.seekError = safeError(error); }
  };
  disposePlayer = () => {
    disposed = true;
    clearTimeout(timeout); cancelAnimationFrame(raf);
    if (frameId !== undefined) el.cancelVideoFrameCallback(frameId);
    if (el.getVideoPlaybackQuality) {
      lastQuality = el.getVideoPlaybackQuality();
      record.playbackQuality = { totalVideoFrames: lastQuality.totalVideoFrames, droppedVideoFrames: lastQuality.droppedVideoFrames };
    }
    eventsToCapture.forEach(name => el.removeEventListener(name, logEvent));
    // Keep a placeholder so the next direct-player test can replace it.
    if (el.id === 'visible-video') {
      const placeholder = document.createElement('video'); placeholder.id = 'visible-video'; placeholder.hidden = true;
      el.replaceWith(placeholder);
    }
    releaseVideo(el);
    $('play-button').onclick = null; $('restart-button').onclick = null; $('seek').oninput = null;
  };
  updateReport();
}
function finishStep(skipped) {
  if (!activeTest) return;
  activeTest.observation = { picture: selectedPicture || null, audio: selectedAudio || null, skipped };
  activeTest.finishedAt = new Date().toISOString();
  stopPlayer();
  step++;
  if (step < TESTS.length) setupTest();
  else {
    isComplete = true;
    run.finishedAt = new Date().toISOString();
    $('player-section').hidden = true;
    $('checks-complete').hidden = false;
    $('test-count').textContent = 'COMPLETE';
    updateReport();
    $('report-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
}
$('file-input').addEventListener('change', () => {
  const file = $('file-input').files?.[0];
  if (!file) return;
  if (!file.size) { $('file-summary').textContent = 'This file is empty. Please choose another video.'; return; }
  selectSource({ kind: 'local-file', url: URL.createObjectURL(file), display: `${file.name} · ${bytes(file.size)} · kept on this device`, report: { kind: 'local-file', bytes: file.size, mimeType: file.type || 'unknown' } });
  $('file-input').value = '';
});
$('sample-button').addEventListener('click', () => selectSource({ kind: 'sample', url: new URL('./assets/sample.mp4', location.href).href, display: 'Built-in sample · 6 seconds · moving pattern + quiet tone', report: { kind: 'sample', id: 'h264-aac-640x360-30fps-v1', mimeType: 'video/mp4' } }));
$('repeat-button').addEventListener('click', () => { archiveRun(); beginRun(); });
$('next-button').addEventListener('click', () => finishStep(false));
$('skip-button').addEventListener('click', () => finishStep(true));
document.querySelectorAll('input[name=picture]').forEach(input => input.addEventListener('change', () => {
  selectedPicture = input.value;
  $('next-button').disabled = false;
  if (activeTest) activeTest.observation = { picture: selectedPicture, audio: selectedAudio || null, skipped: false };
  updateReport();
}));
document.querySelectorAll('input[name=audio]').forEach(input => input.addEventListener('change', () => {
  selectedAudio = input.value;
  if (activeTest) activeTest.observation = { picture: selectedPicture || null, audio: selectedAudio, skipped: false };
  updateReport();
}));
['notes', 'device-model', 'os-version'].forEach(id => $(id).addEventListener('input', updateReport));
$('report-details').addEventListener('toggle', () => { if ($('report-details').open) updateReport(); });
function downloadReport() {
  const blob = new Blob([reportText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `withsubtitles-video-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  $('share-status').textContent = 'Report download requested. Attach the JSON file to your support reply.';
}
$('download-button').addEventListener('click', downloadReport);
$('share-button').addEventListener('click', async () => {
  if (sharing) return;
  const text = reportText();
  const file = new File([text], 'withsubtitles-video-check.json', { type: 'application/json' });
  sharing = true; $('share-button').disabled = true;
  try {
    if (!navigator.share) { downloadReport(); return; }
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'WithSubtitles video check' });
    else await navigator.share({ title: 'WithSubtitles video check', text });
    $('share-status').textContent = 'The report was handed to your chosen app.';
  } catch (error) {
    $('share-status').textContent = error.name === 'AbortError' ? 'Sharing cancelled. Your report is still here.' : 'Sharing is unavailable here. Please use Download or Copy.';
  } finally { sharing = false; $('share-button').disabled = false; }
});
$('copy-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(reportText());
    $('share-status').textContent = 'Report copied. Paste it into your support reply.';
  } catch {
    updateReport(); $('report-details').open = true;
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents($('report-preview')); selection.removeAllRanges(); selection.addRange(range);
    $('share-status').textContent = 'Automatic copy is unavailable. Select and copy the report below, or use Download.';
  }
});
document.addEventListener('visibilitychange', () => {
  if (!run) return;
  if (run.interruptions.length < 40) run.interruptions.push({ event: 'visibilitychange', state: document.visibilityState, at: new Date().toISOString(), test: activeTest?.id || null });
  if (document.hidden) video?.pause();
});
window.addEventListener('pagehide', () => {
  ++runToken;
  if (activeTest) activeTest.interruptedByNavigation = true;
  probeController?.abort();
  stopPlayer();
  setBusy(false);
});
window.addEventListener('pageshow', event => {
  if (!event.persisted || !run || isComplete || video) return;
  if (run.metadata.original && run.metadata.updated) {
    setupTest();
    $('playback-status').textContent = 'Welcome back. Please replay this check after returning to the page.';
  } else {
    archiveRun();
    beginRun();
  }
});
