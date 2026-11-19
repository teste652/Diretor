> Pesquisa feita em 18–19/11/2026 para o bloco 1 (áudio e legendas) do Diretor. O texto da pesquisa está em inglês. Caminhos como `/tmp/claude-0/...` apontam para testes locais daquela sessão, que não foram guardados; as conclusões e números estão aqui.

# audio-arch: audio editing architecture for the Electron/React editor (split/ripple, volume up to +12 dB with keyframes, fades and crossfades, waveforms, loudness, "improve voice", AI ops), with preview identical to export

## Summary
Recommendation: build sound the same way renderFrame builds pictures. One pure, stateless TypeScript mixer (mixInto) feeds both the preview (Web Worker into an AudioWorklet) and the export (Electron utilityProcess into ffmpeg AAC). It reads sample-exact 48 kHz PCM caches that the bundled ffmpeg decodes once per media file. Anything with internal state ("improve voice": high-pass, afftdn/arnndn, de-esser, compressor, limiter) is processed offline by ffmpeg into fixed-grid, deterministic tiles that preview and export both read. Loudness normalization is stored as a static dB gain in the project. Measured on this sandbox (Xeon 2.3 GHz KVM, 4 vCPU; expect 2-4x slower on budget laptops):
- Importing 1 h of AAC into the PCM cache, plus peaks and a 10 ms RMS envelope, takes 4.3 s and uses 691 MB.
- Mixing a 1 h timeline with 600 segments plus an automated music bed takes 1.5 s.
- The voice chain runs at 60-90x realtime, ebur128 at 226x, AAC encoding at 81x.
The current export design cannot survive razor or breath editing: one -ss/-t ffmpeg input per clip plus adelay and amix.
- It exceeds the Windows 32,767-character command-line limit at about 170 clips with a typical path.
- It takes 55 s for 300 clips.
- It damages about 11 ms of audio after every split, because the AAC decoder restarts at each seek (error -15.5 dB relative to the signal on a split that should be seamless).
Per-element Web Audio (MediaElementAudioSourceNode into GainNode) is also a poor base:
- el.volume is capped at 1.
- An element can feed only one source node (InvalidStateError, confirmed in Electron 45).
- Element start latency makes crossfades at cuts and range ducking inaccurate to the sample.
- Its compressor and filters differ from ffmpeg's, so the export would not match.
Rendering the whole timeline to a WAV with ffmpeg does give matching output, but every edit or AI draft costs seconds to minutes before it can be heard. Waveforms should come from the same ffmpeg decode pass as min/max peaks, not from decodeAudioData, which decodes the whole file to float (about 1.38 GB per hour of stereo). Keep audio embedded in the video clip for now (the CapCut main track / FCP "expanded audio" model), with:
- split;
- ripple range removal across all tracks;
- audio-only ducking or muting of ranges;
- automatic micro-crossfades of about 10 ms at cuts that are not continuous in the source.
Detached audio clips and tracks (music, voice-over, J/L cuts via linkId) come later on the same mixer. The AI drives everything through a few small, validated operations: splitClip, removeRanges, duckRanges, the audio fields of updateClip, volume as a dB property, and a normalizeLoudness macro. A new get_audio_analysis tool returns compact range strings that fit the 6 KB economy limit.

## Choice
Option A: a stateless shared TS mixer, plus an ffmpeg PCM cache and deterministic ffmpeg DSP tiles, played by Worker → AudioWorklet in preview and by utilityProcess → ffmpeg AAC in export. Audio stays embedded in VideoClip now: split, ripple range removal across all tracks, duck/mute ranges, automatic edge crossfades. Detached audio tracks with linkId come later. Waveforms come from the import pass (option E). Loudness is stored as a static gain (option G). 'Melhorar voz' uses afftdn/arnndn presets, with DeepFilterNet as an optional later tier (option H).

## Why
It applies the existing rule (one renderFrame for preview and export) to sound. Matching output is guaranteed by construction, not by keeping two engines in sync.
- Same function, same V8 in the renderer Worker and the utilityProcess (one Electron 45 binary), same immutable samples.
- Stateful DSP is only offline, on a fixed grid.
- Normalization is a static dB value in the project.

It removes the measured failures of today's approach:
- the Windows command line overflows at about 170 clips;
- amix takes 55 s at 300 clips;
- about 11 ms of corrupted AAC follows every split;
- volume eval=frame changes gain in 1024-sample steps.

It also removes the inaccuracy of per-element Web Audio at cuts.

It keeps the editor interactive: the mixer only computes what is about to play, so AI drafts and manual tweaks are audible in about 100 ms. It costs 1.5 s per hour of a 600-segment timeline even for a full export.

Every runtime piece the preview needs was verified in an Electron 45.3.4 spike (sandbox, contextIsolation, file://):
- a Worker and an AudioWorklet load;
- the Worker-to-worklet MessagePort carries audio;
- AudioContext runs at 48 kHz at startup;
- getOutputTimestamp works;
- a Worker can Range-fetch through a custom protocol.

## Concrete plan
0) PRINCIPLE. src/core/audio/mix.ts is the only place where samples are combined. Web Audio is used only as the output device, plus a preview-only monitor gain (the existing transport slider). Mixer inputs are (a) compileAudioPlan(projectView), a pure function, and (b) PCM from immutable cache files. Stateful processing never runs at mix time.

