> Pesquisa feita em 18–19/11/2026 para o bloco 1 (áudio e legendas) do Diretor. O texto da pesquisa está em inglês. Caminhos como `/tmp/claude-0/...` apontam para testes locais daquela sessão, que não foram guardados; as conclusões e números estão aqui.

> Ainda não passou pela checagem independente; ela fica para o bloco 2 (cor e transições).

# Color correction in the shared Canvas 2D compositor (preview + export) of an Electron 45 / Chromium 156 video editor

## Summary
Electron 45 (released 21 Oct 2026) ships Chromium 156. All four routes are technically possible, but only a WebGL2 shader pass run on each clip gives the CapCut-like feature set with identical results in preview and export. Canvas 2D ctx.filter works on OffscreenCanvas (Chrome 69+) and keeps WYSIWYG, but it only offers brightness, contrast, saturate, hue-rotate, sepia and grayscale. That math runs on gamma-encoded sRGB, and Chromium uses exactly the spec matrices. It has no temperature/tint, highlights/shadows, per-hue HSL, curves or LUTs. Chromium also skips SVG url() filters on OffscreenCanvas, and CanvasFilter objects are still experimental, so ctx.filter is only a fallback. The recommended design adds an optional colorize hook to renderFrame. For clips that have color settings, the hook uploads the current video frame to a WebGL2 texture (texImage2D has a GPU-to-GPU fast path for SDR video) and runs one fragment shader: white balance and exposure in linear light, tone LUTs, OKLCh saturation/vibrance/8-band HSL, an optional .cube 3D LUT, vignette, sharpen and dither. It then calls drawImage synchronously into the existing 2D context; ungraded clips keep today's code path unchanged. Chromium 141+ removed the SwiftShader WebGL fallback, but on Windows WARP (on by default) runs WebGL in software, so color still works on GPU-less or blocklisted laptops, just more slowly. WebGPU has no default software fallback (its SwiftShader adapter needs --enable-unsafe-webgpu), so it is left for later compute work such as scopes. Color done only in ffmpeg at export breaks WYSIWYG and uses different math (eq works on YUV luma; huesaturation has 6 ranges, not 8). It also cannot grade a clip apart from the titles, because ffmpeg receives already-composited RGBA; ffmpeg stays useful for HDR-to-SDR proxies and as a test oracle. Chromium decodes BT.709 video to R'G'B' and deliberately uses the sRGB transfer function for BT.709/601 and BT.2020 SDR. It assumes BT.709 limited range for untagged files, and the export's swscale RGB-to-BT.709 tv-range conversion is the matching inverse, so neutral grades round-trip; exposure, white balance and vignette must still be computed in linear light while compositing stays in gamma space. iPhone HDR (Dolby Vision/HLG, HEVC 10-bit) is tone-mapped by Chromium's 2D canvas path. The WebGL fast-path copy, however, keeps the frame in its own BT.2020/HLG RGB space, so HDR and wide-gamut clips must go through a scratch 2D canvas or an ffmpeg SDR proxy. A Node benchmark showed that baking every adjustment into a 33³ LUT is slow in JS (36–50 ms per bake) and inaccurate near gamut edges (up to 11–17/255 for saturation boosts), so per-pixel shader math is preferred. Color parameters become ordinary registered numeric props (−100..100, default 0), so keyframes, validation, drafts, undo and the compact get_context work unchanged. A few macros (setColor, colorLook, copyColor, resetColor, plus setCurve/setLut later) and small frame statistics let the AI grade without seeing pixels.

## Choice
(b) A WebGL2 shader pass on each graded video clip, injected into the shared renderFrame through an optional colorize hook. Parameters are registered numeric props (keyframable, AI-controllable), plus a few macro operations. Canvas 2D ctx.filter is the reduced fallback when WebGL2 cannot be created at all.

## Why
WebGL2 is the only option that covers the requested scope (contrast/saturation/brightness plus temperature/tint, highlights/shadows and boosting or reducing specific colors via 8-band HSL, with curves and .cube LUTs next) with math we control. It runs the same code in preview and export, so WYSIWYG holds. Chromium gives SDR video a GPU-to-GPU texture upload path, and Windows WARP covers machines without a usable GPU, which meets the CPU-only constraint. ctx.filter is too limited: it lacks temperature, HSL, curves and LUTs, and url() filters are skipped on OffscreenCanvas. WebGPU has no default software fallback and adds complexity for no gain in one pass. ffmpeg-only grading breaks WYSIWYG and cannot separate clips from titles. Baking everything into a 3D LUT was slow in JS and inaccurate near the gamut edge in my benchmark, so the math runs per pixel in the shader, and only 1D tone curves and user .cube files are textures. Registering parameters in the existing property registry reuses keyframes, validation, drafts, undo, the Inspector and the economy-mode context, which already emits only non-default values.

