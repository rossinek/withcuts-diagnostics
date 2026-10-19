# WithSubtitles video diagnostics

A minimal, typographic, dark support page with an amber accent and one task per screen. Videos are selected and tested locally in the browser. No backend, dependencies, uploads, analytics or external fonts.

## Use

Open the page in **Safari on the affected iPhone**. Choose the problem video (or the built-in six-second H.264/AAC sample), wait for two metadata checks, then complete four playback checks. Tap Play, try seeking, tap Continue, then choose what you saw on the next screen. Share the JSON report using the iOS share sheet, or download/copy it.

Reports include browser capabilities, events, media state, metadata timing, playback errors, draw counters, user observations, optional device details and notes. The combined result choices record audio explicitly for “Audio only” and “No picture or sound”; other choices leave audio unknown. They exclude file names, source URLs, video/audio data and captured frames. Text explicitly entered in notes is included verbatim. Selecting another video retains up to five previous runs in memory so sample and problem-video results can be shared together. Reloading clears everything.

The browser may transform a video selected from Photos; use an original saved in Files when an exact file comparison is needed. File size and MIME type are recorded, but these do not prove byte-for-byte identity.

## Checks and interpretation

1. **Original metadata:** detached `video`, default preload, resolves on the first `loadedmetadata` even for zero dimensions. Matches `getVideoDimentions.ts` in the app, with an added 8-second deadline and cleanup.
2. **Updated metadata:** mounted visible video, explicit `preload=metadata`, inline, muted, explicit `load()`, accepts only positive dimensions on metadata/data/resize/canplay, with the same deadline. This changes several parameters; a pass does not isolate which one mattered.
3. **Regular player:** visible HTML video, no canvas.
4. **App-style preview:** `display:none` video → canvas, using the original probe dimensions and `#t=0.001`. An unavailable size leaves the canvas blank, matching the app's empty crop outcome. The actual app's crop/aspect-ratio/overlay logic is not reproduced.
5. **Different size check:** hidden video → canvas, using the player's live dimensions.
6. **Visible source:** visible video → canvas, using live dimensions.

Playback runs one decoder at a time and uses explicit user gestures. Canvas output is bounded to 960px and drawn at up to 30fps. Successful `drawImage` calls and frame callbacks do **not** establish visual success; user observations are the primary visual evidence. The hidden canvas variants skip invalid crops instead of calling `drawImage` with zero dimensions. No decoding-success or iOS-regression claim is inferred from an empty black frame.

This cannot reproduce Capacitor's custom local-file URL scheme or test AVFoundation, the app's native renderer, native export or Photos save. A passing Safari test does not rule out an app-only problem. Confirm any resulting app fix through TestFlight.

## Local development

Node.js 22+, no install required:

```sh
npm run dev
npm run check
npm test
```

Open http://127.0.0.1:4173. `PORT=4174 npm run dev` chooses another port. This server is only for local preview and handles byte ranges for video seeking.

The static site is in `site/`; links are relative and work at a GitHub Pages project subpath. The generated sample uses FFmpeg's `testsrc2` and a quiet 440Hz tone; no third-party media is included.

## GitHub Pages

Push this repository to GitHub with default branch `main`. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. `.github/workflows/pages.yml` checks the JavaScript, runs tests, and publishes only `site/` on every push to `main` (also supports manual dispatch).

Typical URL: `https://<owner>.github.io/withcuts-diagnostics/`.

## Privacy and limitations

The static hosting provider receives ordinary page/asset requests. Selecting a video creates a browser-local object URL; no video is uploaded. A Content Security Policy forbids fetch/XHR/WebSocket connections and external scripts. Sharing is explicitly initiated by the user; its destination is chosen in the system share sheet. Reports are not automatically sent anywhere or stored in the browser.

JSON file sharing falls back to sharing text if file sharing is unsupported. Download and Copy remain available. Clipboard failures show selectable report text. Tests can be skipped if playback fails; the final report includes partial results. Technical details are under View report.