1) DATA MODEL (schema version 2; parseProject migrates v1: props.volume.value = v>0 ? 20*log10(v) : -60; audio.muted = muted).
  interface AudioRange { id: string; t0: number; t1: number /* seconds relative to the clip, like keyframes */; gainDb: number /* -60 (= silence) .. 0 */; fadeMs: number /* 2..200, ramps inside the range */; tag?: 'respiro'|'silencio'|'manual' }
  interface ClipAudio { muted: boolean; fadeIn: number; fadeOut: number /* s */; voice: 'off'|'leve'|'forte'; ranges: AudioRange[]; normalizedTo?: number /* LUFS, informational */ }
  VideoClip: { ...; mediaId; in; audio: ClipAudio }. The top-level volume and muted fields are removed.
  properties.ts registry: { name:'volume', label:'Volume', unit:'dB', min:-60, max:12, default:0, step:0.1, kinds:['video'] }. This makes setProperty, setKeyframe, the easing curves, the panel and MCP generic for free. Keyframes are interpolated in dB.
  Project.audio: { masterGainDb: number; target: -14|-16|-23|null; edgeFadeMs: 10; safety: 'softclip'|'off' }.
  Track.muted?: boolean (audio mute separate from video 'hidden').
  MediaItem.audio?: { channels: number; startOffset: number }.
  Phase 3: TrackKind 'audio' (0..N tracks); AudioClip extends ClipBase { kind:'audio'; mediaId; in; audio: ClipAudio; linkId?: string }; VideoClip.audio.detached?: true.

2) CACHES (outside the project). Location: app userData/audio-cache/<srcKey>/, where srcKey = sha1(path|size|mtimeMs|ffmpegVersion|ingestVersion). Contents:
  - base.s16 (48 kHz, stereo, s16le);
  - base.json { frames, startOffset };
  - peaks128.i8 (min/max of the mono mix per 128 frames);
  - rms10.i8 (dBFS per 10 ms);
  - loud.json (I, LRA, TP);
  - fx-<chainHash>/tile-<n>.s16.
  LRU cap (default 10 GB, user setting, plus a 'Limpar cache' button). Never evict entries referenced by the open project.
  Serve the cache to the renderer by adding an 'audio' host to serveMedia (src/main/main.ts), restricted to the cache dir, application/octet-stream, using the existing Range support.

3) IMPORT, in main via child ffmpeg, on import and on open if the cache is missing. Progress label 'Preparando o áudio…'.
  Command: ffmpeg -hide_banner -nostdin -loglevel error -i <src> -map 0:a:0 -vn -af aresample=48000:async=1:first_pts=0 -ac 2 -f s16le pipe:1
  A Node stream writes base.s16 and computes peaks and rms10 in the same pass.
  Then: ffmpeg -f s16le -ar 48000 -ac 2 -i base.s16 -af ebur128=peak=true:framelog=quiet -f null - and parse the summary for I, LRA and Peak.
  A clip range is measured the same way with -ss/-t before -i; seeking raw PCM is exact to the byte.
  Until the cache is ready, that media is silent in preview and shows a badge.

4) 'MELHORAR VOZ' TILES, in main via child ffmpeg.
  Priority queue: tiles at or after the playhead first, then all used ranges. Export waits for all of them.
  Tile n covers [30n, 30(n+1)+0.05] s. It is processed from max(0, 30n-5) (5 s pre-roll) and trimmed:
  ffmpeg -f s16le -ar 48000 -ac 2 -ss S -t T -i base.s16 -af "<chain>,atrim=start=<preroll>" -f s16le tile-n.s16
  Run with cwd = the models dir so arnndn=m=sh.rnnn needs no escaping of Windows 'C:' paths inside the filtergraph.
  Chains v1 (tune by ear; versioned in chainHash):
    leve  = highpass=f=70,afftdn=nr=10:nf=-50:tn=1,deesser=i=0.25,acompressor=threshold=0.1:ratio=2:attack=10:release=150:makeup=1.6,alimiter=limit=0.891:level=false
    forte = highpass=f=90,arnndn=m=sh.rnnn:mix=0.85,deesser=i=0.4,acompressor=threshold=0.08:ratio=3:attack=5:release=120:makeup=2.2,alimiter=limit=0.891:level=false
  acompressor threshold/makeup and alimiter limit are linear values; level=false stops alimiter's auto-gain.
  The tile reader crossfades consecutive tiles over the 50 ms overlap (equal-power), identically in both paths.
  Bundle sh.rnnn (298 KB).
  Optional later: DeepFilterNet3 deep-filter (48 kHz WAV in and out) as a third tier writing the same tile format.

5) PLAN COMPILER (src/core/audio/plan.ts, pure). Input: session.view (with drafts applied). Output: segments { srcKey (base or fx), tl0, src0, len (frames = round(s*48000)), gain curve, edge flags }. Rules:
  (a) Neighbours that are contiguous (same media and voice preset, src0_b == src0_a + len_a, tl0_b == tl0_a + len_a) get no fade, so a split is bit-seamless.
  (b) Any other cut gets an equal-power crossfade of edgeFadeMs (default 10 ms) centred on the cut, using the source media beyond each clip's edges ('handles'). If one side lacks handle, shift the fade window into the side that has it. If neither has, use a 5 ms fade-out followed by a 5 ms fade-in.
  (c) A clip edge next to silence gets a 3 ms micro-fade (Descript-style).
  (d) A video transition at a cut (feature 4) gets an audio crossfade of the transition's duration (FCP behaviour).
  (e) gain(t) = dB2lin(volume dB from evalProp, sampled every 64 frames and linearly interpolated) x raised-cosine fadeIn/fadeOut x range ramps (dB, -60 means 0) x 0 if the clip or track is muted.
  (f) Master: x dB2lin(masterGainDb), then a memoryless soft clip above -1 dBFS: y = sign(x)*(0.891 + 0.109*tanh((|x|-0.891)/0.109)).