## Concrete plan
1) Data model (src/core, pure TS)
- Add color props to PROPS in core/properties.ts with kinds ['video'] and a new field group: 'color.basic' | 'color.hsl', so the Inspector can group them; operations and MCP stay generic. Store them sparsely: an absent prop means the default (evalProp already falls back to the default when props[name] is undefined). parseProject must treat them as optional instead of materializing all of them.
- BASIC props (all keyframable, integer sliders, default 0; constants are starting values to tune against CapCut):
  exposure −100..100 (Exposição): lin *= 2^(v/50), i.e. ±2 EV in linear light.
  brightness −100..100 (Brilho): per-channel midtone gamma on encoded values, e' = e^(2^(−0.6·v/100)); black and white points stay fixed.
  contrast −100..100 (Contraste): per channel, a monotone cubic Hermite S-curve through (0,0), (0.4614,0.4614) and (1,1), where 0.4614 is the sRGB encoding of 18% grey. Slope at the pivot k = 2^(v/100), end slopes 1/k. Exact identity at 0.
  highlights −100..100 (Realces) and shadows −100..100 (Sombras): luminance-based gain. Compute Ylin = dot(lin, 0.2126/0.7152/0.0722) and Ye = OETF(Ylin). Ye' = Ye + 0.25·(v/100)·w(Ye)·(v>0 ? 1−Ye : Ye), with w = smoothstep(0.4,1,Ye) for highlights and (1−smoothstep(0,0.6,Ye))·smoothstep(0,0.06,Ye) for shadows. Apply as lin *= EOTF(Ye')/max(Ylin,1e-4), with the gain capped at 8 and monotonicity enforced.
  saturation −100..100 (Saturação): OKLCh C ×= (1+v/100); −100 gives black and white.
  vibrance −100..100 (Vivacidade, label to confirm): C ×= 1 + (v/100)·(1−smoothstep(0,0.25,C))·(1−0.5·skin(h)), where skin(h) is a raised-cosine bump over OKLCh hue 40–80°.
  temperature −100..100 (Temperatura) and tint −100..100 (Tonalidade, green to magenta): one 3×3 white-balance matrix in linear sRGB. Use CAT02 von Kries adaptation from a source white on the CIE daylight locus at T = 6504·2^(0.6·temp/100) K, with y offset +0.02·tint/100, to the locus point at 6504 K (so 0/0 is exactly the identity), then normalize so white keeps luminance 1. At ±100 white becomes (1.17,0.98,0.70) or (0.69,1.03,1.66); consider a smaller factor on the cool side.
  fade 0..100 (Desbotar): e' = mix(e, 0.08+0.84·e, v/100).
  vignette −100..100 (Vinheta): lin *= 1 + (v/100)·0.85·smoothstep(0.35,1.05,d), with d = |uv−0.5|·2/√2 in the clip's own frame; negative values darken the edges.
  sharpen 0..100 (Nitidez): luma unsharp mask with 4 neighbours at ±1 output pixel: e += 1.2·(v/100)·clamp(Ye−mean4, −0.08, 0.08).
- HSL props: hsl.<band>.hue, hsl.<band>.sat, hsl.<band>.lum, each −100..100, default 0, keyframable (keyframe UI hidden by default). Bands with pt-BR labels: red Vermelho, orange Laranja (skin), yellow Amarelo, green Verde, cyan Ciano, blue Azul (sky), purple Roxo, magenta Magenta. Centres in OKLCh hue: 29, 53, 110, 142, 195, 264, 294, 328 degrees. Raised-cosine windows between neighbouring centres give weights that sum to 1. Let cw = smoothstep(0.02,0.08,C) to protect greys. Hue: h += 30°·(v/100)·w·cw. Sat: C ×= 1+(v/100)·w. Lum: L += 0.15·(v/100)·w·cw. Then map back into gamut by bisecting chroma at constant L and h (5 steps) and clamp.
- v1.1: clip.color = { curves?: { master|r|g|b: [[x,y],...] with 2–8 points in 0..255, x strictly increasing }, lutId?: string }, plus a keyframable prop lutAmount 0..100 (default 100), plus project.luts: [{id, path, name, size}]. LUT files are user-imported .cube, referenced by path and never modified. Add a grain prop 0..100 with a deterministic hash seeded by pixel and frame index.
2) Operations (core/operations.ts; validated like today and always shown as drafts)
- Single values need no new op: setProperty, setKeyframe, clearKeyframes, retimeGroup and animate accept the new prop names.
- Macros that expand to setProperty, like 'animate' does:
  setColor {clipId | clipIds: 'all' | string[], set: {prop: value, ...}, relative?: boolean}. Values are clamped to the PROPS range; relative adds to the current value, for requests like 'um pouco mais quente'.
  colorLook {clipId | clipIds, look: 'quente' | 'frio' | 'vibrante' | 'cinema' | 'pb' | 'vintage' | 'noite', amount?: 0..100}. Example values at amount 100: quente = temperature +25, tint +5, vibrance +10; cinema = contrast +15, highlights −15, shadows +10, hsl.orange.sat +10, hsl.blue.hue −20, fade +10; pb = saturation −100, contrast +20.
  copyColor {fromClipId, toClipIds: 'all' | string[], parts?: [...]}, which implements 'Aplicar a todos'.
  resetColor {clipId | clipIds, part?: 'basic' | 'hsl' | 'curves' | 'lut' | 'all'}.
