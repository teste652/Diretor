> Pesquisa feita em 18–19/11/2026 para o bloco 1 (áudio e legendas) do Diretor. O texto da pesquisa está em inglês. Caminhos como `/tmp/claude-0/...` apontam para testes locais daquela sessão, que não foram guardados; as conclusões e números estão aqui.

# Code map: how block 1 fits the current Diretor code (as of v0.1.24, commit 7a0dedf)

## Architecture today

Desktop editor on Electron 45 (Chromium 156, Node 24; https://www.electronjs.org/blog/electron-45-0). It targets Windows first (NSIS per-user installer) and the UI is in pt-BR.

BUILD
- scripts/build-main.mjs uses esbuild to emit CJS: dist/main/main.cjs, preload, dist/mcp/server.cjs and desconectar.cjs. electron and ffmpeg-static are external.
- The renderer is built with Vite 5 (vite.config.ts: root src/renderer, base './'). In production it loads from file://.
- src/renderer/index.html sets this CSP: default-src 'self'; script-src 'self'; media-src 'self' media: blob:; img-src 'self' data: media:.
- electron-builder packs files dist/**. asarUnpack covers dist/mcp/** and ffmpeg-static. scripts/after-pack.cjs asserts the binaries exist. There are no extraResources, and npmRebuild is false.
- CI (windows-latest) runs typecheck, about 155 vitest tests, scripts/e2e.mjs (about 50 checks, repeated on the installed app), installer checks and an update check.

CORE (src/core, pure TS shared by main, renderer and tests)
- model.ts
  - Project 'diretor.project', version 1. parseProject throws on any other version and rebuilds every object, so unknown fields are dropped.
  - Track has hidden and locked. VideoClip has mediaId, in, volume (0..1) and muted. Title and caption clips have text and style.
  - Default tracks: trk_video, trk_text, trk_captions.
- properties.ts: PROPS registry (x, y, scale, opacity), plus evalProp, keyframes and easing.
- operations.ts
  - Op union and validateOp with strict key whitelists (OP_KEYS, CHANGE_KEYS, STYLE_KEYS, CLIP_SPEC_KEYS).
  - expandOp handles macros and fills ids. applyOps runs applyPrimitive on a structuredClone.
  - touchedClipIds reads only 'clipId' fields and addClip ids. describeOp writes pt-BR labels.
  - trimClip with ripple shifts only the later video clips on the same track.
  - remapKeyframes and clampKeyframes are private.
- session.ts (EditorSession)
  - History keeps full before/after Project snapshots, capped at 200.
  - Proposals are lists of steps, each {requested, ops, manualOps}. A step's ops are prepared once with applyOps(project, requested).applied.
  - The view is applyOps(project, ops + manualOps), cached by `${revision}:${proposalId}:${version}`.
  - draftInfo is recomputed on every access.
  - dispatch sends an edit to the draft or commits it. USER_ONLY_OPS are addMedia and updateTrack.
  - A proposal goes stale when the revision changes or the selection leaves its targets. Only one proposal can be open, and proposals are shaped around the AI.
- render.ts
  - renderFrame is one synchronous Canvas 2D compositor for both preview and export. It gets video through the getVideoFrame indirection.
  - drawText fills only, with an optional background and shadow. Captions are fixed at the bottom (cy = 0.9H − h/2, maxW 0.8W).
- export.ts: buildFfmpegArgs takes RGBA on pipe:0. Each audible clip adds `-ss/-t/-i`, then aresample, volume, adelay, and finally amix.
- api.ts: MCP bridge methods status, get_context (economy ceiling 6 KB, compactClip emits only non-default values, reducedContext), propose_edit, get_proposal (long wait up to 45 s) and cancel_proposal.

RUNTIME
- EditorSession lives in the renderer (store.ts).
- MCP path: stdio server (src/mcp/server.ts, zod schemas, OPS_HELP) → HTTP on 127.0.0.1 with a bearer token (2 MB body cap) → main askRenderer → IPC bridge:request → renderer bridgeClient.ts handleBridge.
- Timeouts: main 15 s (get_proposal up to 55 s); server 20 s (get_proposal up to 57 s).
- The in-app chat spawns the Claude Code and Codex CLIs (assistant.ts) against the same MCP server.

PREVIEW (Preview.tsx)
- Draws renderFrame(session.view) on an HTMLCanvas.
- The playback clock is masterTime(): the currentTime of the playing <video>, with a wall-clock fallback.
- Audio comes from the same <video> elements: el.volume = monitor × clip.volume, clamped to 1. An element is muted when its clip is muted or the video track is hidden. Elements are re-seeked only when drift exceeds 0.3 s.
- VideoPool (video.ts) keeps one <video> per clip.id (preload auto, media://local/<path>). frame() returns null while readyState < 2.

EXPORT (renderer exporter.ts → main)
1. Preflight opens one element per clip.
2. export:start receives session.project and spawns ffmpeg right away into a temp file `.diretor-*.part`.
3. Frames are drawn on an OffscreenCanvas 2D (willReadFrequently): seekExact → renderFrame → getImageData → IPC export:frame, with drain handling.
4. export:finish does an atomic move, falling back to 'nome (1).mp4'.
5. Cancel, reload or a crash kills ffmpeg and removes the temp file; e2e checks this.

MEDIA SCHEME
- media:// is registered privileged (standard, secure, stream, supportFetchAPI, bypassCSP, corsEnabled).
- serveMedia supports Range (206/416) and only video MIME types (mp4/m4v/mov/webm). mediaPathFromUrl ignores the URL host.

UI (one screen)
- Grid rows: 52 px top bar / main / timeline at clamp(230px, 32vh, 300px).
- Main columns: left panel 300 px (tabs Mídia | Propriedades=Inspector) / Preview / right ChatPanel 380 px (assistants, ProposalCards, economy toggle).
- Timeline: toolbar (undo, redo, trash, Adicionar legenda, Título, zoom 20–400 px/s), a 28 px ruler, then 48 px DOM lanes Legendas, Texto, Vídeo and Áudio (Áudio is only a CSS pattern today).
- Timeline and Inspector use usePlayback, so they re-render on every playback frame.

Keyboard: Space, Ctrl+Z/Y, Ctrl+S/O, Ctrl+D (dictation), Delete/Backspace and arrows. Ctrl+B, Shift+Delete and I/O are free.

## Constraints

- WYSIWYG: preview and export must share one code path. Video already goes through render.ts renderFrame; audio must go through one core mixer. Stroke, fonts, highlight, gains, fades and cuts belong in src/core, never in Preview-only code or ffmpeg-only code.
- The session lives in the renderer, and MCP calls time out after 15 s (main) and 20 s (server); get_proposal is the only long wait (up to 55/57 s; MAX_WAIT_SECONDS 45). Ingest, VAD, transcription and model downloads must therefore run as async jobs in main with progress and cancel. A bridge call must never wait on them.
- History holds full before/after Project snapshots (200 entries), and every draft view is a full structuredClone. Keep PCM, peaks, VAD segments, whole-media transcripts and marks in userData caches keyed by source. Only edit state goes into Project: caption words on caption clips, ducks and fades. Once words exist, replace the fixed 200-entry cap with a memory budget.
- parseProject accepts only version 1 and drops unknown fields (normalizeStyle rebuilds style). So every persisted field needs a version bump, a migration chain, and a clear refusal of newer files ('atualize o Diretor'). Without that, an old build silently strips data when it saves.
- Ops are validated strictly. Each new field must be added in all of these places: OP_KEYS, CHANGE_KEYS, STYLE_KEYS, CLIP_SPEC_KEYS, pt-BR validateOp messages, describeOp, OPS_HELP (src/mcp/server.ts), compactClip (api.ts) and tests.
- expandOp and applyOps are pure functions of Project. A step's ops are prepared once (session.ts: s.ops = applyOps(this.project, s.requested).applied), and views are recomputed from step.ops only. Macros that depend on analysis data (marks, loudness) must take that data as an explicit argument when the step is prepared, and must resolve into explicit primitives.
- Routing: USER_ONLY_OPS (addMedia, updateTrack), renameProject and setCanvas never enter drafts. New editing ops (splitClip, removeRanges, duckRanges) are draftable. Ingest and cache state are never ops.
- Only one proposal can be open at a time (replaces/appendTo rules), and proposals assume an AI owner: Refazer goes through chat.ownerOf. Drafts the editor generates itself (captions, breath cleanup) need an origin and a local redo.
- The timeline's vertical space is fixed (230–300 px for toolbar, ruler and 4 lanes), so there are no new lanes. Waveform, fades, ducks and breath/pause marks share the Áudio lane. Timeline and Inspector re-render on every playback frame, so heavy content has to be drawn on canvas or memoized.
- Windows command lines are capped at 32,767 chars (https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw). Today's per-clip ffmpeg inputs hit that at about 170 clips (local measurement: 28,759 chars at 150 clips, 38,332 at 200).
- Windows: whisper-cli reads ANSI argv, so tools must run with cwd inside userData and relative ASCII paths. Two onnxruntime.dll copies collide in one process (https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order).
- Packaging ships only dist/** and ffmpeg-static, with no native addons (npmRebuild false). New executables need build.win.extraResources, after-pack assertions and a CI fetch step pinned by SHA-256. Models are downloaded at runtime into userData.
- Security: sandbox, contextIsolation and an explicit preload API; the renderer has no fs. The CSP allows script-src 'self' only, so Blob workers stay blocked unless the CSP changes. media:// bypasses CSP and serves any path with a video extension, so a new host (audio cache) must be confined to its root directory.
- Export robustness is tested in e2e: temp .part plus atomic move, and cancel, close or crash leave no file and no running ffmpeg. New temp files (mixed PCM, job dirs) and child processes (whisper, VAD) must use the same cleanup hooks: abortAllExports, did-start-loading, render-process-gone, closed and will-quit.
- Time conventions:
  - Keyframes are clip-relative seconds.
  - round() rounds times to ms; MIN_DURATION is 0.04 s.
  - NTSC fps is stored exact.
  - sourceTime(c,t) = c.in + (t − c.start) is the only source/timeline mapping. The audio plan, marks and transcripts must reuse it.
- Economy mode is on by default with a 6 KB get_context ceiling and a reducedContext fallback. New bulk data (words, ducks, marks, many split pieces) must be summarized in get_context and read through paged tools.
- tests/mcp.test.ts asserts the exact MCP tool list, and tool descriptions are sent on every call. Keep them short and serve long op help from editor_status.
- All user-facing text is pt-BR: labels, OpError messages, describeOp, MCP texts and the AI INSTRUCTIONS in assistant.ts.
- E2E runs Electron under xvfb with --disable-gpu, real ffmpeg, and fake CLIs selected by env vars (DIRETOR_CLAUDE_CLI/DIRETOR_CODEX_CLI with scripts/ia-simulada.mjs). New external tools need the same env override plus a fake script (as DIRETOR_FFMPEG already does). The only audio check today is 'MP4 tem áudio'.
- Disk: a base PCM cache costs about 691 MB per hour of 48 kHz s16 stereo (local measurement). It needs an LRU cap that never evicts media of the open project.

## Fit of the research recommendations

### rec-audio-arch: one shared TS mixer. PCM cache per media; compileAudioPlan + mixInto; Worker→AudioWorklet preview; export through the mixer.

**Fits**

- src/core already compiles into esbuild (main), Vite (renderer) and vitest. src/core/audio/plan.ts and mix.ts can therefore run unchanged in a renderer Worker, in main for export, and in golden-PCM unit tests.
- Local spike (Electron 45.3.4, sandbox + contextIsolation, file://, xvfb) verified:
  - Worker and audioWorklet.addModule load.
  - A transferred MessagePort streams worker→worklet at 48 kHz.
  - The worker can Range-fetch PCM through media://. registerSchemesAsPrivileged already sets supportFetchAPI, corsEnabled and bypassCSP.
- Vite 5 bundles `new Worker(new URL(..., import.meta.url))` and gives worker URLs via `?worker&url` (https://v5.vite.dev/guide/features). With base './' they stay relative under file://.
- Ingest reuses ffmpegPath(), spawn and probe in main.ts, and MediaItem.hasAudio already says which media to ingest. Local measurements: 1 h of AAC → s16 cache + peaks + RMS in 4.25 s; a plain JS mix of 1 h with 600 segments in 1.5 s.
- Making volume a PROPS entry (dB, −60..+12) gives setProperty, setKeyframe, animate, Inspector rows and MCP support for free, as for x/y/scale/opacity.
- Drafts: Preview already renders session.view, and sync() reads volume/muted from the view. Compiling the plan from session.view keeps drafts audible before accept. Recompile only when the view cache key changes.
- App passes session.project to export:start, so main can compile the plan and read base.s16 straight from disk. No PCM crosses IPC.
- Plan rule (a) gives contiguous pieces no fade, so a split is bit-seamless. This fixes the ~11 ms (≈520 samples) corruption measured locally when a split clip is exported as two -ss/-t inputs.

**Blockers**

- Preview.tsx: masterTime() reads the playing <video>.currentTime, and those elements also play the audio. HTMLMediaElement.volume only accepts 0..1, so +12 dB is impossible (https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume). tick() and sync() must move to an AudioContext clock (getOutputTimestamp plus outputLatency, https://web.dev/articles/audio-output-latency). Video elements then stay muted and slaved: seek when drift > 80 ms, nudge playbackRate between 20 and 80 ms.
- video.ts VideoPool is keyed by clip.id. Each split piece gets a new <video> that is only sought once it becomes active. Once the audio clock stops waiting for video, seams show stalls or black frames. The pool needs 2–3 elements per media, reuse across contiguous pieces, and a pre-seek about 0.5 s before a cut. exporter.ts preflight must dedupe by media.
- main.ts export:start spawns ffmpeg immediately with buildFfmpegArgs. An audio phase (ensure caches → mix to a temp file) has to run first. ExportJob, abortExport, removeQuietly and the e2e leftovers check must then cover a job with no process yet and the temp PCM.
- serveMedia ignores the URL host (mediaPathFromUrl) and whitelists video MIME types only. It needs an explicit audio host mapped to userData/audio-cache, with traversal checks and application/octet-stream.
- Nothing ingests audio today. MediaPanel.importPaths and project open must start ingest jobs with progress. Until a medium's cache is ready, preview plays it silent and shows a badge.
- The rec's utilityProcess.fork('audio-export.cjs') is risky:
  - utilityProcess stdin must be 'ignore', and only stdout/stderr can be piped (https://electronjs.org/docs/latest/api/utility-process).
  - Forking a module that lives inside app.asar is undocumented, so it needs a spike or asarUnpack.
  - Node worker_threads gained asar support in electron#33216 (https://ayakael.net/mirrors/electron/commit/06a00b74e817a61f20e2734d50d8eb7bc9b099f6).
- volume/muted 0..1 semantics are spread across many files:
  - model.ts parse; operations.ts CHANGE_KEYS and 'volume vai de 0 a 1.'.
  - api.ts compactClip (volume≠1); export.ts volume filter and c.volume>0.
  - Preview.tsx el.volume; Inspector.tsx NumberField 0..1; Timeline.tsx mute-all.
  - server.ts OPS_HELP; tests/operations.test.ts (rejects 1.5); assistant.ts INSTRUCTIONS.
  Also, model.ts PROP_NAMES/PROP_DEFAULT and the api.ts status handler hard-code ['x','y','scale','opacity'].
- The spike HTML had no CSP. Confirm that Worker and addModule work from file:// under the real index.html CSP (script-src 'self', no worker-src). The rec's Blob-URL fallback would be blocked unless worker-src blob: is added.

**Simplifications**

- Export: mix in main into a temp f32le file and hand it to the single final ffmpeg as `-f f32le -ar 48000 -ac 2 -i <tmp>`, encoded once to AAC. Don't build a separate .m4a and `-c:a copy`. This means one encode and one process, and lets PCM-level goldens be tested in vitest.
- No utilityProcess in block 1. Preview mixes in a renderer Worker. Export mixes in main in 1 s chunks that yield with setImmediate; mixing an hour takes about 2 s. Move to worker_threads only if profiling demands it.
- Keep VideoClip.muted top-level; it is already in CHANGE_KEYS, the UI and tests. Add flat optional fields fadeIn, fadeOut and ducks instead of a nested ClipAudio.
- Defer to after block 1: 'Melhorar voz' tiles, loudness normalization, Project.audio master/target, and get_audio_analysis.
- Store duck/mute ranges in SOURCE seconds rather than clip-relative. Trims, splits and ripple deletes then never remap them, and breath marks (source time) convert 1:1.
- Two peak levels are enough: 128-frame peaks (≈375/s at 48 kHz) against a max zoom of 400 px/s, plus one coarse level. Draw the waveform on one viewport-sized canvas, not one per clip (canvas size limits: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas).
- Micro-crossfades come from adjacency and handles at plan time (rules a–c), so they need no model field and no op. Use a constant 10 ms edge fade, in line with 5–10 ms guidance (https://www.soundonsound.com/techniques/using-fades-crossfades).

**Conflicts**

- vs rec-breath, preview/export path: rec-breath previews with MediaElementAudioSourceNode + GainNode envelopes and exports with ffmpeg volume=eval=frame expressions in filter_complex_script. That is two engines, and both are discarded once the mixer lands. Resolution: breath lowering ships only on top of the mixer. rec-breath itself calls a TS mix to WAV the better long-term parity.
- vs rec-breath, cache: rec-breath keeps a separate 16 kHz f32 analysis cache. Resolution: one 48 kHz s16 stereo base.s16 per media, with 16 kHz mono derived on demand.
- vs rec-stt, audio source: rec-stt extracts per job from the original file (-ss before -i). Resolution: cut speech audio from base.s16 by byte offset, so words, marks and the mixer share one sample clock.
- Range coordinates: rec-audio-arch uses clip-relative AudioRange t0/t1; rec-breath uses source-seconds VideoClip.gain. Resolution: source seconds {s, e, gainDb, fadeMs, tag}.
- Op names overlap (removeRange/removeRanges, setGainRegions/duckRanges, cleanSpeech). Resolution: one set.
  - splitClip.
  - removeRanges: up to 500 ranges in current timeline coordinates, applied right to left.
  - duckRanges: tagged; same-tag overlaps are replaced, so it is idempotent.
  - clearAudioRanges.
  - cleanSpeech: a macro that references an analysis and is resolved when the step is prepared.
- MCP surfaces overlap: get_audio_analysis (audio-arch), analyze_audio/list_audio_marks (breath) and generate_captions (stt). Resolution: one job pattern.
  - A start tool returns a jobId.
  - get_job waits up to 45 s.
  - A paged get_analysis reader returns results.

### rec-breath: Silero VAD + TS DSP classifier. Markers on the timeline, reviewed and applied as one draft that lowers breaths or cuts pauses with ripple.

**Fits**

- Review-then-apply maps onto one proposal step. All ducks or all cuts are shown as the draft view, accepted as one history entry, and undone together by Ctrl+Z.
- Cutting reuses the slice-1 removeRanges ripple across every track, so captions and titles shift. Lowering reuses the slice-4 duck ranges in source seconds.
- The classifier is pure TS (src/core/speech/*.ts), testable on synthetic signals in vitest, and reads the shared base PCM.
- Markers fit in the existing Áudio lane. Marks stored in source seconds follow clips through trims and splits via sourceTime.
- Guards are plain parameters of a pure proposal builder: keep 100–150 ms after a word and 50–100 ms before the next, target gap 120–300 ms. Product precedents: Descript 'Shorten word gaps' (https://help.descript.com/script-editing/shorten-word-gaps); Auphonic lowers breaths without cutting (https://auphonic.com/blog/2023/11/29/eliminate-breathing-sounds-and-mouth-noises/).
- whisper.cpp's VAD segments (rec-stt C4) can be shared, so STT and breath detection use one speech mask.

**Blockers**

- onnxruntime-node is a native addon (~307 MB unpacked across platforms, https://npmjs.com/package/onnxruntime-node). The build has npmRebuild false, no native deps, and asarUnpack only for dist/mcp and ffmpeg-static. A second onnxruntime.dll (the sherpa fallback) can clash in the same process (https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order).
- Preview through a MediaElementAudioSourceNode per element means N graphs under the per-clip VideoPool, all dead code after slice 4. Without the plan's handles, gain nodes cannot remove clicks at cuts.
- Export through per-clip volume=eval=frame expressions grows the filter chains that already approach 32,767 chars and the amix cost (local: 300 clips → 55.5 s for audio alone). It needs filter_complex_script plus asplit/atrim per media, and its gain math differs from preview.
- project.audioMarks inside Project (rec-breath §7) would copy hundreds of records into every history snapshot and into get_context.
- cleanSpeech written as a pure expandOp(p, o) macro cannot see the marks.
- Proposals are AI-only: ProposalCard 'Refazer' calls chat.ownerOf. Local proposals and a local redo are missing.
- Global shortcuts in App.tsx (Space, Delete/Backspace, arrows) would delete clips during review. A review mode has to intercept them.
- Legal note carried from rec-breath: Dolby US10825464 covers breath classification combined with a levelling gain. Block 1 has no auto-levelling, so keep any loudness normalization out of the breath chain until reviewed.

**Simplifications**

- VAD: use whisper-vad-speech-segments.exe with ggml-silero-v6.2.0 (≈0.86 MB) from the same pinned whisper.cpp build as STT (https://github.com/ggml-org/whisper.cpp/releases). Block 1 then needs no onnxruntime. Segments become a binary speech mask, and the classifier scans only non-speech gaps.
- Keep marks and review decisions in the cache (userData/audio-cache/<srcKey>/marks.json) plus a renderer marks store. Only applied results (ducks or cuts) enter Project.
- No new Project fields:
  - Lowering is duckRanges with tag 'breath' (−20 dB, 25 ms ramps).
  - Cutting is removeRanges, computed at proposal time from marks mapped through the current project.
- cleanSpeech carries an analysisId. It is resolved into explicit duckRanges/removeRanges when the step is prepared, with the session passing the marks index into applyOps. The AI never lists hundreds of ranges, and views stay pure.
- Ship lowering first (S6a) and cutting second (S6b). Defer punch-in zooms, 'click' marks and an ML breath model such as Respiro-en.

**Conflicts**

- VAD runtime: onnxruntime-node (breath) vs whisper-vad exe plus sherpa's onnxruntime (stt). Resolution: the whisper-vad exe for both; no onnxruntime in block 1.
- Preview/export through element gain nodes and ffmpeg expressions vs the shared mixer (audio-arch). Resolution: the mixer; don't ship lowering before S4b.
- Cache format (16 kHz f32) and gain-region coordinates vs audio-arch. Resolution: 48 kHz s16 base with 16 kHz derived; ranges in source seconds.
- Marks in Project (breath) vs history and economy limits. Resolution: cache. MCP gets an analyze_audio summary (≤1.5 KB) and paged get_analysis('marks').
- Op naming (setGainRegions, removeRange) vs audio-arch (duckRanges, removeRanges). Resolution: duckRanges and removeRanges.

### rec-stt: whisper-cli job in main, like ffmpeg. First-use model download manager, caption chunker with per-word timings, stroke style, transcript panel.

**Fits**

- Child-process patterns already exist: the ffmpeg export in main.ts, and assistant.ts runAssistant with line parsing and taskkill /T on Windows. They map directly to whisper-cli and VAD runners that parse 'progress = N%' from stderr.
- The env-override plus fake-binary pattern already exists (DIRETOR_FFMPEG; DIRETOR_CLAUDE_CLI/DIRETOR_CODEX_CLI with scripts/ia-simulada.mjs). DIRETOR_WHISPER_CLI and DIRETOR_WHISPER_VAD with scripts/stt-simulada.mjs keep Linux CI and e2e deterministic.
- scripts/after-pack.cjs already asserts bundled binaries.
- scripts/update-check.mjs and e2e already use local HTTP servers, so the downloader (Range resume, checksum, cancel) can be tested offline.
- net.fetch in main uses Chromium's network stack with system proxy/PAC (https://electronjs.org/docs/latest/api/net), so model downloads work behind proxies.
- Captions are already clips on trk_captions with style presets. Chunker output is plain addClip specs, and the proposal flow supplies preview, accept and undo.
- strokeText then fillText (https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/strokeText) fits into render.ts drawText, which preview and export share.
- Default choices:
  - Model: large-v3-turbo q5_0, 574 MB (https://huggingface.co/ggerganov/whisper.cpp/tree/main).
  - Clássico preset, per the Netflix pt-BR guide: 42 chars per line, 2 lines, at most 17 cps (https://partnerhelp.netflixstudios.com/hc/en-us/articles/215600497-Portuguese-Brazil-Timed-Text-Style-Guide).

**Blockers**

- No vendored binaries or extraResources yet. Needed:
  - scripts/fetch-stt.mjs downloading b5454 whisper-bin-x64.zip (v1.9.5) with a pinned SHA-256 and keeping whisper-cli.exe, whisper-vad-speech-segments.exe, whisper.dll and ggml*.dll.
  - App-local msvcp140/vcruntime140/vcruntime140_1: they are imported but not in the zip.
  - build.win.extraResources → resources/stt.
  - after-pack assertions on win32.
  - A CI step before test:e2e and dist, and .gitignore vendor/.
- No generic job manager in main: start/progress/cancel/result, dedupe by key, and abort on did-start-loading, render-process-gone, closed and will-quit (as abortAllExports does).
- No download manager:
  - Range resume of a .part file and streaming SHA-256.
  - Atomic rename and an fs.statfs free-space check.
  - A mirror URL.
  - User consent for ~575 MB.
- Local proposals are missing (same gap as breath). Generated captions must also queue, or replace after confirmation, when an AI proposal is open.
- The caption model has no words, stroke or position:
  - TextStyle, STYLE_KEYS and normalizeStyle drop unknown keys.
  - layoutText pins captions at cx = W/2, cy = 0.9H − h/2.
  - Caption props are only opacity.
  A schema bump is required.
- get_context: caption clips carrying words would exceed the 6 KB economy ceiling. compactClip must omit words, and words must come through a paged reader.
- MCP timeouts (15/20 s) mean generate_captions cannot block and must return a jobId. get_job needs the long-wait exception in bridgeTimeoutMs (main.ts) and callTimeoutMs (server.ts).
- whisper-cli rules:
  - It reads ANSI argv, so it runs with cwd under userData/stt and relative ASCII arguments only.
  - -nfa is mandatory: flash attention is on by default and silently disables DTW (https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md).
  - Never pass --vad (token times stay in the VAD timeline) or -p > 1.
- Fonts: system fonts differ between machines. Matching preview and export for styled captions needs bundled @font-face fonts awaited with document.fonts.load before export (https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load).

**Simplifications**

- Ship one engine: whisper.cpp 'Preciso' with large-v3-turbo q5_0. Defer the sherpa-onnx Parakeet fallback. That avoids an onnxruntime.dll clash, the Electron external-buffer caveat (https://csukuangfj.github.io/sherpa/onnx/faqs/index.html) and a second ~640 MB model. RTF calibration and engine choice come later.
- Transcribe per media in source time and cache the result (userData/stt/cache/<srcKey>/...). Map to the timeline only when building the proposal. Edits made during a long job then never invalidate it, splits and ripples reuse it, and breath detection and the transcript panel share it.
- Take audio from base.s16 and VAD segments from the shared speech mask, then build speech.wav and the mapping table as in rec-stt C5.
- Words live only on caption clips (clip-relative {t, s, e, c?}). src/core/captions.ts is a pure DP chunker with the rec's Shorts/Clássico presets and frame snapping.
- generate_captions lets the editor build the proposal itself, so the transcript never round-trips through the AI. get_analysis('transcript') is only for word-level corrections.

**Conflicts**

- VAD is shared with breath detection: one exe, with segments cached once per media.
- Audio source: per-job extraction vs the audio-arch base cache. Resolution: the base cache.
- Fallback runtime: sherpa's onnxruntime vs breath's onnxruntime-node. Resolution: neither in block 1.
- MCP: rec-stt I has generate_captions return a proposal, but timeouts require jobs, and analyze_audio needs them too. Resolution: jobId + get_job.
- rec-stt C1 picks clips with !muted && volume > 0. After S4b volume is in dB, so the test becomes 'not muted, volume > −60 dB, track not muted'.

## Features: where each one touches the code

### F1 Split/razor + ripple delete across all tracks (captions and titles stay in sync) (size L)

**Touch points**

- `src/core/operations.ts`: Op union additions:
  - Primitives: splitClip {clipId, at, newId?}, shiftClips {clipIds, delta}, cutTextTime {clipId, t0, t1}.
  - Macro: removeRanges {ranges}.
  
  Validation: add OP_KEYS; at must lie MIN_DURATION inside the clip; ranges are sorted, merged, at most 500, and inside the project. A locked track that would change gives 'locked'.
  
  expandOp:
  - Fills newId.
  - Expands removeRanges right to left per unlocked track: a clip inside the range → removeClip; a straddling video → two splitClip + removeClip; a straddling title/caption → cutTextTime or trimClip; later clips → shiftClips by −(e−s). Hidden tracks still ripple.
  
  Also:
  - Export remapKeyframes and clampKeyframes, and add partitionKeyframes(c, at) with boundary values and groups 'entrada'/'saida'.
  - touchedClipIds must read newId and clipIds[].
  - describeOp: 'Dividir clipe', 'Apagar trecho (−0:04)'.
  - Route text-clip remapping through one helper so S5a can add words.
  - Decide whether trimClip ripple should reuse the cross-track shift: today it only shifts later video clips, so captions drift after a head trim.
- `src/core/session.ts`: draftInfo is recomputed on every access while Timeline renders per frame, so memoize it by the view cache key. Also:
  - Add split right pieces to createdClipIds, so selecting them does not stale the draft.
  - Expose cuts [{at, removed}] and aggregate ranges into seams instead of one range per shifted clip.
  - Make simulateSteps/targets include shifted pieces.
- `src/core/api.ts`: compactProposal: add removed time and cut count. compactClip (economy): collapse contiguous same-media pieces, or emit [id, start, dur, in] tuples, when the timeline has many pieces.
- `src/mcp/server.ts`: Short OPS_HELP entries for splitClip and removeRanges (current timeline seconds).
- `src/renderer/Timeline.tsx`: Range selection on the ruler (Shift+drag; I/O set in/out). Toolbar buttons Dividir (Ctrl+B) and Apagar trecho (Shift+Delete). Ripple drafts show seams with '−0:04' chips instead of hatched originals overlapping shifted clips. React.memo ClipBlock and a separate Playhead subscriber, so playback does not re-render hundreds of pieces.
- `src/renderer/App.tsx`: Add Ctrl+B (Ctrl+D is dictation), Shift+Delete checked before the plain Delete/Backspace branch, and I/O. Keep the input-focus guard.
- `src/renderer/video.ts`: VideoPool keyed by media path, with 2–3 elements per media:
  - Assign clip→element at the playhead.
  - Keep the same element across contiguous pieces (next.in == prev.in + prev.duration).
  - prepare(nextClip) pre-seeks about 0.5 s before a seam.
  - frame() keeps the last good frame during a hand-off.
  - preflight dedupes by media.
- `src/renderer/Preview.tsx`: sync() uses pool assignments and pre-seeks upcoming pieces, with no hard seek for contiguous pieces. masterTime stays until S4a. While a ripple draft is open, an Antes/Depois toggle renders session.project vs session.view.
- `src/renderer/exporter.ts`: Preflight per media. Frame loop unchanged (sourceTime is continuous across a split).
- `src/core/export.ts`: Interim until S4a:
  - Merge contiguous same-media pieces with equal volume/muted into one input.
  - Open each media once with asplit/atrim/adelay in a -filter_complex_script temp file, or fail early with a pt-BR message when over the argv budget.
- `src/main/main.ts`: If a filter script is used, write it next to the .part file and delete it in abortExport, finish and the leftovers paths.

**Model and ops**

- No schema change; files stay version 1.
- {op:'splitClip', clipId, at, newId?}: primitive. at is timeline seconds, snapped to the frame grid by the UI. The right piece copies the clip: video gets in += at − start; titles/captions keep text and style; keyframes are partitioned with boundary values.
- {op:'removeRanges', ranges:[[s,e],...]}: macro. At most 500 ranges in current timeline coordinates, merged, applied right to left on every unlocked track; error 'locked' otherwise.
- {op:'cutTextTime', clipId, t0, t1}: primitive. Removes interior time from a title/caption and remaps keyframes (and words, from S5a).
- {op:'shiftClips', clipIds, delta}: primitive. start += delta; validates start ≥ 0 and no video overlap.
- Exported helpers: partitionKeyframes, clampKeyframes, remapKeyframes.
- Optional at the first schema bump (S2): Clip.origin? (id of the take a piece was split from), for 'apply to all pieces' in blocks 2–3.

**Preview/export parity risks**

- Preview: under the per-clip pool every new piece is a fresh <video>. Playback can stall or show black at seams (frame() is null while readyState < 2). The per-media pool with pre-seek fixes this.
- Export audio before the mixer: every piece adds an -ss/-t/-i input. That causes about 11 ms of corruption after each split (local measurement), slows amix (300 clips ≈ 55 s locally) and hits the 32,767-char limit near 170 clips. Mitigate by merging contiguous pieces and using per-media inputs; S4a removes the problem.
- Preview audio at a cut before the mixer: the element hand-off gives an audible gap or click. Acceptable for now; S4a crossfades fix it.
- Keyframe partition must evaluate the animation at the cut (boundary keyframes), so the seam frame is identical before and after a split. Video frames are unaffected because sourceTime stays continuous.
- round() keeps cut times in ms. The UI snaps cuts to frame boundaries so isActiveAt picks the same piece at the seam frame in both preview and export.

**Drafts, undo and MCP**

Undo: a manual split or range delete is one dispatch and one history entry. If a draft already touches the clip, it becomes a manual adjustment that Ctrl+Z undoes inside the draft.

AI path: the AI sends removeRanges through propose_edit. The prepared step ops carry explicit newIds, so recomputing the view is deterministic. touchedClipIds and targets must include shifted and created pieces, or selection staleness misfires.

Stale logic needs no change and is correct, because any revision change invalidates timeline coordinates.

Draft display: seams plus removed-time chips. Drawing removedClipIds at their original positions would overlap the shifted clips.

MCP: tool list unchanged; OPS_HELP grows. get_context can pass 6 KB with hundreds of pieces, so economy compaction of pieces is needed.

**Tests**

Unit, operations.test.ts:
- splitClip on video, title and caption: in/duration, keyframe partition with boundary values, groups, newId idempotency, invalid at near edges.
- removeRanges: multi-track ripple (captions and titles shift, straddling text is cut, contained clips removed), unsorted or overlapping input merged, 500 cap, locked track error, hidden track shifts.
- touchedClipIds with clipIds[].

Unit, session.test.ts: a split inside a draft goes to manualOps; the new piece is in createdClipIds; accept is one history entry; undo restores; draftInfo is memoized.

Unit, export.test.ts: merged args, and a real ffmpeg export of a split clip whose audio around the seam equals the unsplit export.

E2E (scripts/e2e.mjs):
- Ctrl+B split.
- Shift+drag range + Shift+Delete moves captions and titles left.
- Playback across a seam has no black frames.
- Preview = export (PSNR > 30) at a seam frame.
- Export duration matches the new timeline; undo restores.

Existing trimClip ripple tests change if trim ripple becomes cross-track.

### F2 Audio engine: PCM cache, shared TS mixer, Worker→AudioWorklet preview, export through the mixer, volume in dB with keyframes (−60..+12), fades, duck/mute ranges, automatic micro-crossfades at cuts, waveform lane (size XL)

**Touch points**

- `src/main/audioCache.ts (new)`: ingest(media) writes userData/audio-cache/<srcKey>/:
  - base.s16: `ffmpeg -nostdin -i src -map 0:a:0 -vn -af aresample=48000:async=1:first_pts=0 -ac 2 -f s16le pipe:1`.
  - Two peak levels and meta.json {frames, startOffset}.
  
  srcKey hashes path, size, mtime, ffmpeg version and ingest version. Writes go to .part, then rename. Queue with progress and cancel. LRU cap that never evicts media of the open project.
- `src/main/main.ts`: - IPC audio:ensure, audio:status and the 'audio:progress' event.
  - serveMedia gains an 'audio' host confined to the cache root (traversal check, application/octet-stream, existing Range code).
  - export:start: ensure caches → compileAudioPlan(project) + mixInto in 1 s chunks → temp .f32 beside the .part → spawn ffmpeg.
  - ExportJob gains audioTmp and a phase with no process yet; abortExport, abortAllExports and will-quit clean both.
- `src/core/audio/plan.ts (new)`: compileAudioPlan(project, mediaInfo) returns segments {srcKey, tl0, src0, len in 48 kHz frames, gain curve, edge flags}. Rules:
  - Contiguous pieces get no fade.
  - Other cuts get a 10 ms equal-power crossfade using handles.
  - An edge next to silence gets a 3 ms micro-fade.
  - Gain = dB keyframes sampled every 64 frames × raised-cosine fades × duck ramps × mute (clip, Track.muted, hidden video track).
- `src/core/audio/mix.ts (new)`: mixInto(plan, frame0, n, read) is stateless, accumulates in float64 and soft-clips above −1 dBFS.
- `src/core/audio/peaks.ts (new)`: Peak computation shared by ingest (main) and lane drawing (renderer).
- `src/core/model.ts`: Schema bump: migrate VideoClip.volume v → props.volume = v > 0 ? 20·log10(v) : −60 (0.5 → −6.02 dB); keep muted. Add VideoClip fadeIn?, fadeOut? and ducks?, and Track.muted?. PROP_NAMES and PROP_DEFAULT include volume. parseProject and normalize handle the new fields.
- `src/core/properties.ts`: PROPS gets volume: {label 'Volume', unit 'dB', min −60, max 12, default 0, step 0.5, kinds ['video']}, interpolated in dB.
- `src/core/operations.ts`: - CHANGE_KEYS: remove volume, with an explanatory error ('volume agora é em dB: use setProperty volume'); add fadeIn and fadeOut.
  - New ops duckRanges and clearAudioRanges. Validation: gainDb −60..0, fadeMs ≤ (e−s)/2, at most 500 ranges.
  - splitClip gives fadeOut to the right piece and zeroes the inner fades.
  - describeOp labels.
- `src/core/export.ts`: buildFfmpegArgs(p, outPath, audioPath?) takes a single `-f f32le -ar 48000 -ac 2 -i <tmp>` input and drops the per-clip inputs, amix and adelay. Keeps -t total and the BT.709 tags. Removes the S1 interim code.
- `src/core/api.ts`: compactClip: volume in dB through props (omitted at 0 dB), fadeIn/fadeOut, ducks as counts per tag. status reads the prop list from PROPS instead of hard-coding it.
- `src/renderer/audio/engine.ts, mixer.worker.ts, player.worklet.ts (new)`: AudioContext at 48 kHz with latencyHint 'interactive'. The worklet holds a ring buffer and reports startContextFrame, played frames and underruns. The worker holds the plan and Range-fetches media://audio/<srcKey>/base.s16. It mixes 200–300 ms ahead and posts chunks over a transferred MessagePort. A plan update flushes everything beyond now + 50 ms. The monitor gain is the transport slider. A debug tap feeds e2e.
- `src/renderer/Preview.tsx`: Replace masterTime() with the engine clock (getOutputTimestamp + outputLatency). Video elements are muted and slaved: seek when drift > 80 ms, playbackRate 0.97–1.03 between 20 and 80 ms. play, pause and seek go through the engine. While caches are missing, fall back to a silent wall clock and show a badge.
- `src/renderer/video.ts`: The pool never plays audio (withAudio false).
- `src/renderer/Timeline.tsx`: The Áudio lane (48 → 64 px) becomes one canvas with the waveform, redrawn only on scroll, zoom or view change. It also gets fade handles at clip corners (committed on pointerup), duck blocks and an optional volume line. The head's mute button issues updateTrack muted, which is user-only.
- `src/renderer/Inspector.tsx`: Volume row in dB through the registry, with a keyframe button. Fade de entrada and Fade de saída fields, Mudo, and a list of ducked ranges with a clear action.
- `src/renderer/MediaPanel.tsx, App.tsx, exporter.ts, src/preload/preload.ts`: Start ingest on import and on open. Badge 'Preparando o áudio… N%'. Export modal phases (áudio, quadros) with cancel during the audio phase. Preload exposes audioEnsure, audioStatus and onAudioProgress.
- `src/mcp/server.ts, src/main/assistant.ts`: OPS_HELP and INSTRUCTIONS: volume in dB (−60..+12) through setProperty, setKeyframe and animate; fades; duckRanges.
- `src/renderer/index.html`: Verify Worker and worklet loading under the CSP; add worker-src only if needed.

**Model and ops**

- Schema bump (v2→v3 if S2 shipped v2) with the v1-semantics volume migration to props.volume in dB; muted kept.
- PROPS volume: dB, −60..+12, default 0, keyframable.
- VideoClip.fadeIn?: number, fadeOut?: number, in seconds, with fadeIn + fadeOut ≤ duration.
- VideoClip.ducks?: {s, e, gainDb (−60 = mute .. 0), fadeMs?, tag?: 'breath'|'pause'|'manual'}[], in SOURCE seconds.
- Track.muted?: boolean, set via updateTrack (user-only).
- {op:'duckRanges', clipId? | all:true, ranges:[{s,e,gainDb?,fadeMs?}], tag?}: at most 500 ranges; same-tag overlaps are replaced, so it is idempotent.
- {op:'clearAudioRanges', clipId?, tag?}
- setProperty, setKeyframe and animate on 'volume'; updateClip set {fadeIn, fadeOut, muted}.
- Crossfades have no op; the plan derives them.
- Outside Project: userData/audio-cache/<srcKey>/{base.s16, peaks, meta.json}.

**Preview/export parity risks**

- Preview and export run the same plan and mixer by construction. Risks left in preview only: worklet underruns (never exported), an output device not at 48 kHz (browser resampling), and lip-sync drift if outputLatency is not compensated (https://web.dev/articles/audio-output-latency).
- A/V offset for media with start_time ≠ 0 or edit lists: video timing comes from Chromium's decoder and audio from ffmpeg ingest. Validate preview and export with a flash+beep fixture.
- Video slaved to the audio clock can lag 20–80 ms in preview; export stays frame-exact.
- The transport slider must stay monitor-only. A hidden video track mutes audio in both paths (it already does today).
- +12 dB gains can clip; the same soft clip runs in both paths.
- Stale cache if a file is replaced in place with the same size and mtime. srcKey includes size, mtime, ffmpeg version and ingest version.

**Drafts, undo and MCP**

Drafts: the plan is compiled from session.view, so drafted volume keyframes, ducks and cuts are audible before accept. Recompile only when the view cache key changes.

Undo: audio edits are ordinary ops, so routing, manual adjustment inside a draft and single history entries all work unchanged. Fade and volume drags commit on pointerup.

Ingest and cache state are never ops and never bump the revision.

MCP: volume is now a prop in dB, set with setProperty 'volume'. A legacy set.volume gets an explanatory error. get_context grows only by non-default audio fields, and editor_status lists props from the registry.

**Tests**

Unit:
- plan: split mix == unsplit mix, bit for bit; a ripple join equals concatenation plus crossfade, with and without handles; fades; ducks in source seconds survive split, trim and ripple; mute, hidden and track mute; dB interpolation.
- mix: golden PCM and soft clip.
- Migration v1/v2→v3: 0.5 → −6.02 dB, 0 → −60, 1 → omitted.
- operations: volume only via setProperty; legacy set.volume rejected; fade bounds; duckRanges validation and idempotency.
- export args contain a single audio input.
- main: ingest a short file with ffmpeg-static; srcKey invalidation; the serveMedia audio host rejects traversal.

E2E:
- Import shows 'Preparando o áudio…', then the waveform.
- Play advances on the audio clock with 0 underruns (window.__diretor hook).
- The worklet debug tap equals export PCM for a range.
- Exported audio RMS per window matches the mixer within tolerance at fades and ducks.
- Cancel during the audio phase leaves no temp file and no ffmpeg.
- Inspector volume keyframe and fade-handle drag.
- Replace 'MP4 tem áudio' with this real parity check.

Windows CI: a 600-clip export. Also check that AudioContext runs on runners without an audio endpoint; otherwise drive the engine clock from a test hook.

### F3 Breath/pause detection (rec-breath) as timeline markers, reviewed and applied as one draft: lower breaths or cut pauses with ripple (size L)

**Touch points**

- `src/main/jobs.ts (new, shared with STT)`: JobManager: start, progress, cancel, result, and dedupe by key. Jobs abort on did-start-loading, render-process-gone, closed and will-quit.
- `src/main/speech/vad.ts (new)`: Runs whisper-vad-speech-segments.exe (pinned build, ggml-silero-v6.2.0) on 16 kHz mono derived from base.s16, with cwd and relative ASCII arguments. Parses lines 'Speech segment i: start = X, end = Y' and caches vad.json per srcKey. DIRETOR_WHISPER_VAD selects a fake.
- `src/core/speech/breath.ts (new)`: DSP classifier over non-speech gaps. Features: RMS relative to local speech level and noise floor, spectral centroid and flatness, ZCR, and duration (typically 0.2–0.6 s). Outputs marks {s, e, kind 'breath'|'pause', score} in source seconds. Parameters: Força (sensitivity) and Ritmo (target gap).
- `src/core/speech/marks.ts (new)`: mapMarks(project, marks) uses the inverse of sourceTime.
  
  buildLowerOps: duckRanges with tag 'breath', −20 dB, 25 ms, never below the noise floor.
  
  buildCutOps: removeRanges with guards:
  - keep ≥ 100–150 ms after a word and 50–100 ms before the next;
  - target gap 120–300 ms;
  - no cut inside transcript words when a transcript exists;
  - skip locked tracks.
  
  More than 500 ranges are chunked into several ops of one step.
- `src/core/operations.ts`: cleanSpeech {analysisId, breaths:'lower'|'cut'|'off', pauses?:{minMs,targetMs}, minConfidence?} macro, expanded via an explicit context argument: applyOps(project, ops, {marks}). Without context it returns OpError 'analysis_pending'.
- `src/core/session.ts`: proposeLocal(title, steps, {origin:'local', regenerate}) keeps the one-open-proposal rule and offers 'replace'. Local Refazer calls regenerate on the current project. The marks resolver is passed in when steps are prepared or simulated.
- `src/main/main.ts, src/preload/preload.ts`: IPC speech:analyze and jobs:cancel, jobs:progress events, and marks read/write for review decisions.
- `src/renderer/marks.ts (new)`: Marks store per srcKey with review state (pending/apply/keep), persisted to the cache.
- `src/renderer/Timeline.tsx`: Marks drawn on the Áudio lane canvas: a pill for a breath, a bracket with its duration for a pause. Clicking toggles apply/keep. A review bar shows 'N de M', anterior/próxima, Ouvir, Aplicar/Manter and Sair.
- `src/renderer/CleanSpeechPanel.tsx (new, opened from the timeline toolbar)`: 'Limpar fala': Detectar with progress, a summary (e.g. 37 respirações, 14 pausas, −0:31), mode Abaixar/Cortar/Manter, Força, Ritmo, Revisar, and Aplicar como rascunho.
- `src/renderer/App.tsx`: In review mode: Space plays the mark with pre-roll; Delete/Backspace toggles the mark and never deletes clips; arrows go to the next/previous mark; Esc exits.
- `src/renderer/ChatPanel.tsx`: ProposalCard shows local origin ('Diretor'), and its Refazer calls the local regenerate.
- `src/core/api.ts, src/mcp/server.ts, src/renderer/bridgeClient.ts`: analyze_audio starts or joins a job and returns a summary of at most 1.5 KB. get_analysis kind 'marks' is paged and returns timeline seconds plus the current revision. Add get_job, the LABEL entries and the long-wait timeouts.

**Model and ops**

- No new Project fields: it uses F2 ducks and F1 removeRanges.
- Cache only: vad.json (speech segments) and marks.json (marks, review decisions, params) under userData/audio-cache/<srcKey>/.
- Ops used: duckRanges tag 'breath' (lower), removeRanges (cut), clearAudioRanges {tag:'breath'} (replace or redo).
- Optional macro: cleanSpeech {analysisId, breaths, pauses, minConfidence}, resolved into explicit ops when the step is prepared.

**Preview/export parity risks**

- Lowering exists only in the mixer, so preview equals export. Do not ship it before F2: ramping element volume would not match the export.
- Cuts inherit the F1 and F2 behaviour (plan crossfades at joins).
- Marks are computed on base.s16, the mixer's own sample clock, and mapped with the same sourceTime convention. What the user reviews is exactly what gets processed.
- pt-BR devoiced word endings can look like breaths. Guard pads protect words, and review stays mandatory before cut mode.

**Drafts, undo and MCP**

Detection and review never touch history or the revision.

'Aplicar como rascunho' creates one local proposal with one step. It previews through the mixer (lower) or the ripple view (cut). Accept is one history entry, and Ctrl+Z reverts it all. Edits during review stale the proposal as they do today; a local Refazer recomputes instantly from cached marks.

AI path: analyze_audio → summary → propose_edit with cleanSpeech (or explicit ranges from get_analysis) → the same draft UI. get_context carries only counts.

**Tests**

Unit:
- Classifier on synthetic signals: tone 'speech', band-limited noise bursts of 200–600 ms, silence.
- Mapping through split, trim and ripple.
- Lower and cut builders: pads, min pause, target gap, locked-track skip, >500 chunking.
- cleanSpeech resolution with and without context.
- Session local proposal: accept, discard, stale, local redo.
- VAD parser and cancel with a fake exe.

MCP: tool list, paging, job idempotency.

E2E on a generated fixture (lavfi sine + anoisesrc bursts + silences):
- Detectar finds the expected marks.
- Abaixar draft → accept → exported RMS in mark windows ≈ −20 dB.
- Cortar → the timeline is shorter by the expected seconds, captions shift and export duration matches.
- Review keys never delete clips.

### F4a Caption style: font, color, outline (stroke then fill), position (size M)

**Touch points**

- `src/core/model.ts`: TextStyle gets strokeColor?, strokeWidth? (fraction of fontSize, 0..0.3) and posY? (captions, 0..1, default 0.9 = current layout). normalizeStyle keeps them. First schema bump: add the migration chain and a 'versão mais nova' error.
- `src/core/operations.ts`: STYLE_KEYS and validation (colors, ranges). Caption presets:
  - 'Shorts': bold, white fill, black stroke about 0.12, posY about 0.7.
  - 'Clássico': Netflix-like, with background.
- `src/core/render.ts`: drawText:
  1. Draw the shadow only on the first pass, then reset it.
  2. Stroke pass: lineJoin 'round', miterLimit 2, lineWidth = 2·strokeWidth·fontSize, strokeText.
  3. fillText.
  
  layoutText adds the stroke to width/height and uses posY. hitTest includes the stroke. fontFor quotes family names that contain spaces.
- `src/renderer/fonts/*, src/renderer/styles.css`: Bundled OFL woff2 fonts via @font-face. CSP font-src falls back to 'self'. Export the list for the Inspector.
- `src/renderer/exporter.ts, src/renderer/Preview.tsx`: Await document.fonts.load(fontFor(style)) for every font in use before export. Redraw the preview on fonts loadingdone.
- `src/renderer/Inspector.tsx`: StyleSection: Fonte (bundled list), Cor, Contorno (color and thickness), Fundo, Sombra, Posição.
- `src/core/api.ts, src/mcp/server.ts`: compactClip emits only non-default style keys; OPS_HELP lists the style keys.

**Model and ops**

- Schema v1→v2: additive, and the defaults reproduce v1 rendering.
- TextStyle.strokeColor?: string, strokeWidth?: number, posY?: number
- No new ops (updateClip style).

**Preview/export parity risks**

- Fonts that are not yet loaded, or that differ by system, render differently in the first export frames than in preview. Bundle them and await FontFaceSet.load (https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load). A main-thread OffscreenCanvas shares document fonts; an export in a Worker would need self.fonts.
- Draw the stroke before the fill and use round joins, to avoid eating into glyphs and miter spikes (https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/strokeText).
- A shadow on both passes doubles the darkness, so apply it on the first pass only.
- Small anti-aliasing differences between the GPU HTMLCanvas and the CPU OffscreenCanvas stay within the e2e PSNR > 30 check.

**Drafts, undo and MCP**

Plain updateClip style changes, so routing, drafts and undo are unchanged. The AI restyles through propose_edit. compactClip grows only for non-default keys.

**Tests**

Unit: v1→v2 migration leaves styles unchanged; STYLE_KEYS validation; layout size with stroke; hitTest box; posY. E2E: a stroked caption in a bundled font gives preview = export PSNR on a caption frame; document.fonts.check is true before export; Inspector controls work.

### F4b Automatic captions: whisper-cli job in main, first-use model download (progress, cancel, checksum), chunking into caption clips with per-word timings (size XL)

**Touch points**

- `scripts/fetch-stt.mjs (new), package.json build.win.extraResources, .gitignore, .github/workflows/ci.yml, scripts/after-pack.cjs`: Vendor the whisper.cpp b5454 (v1.9.5) Windows x64 binaries, the VC++ runtime DLLs and ggml-silero-v6.2.0.bin, all pinned by SHA-256, into resources/stt. Assert them in after-pack (win32). CI fetches them before test:e2e and dist.
- `src/main/models.ts (new)`: ModelManager: list, install and remove models. net.fetch with Range resume into .part, streaming SHA-256, atomic rename, fs.statfs space check, mirror fallback, cancel and progress events. Requires explicit consent for 574 MB.
- `src/main/stt.ts (new)`: Pipeline:
  1. Ensure the base cache, then derive 16 kHz mono.
  2. Get VAD segments (shared with F3) and build speech.wav plus a mapping table.
  3. Run whisper-cli -m <relative model> -f speech.wav -l pt -nfa -dtw large.v3.turbo -sns -ojf -of out -np -pp. Use cwd = job dir with relative ASCII args, windowsHide, and taskkill /T on cancel. Process in batches of ≤5 min of speech.
  4. Turn tokens into words: t_dtw, attach punctuation, at least 60 ms per word, confidence.
  5. Map times back, de-loop and drop hallucinations, refine word edges.
  6. Cache the transcript per srcKey in source seconds.
  
  DIRETOR_WHISPER_CLI selects a fake.
- `src/main/jobs.ts (shared), src/main/main.ts, src/preload/preload.ts`: IPC stt:models, stt:download, stt:cancelDownload, stt:transcribe and jobs:cancel, with progress events. Abort hooks sit next to abortAllExports.
- `src/core/captions.ts (new)`: chunkWords(words, preset) is a DP chunker:
  - Shorts: 1–3 words, ≤16–18 chars.
  - Clássico: 42 chars × 2 lines, ≤17 cps, 0.833–7 s on screen, gap of 2 frames.
  It applies pt-BR break penalties and frame snapping. mapTranscript(project, transcript, range) uses the inverse of sourceTime and drops words in removed or muted parts.
- `src/core/model.ts`: CaptionClip.words?: {t, s, e, c?}[] (clip-relative) and TextStyle.highlightColor?. Schema bump. Validation: words sorted and within the clip.
- `src/core/operations.ts`: Add words to CLIP_SPEC_KEYS and CHANGE_KEYS. trimClip, splitClip and cutTextTime remap words; shiftClips needs nothing because words are clip-relative. A text edit either re-aligns or drops words. Optional replaceCaptions {range, clips} macro → removeClip + addClip in one step.
- `src/core/session.ts`: Local proposals with queue or replace when another proposal is open (shared with F3).
- `src/renderer/CaptionsDialog.tsx (new), Timeline.tsx toolbar, App.tsx`: 'Gerar legendas' modal: trecho, preset, fonte, cor, contorno, idioma pt-BR. First-use download card with progress, cancel, retry and checksum. Progress strip in the Legendas lane with Cancelar.
- `src/renderer/ChatPanel.tsx`: Local ProposalCard, e.g. 'Legendas automáticas: 128 legendas'.
- `src/core/api.ts, src/mcp/server.ts, src/renderer/bridgeClient.ts`: generate_captions returns a job, or 'model_missing', which only the user can resolve. Add get_job. compactClip omits words (count and a capped list of low-confidence words). Long-wait timeouts for get_job.

**Model and ops**

- Schema bump: CaptionClip.words?: {t:string, s:number, e:number, c?:number}[] (clip-relative) and TextStyle.highlightColor?: string.
- addClip caption specs accept words; updateClip set.words.
- splitClip, cutTextTime and trimClip remap words.
- Optional macro: {op:'replaceCaptions', range:[s,e], clips:[spec...]}.
- Outside Project:
  - userData/stt/models/*.bin, plus .part files and a manifest.
  - userData/stt/cache/<srcKey>/transcript-<model>-<lang>-<paramsVersion>.json: source seconds plus the VAD mapping.
  - userData/stt/jobs/<id>/, deleted when the job ends.

**Preview/export parity risks**

- Rendering depends only on text and style (plus highlight, if added), all through the shared renderFrame. The F4a font gate applies.
- Word times share the base.s16 clock with the mixer. Caption boundaries are snapped to frames, so preview and export never disagree by one frame.
- Whisper word starts run about 150 ms early in benchmarks (https://arxiv.org/pdf/2609.32396), and it hallucinates on non-speech (https://arxiv.org/html/2501.11378v1). These affect quality, not parity; VAD gating and cleanup mitigate them.

**Drafts, undo and MCP**

Transcription is a job outside history.

Its result becomes one local proposal: remove the old captions in the range, then N addClip with words. The proposal is mapped against the current revision when it is created. Accept is one history entry, and Ctrl+Z removes every generated caption.

Edits made during the job don't matter, because the cache is in source time. Once the draft is shown, edits stale it as usual, and a local Refazer re-maps it instantly. If an AI proposal is open, the captions draft waits in a queue or replaces it after confirmation.

MCP: generate_captions → job → the editor builds the proposal, and the AI follows with get_proposal. get_context excludes words.

Words increase history memory; watch the 200-snapshot cap.

**Tests**

Unit:
- Chunker: line breaks, cps, min/max duration, gaps, pt-BR penalties, frame snap.
- Transcript mapping through split, ripple and mute; word remap on trim, split and cutTextTime.
- -ojf parser on a checked-in fixture; VAD mapping.
- Model manager against a local HTTP server: resume, checksum mismatch, cancel, low disk.
- Job manager cancel and abort on window close.
- Relative-path builder for a non-ASCII userData.

MCP: tool list, model_missing, get_job wait.

E2E with the DIRETOR_WHISPER_CLI fake and a local model server: download card → progress → draft with N captions → accept → preview = export PSNR on a stroked caption. Cancelling mid-job leaves no process.

Windows CI: whisper-cli starts from the installed app, which proves the DLLs are present.

### F4c Transcript panel: word chips, low-confidence highlight, click-to-seek, inline correction (size M)

**Touch points**

- `src/renderer/TranscriptPanel.tsx (new), src/renderer/MediaPanel.tsx LeftPanel`: Third left tab 'Transcrição' showing the timeline's captions as word chips:
  - The current word is highlighted by a small component subscribed to playback.
  - Words with c < 0.5 are underlined.
  - Click seeks with 0.3 s pre-roll and selects the caption.
  - Double-click or Enter edits; Tab jumps to the next doubtful word.
  - Enter/Backspace split or merge captions.
  - 'Substituir em tudo' replaces everywhere.
- `src/core/captions.ts`: editWords splits time by character count; helpers for splitting and merging captions return ops.
- `src/core/operations.ts`: Optional macros splitCaption {clipId, atWord} and mergeCaptions {clipIds}. Otherwise use plain updateClip, addClip and removeClip.
- `src/core/render.ts`: Optional active-word highlight with highlightColor, measured per word in one pure function of t.
- `src/core/api.ts, src/mcp/server.ts`: get_analysis kind 'transcript': paged words and segments in timeline seconds for the current revision.
- `src/renderer/Inspector.tsx`: Chips for the selected caption.

**Model and ops**

- No schema change beyond F4b.
- Edits are updateClip {text, words}; addClip/removeClip for split and merge; optional splitCaption/mergeCaptions macros.
- 'Dicionário do projeto' is left for later; it would need Project.dictionary.

**Preview/export parity risks**

- Only if the active-word highlight ships: per-word measurement must be identical in preview and export.
- A text edit that drops words silently loses highlight timing, so keep words aligned whenever possible.

**Drafts, undo and MCP**

Each chip edit is one dispatch and one history entry, or a manual adjustment inside an open captions draft. 'Substituir em tudo' is one batch. AI corrections arrive as proposals built from get_analysis('transcript').

**Tests**

Unit: time splitting on word edit, split/merge ops, replace-all. E2E: a chip edit updates the caption in preview and export; click seeks; Tab navigation works. MCP: transcript paging.

### F5 MCP/AI surface: new tools and ops, get_context compaction, economy ceiling (size M)

**Touch points**

- `src/core/api.ts`: BridgeMethod and handleBridge for generate_captions, analyze_audio, get_job and get_analysis.
  
  compactClip:
  - volume dB, fades and duck counts;
  - caption words omitted (count plus a capped list of low-confidence words);
  - in economy mode, collapse contiguous same-media pieces.
  
  status: props from PROPS, job states and cache readiness. compactProposal: removed time, cut count and origin. reducedContext hints point to get_analysis.
- `src/mcp/server.ts`: zod schemas for the four tools, with short descriptions. Condense OPS_HELP and serve the detailed help from editor_status. callTimeoutMs gets a long-wait case for get_job.
- `src/main/main.ts`: bridgeTimeoutMs exception for get_job (up to 55 s).
- `src/renderer/bridgeClient.ts`: LABEL entries (gerou legendas, analisou o áudio, conferiu a tarefa, leu a transcrição). markProposal for proposals created on a client's behalf.
- `src/main/assistant.ts`: INSTRUCTIONS: volume is in dB; long jobs must not block, use get_job; prefer cleanSpeech or analysis ids over listing ranges.
- `tests/mcp.test.ts`: Update the exact tool list.

**Model and ops**

- Tools:
  - generate_captions {range?, preset, style?} → {jobId} | {error:'model_missing'}
  - analyze_audio {clipId? | range?} → {jobId} | summary ≤1.5 KB
  - get_job {jobId, waitSeconds≤45, cancel?}
  - get_analysis {kind:'marks'|'transcript', range?, cursor?, limit≤100}
- Ops the AI can send through propose_edit: splitClip, removeRanges, duckRanges, clearAudioRanges, setProperty/setKeyframe 'volume', updateClip {fadeIn, fadeOut, words, style.strokeColor/strokeWidth/posY/highlightColor}, and cleanSpeech (analysisId).

**Preview/export parity risks**

- None directly; these tools add no rendering path.
- Stale timeline coordinates from the AI: removeRanges proposals rely on the existing baseRevision/stale checks, which must stay strict for ripple ops.

**Drafts, undo and MCP**

Proposal semantics don't change. The new tools never edit the project directly: jobs produce cache data or proposals built by the editor.

Economy: get_context stays under 6 KB by summarizing, and bulk data goes only through paged readers.

Revision: analysis results are in source time and independent of revision. get_analysis maps them to the current revision and returns it, so the AI's proposal carries the right baseRevision.

**Tests**

mcp.test.ts: tool list and schemas. api tests: compactClip with 300 pieces and with 300 captions stays under 6 KB in economy mode; get_job long-wait timeout path. E2E: the fake Claude CLI (ia-simulada.mjs) calls generate_captions and get_job, and the proposal card appears.

## One screen: where each feature goes

Today's layout:
- Top bar: 52 px.
- Main row: left panel 300 px (tabs Mídia | Propriedades), Preview in the centre, right ChatPanel 380 px.
- Timeline: clamp(230px, 32vh, 300px), with a toolbar, a 28 px ruler and four 48 px lanes (Legendas, Texto, Vídeo, Áudio).

Block 1 adds no panel and no lane. It adds one left tab and one modal.

FEATURE PLACEMENT
- Split and ripple:
  - Toolbar buttons Dividir (Ctrl+B) and Apagar trecho (Shift+Delete).
  - Range band on the ruler (Shift+drag, or I/O).
  - Ripple drafts show seams with '−0:04' chips.
  - While a ripple draft is open, the Preview gets an Antes/Depois toggle.
- Audio engine:
  - The Áudio lane grows to 64 px and becomes one canvas: waveform, fade handles at clip corners, duck blocks, optional volume line.
  - The lane head's mute button becomes the track mute.
  - Propriedades for a video clip gets an 'Áudio' block: Volume in dB with a keyframe button (from the registry), Fade de entrada/saída, Mudo, list of ducked ranges.
  - The Preview transport slider is labelled 'volume da prévia' (monitor only).
  - Items in Mídia show 'Preparando o áudio… 62%'.
- Breath and pauses:
  - Toolbar button 'Limpar fala' opens a popover: Detectar, summary, Abaixar/Cortar/Manter, Força, Ritmo, Revisar, Aplicar como rascunho.
  - Marks are drawn on the Áudio lane: a pill for a breath, a bracket with duration for a pause.
  - In review mode the toolbar hint area becomes a bar: 'Respiração 3 de 37 [<] [>] Ouvir (Espaço) Aplicar/Manter (Enter) Sair (Esc)'.
- Captions:
  - Toolbar button 'Gerar legendas' opens a modal, like the export modal: trecho, preset Shorts/Clássico, fonte, cor, contorno, idioma, and the first-use card 'Baixar modelo de fala (574 MB)' with progress, Cancelar and conferência.
  - Job progress runs as a strip inside the Legendas lane, with Cancelar.
  - The result arrives as a ProposalCard (origin 'Diretor') in the right panel, and the draft zones appear in the Legendas lane.
- Caption style: Propriedades > Estilo gets Fonte (bundled fonts), Contorno (color and thickness) and Posição.
- Transcript: a third left tab 'Transcrição' with word chips (low-confidence words underlined, click to seek, double-click to edit). Propriedades for a caption also shows its chips.
- MCP/AI: the ChatPanel shows tool activity lines and job progress, plus ProposalCards for both AI and local drafts.

SKETCH
+------------------------------------------------------------------------------------------------+
| Diretor   Abrir  Salvar                                                     [Exportar MP4]     |
+------------------------------+---------------------------------------+-------------------------+
| Mídia | Propriedades | Transcrição | Prévia               [Antes|Depois]| Claude | Codex          |
| Vídeo selecionado            |  +---------------------------------+  | > Claude analisou o áudio|
|  Início 0:12  Dur 4.00       |  |            (quadro)             |  | > Legendas 42% [Cancelar]|
|  Áudio                       |  |      LEGENDA COM CONTORNO       |  | +---------------------+ |
|   Volume   -3.0 dB  [<>]     |  +---------------------------------+  | | Rascunho: Limpar fala| |
|   Fade in  0.20 s            |  |> 0:12.40 / 3:10.00  prévia --o--   | | 37 respirações -20dB | |
|   Fade out 0.50 s            |                                       | | [Aceitar][Descartar] | |
|   [ ] Mudo   Trechos: 3 [x]  |                                       | +---------------------+ |
+------------------------------+---------------------------------------+-------------------------+
| <- -> Lixeira | Dividir | Apagar trecho | +Legenda | Título | Gerar legendas | Limpar fala | Zoom --o-- |
| 0s        5s  [====== trecho marcado ======]  10s           15s                                  |
| Legendas | [Transcrevendo 42% ######.... Cancelar]  [leg][leg][leg]                             |
| Texto    |     [Título..........]                                                               |
| Vídeo    | [clip A.......]|[clip B....]|(-0:04)|[clip C.............]                           |
| Áudio    | /\/\/\_/\/\ (resp) /\/\/\ [==abaixado==] /\/\ [pausa 1.2s] /\/\/\  fade handles at corners |
+------------------------------------------------------------------------------------------------+

## Slices (shippable order)

### S1 Dividir e apagar trecho (size L; depends on: none)

Ops and session:
- splitClip, shiftClips and cutTextTime primitives, and the removeRanges macro (right to left, every unlocked track, error 'locked').
- Exported keyframe partition helpers; touchedClipIds with clipIds[]; memoized draftInfo with cut seams.
- Decide whether trim ripple becomes cross-track.

Timeline:
- Ruler range selection (Shift+drag, I/O); Dividir (Ctrl+B) and Apagar trecho (Shift+Delete).
- Seams and '−0:04' chips in drafts.
- React.memo ClipBlock and an isolated Playhead.

Playback and export:
- Per-media VideoPool (2–3 elements, reuse across contiguous pieces, pre-seek ~0.5 s); preflight dedupe.
- Interim export audio: merge contiguous pieces, open each media once via filter script, or fail early.

MCP: OPS_HELP entries and economy compaction of pieces. Unit and e2e tests.

**Visible result.** Ctrl+B or Dividir cuts at the playhead.

Marking a range and pressing Shift+Delete removes it from every track: captions and titles close the gap and stay in sync.

Claude can propose cuts, shown as a draft with seams. Playback stays smooth across cuts, and exports with many cuts work.

### S2 Legenda com contorno e fontes (size M; depends on: none (can run in parallel with S1))

- Migration chain in parseProject, with a 'versão mais nova' refusal.
- Schema v2: TextStyle strokeColor, strokeWidth, posY (optionally Clip.origin).
- Two-pass drawText (stroke then fill, shadow once); layout and hitTest include the stroke.
- Bundled OFL fonts with document.fonts.load gating for preview and export.
- StyleSection controls; Shorts and Clássico presets; STYLE_KEYS; compactClip; OPS_HELP.

**Visible result.** Captions and titles get a coloured outline (e.g. yellow text with a black outline), a choice of bundled fonts and an adjustable position, and the export looks identical to the preview.

### S3 Forma de onda (cache de áudio) (size M; depends on: none; easier after S1, which memoizes the timeline and adds range selection)

- audioCache.ts ingest job (base.s16, two peak levels, meta).
- srcKey and LRU.
- media://audio host confined to the cache.
- Ingest triggered on import and open, with progress badges.
- Áudio lane canvas waveform redrawn only on scroll, zoom or view change.
- Preload API.
- Tests for ingest and for traversal rejection.

**Visible result.** The Áudio lane shows the real waveform, so cuts can be placed on silences, and media items show 'Preparando o áudio…' progress.

### S4a Motor de áudio: prévia e exportação pelo mesmo mixer (size L; depends on: S1 (cuts, per-media pool), S3 (PCM cache))

- core/audio plan.ts and mix.ts (rules: contiguous pieces get no fade, 10 ms equal-power crossfades with handles, 3 ms micro-fades, soft clip). For now, map the existing 0..1 volume and muted.
- Renderer Worker, AudioWorklet and engine.
- Preview clock from getOutputTimestamp, with video elements muted and slaved.
- Export mixes in main to a temp f32le file, used as the single ffmpeg audio input; cleanup paths extended.
- Delete the S1 interim export code.
- CSP check.
- E2E audio parity (worklet tap = export PCM) and a 600-clip Windows export.

**Visible result.** Cuts no longer click or gap, in preview or in export. What you hear in preview is exactly what is exported, and exports with hundreds of cuts stay fast and within the Windows command-line limit.

### S4b Volume em dB, fades e trechos abaixados (size L; depends on: S4a)

- Schema bump: volume migrates to props.volume in dB (−60..+12, keyframable); fadeIn, fadeOut and ducks (source seconds); Track.muted.
- PROPS entry; duckRanges and clearAudioRanges ops; CHANGE_KEYS changes with a legacy error.
- Inspector 'Áudio' block.
- Áudio lane fade handles, duck blocks and optional volume line.
- Track mute button.
- compactClip, status props, OPS_HELP and INSTRUCTIONS.
- Migration, plan and e2e tests.

**Visible result.** Volume up to +12 dB with keyframes; draggable fade-in and fade-out handles; select a range to lower or mute it. All of it is audible in drafts before accepting, and identical in the export.

### S5a Gerar legendas (size XL; depends on: S2 (style), S3 (cache); S1 so words follow splits)

Infrastructure:
- fetch-stt.mjs, extraResources, after-pack and CI vendoring (whisper b5454, VC++ DLLs, silero VAD model).
- jobs.ts job manager; models.ts download manager with consent, Range resume, SHA-256 and cancel.

Pipeline and model:
- stt.ts: base cache → VAD → speech.wav mapping → whisper-cli (-nfa -dtw) → words → per-media transcript cache.
- captions.ts chunker (Shorts and Clássico presets) and timeline mapping.
- Schema bump: CaptionClip.words and highlightColor; word remap in split, trim and cutTextTime.

Editor:
- Local proposals with origin, local redo and a queue.
- CaptionsDialog, Legendas-lane progress strip, local ProposalCard.
- MCP generate_captions and get_job.
- Fakes (DIRETOR_WHISPER_CLI) and e2e.

**Visible result.** Gerar legendas downloads the speech model once (with progress and cancel), transcribes with a progress bar, and delivers a styled caption draft that can be accepted or discarded and undone in one step. Claude can also ask the editor to generate captions.

### S5b Painel de transcrição e correções (size M; depends on: S5a)

- TranscriptPanel left tab: chips, low-confidence underline, click-to-seek, inline edit with time splitting, Tab to the next doubtful word, split/merge captions, 'Substituir em tudo'.
- Inspector chips.
- Optional active-word highlight in render.ts.
- MCP get_analysis('transcript').

**Visible result.** Misheard words can be fixed by clicking a chip and typing; the captions update in preview and export. Claude can propose corrections word by word.

### S6a Respirações: detectar, revisar e abaixar (size L; depends on: S4b (ducks and mixer), S5a (vendored VAD, job manager, local proposals))

- VAD job reusing the vendored whisper-vad exe and the job manager; shared speech mask.
- breath.ts DSP classifier.
- marks.ts mapping and lower builder; marks store and cache with review state.
- Áudio lane markers, review mode with key interception, 'Limpar fala' popover.
- Local proposal of duckRanges with tag 'breath'.
- cleanSpeech macro resolved when the step is prepared.
- MCP analyze_audio and get_analysis('marks').
- Synthetic-fixture tests.

**Visible result.** Breath markers appear on the Áudio lane. After review, 'Aplicar como rascunho' lowers every breath by about 20 dB in preview and export, and one undo restores them.

### S6b Cortar pausas (size M; depends on: S1, S4a, S6a)

- Cut mode of the builder: guards (pads after and before words), Ritmo target gap, min pause, and word-aware when a transcript exists.
- Emits removeRanges through the S1 ripple; joins use the S4a crossfades.
- Review navigation for pauses.
- Summary of saved time.
- E2E for duration and caption sync.

**Visible result.** Long pauses shrink to the chosen gap across all tracks in one draft. Captions and titles stay in sync, joins are click-free, and the summary shows the time saved (e.g. −0:31).

## Notes for blocks 2 and 3

BLOCK 2: color in renderFrame, transitions between adjacent clips

Easier:
- Keep renderFrame synchronous and keep the getVideoFrame indirection through the S1 VideoPool rewrite (frame(clip) API unchanged). rec-color's optional colorize hook (WebGL2 pass on the frame, then drawImage into the same 2D context) then drops in without touching preview or export plumbing.
- The per-media pool with 2–3 elements is exactly what transitions need: outgoing and incoming frames at the same time, including same-source transitions between split pieces. The pre-seek logic is reused.
- S4a's plan already computes handles (source material beyond each edge) for crossfades. Export that computation from core as one function (e.g. cutHandles), so it also gives the maximum transition length. Store transitions on the cut, e.g. transitionOut on the left clip, rather than as overlapping clips. Then S1's shiftClips/no-overlap validation and the audio plan stay valid. rec-audio-arch rule (d) then maps a video transition to an audio crossfade of the same length.
- Volume as a PROPS entry (S4b) proves the path for non-transform numeric props. Color props reuse keyframes, validation, drafts, undo and sparse compactClip (it already emits only non-default values). splitClip's generic keyframe partition splits color keyframes correctly for free.
- S1's Antes/Depois toggle doubles as the before/after compare for color.

Harder:
- Export draws on an OffscreenCanvas 2D with willReadFrequently, which is CPU-backed. Each graded clip forces a GPU→CPU readback per frame. Read the WebGL result synchronously in the same task, because preserveDrawingBuffer=false semantics apply (https://github.com/KhronosGroup/WebGL/blob/main/specs/latest/1.0/index.html). Don't move export into a Worker during block 1: fonts and GL contexts would both have to be re-solved there.
- E2E runs Electron with --disable-gpu under xvfb, and Chromium 141+ removed the automatic SwiftShader WebGL fallback (https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM/m/oLrB5up_BwAJ). WebGL tests need --enable-unsafe-swiftshader or --use-angle=swiftshader; Windows falls back to WARP.
- Cut-pause cleanup (S6b) produces dozens of cuts. Transitions must never be applied to every cut automatically; micro-crossfades stay audio-only.
- After S4a, preview video is slaved to the audio clock with up to about 80 ms drift. A transition can show an element frame one frame off in preview; export stays exact.

BLOCK 3: tracking keyframes, masks with per-frame mattes

Easier:
- Block 1 caches are keyed by srcKey and source time (PCM, peaks, VAD, transcripts, marks). That is the template for tracking data and mattes: keyed by media and source frame, not by clip id, so splits, trims and ripples never invalidate them, and every piece of a take shares them.
- The generic job manager and download manager (S5a) carry over to tracking and segmentation models: progress, cancel, checksum, consent.
- Local-origin proposals (S5a) let tracking results arrive as a reviewable draft of keyframes.
- splitClip's keyframe partition already handles tracked and mask-shape keyframes.
- The migration chain from S2 makes adding mask fields a routine step.
- The optional Clip.origin recorded at split time enables 'aplicar a todos os pedaços da mesma tomada' for masks and color.

Harder:
- Every history entry stores full before/after snapshots, and every draft view is a full clone. Per-frame tracks or mattes inside Project would make every edit O(data). Keep dense data in the cache and reference it from Project, e.g. maskSource {kind:'matte', key}. Alternatively, decimate tracks to sparse keyframes before proposing them. Block 1 must set this precedent by keeping words-only data on caption clips and marks out of Project.
- Preview frames come from elements slaved to the audio clock (S4a). A matte must match the frame actually presented, not the timeline t. When S1 rewrites VideoPool, add an optional mediaTime to the VideoFrame interface in render.ts, filled from requestVideoFrameCallback metadata (https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback); seekExact already gives exact times in export.
- Many split pieces fragment a take, so a mask edited on one piece must propagate. Without an origin link this is manual.
- getVideoFrame returns an HTMLVideoElement. Any on-the-fly ML needs pixel readback, so run segmentation and tracking offline as jobs into the cache.
- Canvas 2D can composite a matte (destination-in) identically in preview and export. However, per-frame matte decode cost in export must be budgeted alongside the color pass's readback.