6) MIXER (src/core/audio/mix.ts): mixInto(plan, frame0, n, read(srcKey, srcFrame, n) => Int16Array) => [Float32Array L, Float32Array R]. Float64 accumulation. No state between calls, so seek, scrub, partial export and parallel export are trivial. Measured: 1 h, 600 segments plus an automated music bed, 1.5 s in Node 22.

7) PREVIEW ENGINE (renderer).
  - Audio context: new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' }). Set webPreferences.autoplayPolicy: 'no-user-gesture-required' explicitly (it is the Electron default) and still await ctx.resume() on Play. Watch statechange (sleep, device change).
  - Graph: AudioWorkletNode('timeline-player', { numberOfInputs: 0, outputChannelCount: [2] }) → monitorGain (the existing transport slider, never exported) → destination.
  - Worklet: a ring buffer of 2048-frame chunks. It reports startContextFrame, playedFrames and underruns. It transfers spent ArrayBuffers back to the worker for re-use, so the audio thread does no garbage collection.
  - Worker audio-mix.worker.ts: holds the plan; fetches PCM windows with fetch('media://audio/<srcKey>/base.s16', { headers: { Range } }); mixes; posts chunks through a MessageChannel port transferred to the worklet. Keeps 200-300 ms ahead and starts output after 100 ms is buffered. Load the worker and worklet through Vite ?worker&url / ?url, with Blob URL as fallback.
  - Clock: replace masterTime() in Preview.tsx:
      ts = ctx.getOutputTimestamp();
      ctxNow = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      t = playStartT + (ctxNow - startContextTime).
  - Video: elements stay muted and follow t. |drift| > 80 ms → seek; 20-80 ms → playbackRate 0.97-1.03. Change VideoPool (src/renderer/video.ts) to pool 2-3 elements per media instead of one per clip. Keep playing the same element across contiguous splits. Pre-seek the next clip's element 0.5 s before a cut.
  - Edits and AI drafts during playback: post the new plan; the worker tells the worklet to drop frames beyond now + 50 ms and refills them (about 100 ms to hear the change).
  - Optional: audio scrubbing with 60 ms grains from the same mixer.

8) EXPORT (src/main/main.ts, src/core/export.ts).
  - exportStart first awaits audioAssets.ensure(project) (import + tiles + analysis, with progress).
  - It then runs utilityProcess.fork('audio-export.cjs'): compileAudioPlan + mixInto in 1 s blocks, written to the stdin of: ffmpeg -f f32le -ar 48000 -ac 2 -i pipe:0 -c:a aac -b:a 192k <out>.diretor-audio.m4a (≈45 s per hour on the sandbox).
  - buildFfmpegArgs drops the per-clip -ss/-t -i, aresample, adelay and amix, and adds: -i <tmp>.m4a -map 1:a:0 -c:a copy. The process always has 2 inputs, whatever the clip count.
  - Later option: run the audio step in parallel with frame rendering and remux at the end.

9) WAVEFORM (Timeline.tsx 'Áudio' lane, which today is a CSS pattern).
  - Per visible clip, draw the slice [in, in+duration] of peaks128, choosing the mip level so there is at least 1 peak per pixel.
  - Multiply amplitude by the gain curve; tint red where it would hit the soft clip.
  - Draw fade handles at the corners, ranges as tagged translucent blocks, and the volume line as a draggable curve.
  - Above 375 px/s, draw from base.s16 via Range fetch.

10) LOUDNESS. 'Normalizar volume' on a clip: ebur128 over the clip's range (base or fx), then setProperty volume = clamp(target - I, -60, 12), limited so TP + gain ≤ -1 dBTP; if that cap prevents reaching the target, say so. 'Normalizar vídeo': mix → ebur128 → masterGainDb. Default -14 LUFS; options -16 and -23. Never put dynamic loudnorm in a chain.