- v1.1 structured ops: setCurve {clipId, channel, points | null}; setLut {clipId, lutId | null}. addLut is USER_ONLY, like addMedia. autoColor is a UI-only macro computed in the renderer from pixels (gray-world white balance on low-chroma midtones, median-luma exposure, p2/p98 contrast, all capped at ±40); the AI uses colorStats instead.
- Example: {op:'setColor', clipId:'clp_1', set:{exposure:12, contrast:15, temperature:-8, 'hsl.orange.sat':-10, 'hsl.blue.sat':20}} is about 120 bytes.
3) Render hook (core/render.ts stays platform-free and testable)
- Add RenderOptions.colorize?: (clip, frame, t, outW, outH) => CanvasImageSource | null.
- Decide hasColor(clip) once per clip, not per frame: true if any color prop is non-default or keyframed, or curves or a LUT are set. This avoids a path switch in the middle of a clip. If true, draw the returned image with the same videoRect and globalAlpha; otherwise call drawImage(video) exactly as today.
4) ColorEngine (src/renderer/colorEngine.ts, shared by Preview.tsx and exporter.ts)
- Context: new OffscreenCanvas(W,H).getContext('webgl2', {alpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false, powerPreference:'default'}). Handle webglcontextlost and webglcontextrestored.
- Upload, SDR BT.709/601 sources: gl.texImage2D(TEXTURE_2D, 0, RGBA8, RGBA, UNSIGNED_BYTE, video) every frame. Use texImage2D, not texSubImage2D, keep the default unpack settings and flip v in the shader; these are the conditions for Chromium's GPU-copy fast path.
- Upload, HDR or wide-gamut sources (probe shows arib-std-b67, smpte2084 or bt2020): drawImage(video) into a scratch GPU 2D OffscreenCanvas (without willReadFrequently), where Chromium tone-maps, then texImage2D(scratchCanvas).
- Output size: min(source size, ceil(on-canvas rect)) per axis, rendered into a viewport of a drawing buffer that is only resized when it must grow. Use CLAMP_TO_EDGE and LINEAR; call generateMipmap and use LINEAR_MIPMAP_LINEAR when the source is at least 2× the output.
- One fragment shader with highp floats, in this order:
  (a) sample, with optional sharpen;
  (b) exact piecewise sRGB EOTF;
  (c) white-balance matrix × 2^EV;
  (d) highlights/shadows gain from a 1024×1 R16F LUT indexed by encoded luma;
  (e) OETF;
  (f) per-channel tone LUT, 1024×1 RGBA16F, equal to curve_c ∘ curve_master ∘ fade ∘ contrast ∘ brightness, sampled at (x·(N−1)+0.5)/N;
  (g) OKLab saturation, vibrance and HSL, then gamut map;
  (h) optional .cube as a TEXTURE_3D RGB16F (N ≤ 65, LINEAR, coordinate (c·(N−1)+0.5)/N; the .cube order with red fastest maps directly to texImage3D x), mixed by lutAmount; parse DOMAIN_MIN/MAX and reject 1D LUTs in v1.1;
  (i) vignette in linear light;
  (j) TPDF dither of ±1 LSB seeded by pixel position, which is deterministic and therefore identical in preview and export.