11) OPERATIONS (operations.ts; same validate → expand → apply pipeline; unknown fields still rejected).
  - {op:'splitClip', clipId, at} — at is timeline seconds, at least MIN_DURATION from both edges. Expands to updateClip on the left part plus an internal insertClip for the right copy: in += at - start; keyframes and ranges partitioned with boundary values (reuse clampKeyframes); fadeIn stays left, fadeOut goes right.
  - {op:'removeRange', start, end} and {op:'removeRanges', ranges:[[s,e],...]} — at most 500 ranges, sorted, non-overlapping, given in the CURRENT timeline coordinates and applied right to left. On every track: clips inside are removed, clips straddling an edge are trimmed or split, and later clips shift by -(e-s). Captions and titles stay in sync. Error 'locked' if a locked track would have to move.
  - {op:'duckRanges', ranges, gainDb?:-24, fadeMs?:15, tag?:'respiro', clipId?} — -60 means mute. Stored relative to the clip on each overlapped video clip. Replaces earlier ranges with the same tag that overlap, so a repeated proposal is idempotent.
  - {op:'clearAudioRanges', clipId?, tag?}.
  - updateClip.set gains the keys muted, fadeIn, fadeOut and voice. Volume uses {op:'setProperty', prop:'volume', value: dB} or setKeyframe (-60..+12). The legacy set.volume (0..1) returns an error explaining dB.
  - {op:'normalizeLoudness', target:-14, scope:'clips'|'video', clipIds?} — a macro resolved asynchronously before validation (cached or about 0.3 s per minute of ebur128). Expands to setProperty volume or masterGainDb. If analysis is not ready: new OpError code 'analysis_pending' with a retry hint.
  - Validation: 0.03 ≤ e-s ≤ 30 s for respiro/silencio tags; fadeMs ≤ (e-s)/2; gainDb in [-60, 0]; fadeIn + fadeOut ≤ duration; voice in its enum; volume in [-60, 12]; each range must overlap an audible clip.

12) MCP (src/mcp/server.ts, src/core/api.ts).
  - Extend OPS_HELP in pt-BR.
  - New tool get_audio_analysis({clipId? | range?, kinds:['loudness','silences','breaths'], minDuration?}) returns, for example: {"state":"ready","lufs":-19.2,"truePeak":-3.1,"noiseFloorDb":-52,"silences":"12.31-12.90,15.02-15.30","breaths":"3.12-3.41:0.9,..."}. Times are timeline seconds with 2 decimals; ':' carries the confidence. About 12 bytes per range, so roughly 400 ranges fit under the 6 KB ceiling; a 'more' cursor covers the rest. state 'pending' comes with retryAfterSeconds.
  - compactClip adds 'audio' only when it differs from defaults, e.g. {volumeDb:-3, volumeKeyframes:2, fadeIn:0.2, voice:'leve', ranges:{respiro:14}}.
  - The draft UI shows ducked and removed ranges on the waveform; accept, adjust or discard work per step as today.
  - The breath detector (separate research) only produces analysis events consumed here.

13) TESTS (vitest + e2e).
  - Mixing a split clip equals mixing the unsplit clip, bit for bit.
  - Ripple removal equals concatenation plus a crossfade.
  - Ducks, fades, soft clip, and plan determinism.
  - A golden md5 of export PCM for a fixture project, per platform and ffmpeg version.
  - e2e: a debug tap of the worklet output equals the export PCM for the same range.
  - Windows CI export with 600 clips.
  - An A/V offset fixture (flash + beep) for files with start_time ≠ 0 or edit lists.

14) PHASES.
  - P1: import, cache and peaks; mixer; worklet preview; export via the mixer; volume in dB and fades; split; removeRange(s); duck/mute ranges; edge crossfades; VideoPool per media.
  - P2: 'Melhorar voz' tiles; loudness normalization; get_audio_analysis (silences, then breaths).
  - P3: audio tracks (music, voice-over); 'Separar áudio' with linkId (J/L cuts); auto-ducking music under speech from rms10; optional DeepFilterNet download.

## Risks
- AudioWorklet underruns when the renderer is under load or garbage collection runs. MessagePort allocates per message: Chrome's own guidance calls it suboptimal for real-time. Mitigate with buffer recycling and 250 ms of lookahead. Later, SharedArrayBuffer is possible by serving the renderer from a custom app:// scheme with COOP/COEP headers; the spike showed SharedArrayBuffer is undefined under file:// because crossOriginIsolated is false.
- Output-latency estimates for Bluetooth and HDMI may be wrong, giving a lip-sync offset in preview only (export unaffected). The spike saw outputLatency read 0 at start and 0.03 later. Add a manual 'atraso do áudio' setting.
- Disk use: about 0.69 GB per hour of source, plus the same per processed preset. Low-space SSDs need the LRU cap, a visible setting and 'Limpar cache'.
- A/V alignment between Chromium's <video> currentTime and ffmpeg-decoded PCM for files with start_time ≠ 0, MP4 edit lists, or variable frame rate (phone footage). This already exists today. Must be fixture-tested; compensate using the probed 'start:'.
- ffmpeg version drift: ffmpeg-static 5.3.0 ships 6.1.1 (gyan.dev) on Windows, while the Linux dev binary is 7.0.2. DSP output differs between versions, so put the ffmpeg version in cache keys, keep golden files per platform, and consider pinning one ffmpeg build.
- Mix-bus dynamics (limiter or compressor on the whole mix) cannot be identical after a seek. v1 restricts the master to static gain plus a memoryless soft clip. A limiter whose output depends only on a finite window (sliding-minimum gain plus FIR smoothing, with pre-roll) can come later.
- Ripple across all tracks moves captions and titles (desired) but differs from CapCut's main-track-only ripple; the pt-BR UI text must make this clear. Locked tracks block ripple.
- Many split clips make undo snapshots and timeline DOM heavier. One <video> per clip wastes decoders. The spike loaded 300 players in Electron 45 on Linux without hitting Chromium's 2021 cap of 75; hardware decoder sessions on Windows are not tested.
- Loading the Worker and worklet worked from file:// in the Electron 45.3.4 Linux spike. Still verify in the packaged Windows app (asar) and in dev (http://localhost:5173).
- RNNoise artifacts on laughter or music. Keep 'leve' on afftdn; the DeepFilterNet tier is still unverified for binary size and Windows packaging.
- Web Audio 1.1 is still a W3C Working Draft (2026-09-22). The APIs used here have long shipped in Chromium, but outputLatency and getOutputTimestamp accuracy varies by device.

## Fallback
If the Worker → AudioWorklet path glitches on some PCs: schedule the same mixer chunks with AudioBufferSourceNode.start(when) from the main thread. This plays without gaps in a 48 kHz context, and preview still matches export. If the PCM cache's disk use is unacceptable: decode PCM windows on demand, through ffmpeg (-ss with pre-roll + atrim) for both paths or Mediabunny/WebCodecs in the Worker with ffmpeg for export. Keep the same mixer; seeks get slower, and with two decoders matching must be re-tested. If the ffmpeg voice chains are not good enough: produce the same tiles with DeepFilterNet3. A stopgap that keeps today's per-clip ffmpeg export for small projects is NOT advised: splits click in the export (measured) and Windows overflows at about 170 clips.

## User-facing constraints
- After importing a video, the audio and waveform take a few seconds per hour of footage to prepare. Measured 4.3 s per hour on a fast server CPU; expect about 5-20 s on typical laptops. Until then that clip plays silent and shows 'Preparando o áudio…'.
- The audio cache uses about 0.7 GB per hour of footage, plus about 0.7 GB per hour for each 'Melhorar voz' strength used. It is cleaned automatically up to a size limit (suggest 10 GB) and can be cleared in settings.
- 'Melhorar voz' processing runs at roughly 60-90x realtime on a fast CPU (about 1 minute per hour of speech), probably 2-3x slower on budget laptops. The part near the playhead is processed first. Export waits until everything is processed.
- An optional AI noise remover (DeepFilterNet3) would be an extra download and runs about 5x faster than realtime on a 2017 laptop CPU (single thread). Download size not verified. No GPU is needed for any audio feature.
- Nothing is uploaded: decoding, analysis, noise reduction and mixing all run locally with the bundled ffmpeg.
- Raising volume above 0 dB (up to +12 dB) can distort loud passages. The editor softens the peaks and warns; 'Normalizar' or 'Melhorar voz' are the better way to make speech louder.
- With Bluetooth headphones the preview can be slightly out of lip-sync if Windows reports the wrong latency. The exported MP4 is not affected.
- Volume target: -14 LUFS is the de-facto choice for YouTube, Reels and TikTok. YouTube only turns loud videos down; TikTok and Instagram publish no official number. Podcasts use -16 and TV -23.
- Export gains a short audio step (about 45 s per hour on a fast CPU), small compared with rendering the video frames.
- 'Abaixar respiros' keeps the picture continuous. 'Cortar respiros' makes jump cuts and shortens the video; captions and titles move along.

## Product questions
- Breaths: should the default be to lower them (about -24 dB, picture stays continuous) or to cut them (jump cuts, shorter video), or should the user be asked each time?
- Is background music or a separate voice-over needed in this phase? That requires an audio track and 'Separar áudio', and enables J/L cuts. Or can it wait for phase 3?
- Volume control: show % like CapCut (100% = 0 dB, 400% = +12 dB) or dB?
- When cutting a section or deleting a clip, should titles, captions and their animations always move with the video (sync lock), unlike CapCut, where only the main track moves?
- Default loudness target (-14 LUFS?): normalize automatically on export, or only when the user clicks 'Normalizar'?
- How much disk may the audio cache use, and where: system drive or next to the project file?
- Is an optional AI noise-removal download (DeepFilterNet3, size to be verified) acceptable, or should only the built-in ffmpeg filters be used?
- Should the user hear audio while dragging the playhead (audio scrubbing) by default?


## Checagem independente das afirmações

Uma segunda pesquisa tentou refutar cada afirmação (13 no total: confirmed 12, partly 1). Abaixo, só as que foram corrigidas ou que trazem uma ressalva. Onde a correção conflita com o texto acima, vale a correção.

- **audio-arch-12** (confirmed). Afirmação: Electron 45.0.0 (21 Oct 2026) ships Chromium 156, Node 24.22.0 and V8 15.6. The renderer Worker and a Node utilityProcess therefore run the same V8, so the same JS mixer produces identical floats.
  - Correção: No correction. Note that the installed 45.3.4 is Chromium 156.0.8078.100 / Node 24.22.3, not the 45.0.0 numbers.
  - Evidência: https://www.electronjs.org/blog/electron-45-0 (dated October 21, 2026: 'upgrades Chromium from 152.0.7977.54 to 156.0.8078.48, Node.js from v24.18.1 to v24.22.0, and V8 from 15.2 to 15.6'). Local check: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron -e 'process.versions' prints electron 45.3.4, chrome 156.0.8078.100, node 24.22.3, v8 15.6.75.57-electron.0. Local experiment (/tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/factcheck-audio-arch/spike2/main4.cjs + mixcore.js): one float-heavy mixer-like function (Math.pow/tanh/cos/log10/exp, Float64 accumulation, Float32Array output, FNV hash) gave the same hash 83bcc9c6 in a utilityProcess.fork child, in a sandboxed renderer Worker, under ELECTRON_RUN_AS_NODE and in system Node 22.23.5.