- Draw: right after drawing, still inside renderFrame, call ctx.drawImage(glCanvas, sx, sy, ow, oh, r.x, r.y, r.w, r.h) or transferToImageBitmap(). The WebGL spec allows this with preserveDrawingBuffer:false.
- CPU work each frame: evalClipProp for every color prop; rebuild the white-balance matrix and the 1D LUTs only when the value tuple changes (microseconds).
5) Capability detection and fallback
- At startup, try OffscreenCanvas(1,1).getContext('webgl2'). Log app.getGPUFeatureStatus().webgl2 and the unmasked renderer string.
- If the renderer is WARP or 'Microsoft Basic Render Driver', grade the preview at ≤960 px wide (export stays at full size) and show a pt-BR performance hint.
- If WebGL2 is missing, use the ctx.filter subset in both preview and export (see fallback) and disable the other sliders with a notice.
- If the context is lost during export, abort with a clear message. Never export ungraded frames silently.
6) HDR and wide gamut
- Extend parseFfmpegProbe to capture bit depth, range, matrix, primaries and transfer from the stream line (e.g. 'yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67)') and Dolby Vision side data. Store it as MediaItem.color = {transfer, primaries, hdr}.
- Route HDR clips through the scratch-canvas upload above.
- If Chromium cannot decode the file (no HEVC Main10 hardware), or the look is unacceptable, offer an SDR proxy built with ffmpeg: 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p' + libx264 crf 16, scaled to at most the project size. Tune npl (100 vs 203) against Chromium's own look. Audio keeps coming from the original.
7) Export
- Keep today's RGB-to-YUV step (scale=out_color_matrix=bt709:out_range=tv, tags bt709/tv); it is the inverse of Chromium's decode.
- Optional: add flags=accurate_rnd+full_chroma_int to that scale filter, and x264 aq-mode=3 for dark gradients. Check both with gradient test clips.
8) UI (same single screen)
- A 'Cor' section in the Inspector for the selected video clip:
  Básico: sliders, each with a keyframe toggle;
  Cores (HSL): 8 colour chips plus Matiz, Saturação and Luminância sliders;
  Looks: thumbnail grid;
  buttons: Automático, Aplicar a todos, Redefinir;
  hold-to-compare (antes/depois), which matters most for AI drafts.
- v1.1 adds Curvas and LUT.
9) AI context and tool docs
- compactClip already emits only non-default props in economy mode, so a graded clip costs about 60–150 bytes.
- Add include:['color'] to get_context, returning colorStats for each selected clip (≈120 bytes). Compute them from a 96×54 sample at the playhead, both before and after the grade: luma p2/p50/p98, % clipped at the low and high end, colour cast expressed as suggested temperature/tint, mean chroma, and skin share (OKLCh h 40–80°).
- Document the prop names, ranges, band names and recipes in the propose_edit description (≈700 bytes). Example recipe: 'pele bonita' = hsl.orange.sat −10, hsl.orange.lum +10, temperature +5.
10) Tests
- vitest on the TS reference of the color math:
  exact identity at defaults;
  monotone tone LUTs;
  white-balance matrix is the identity at 0;
  HSL weights sum to 1;
  .cube parser (DOMAIN lines, comments, size limits);
  op validation and macro expansion;
  compact context contains only non-defaults.
- e2e:
  the current e2e launches Electron with --disable-gpu, so add --enable-unsafe-swiftshader (tests only);
  compare preview pixels with the TS reference (±2/255, or ±1 more with dither);
  compare decoded MP4 frames with the preview (±3/255 on flat patches);
  check that a clip graded at neutral matches an ungraded clip, to catch upload-path changes on every Electron update;
  include a small 10-bit HLG test clip encoded with x265 and HLG tags.
11) Phasing
- v1: basic sliders + HSL + looks + copy/reset + AI ops and stats + capability fallback + HDR routing.
- v1.1: curves, .cube LUT with amount, grain, whites/blacks, SDR proxy.
- v2: colour wheels as ASC CDL (slope/offset/power), adjustment-layer clips, local highlights/shadows from a blurred luminance texture, scopes, and masks (a segmentation alpha texture in the same pass).
- Rough size: v1 is about 1.5–3 engineer-weeks (estimate).

## Risks
- HDR/BT.2020 clips: from reading the code, the WebGL fast-path upload keeps BT.2020/HLG/PQ RGB without the tone mapping Chromium's 2D drawImage applies, so graded and ungraded HDR clips would differ. Route them via a scratch 2D canvas or an SDR proxy, and verify on Windows with a real iPhone HLG clip
- Software rendering (WARP) on laptops without a usable GPU or with blocklisted drivers: preview with grading may stutter at 1080p (estimate). Reduce the preview grading resolution; export output is identical, it just takes longer
- WebGL context loss (driver reset, sleep/resume) during preview or export: handle restore, and abort export with an explanation instead of writing ungraded frames
- Drift between the GLSL shader and the TS reference, and between Electron/Chromium versions (video upload and tone-mapping internals change): keep pixel-parity e2e tests and run them on every Electron update
- Banding or posterization with strong grades in an 8-bit pipeline (8-bit source, RGBA8 canvas, 4:2:0 tv-range H.264): dither, moderate ranges and gradient tests; consider 10-bit export later (float16 canvas is now 'stable' in Chromium's runtime features list)
- The look and slider feel may not match CapCut, which publishes no ranges: tune constants side by side on typical phone footage and keep all mappings in one TS module
- Context budget: many keyframed color props in a selection can exceed the ~6 KB economy ceiling; emit only non-defaults and send colorStats only on request
- On dual-GPU laptops, powerPreference 'high-performance' might cause cross-adapter copies; keep 'default' (unverified)
- GPU driver 'video enhancement' features may alter decoded colors on some machines (low confidence); preview and export are affected equally, but the output may look different from other players
- Linux CI: --disable-gpu leaves no WebGL since the SwiftShader fallback was removed; use the unsafe SwiftShader switch only in tests, never in production

## Fallback
If WebGL2 cannot be created at all (no hardware WebGL and no WARP), render a reduced set with Canvas 2D ctx.filter in both preview and export so they still match: exposure becomes brightness(2^(v/50)), contrast becomes contrast(2^(v/100)), saturation becomes saturate(1+v/100). Temperature/tint, HSL, curves, LUT, vignette and sharpen are disabled, with a pt-BR notice ('cores simplificadas neste computador'), and their stored values are kept so the project renders fully on capable machines. If the product cannot accept simplified colors, block export of graded projects with an explanation instead of silently exporting different colors. WebGPU can later be added as an optional accelerator with the same math in WGSL, but never as the only path.

## User-facing constraints
- Nothing to download: color correction is built into the app, works offline and uses no paid service.
- Works on any Windows 10/11 laptop. On computers without working graphics drivers (or very old graphics), Windows' software renderer takes over: the preview with color may stutter and export takes longer, but the exported colors are the same.
- Color is applied per clip, as in CapCut; use 'Aplicar a todos' to copy a look to every clip.
- iPhone HDR videos (Dolby Vision/HLG) may need a one-time preparation (possibly as long as the video or longer for 4K, estimate). The exported video is standard SDR, so colors can differ slightly from the iPhone's Photos app.
- Very strong adjustments (high contrast or saturation, brightening dark skies) can show banding ('degraus') or noise because phone video is 8-bit; moderate values look best.
- Colors look different on other screens: wide-gamut laptop screens look more saturated, and Apple players show BT.709 video slightly lighter (they use a 1.96 gamma). This is not an export error.
- The AI does not see the image by default. It uses numeric measurements of brightness and color, and each color change it proposes appears as a draft you can compare (antes/depois), adjust or discard.
- LUT files (planned for v1.1) are .cube only; LUTs made for 'Log' cameras look wrong on normal phone video.
- Expected performance cost: a few milliseconds per frame for a graded clip on typical laptops (estimate), with no noticeable change in export time.

## Product questions
- Is color per clip enough for v1, or is a global 'ajuste para o vídeo todo' (adjustment layer) needed from the start?
- Slider scale and names: is −100..100 acceptable (CapCut publishes no ranges)? Confirm pt-BR labels, e.g. 'Tonalidade' vs 'Matiz' for Tint, 'Vivacidade' vs 'Vibração' for Vibrance, 'Realces' for Highlights.
- Do curves and .cube LUT import need to be in v1, or can they wait for v1.1 (v1 = basic sliders + 8-color HSL + looks)?
- iPhone HDR clips: convert automatically to an SDR proxy on import (extra time and disk space, most robust), or rely on Chromium's tone mapping with a notice?
- May the AI request a small thumbnail image of the frame for color decisions (costs tokens and context), or should it rely only on numeric color statistics?
- Which looks/presets should ship, and with which names for Brazilian creators (Quente, Frio, Vibrante, Cinema, P&B, Vintage, Noite...)?
- Should 'Automático' analyze only the frame under the playhead or several frames across the clip?
- Should every color slider show keyframe controls in the UI, or only behind an 'Animar' toggle (the AI can always keyframe)?
- Before/after compare: a hold-to-compare button, a split view, or both?
- If a computer has no WebGL2 at all, should export of graded projects be blocked, or allowed with simplified colors after a warning?