- **audio-arch-1** (confirmed). Afirmação: Today's buildFfmpegArgs gives a Windows command line of 28,759 chars at 150 clips and 38,332 at 200 clips with a ~90-char path; overflows at about 170 clips.
  - Correção: The numbers are correct. The script uses 'ffmpeg.exe' as argv[0] rather than the full app.asar.unpacked path (about 100 chars), so the threshold moves by less than one clip. The overflow comes from the per-clip -i design, not from ffmpeg itself: one -i per media file with the graph in -filter_complex_script (available in 6.1.1) avoids it.
  - Evidência: Re-ran scratchpad/scripts/argsize.mjs. Its export.bundle.mjs matches the current /home/user/Diretor/src/core/export.ts (one -ss/-t/-i plus an aresample/volume/adelay chain per audible clip, then amix). Output: 100→19,209; 150→28,759; 200→38,332; 400→76,932; 600→115,532 chars. Linear interpolation crosses 32,767 at about 171 clips. The test path is 86 chars. main.ts:334 calls spawn(ffmpegPath(), buildFfmpegArgs(...)).
- **audio-arch-2** (confirmed). Afirmação: The current per-clip ffmpeg audio graph scales badly: 50 clips 1.74 s, 100 clips 5.65 s, 300 clips 55.5 s for the audio alone (ffmpeg 7.0.2, Xeon 2.3 GHz, 4 vCPU).
  - Correção: Measured with the Linux 7.0.2 binary. Windows ships 6.1.1, which was not measured.
  - Evidência: Re-ran scratchpad/scripts/amixbench.mjs with node_modules/ffmpeg-static/ffmpeg (reports 7.0.2-static johnvansickle) on the 1 h long60.m4a: 50 clips 1.35 s, 100 clips 5.03 s, 300 clips 52.69 s, exit 0. Growth is roughly quadratic because adelay pads every input to the full timeline before amix.
- **audio-arch-3** (partly). Afirmação: A seamless split (two contiguous clips from one AAC source) corrupts about 520 samples (~11 ms) after the cut because decoding restarts at the -ss seek; signal fell 0.1228→0.0223; error-to-signal near the cut -15.5 dB.
  - Correção: The cause is right, and so is the conclusion that today's export breaks seamless splits. The size is not fixed. Corruption runs from the cut to the end of the AAC frame that contains it: 0 to about 1024 samples (0-21 ms), about 512 on average, with ESR from -8 to -35 dB. The ~520 samples / -15.5 dB figure is one instance; the worst case is about twice as long.
  - Evidência: Reproduced in scratchpad/factcheck-audio-arch (cmp.mjs) on a 6 s 48 kHz stereo AAC 192k file. Today's exact graph (two -ss/-t inputs, aresample async=1 first_pts=0, adelay, amix normalize=0) with a cut at 2.5 s gives 782 bad samples and an error-to-signal ratio (ESR) of -8.0 dB over the 2048 samples after the cut; the audio before the cut is bit-exact. Cut-position sweep: at offsets 0/256/512/768/1000 inside the 1024-sample AAC frame, bad samples = 971/715/459/203/0 and ESR = -8.4/-12.4/-19.4/-34.6/-77 dB. One decode with asplit+atrim+concat is bit-exact (error 0).
- **audio-arch-4** (confirmed). Afirmação: Importing 1 h of 48 kHz stereo AAC into an s16le PCM cache (691,200,000 bytes), plus min/max peaks and a 10 ms RMS envelope, took 4.25 s in one ffmpeg→Node pass.
  - Correção: The input was an audio-only .m4a already in the page cache. Real imports read audio interleaved in multi-GB phone video files from a laptop disk; that I/O was not measured. peaks.mjs uses 256 frames per peak; the recommendation specifies 128.
  - Evidência: Re-ran scratchpad/scripts/peaks.mjs on bench/long60.m4a (1:00:00, AAC LC 48 kHz stereo): 4.12 s with the cache written (cache.s16 = 691,200,000 bytes; 675,000 peak pairs; 360,000 envelope points) and 3.83 s without writing.
- **audio-arch-5** (confirmed). Afirmação: A plain JS mixer (600 segments with fades plus a music bed with an interpolated envelope) mixed a 1 h stereo 48 kHz timeline in 1.5 s (2.1 s including writing 1.38 GB of f32) on Node 22.
  - Correção: The benchmark mixer is simpler than the one specified: linear 5 ms fades, Float32 accumulation, no equal-power handle crossfades, no range ramps or soft clip, and readSync from the page cache instead of Range fetch. There is still ample headroom.
  - Evidência: Re-ran scratchpad/scripts/mixbench.mjs on a fresh 1 h s16 cache: 1.44 s and 1.48 s on Node v22.23.5; 1.39 s under Electron 45.3.4's Node 24.22.3 (ELECTRON_RUN_AS_NODE); 1.82 s when writing 1,382,400,000 bytes of f32.
- **audio-arch-6** (confirmed). Afirmação: ffmpeg speeds on 10 min of 48 kHz stereo: afftdn 4.1 s, afftdn tn=1 4.5 s, arnndn sh 9.6 s, voice chain with afftdn 6.7 s, with arnndn 10.0 s; loudnorm pass 1 41.5x; ebur128 peak=true over 1 h 226x (15.9 s); a 60 s range measures in 0.27 s and processes in 0.62 s.
  - Correção: All numbers come from a server CPU with AVX-512 running Linux ffmpeg 7.0.2. Nothing was measured on Windows 6.1.1 or on a budget laptop; CPUs without AVX2 take slower code paths.
  - Evidência: Re-ran on the same sandbox (Xeon 2.3 GHz with AVX-512, ffmpeg 7.0.2), using the recommendation's exact 'leve' and 'forte' chains: afftdn 3.38 s; afftdn=tn=1 4.03 s; arnndn=m=sh.rnnn 8.37 s; leve 5.35 s (112x); forte 8.06 s (74x); loudnorm print_format=json 13.6 s for 600 s (44x); ebur128=peak=true:framelog=quiet on 1 h 14.1 s (255x). 60 s range: ebur128 0.24 s; leve with 5 s pre-roll 0.62 s; forte 0.88-0.92 s. Extra: AAC 192k encode of 600 s took 6.76 s (89x).
- **audio-arch-7** (confirmed). Afirmação: The voice chain produces bit-identical output across runs and across -filter_threads 1 and 4, but output depends on where processing starts (3 s vs 10 s pre-roll differed by up to 33 LSB, ~1 LSB RMS, over 60 s without fully converging), so tiles must sit on a fixed grid.
  - Correção: This holds only on the same machine with the same binary. With -cpuflags -avx512-avx2-fma3 or -cpuflags 0, the md5 changed for the AAC decode (7322f0→206fc5/ab3f46), the forte chain (993792→73d06c/ff6539) and the AAC encode; leve did not change. The Windows gyan.dev build also picks code paths at runtime ('runtime cpu detection yes', AVX2/FMA3/AVX-512 enabled per https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/win32-x64.README). Tiles are local, so preview and export still match.
  - Evidência: Local runs on 60 s of the cache. Same md5 for repeat, -filter_threads 1 and -filter_threads 4: leve 6a77ded5c929..., forte 993792413d5b.... Pre-roll 3 s vs 10 s: leve max 3 LSB, identical after 17.5 s; forte (arnndn) max 55 LSB, 0.77 LSB RMS, still differing at 60 s (max 3 LSB in the last 10 s).
- **audio-arch-9** (confirmed). Afirmação: getOutputTimestamp() returns contextTime (the sample frame the output device is currently rendering) and performanceTime (on the performance.now() clock), the right mapping for slaving canvas video to audio. Web Audio 1.1 is a W3C Working Draft dated 22 Sep 2026.
  - Correção: The spec also says both members are 0 until the rendering graph has processed a block. The recommendation's clock formula would then give t = playStartT + performance.now()/1000, so it needs a guard.
  - Evidência: https://www.w3.org/TR/webaudio-1.1/ is a W3C Working Draft dated 22 September 2026 (https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/). It says 'the contextTime member contains the time of the sample frame which is currently being rendered by the audio output device', and performanceTime is in the Performance (hr-time) coordinate system. Spike: getOutputTimestamp returned contextTime 1.49-1.53 with a matching performanceTime.
- **audio-arch-11** (confirmed). Afirmação: Electron 45.3.4 spike (sandbox:true, contextIsolation, file://): Worker and AudioWorklet modules load; Worker streams audio to the worklet via a transferred MessagePort; AudioContext({sampleRate:48000}) is running at startup (baseLatency 0.010 s); getOutputTimestamp works; a Worker can Range-fetch through a privileged custom protocol (50 × 19.2 KB in 95 ms); SharedArrayBuffer undefined because crossOriginIsolated is false.
  - Correção: Test conditions matter. The spike runs as root, which requires --no-sandbox, so the OS sandbox was off. It used Linux with a dummy audio sink. The spike pages had no CSP; under the app's real CSP the Blob-URL fallbacks fail (see other_problems). Windows WASAPI, Bluetooth and the packaged asar build were not tested.
  - Evidência: Re-ran a copy of the spike (scratchpad/factcheck-audio-arch/spike2) under xvfb with Electron 45.3.4. Results: origin file://, coi false, SAB undefined; ctx running at 48000 with baseLatency 0.01002 and outputLatency 0, later 0.03; second createMediaElementSource throws InvalidStateError; worker created; worklet loaded; the port delivered all 40,960 pushed frames with 0 underruns while data lasted; getOutputTimestamp ok; Worker Range fetch gave 206 and 50 requests in 90 ms. The context is also 'running' with the autoplay-policy command-line switch removed, matching the documented Electron default (https://www.electronjs.org/docs/latest/api/structures/web-preferences: autoplayPolicy 'Defaults to no-user-gesture-required').

### Outros problemas que a checagem encontrou

- Voice-chain delay is not compensated, so step 4 cannot work as written (measured locally by cross-correlation in scratchpad/factcheck-audio-arch/py/lag.py). afftdn adds 1200 samples (25 ms), arnndn 480 (10 ms) and alimiter 240 (5 ms; its default latency=false, per the 6.1 docs 'the delay it produces is the attack time'; latency=1 brings it to 0). Totals: 'leve' 1439 samples (~30 ms), 'forte' 719 (~15 ms). Output length equals input length, so the tail is never flushed. Effects: 'Melhorar voz' tiles play 15-30 ms late against the video and the base audio, and the crossfades in rule (b) at base↔fx or leve↔forte boundaries mix copies offset by 15-30 ms, which smears transients and causes comb filtering. Fix: use alimiter latency=1; trim the measured delay (atrim start = preroll + delay; extend -t and add apad at the end); measure the delay per chainHash at runtime (impulse test), because it may differ between 6.1.1 and 7.0.2; add a test that fx tiles correlate with base at lag 0.
- Vite loading as written fails for a TypeScript worklet (tested with the repo's Vite 5.4 and base './'). `?url` on a .ts file emits the raw untranspiled TypeScript (proc-*.ts), or a data:video/mp2t base64 URL under the 4 KB inline limit; addModule cannot load either. `?worker&url` emits a transpiled IIFE chunk via new URL('…js', import.meta.url), which works from file://. Use ?worker&url for both the worker and the worklet, or write the worklet in plain JS.
- The planned 'Blob URL as fallback' is blocked by the app's own CSP. src/renderer/index.html has script-src 'self' and no worker-src. In Electron 45.3.4, under that CSP, a blob: Worker fires a CSP violation (worker-src blob) and audioWorklet.addModule(blob:) fails with AbortError; both work with no CSP, and a file:// worklet loads either way. Drop the fallback, or extend the CSP (worker-src 'self' blob:; script-src 'self' blob:). Fetches to media:// are fine because the scheme is registered with bypassCSP.
- ASAR packaging: 'Bundle sh.rnnn' plus 'run with cwd = the models dir' needs the model outside app.asar. Electron docs say the working directory can never be a directory inside an ASAR archive and passing one as cwd errors (https://www.electronjs.org/docs/latest/tutorial/asar-archives), and the external ffmpeg cannot read files inside the archive. package.json asarUnpack currently covers only dist/mcp/** and node_modules/ffmpeg-static/**; add the models dir or use extraResources. The model itself checks out: sh.rnnn is 297,646 bytes, and the GregorR/rnnoise-models README says the models are 'not subject to copyright', so commercial use is fine.
- The golden-md5 test plan ('per platform and ffmpeg version') will be flaky across machines. ffmpeg's AAC decoder, arnndn and AAC encoder give different bits when AVX2/FMA3 are unavailable (shown with -cpuflags), and CI runners and user laptops differ. Compare ffmpeg-produced PCM with a tolerance or SNR threshold. Keep exact md5 only for the JS mixer given fixed inputs; V8 float results matched across processes and Node versions.
- Outdated risk statement: the cap of 75 WebMediaPlayers was a Chrome 92 intervention reverted on Aug 3, 2021 by raising the limit to 1000 per frame (kDefaultMaxWebMediaPlayers = 1000, overridable by switch). Sources: https://webrtchacks.com/srcobject-intervention/ and https://chromium.googlesource.com/chromium/src/+/ff0d241ac8df72ad2cb4d3105cf90d802b62cbfd/content/renderer/media/media_factory.cc. The real constraint is decoder and memory load (pooling per media is still right).
- The export failures cited (command-line overflow, O(N²) amix, split seams) belong to today's per-clip-seek graph, not to ffmpeg mixing in general. One -i per media file, with asplit/atrim/concat in a -filter_complex_script file, was bit-exact at a split in my test and keeps the command line short. The JS-mixer choice rests mainly on preview==export parity and fast audible AI drafts, which still hold. The filter-graph design is a viable export fallback if the mixer slips. (FFmpeg 7.1+ deprecates -filter_complex_script in favour of -/filter_complex; 6.1.1 supports it.)
- The s16 PCM cache hard-clips decoded overs. Decoding the AAC of a hard-limited loud signal (peak 0.977 before encoding) gave max |x| = 1.15, with 341 samples above 1.0 in 30 s. Storing as s16 bakes in that clipping, which a later volume cut cannot undo; today's float path can. This is rare for speech but likely for music beds in phase 3. Consider f32 for music, or a few dB of headroom.
- Rule (a), contiguity: the model stores float seconds, and the plan rounds seconds×48000 separately for tl0, src0 and len. A split point near a half-sample can make src0_b differ from src0_a+len_a by 1, so a seamless split gets a crossfade and the 'split equals unsplit bit for bit' test fails. Snap 'at' to a sample (or video-frame) grid in splitClip, or accept a ±1-frame tolerance.
- All speeds come from a 4-vCPU Xeon with AVX-512 and ffmpeg 7.0.2. The Windows binary is '6.1.1-essentials_build-www.gyan.dev' (https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/win32-x64.README). That build enables every filter used: afftdn, arnndn, deesser, acompressor, alimiter, ebur128, loudnorm, atrim, aresample, amix, adelay. The '2-4x slower on budget laptops' figure is unmeasured, and import I/O on large video containers was not measured.
- get_audio_analysis size estimate: for long videos, ranges such as '1234.56-1235.10:0.9,' take 16-20 bytes, not 12, so roughly 300 ranges fit in 6 KB rather than 400. The 'more' cursor will be used more often.
- DeepFilterNet tier: the paper reports a real-time factor of 0.19 on a single-threaded notebook CPU (https://arxiv.org/abs/2305.08227), about 5x realtime; the abstract does not name the '2017' CPU. Code and weights are dual-licensed MIT/Apache-2.0, and prebuilt deep-filter binaries exist on GitHub releases. Windows binary size and runtime dependencies are still unverified.
