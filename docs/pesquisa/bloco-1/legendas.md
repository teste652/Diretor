> Pesquisa feita em 18–19/11/2026 para o bloco 1 (áudio e legendas) do Diretor. O texto da pesquisa está em inglês. Caminhos como `/tmp/claude-0/...` apontam para testes locais daquela sessão, que não foram guardados; as conclusões e números estão aqui.

# captions-style: CapCut-like caption styling and word-level animation in the shared Canvas 2D compositor (renderFrame), with fonts, readability/safe zones, data model, presets and AI ops (Electron 45.3.4 / Chromium 156)

## Summary

The tools converge on one caption vocabulary. It is a heavy sans (Montserrat/Anton or a Proxima-like face), often uppercase, with a thick black outline or a box and a soft shadow. Pages are 1-3 words, the spoken word is highlighted (colour, a box behind it, or a slight enlargement), pages pop in, and the AI adds keyword emphasis and emoji. CapCut (Highlight keywords, caption templates), Captions.ai (active-word colour/background, border, split words, AI emphasis) and Submagic (42 templates incl. Hormozi/Beast) all ship this. DaVinci Resolve 20 has a 'Word Highlight' animated-subtitle preset. Premiere only gained single-word captions in 26.3 (June 2026), still without a word highlight. All of it fits the existing renderFrame. A spike in the app's own Electron 45.3.4 (Chromium 156.0.8078.100) found these text APIs on both the HTML and Offscreen 2D contexts: letterSpacing, wordSpacing, fontKerning, textRendering, lang, roundRect and fontBoundingBox metrics. Word x-positions from measured word and space widths were exact. Captions added at most ~0.1 ms per 1080x1920 export frame against a 6.35 ms baseline. A 0.3 em blur added +1 ms and a fade layer +2 ms. Every typical failure was reproduced: miter spikes on accents (É, Ã); overlapping contours in Google variable fonts (Montserrat/Inter/Roboto/TikTok Sans, including ç é ê ã K M) that show as inner lines in hollow or semi-transparent text; a dark rim when stroke+fill is drawn at alpha < 1; neighbouring strokes covering fills; and fallback (serif) glyphs while a FontFace is still loading. Each has a cheap fix: round joins; two passes (all strokes with the shadow, then all fills); lineWidth = 2x the visible outline; the active word drawn last; a pooled layer for fades; and awaiting document.fonts.load before export. document.fonts.check() cannot detect missing fonts: it returns true for nonexistent families (MDN, spike). Bundle about 10 OFL/Apache Google fonts as Latin WOFF2 subsets (~0.32 MB). All cover pt-BR accents and none declares a Reserved Font Name. Do not bundle The Bold Font or Komika Axis (contradictory licences) or Proxima Nova (commercial). window.queryLocalFonts works in Electron 45 without a gesture. Its 'local-fonts' permission goes only through setPermissionCheckHandler, and a denial returns an empty list silently. Safe zones at 1080x1920 put the default block centre at y≈58% with max width ≈64% on vertical video. 16:9 subtitles anchor at the bottom at 90% height with 68% width. Recommended model: a relative-unit CaptionStyle (size as % of frame height; em-based stroke/shadow/box; % position) plus CaptionClip.words [{t,s,e,c?,k?}] relative to the clip. It comes with 6 pt-BR presets and 4 compact AI ops that expand into existing validated ops.

## Options

### A. Native Canvas 2D word-layout captions inside renderFrame (recommended)

**How.** A pure layout step measures each word (measureText width plus measured space), wraps greedily within maxWidth and is cached by style, text, frame size and font epoch. drawCaption then runs per frame in this order: box (block or per line), box behind the active word, pass 1 strokeText for all words (lineJoin/lineCap 'round', lineWidth = 2 x visible outline, shadow only in this pass), pass 2 fillText with per-word colours, and finally the active or popping word with its own transform. When opacity < 1 everything goes into a pooled OffscreenCanvas layer composited with globalAlpha. Bundled WOFF2 fonts are registered with FontFace and awaited with document.fonts.load before export.

**Pros**

- One function for preview and export: WYSIWYG by construction, matching the project's rule
- Measured cost is negligible: <=~0.1 ms per 1080x1920 export frame for 3-16 words with outline, box and shadow; +2 ms only while fading
- Covers every style seen in CapCut, Captions.ai and Submagic: outline, shadow, box, uppercase, letter spacing, active-word colour/box/scale, progressive karaoke, keyword emphasis, emoji
- No new dependency; every API used exists on CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D in Chromium 156

**Cons**

- Font loading must be gated explicitly; an unloaded FontFace renders with the fallback silently
- Needs the two-pass, round-join and layer techniques to avoid spikes, overlap lines and alpha rims
- GPU-accelerated preview vs CPU export (willReadFrequently) may differ by sub-pixel antialiasing on real Windows GPUs (not testable in the sandbox)
- No hyphenation or complex-script shaping beyond what Chromium does (not needed for pt-BR)

**License.** Own code; bundled fonts OFL-1.1 / Apache-2.0

**Footprint.** About 600-900 lines of TypeScript (types, presets, layout, draw, animation, ops); fonts ≈0.32 MB WOFF2 (≈0.49 MB with TikTok Sans)

**Performance.** Spike (Electron 45.3.4, software canvas, 4 vCPU Xeon), export path at 1080x1920 with full getImageData per frame. Baseline 6.35 ms. 3/8/16 words with stroke+fill, box or 0.08 em blur: 5.7-6.5 ms (within noise). 0.3 em blur: 7.33 ms. Alpha layer: 8.42 ms. Layout recomputed every frame: 7.11 ms mean, 92.7 ms worst (so cache it). Preview-like HTMLCanvas: 0.80 ms -> 1.19 ms (karaoke) / 1.34 ms (with blur).

**Maturity.** Long-shipped Canvas text APIs; letterSpacing is Baseline 2025; all verified present in Chromium 156.0.8078.100

**Sources**

- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing
- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineJoin
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors
- https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load
- /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json
- /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/perf.json
- /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/artifacts.png

### B. Pre-rendered caption sprites (ImageBitmap per page/word) composited per frame

**How.** The same drawCaption renders each page, and each word that animates, once into an OffscreenCanvas/ImageBitmap at the largest scale it will reach. Each frame then only calls drawImage with a transform and alpha.

**Pros**

- Constant per-frame cost
- Fades have no stroke rim, because the sprite is already flattened
- Still a single renderer, because the sprites come from the same code

**Cons**

- Cache invalidation on every style, text, font or canvas-size change, and extra memory
- Sprites blur when scaled above 1x unless rendered at the maximum scale
- Brings no benefit at the measured cost; adds complexity

**License.** Own code

**Footprint.** +150-250 lines; a few MB of bitmaps for visible pages

**Performance.** drawImage of small sprites costs microseconds; a re-render on change costs about one layout plus one draw (<1 ms)

**Maturity.** Standard technique (MDN: pre-render similar primitives on an offscreen canvas)

**Sources**

- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

### C. ASS/libass karaoke subtitles (ffmpeg 'subtitles' filter in export + libass-WASM in preview)

**How.** Serialize captions to ASS using karaoke k-tags, bord, shad, fad and t transform tags. The export burns them in with ffmpeg -vf subtitles; the preview uses a WASM libass port in a worker.

**Pros**

- Mature subtitle format with built-in karaoke timing
- Export text rendering is independent of the app

**Cons**

- Two different renderers (libass and Canvas) break the preview==export rule
- Fonts resolve through fontconfig on Windows; word pop and box-behind-word need heavy override tags; AI and keyframe integration is awkward
- libass must be confirmed in the Windows ffmpeg-static 6.1.1 build (the Linux 7.0.2 dev build has the 'ass' and 'subtitles' filters)
- Extra WASM worker for preview

**License.** libass ISC; the ffmpeg GPL build is already shipped

**Footprint.** Several MB of WASM plus glue code

**Performance.** Fast in export; preview depends on the WASM worker

**Maturity.** Mature, but misaligned with this architecture

**Sources**

- /home/user/Diretor/node_modules/ffmpeg-static/ffmpeg (-filters lists 'ass' and 'subtitles')

### D. DOM/CSS overlay text in preview + Canvas for export

**How.** Captions are HTML above the preview, using -webkit-text-stroke, paint-order and CSS animations; the export redraws them with Canvas.

**Pros**

- Quick to prototype; CSS has text-stroke and paint-order

**Cons**

- Two layout engines: line breaks, kerning, stroke geometry and animation timing drift between preview and MP4
- Violates the single-renderFrame principle; rejected

**License.** n/a

**Footprint.** Duplicate styling code

**Performance.** Fine in preview; irrelevant to export

**Maturity.** Mature web tech, wrong fit

**Sources**

- /home/user/Diretor/src/core/render.ts (single compositor shared by preview and export)

### E. Fonts: bundled OFL/Apache Google Fonts pack as Latin WOFF2 subsets loaded with FontFace (recommended primary)

**How.** Subset each font with pyftsubset (Google 'latin' unicode-range, all layout features, --flavor=woff2) and ship it in src/renderer/assets/fonts; Vite emits it into dist/renderer/assets inside app.asar. At startup call document.fonts.add(new FontFace(family, url, {weight: range or static weight})). Before export, await document.fonts.load per family/weight with the actual characters, then verify by measurement.

**Pros**

- The same glyphs on every PC, so a project looks identical anywhere
- All candidates cover every pt-BR accent (checked with fontTools)
- Tiny: about 0.32 MB for 10 families
- Works offline from asar via file://; the current CSP (default-src 'self') allowed it in the spike

**Cons**

- OFL/Apache texts and copyright lines must be shipped (licences screen)
- Variable fonts keep overlapping contours: fine with stroke-then-fill, but hollow styles need a destination-out layer or an overlap-free static instance
- Lacks the exact 'viral' fonts (The Bold Font, Komika Axis, Proxima Nova); look-alikes only

**License.** OFL-1.1: Montserrat, Poppins, Inter, Roboto, Anton, Bebas Neue, Oswald, Archivo Black, Bangers, Lilita One, Titan One, League Spartan, TikTok Sans. Apache-2.0: Luckiest Guy. No Reserved Font Names declared.

**Footprint.** Latin WOFF2: Montserrat VF 58.6 KB, Poppins 700/800/900 ~8.5 KB each, Inter VF 105 KB, Anton 22 KB, Bebas Neue 14 KB, Oswald VF 28 KB, Archivo Black 19 KB, Luckiest Guy 17 KB, Bangers 23 KB, Lilita One 10.5 KB, optional TikTok Sans VF 163 KB. An overlap-free static Montserrat 900 is 27 KB.

**Performance.** A local 745 KB TTF loaded in <0.4 s from file:// in the spike; WOFF2 subsets are much smaller

**Maturity.** Licences verified from google/fonts METADATA.pb (main branch)

**Sources**

- https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/apache/luckiestguy/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/tiktoksans/METADATA.pb
- https://openfontlicense.org/how-to-use-ofl-fonts/
- https://www.electronjs.org/docs/latest/tutorial/asar-archives

### F. Fonts: user-installed Windows fonts via the Local Font Access API (optional secondary)

**How.** In main, setPermissionCheckHandler allows 'local-fonts' for the app origin. The renderer calls window.queryLocalFonts() once per session, groups the results by family and lists them under 'Fontes do computador'. Drawing uses the family name in ctx.font; no FontFace is needed. Projects using such fonts are flagged as non-portable.

**Pros**

- Users can use fonts they already own (including paid ones) without the app redistributing them
- No native module; FontData also exposes postscriptName, fullName and style, and blob() gives the file bytes if ever needed

**Cons**

- A project looks different on a PC without the font
- The font's licence is the user's responsibility
- A denied permission fails silently (empty list); MDN marks the API experimental/Chromium-only; Windows per-user font enumeration not tested here

**License.** User's own fonts

**Footprint.** About 100 lines plus the permission handler

**Performance.** Enumerated once per session (108 fonts instantly in the sandbox); drawing by name costs the same as a bundled font

**Maturity.** Verified in Electron 45.3.4: works without a user gesture when permitted; 'local-fonts' is listed in Electron's permission handlers

**Sources**

- https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/tutorial/security
- /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/lfa.json

## Recommendation

**Choice.** Option A (native Canvas 2D word-layout captions inside the existing renderFrame), with fonts from option E (bundled OFL/Apache Latin WOFF2 pack) and option F (installed fonts) as an optional phase-2 addition. The model is a relative-unit CaptionStyle plus clip-relative CaptionClip.words, with 6 pt-BR presets and 4 compact AI ops (setCaptionStyle, setCaptionWords, markWords, regroupCaptions).

**Why.** Captions are frame content, so they must go through the one renderFrame that both preview and export use. The spike in the app's own Electron 45.3.4 (Chromium 156) shows Canvas 2D has every primitive needed on both context types, and that captions cost well under 1 ms per 1080x1920 frame against a 6.35 ms baseline. Sprites, libass or WebGL would add a second code path or complexity for no gain. Every failure that makes home-made captions look amateur was reproduced, and each has a cheap, deterministic fix: miter spikes on accents, inner overlap lines in variable fonts, dark rims while fading, neighbouring strokes over fills, and serif fallback in the first frames. Relative units (size as % of frame height, em-based decorations, % position) make one preset valid for 9:16, 16:9 and 1:1 and survive setCanvas. They also let the AI write {size: 5} without computing pixels. Bundled OFL/Apache fonts with full pt-BR coverage (~0.32 MB) give identical glyphs on every PC. Installed fonts stay optional because they break portability. Per-word timing ({t,s,e,c,k}) relative to the clip is exactly what the STT pipeline already produces (rec-stt) and what karaoke, keyword emphasis and emoji need. The new ops expand into the existing validated updateClip/addClip/removeClip ops, so drafts, per-step accept and undo keep working.

## Concrete plan

0) SCOPE. Captions only: titles keep TextStyle (px) and can adopt stroke/uppercase/letterSpacing later. Fold the schema change into the schema-v2 bump planned in rec-audio-arch.md, as one parseProject migration.

1) TYPES (src/core/captions/types.ts)
- CaptionWord { t: string; s: number; e: number; c?: number; k?: 1|2; br?: true }.
  - t: display token (may be an emoji).
  - s/e: seconds relative to clip start, 3 decimals, sorted, s < e, gaps allowed.
  - c: STT confidence 0..1 (the UI underlines c < 0.6).
  - k: emphasis (1 = keyword, 2 = strong).
  - br: line break after the word.
- CaptionStyle. All lengths are relative. It keeps fontFamily, fontWeight, color and align from TextStyle. It replaces the px fontSize with size, the background string with box, and the boolean shadow with an object.
  - fontFamily: string, one family from the catalog or the installed fonts. Default 'Montserrat'.
  - fontWeight: 100..900, snapped to the weights the family has. Default 800.
  - italic: false.
  - size: % of frame height, 2..15. Default 4.5 portrait, 5 landscape, 4.5 square.
  - uppercase: false; applied at layout time with toLocaleUpperCase('pt-BR').
  - letterSpacing: em, -0.05..0.30. Default 0.
  - lineHeight: multiple of the font size, 0.9..2.0. Default 1.15.
  - align: 'left'|'center'|'right'. Default 'center'.
  - color: fill colour. Default '#FFFFFF'; prefer opaque colours.
  - stroke: {color, width} | null. width is the VISIBLE outline in em, 0.01..0.30. Default {'#000000', 0.08}. Drawn with lineWidth = 2*width*px and lineJoin = lineCap = 'round'.
  - shadow: {color, opacity 0..1, blur 0..0.5 em, dx -0.3..0.3 em, dy -0.3..0.3 em} | null. Default {'#000000', 0.5, 0.06, 0, 0.04}.
  - box: {color, opacity 0..1, padX 0..1 em, padY 0..1 em, radius 0..1 em, mode 'block'|'line'} | null. Default null.
  - position: {x 0..100 % of width, y 0..100 % of height, anchor 'center'|'bottom'}. Defaults: portrait {50, 58, center}, landscape {50, 90, bottom}, square {50, 82, bottom}.
  - maxWidth: % of frame width, 30..100. Defaults: portrait 64, landscape 68, square 80.
  - maxLines: 1..3. Default 2.
  - autoFit: true. Shrinks the font, down to 70%, when a page needs more than maxLines or a word is wider than maxWidth.
  - highlight: {mode 'active'|'progressive', color: string|null, box: {color, padX, padY, radius in em}|null, scale 1..1.4, upcomingColor: string|null} | null. Default null.
  - emphasis: {color, scale 1..1.4} | null. Default {'#FFE600', 1}.
  - animation: {in 'none'|'fade'|'pop'|'slideUp'|'bounce', per 'page'|'word', duration 0.05..0.6 s, reveal: boolean}. Default {'pop', 'page', 0.12, false}.
- CaptionClip v2 { kind: 'caption'; text; words?: CaptionWord[]; style: CaptionStyle; preset: CaptionPresetId | 'custom' }.
  - When words exist, text must equal the tokens joined by spaces (br gives a newline).
  - At most 60 words per clip.
  - props stay {opacity}.
- Migration v1 -> v2 (same look):
  - size = fontSize/H*100; fontWeight = min(fontWeight, 900).
  - background '' -> box null. Otherwise box = {rgb of background, its alpha, padX 0.45, padY 0.2, radius 0.3, 'block'}.
  - shadow true -> {'#000000', 0.55, 0.12, 0, 0.04}.
  - stroke null, lineHeight 1.2, position {50, 90, 'bottom'}, maxWidth 80, maxLines 3, autoFit false.
  - highlight null, emphasis null, animation {'none', 'page', 0.12, false}, preset 'custom'.

2) PRESETS (src/core/captions/presets.ts)
Each preset is a patch over the aspect default. Its paging values are used by STT grouping and by regroupCaptions.
- amarelo 'Amarelo com borda'
  - Style: Montserrat 900, size 4.6, uppercase, lineHeight 1.1, color #FFE600, stroke {#000000, 0.10}, shadow {#000000, 0.55, 0.06, 0, 0.05}, emphasis {#FFFFFF, 1.08}, animation {pop, page, 0.12}.
  - Paging: max 3 words, 18 chars, 2 lines.
- caixa 'Branco com caixa'
  - Style: Montserrat 700, size 4.0, normal case, lineHeight 1.3, color #FFFFFF, stroke null, shadow null, box {#000000, 0.65, 0.35, 0.12, 0.22, line}, emphasis {#FFE600, 1}, animation {fade, page, 0.10}.
  - Paging: 6 words, 32 chars, 2 lines.
- karaoke 'Karaokê'
  - Style: Montserrat 900, size 4.6, uppercase, lineHeight 1.1, color #FFFFFF, stroke {#000000, 0.09}, shadow {#000000, 0.5, 0.05, 0, 0.04}, highlight {active, color #FFE600, box null, scale 1.12, upcomingColor null}, emphasis {#00E676, 1}, animation {pop, page, 0.12}.
  - Paging: 3 words, 18 chars.
- palavraCaixa 'Palavra em destaque'
  - Style: Poppins 800, size 4.4, uppercase, lineHeight 1.15, color #FFFFFF, stroke {#000000, 0.06}, shadow {#000000, 0.45, 0.05, 0, 0.03}, highlight {active, color #FFFFFF, box {#7C3AED, 0.14, 0.06, 0.18}, scale 1.06}, emphasis {#FFE600, 1}, animation {pop, word, 0.10, reveal false}.
  - Paging: 4 words, 22 chars.
- impacto 'Impacto'
  - Style: Anton 400, size 7.0, uppercase, letterSpacing 0.02, lineHeight 1.0, color #FFFFFF, stroke {#000000, 0.08}, shadow {#000000, 0.6, 0.08, 0, 0.05}, emphasis {#FF3B30, 1.1}, animation {pop, page, 0.15}, maxLines 1.
  - Paging: 1 word, 12 chars.
- classico 'Clássico'
  - Style: Inter 600, size 5.0 landscape / 3.2 portrait, normal case, lineHeight 1.2, color #FFFFFF, stroke {#000000, 0.05}, shadow {#000000, 0.6, 0.10, 0, 0.03}, box null, maxLines 2, highlight null, animation {none}.
  - Position: landscape {50, 90, bottom}, portrait {50, 64, bottom}. maxWidth: 68 landscape, 80 portrait.
  - Paging (Netflix pt-BR): 42 chars per line (24 in portrait), 2 lines, at most 17 chars/s, 0.833 to 7 s per page.
- Paging rules shared by all presets:
  - Break on sentence punctuation and on pauses of 0.35 s or more (Shorts styles) or 0.6 s or more (Clássico).
  - Never end a page on a pt-BR function word: a, o, as, os, um, uma, de, da, do, das, dos, em, na, no, nas, nos, e, que, pra, por, com, se.
  - A page runs from first.s to last.e + 0.15 s, capped at the next page's start.

3) FONTS
- Files and catalog
  - Files go in src/renderer/assets/fonts/*.woff2 with licenses/*.txt, taken from google/fonts (main).
  - The catalog is pure data in src/core/captions/fonts.ts. Entries: Montserrat VF 100-900; Poppins 700/800/900 static; Inter VF 100-900; Anton 400; Bebas Neue 400; Oswald VF 200-700; Archivo Black 400; Luckiest Guy 400 (Apache-2.0); Bangers 400; Lilita One 400; optional TikTok Sans VF 300-900. About 0.32 MB in total.
- Build (one-off; commit the outputs). Use fonttools 4.60.1 with brotli:
  - pyftsubset IN.ttf --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' --layout-features='*' --flavor=woff2
  - Optional overlap-free static instance for hollow styles: fonttools varLib.instancer IN.ttf wght=900 --remove-overlaps (needs skia-pathops).
- Registration at renderer startup
  - For each entry: document.fonts.add(new FontFace(family, 'url(' + assetUrl + ')', {weight: '100 900' for variable fonts or the static weight, style: 'normal'})).
  - Declaring the weight range makes the wght axis apply instead of synthetic bold.
  - Vite emits the files into dist/renderer/assets inside app.asar, and file:// reads them from asar.
- Preview
  - Await ensureFonts(project) before the first draw.
  - On document.fonts 'loadingdone': fontEpoch++, clear the layout cache, redraw.
- Export gate (exporter.ts, before the frame loop)
  - Collect the unique (italic, weight, family) used by caption and title clips, plus every character in their texts.
  - Await document.fonts.load(spec at 100px, chars) for all of them.
  - Verify each family by comparing measureText of a sample against the generic fallback. Never use document.fonts.check(); it returns true for missing fonts.
  - If a family is missing, stop with 'A fonte X não está disponível neste computador.'
  - The export already draws on a main-thread OffscreenCanvas, which uses document.fonts. If export ever moves to a Worker, add the FontFaces to self.fonts and finish loading them before the first use of any font string; Chromium 156 kept the fallback for a string resolved earlier.
- Font stack at draw time: the quoted family, then Segoe UI Emoji, Segoe UI Symbol, sans-serif.
- Installed fonts (phase 2)
  - In main.ts, call session.defaultSession.setPermissionCheckHandler and return true for 'local-fonts' only when the origin is the app (file:// or the dev URL). Keep the current policy for every other permission.
  - Electron consults the CHECK handler for this permission; the request handler was never called in the spike. A denial makes queryLocalFonts resolve to [] silently.
  - The renderer calls window.queryLocalFonts() once per session, groups the results by family and lists them under 'Fontes do computador'. It draws by family name.
  - When a project opens and one of its families is missing, show a warning and render with Montserrat instead.
- Licences screen: each font's copyright line plus the full OFL-1.1 or Apache-2.0 text.
- Not shipped: The Bold Font, Komika Axis, Proxima Nova. Offer look-alikes instead: Anton or Bebas Neue, Luckiest Guy or Bangers, and Montserrat 800-900.

4) RENDERER (src/core/captions/layout.ts, draw.ts, anim.ts; render.ts calls drawCaption for caption clips)
- Context setup:
  - px = size/100*H.
  - ctx.font = italic + weight + px + 'px ' + stack.
  - ctx.letterSpacing = (letterSpacing*px) + 'px'.
  - fontKerning 'normal', textRendering 'auto', lang 'pt-BR', textAlign 'left', textBaseline 'alphabetic'.
- Layout. Cached in an LRU Map of 256 entries; key = fontEpoch | WxH | the style's layout fields | tokens.
  - adv_i = measureText(token).width. This includes the trailing letterSpacing.
  - space = measureText(' ').width + max(0, maxScale - 1)*0.5*px.
  - Wrap greedily at maxWidth*W/100, honouring br. Apply autoFit once.
  - asc and desc = fontBoundingBoxAscent and fontBoundingBoxDescent of 'ÁÇÉgjpq'. Chromium 156 does not implement emHeight*.
  - lineH = px*lineHeight; blockH = lineH*(n-1) + asc + desc. Top comes from the anchor; baseline_i = top + asc + i*lineH.
  - lineW = sum(adv) + (k-1)*space - letterSpacing; x comes from align. Each word's centre is cx = x + (adv - letterSpacing)/2.
  - Clamp the block to the frame. Inflate the bbox by stroke + blur + |offset| for layers and hit-testing.
- Per frame. Everything is a pure function of tl = t - clip.start.
  - active = the last word with s <= tl (binary search).
  - spoken = s <= tl.
  - Each word's animation state comes from section 5.
- Draw order:
  - (a) Box: one per block or one per line, with ctx.roundRect.
  - (b) The highlight box behind the active word, scaled with the word.
  - (c) Pass 1: strokeText for every visible word except the top word and emoji tokens. The shadow is set only in this pass; if there is no stroke, it goes on the fill pass instead.
  - (d) Pass 2: fillText per word. Colour, first match wins: active word -> highlight.color; progressive and spoken -> highlight.color; k set -> emphasis.color; not yet spoken and upcomingColor set -> upcomingColor; otherwise color. Emoji tokens (Unicode Extended_Pictographic) are filled only, never stroked.
  - (e) Top word: the active word when highlight scale > 1, or any word mid-pop. Stroke then fill under translate(cx, baseline - 0.35*asc) and scale(s), drawn at (-(adv - letterSpacing)/2, 0.35*asc). Lines never reflow.
- Opacity < 1 (page fade or opacity keyframes) with a stroke, box or shadow: draw (a)-(e) into a pooled OffscreenCanvas the size of the bbox, then drawImage it with globalAlpha. This cost +2.1 ms in the spike. A single word with alpha < 1 uses a small word layer.
- Hollow outline styles (later): stroke into a layer, then use globalCompositeOperation 'destination-out' with fillText to remove the inside. This keeps the overlap lines of variable fonts from ever showing.
- hitTest uses the cached bbox.

5) ANIMATION
All pure functions. No Date.now or Math.random; if jitter is ever added, seed it with hash(clip.id, i).
- u = clamp((tl - t0)/duration, 0, 1), where t0 = 0 for per-page animation and s_i for per-word animation.
- pop: scale = 0.7 + 0.3*easeOutBack(u) with c1 = 1.70158; alpha = min(1, 2u).
- fade: alpha = easeOut(u).
- slideUp: dy = 0.35*px*(1 - easeOut(u)); alpha = easeOut(u).
- bounce: dy = -0.25*px*sin(pi*u)*(1 - u).
- reveal: the word stays hidden while tl < s_i, but its space is still reserved.
- Highlight scale = 1 + (scale - 1)*easeOut(clamp((tl - s_i)/0.08)); it eases back over 0.08 s after the next word starts.

6) OPERATIONS + MCP
Validated like the existing ops. The macros expand into updateClip/addClip/removeClip, so drafts, undo and per-step accept are unchanged.
- {op:'setCaptionStyle', clipIds:'all'|[ids], preset?, patch?}
  - Each caption clip gets style = (the preset for the project's aspect, or its current style) merged with patch. preset becomes 'custom' if patch is given, else the preset id.
  - Unknown keys -> invalid_param. Values out of range -> out_of_range. A fontFamily outside the catalog and the installed list -> invalid_param, listing the bundled families.
- {op:'setCaptionWords', clipId, words:[[t, s, e, k?], ...]}: replaces words and text. Words must be sorted, with 0 <= s < e <= duration, at most 60.
- {op:'markWords', clipId, idx:[...], k:0|1|2}: keyword emphasis.
- {op:'regroupCaptions', clipIds:'all'|[ids], maxWords:1..8, maxLines?:1..3}: macro that re-pages consecutive caption clips by word times.
- addClip(caption) accepts words.
- updateClip set.text re-aligns words by LCS over normalised tokens. Unchanged tokens keep s/e; new tokens share the replaced span in proportion to their characters; c is dropped.
- trimClip, splitClip and removeRanges shift words with the content, like contentShift in remapKeyframes. Words outside [0, duration] are kept but not drawn. A split gives each word to the side that holds its midpoint.
- get_context:
  - A caption appears as {id, kind, start, dur, text, preset}, plus custom:1 when its style differs from the preset.
  - With economy mode off, add a dedup table captionStyles {A:{...}} and st:'A' on each clip.
  - Words are sent only with include:['words'] or for selected clips, as w:[[t, s, e, c, k]]: 15-20 bytes per word, about 3 KB per minute of speech.
  - status lists the caption presets and font families.
  - Add pt-BR OPS_HELP lines with the ranges.

7) UI (pt-BR, same screen)
- Inspector 'Legenda' panel:
  - Preset gallery, with thumbnails drawn by drawCaption.
  - Controls: Fonte, Tamanho (%), Cor, Borda, Sombra, Caixa, MAIÚSCULAS, Espaçamento.
  - Posição: Centro / Abaixo do centro / Embaixo, plus dragging in the preview.
  - Destaque da palavra (cor, caixa, aumentar) and Animação.
  - 'Aplicar a todas as legendas', on by default.
- Preview toggle 'Áreas do TikTok/Reels/Shorts'. It is an overlay only and is never exported.
- Transcript panel: underline low-confidence words; clicking a word marks it as a keyword.

8) TESTS
- vitest:
  - layout with an injected measure function
  - active-word boundaries
  - easing curves
  - the v1 -> v2 migration
  - op validation
  - LCS re-alignment
- Electron e2e under xvfb, as in the spike:
  - Golden hashes per preset at 3 times on both canvas paths.
  - Export frame 0 equals a frame drawn after the fonts have loaded.
  - No stroke pixels inside glyphs while fading.
  - Performance budget: at most 2 ms per frame for captions at 1080x1920.

9) PHASES
- Block 1:
  - sections 1-4
  - section 5 limited to page pop/fade and the highlight (colour, box, scale, progressive)
  - section 6 limited to setCaptionStyle, setCaptionWords and markWords
  - section 7, including the safe-zone overlay
  - section 8
- Later:
  - per-word entrance animations (bounce, slideUp, reveal)
  - regroupCaptions
  - AI emoji insertion
  - installed fonts
  - the hollow outline style
  - SRT/VTT export

## Risks

- Real Windows GPUs may make the GPU-accelerated preview canvas differ from the CPU export canvas (willReadFrequently) by sub-pixel antialiasing. Pixel-identical output was only verified in the GPU-less sandbox. Run golden tests on the export path and keep layout pure, so any difference stays sub-pixel.
- Font timing: an unloaded or missing font silently renders with the fallback (serif in Chromium), and document.fonts.check() reports true for missing fonts. The export gate with measurement checks is mandatory.
- Installed fonts make projects non-portable, and their licences are the user's responsibility. A denied 'local-fonts' permission returns an empty list without an error.
- Variable fonts have overlapping contours in ç, é, ê, ã, K, M and others. Inner lines appear in hollow or semi-transparent text unless a layer, destination-out or an overlap-free static instance is used.
- Word timing from STT is off by about 0.1-0.15 s (Whisper DTW, rec-stt). The highlight may lead or lag, so word edges need refining and a manual nudge.
- Safe-zone numbers are third-party measurements of 2026 platform templates (TikTok publishes files, not numbers). Platform UIs change.
- Emoji use the Windows emoji font, which differs between Windows 10 and 11. strokeText draws an outline around emoji glyphs, so emoji must be skipped in the stroke pass.
- If export moves into a Worker, Chromium 156 keeps the fallback for any font string resolved before its FontFace loaded. Fonts must be fully loaded in self.fonts before first use.
- One caption clip per page means many small clips: more timeline DOM, and the migration must be coordinated with the audio-arch schema v2.
- Large blur radii and fade layers raise per-frame cost, measured at up to +2 ms, still small next to video seek and IPC.

## Fallback

If Canvas text is ever too slow in the GPU preview on very weak laptops, render each page (and each animating word) once into an ImageBitmap with the same drawCaption and composite per frame (option B). There is still only one renderer. If FontFace url() loading from asar fails in some packaging, read the bytes (fetch of file:// worked in the spike, or IPC) and use new FontFace(name, ArrayBuffer). If installed fonts cause support problems, ship only the bundled catalog. If the word highlight is too inaccurate on some recordings, fall back to the page-level 'Amarelo com borda' or 'Branco com caixa' presets, which need only page timing.

## User-facing constraints

- About 10 free fonts are included. They work offline, look the same in the preview and the exported video, and all support Portuguese accents (ã, õ, ç, á, é, ê, í, ó, ô, ú, à).
- Some popular 'viral' fonts are not included: The Bold Font and Komika Axis because their licences are unclear, and Proxima Nova because it is paid. Similar free fonts are offered instead (Anton/Bebas Neue, Luckiest Guy/Bangers, Montserrat Black).
- Fonts installed on the user's PC can be used (optional feature). A project that uses one looks different on a computer without that font, and the font's licence is the user's responsibility.
- The highlight of the spoken word follows the automatic transcription, which is accurate to about a tenth of a second. It can lag slightly on fast speech; individual words can be retimed or corrected.
- Emoji use Windows' own emoji style, so they look different on Windows 10 and Windows 11. On a given PC, the preview and the export always match.
- The TikTok/Reels/Shorts safe-area guides are approximate (measured from the platforms' 2026 templates) and may change when the apps change their layout.
- Captions are burned into the video. A separate subtitle file (SRT/VTT) is not part of block 1.
- Switching the format (vertical/horizontal/square) keeps captions proportional, and presets move to the right position for that format automatically.
- Very long words or pages are shrunk automatically (down to 70%) to fit the chosen number of lines; there is no hyphenation.

## Product questions

- Default look for vertical videos: 'Karaokê' (white text, spoken word in yellow and slightly bigger) or the static 'Amarelo com borda'? And should Shorts-style presets be UPPERCASE by default?
- Should 'Aplicar a todas as legendas' be ON by default (CapCut behaviour), with per-caption styling only as an explicit choice?
- Should fonts installed on the user's PC appear in the font picker (portability and licence risk), or only the bundled fonts?
- May the AI choose keywords to emphasise and insert emoji automatically (Submagic-style), or only when the user asks?
- Which safe zone should the preview show by default: TikTok, Reels, Shorts, or the intersection of all three (the most conservative)?
- Are per-word entrance animations (bounce/slide/word-by-word reveal) needed in block 1, or are page pop plus the word highlight enough?
- Should an SRT/VTT subtitle file be exported next to the MP4 (YouTube upload, accessibility)?
- Include TikTok Sans (OFL, +163 KB) for a 'native TikTok' look? Preset names should avoid platform trademarks: is that acceptable?
- Default caption grouping for vertical videos: max 3 words per page (CapCut-like) or up to 4-6 words over 2 lines (Hormozi-style)?

## Claims and sources

- Electron 45.3.4 (the version in package.json/node_modules) ships Chromium 156.0.8078.100 (process.versions.chrome) and Node 24.22.3. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/main.cjs (spike log))*
- In Chromium 156, both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D expose letterSpacing, wordSpacing, fontKerning, textRendering, fontStretch, fontVariantCaps, direction, lang, filter, roundRect and reset. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json)*
- Chromium 156 TextMetrics provides actualBoundingBox* and fontBoundingBoxAscent/Descent plus baselines, but NOT emHeightAscent/emHeightDescent, getSelectionRects, getActualBoundingBox or getIndexFromOffset. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json)*
- Canvas letterSpacing is added after every character including the last ('ABC' at 100px Anton: 143.8 -> 173.8 px with 10px), and measureText includes it; '0.1em' resolved to 10px at 100px. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json)*
- Per-word x positions computed as the sum of measured word widths plus the measured space width matched measureText of the line prefixes exactly (0 px error, Montserrat 900, kerning on); fontKerning 'none' widened the test string from 969.7 to 996.7 px. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json)*
- A FontFace added to document.fonts but not yet loaded is not used by canvas: the first measure/draw uses the fallback font and only triggers the load (status unloaded -> loading); the correct font appears in later draws. Fonts must be awaited (document.fonts.load) before export frames are rendered. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font; https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load)*
- document.fonts.check() returns true for nonexistent and system fonts, so it cannot detect a missing font; verification must compare measured widths against the fallback, or use the local font list. *(confidence high, load-bearing; source: https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check; /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json (checkMissing: true))*
- An OffscreenCanvas created on the renderer main thread (as exporter.ts does) uses fonts registered in document.fonts. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json (mainThreadOffscreenSeesDocFonts: true); /home/user/Diretor/src/renderer/exporter.ts)*
- An OffscreenCanvas in a Worker does not see document fonts; FontFaces must be added to self.fonts. In Chromium 156 a font string first resolved before its FontFace loaded kept the fallback even after loading (same or new context) until a different font string was used. *(confidence high; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/perf.json (worker2); https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/fonts)*
- lineJoin defaults to 'miter' and miterLimit to 10. Thick strokes then produce visible spikes on sharp corners and accents (É, Ã); lineJoin 'round' removes them. Premiere users hit the same spikes with Miter joins and fix them by switching to Round. *(confidence high, load-bearing; source: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineJoin; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/miterLimit; https://community.adobe.com/questions-729/artifacts-on-text-using-stroke-in-essential-graphics-1413868; /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/artifacts.png)*
- A canvas stroke is centred on the path (half the lineWidth on each side), so with stroke-then-fill the visible outline is lineWidth/2; fill-then-stroke eats into the glyph. *(confidence high, load-bearing; source: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors; /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/artifacts.png)*
- The Google Fonts variable fonts Montserrat, Inter, Roboto and TikTok Sans contain overlapping contours in many glyphs, including pt-BR ç, é, ê, ã and K, M, W, R. The static Poppins Black, Archivo Black, Bebas Neue and Luckiest Guy have none, and Anton has one (ç). A fontTools instancer --remove-overlaps static instance has none. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/tools/overlap.py (fontTools 4.60.1 + skia-pathops))*
- Stroke-only text drawn with a variable font shows inner overlap lines, and stroke+fill drawn at globalAlpha 0.5 shows the inner half of the stroke (and overlapping strokes) through the fill, even with an overlap-free font. Stroke-then-fill at alpha 1 hides both, and rendering into a layer composited with globalAlpha fixes fades. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/artifacts.png; /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/static_vs_vf.png)*
- Drawing word by word (stroke, fill, stroke, fill) lets a word's thick stroke cover the neighbouring word's fill; two passes (all strokes, then all fills) avoid it. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/order.png)*
- Export-path cost (OffscreenCanvas willReadFrequently, 1080x1920, drawImage + full getImageData per frame, sandbox 4 vCPU Xeon, no GPU): baseline 6.35 ms/frame. Adding 3-16 caption words with stroke+fill, a box or a 0.08 em shadow blur stayed within noise (5.7-6.5 ms); a 0.3 em blur gave 7.33 ms; an alpha layer gave 8.42 ms; recomputing layout every frame gave 7.11 ms mean with a 92.7 ms worst case. *(confidence medium, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/perf.json)*
- Preview-like HTMLCanvas (software in the sandbox, raster forced by a 1-px readback): 0.80 ms per frame for the background alone, 1.19 ms with an 8-word karaoke caption, 1.34 ms with a shadow blur. *(confidence medium; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/perf.json)*
- Repeated renders of the same caption frame, and HTMLCanvas vs OffscreenCanvas renders, were pixel-identical in the sandbox (both software). willReadFrequently forces a software canvas, so on real GPUs the preview may differ slightly from the export. *(confidence medium, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)*
- In Electron 45.3.4, window.queryLocalFonts() works without a user gesture when permitted. It returned 108 faces in 27 families plus FontData.blob() bytes. Only setPermissionCheckHandler is consulted, with 'local-fonts'; the request handler was never called. Denying it makes the call resolve to an empty array without an error. With no handler, it is granted. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/lfa.json)*
- Electron documents 'local-fonts' in both setPermissionRequestHandler and setPermissionCheckHandler. By default Electron automatically approves all permission requests unless a custom handler is configured. *(confidence high, load-bearing; source: https://www.electronjs.org/docs/latest/api/session; https://www.electronjs.org/docs/latest/tutorial/security)*
- Installed system fonts can be used in canvas by family name without the Local Font Access permission or a FontFace. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/lfa.json (useLocalByName))*
- MDN: queryLocalFonts needs the 'local-fonts' permission, throws SecurityError if not called from a user interaction (in browsers) and is experimental with limited availability. *(confidence high; source: https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts)*
- Licences in google/fonts METADATA.pb (main branch). OFL: Montserrat (wght 100-900), Poppins, Bebas Neue, Anton, Inter, Roboto (now OFL, variable), Oswald, Archivo Black, TikTok Sans (added 2025-07-09), Bangers, Lilita One, Titan One, League Spartan, Noto Color Emoji. Apache-2.0: Luckiest Guy. *(confidence high, load-bearing; source: https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/METADATA.pb; https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/METADATA.pb; https://raw.githubusercontent.com/google/fonts/main/ofl/tiktoksans/METADATA.pb; https://raw.githubusercontent.com/google/fonts/main/apache/luckiestguy/METADATA.pb)*
- None of the downloaded OFL.txt files (Montserrat, Roboto, TikTok Sans, Anton, Bebas Neue, Poppins, Archivo Black, Oswald, Inter) declares a Reserved Font Name, so subsets or instances may keep the original names. *(confidence medium, load-bearing; source: https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/OFL.txt; https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt)*
- The OFL allows bundling with restrictively licensed (commercial) software if at least the copyright statement, licence notice and licence text are included. Videos and images made with OFL fonts need no licence or acknowledgement. *(confidence high, load-bearing; source: https://openfontlicense.org/how-to-use-ofl-fonts/)*
- All candidate fonts cover every pt-BR accented letter (ãõçáéêíóôúàâü and uppercase) and º ª € curly quotes, dashes and ellipsis. *(confidence high, load-bearing; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/tools/cov.py (fontTools))*
- Latin-subset WOFF2 sizes: Montserrat VF 58.6 KB, Inter VF 105 KB, Roboto VF 84 KB, TikTok Sans VF 163 KB, Oswald VF 28 KB, Anton 22 KB, Bebas Neue 14 KB, Poppins Black 8.4 KB, Archivo Black 19 KB, Luckiest Guy 17 KB, Bangers 23 KB, Lilita One 10.5 KB. An overlap-free static Montserrat 900 is 27 KB. *(confidence high; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/subset/)*
- Noto Color Emoji in google/fonts is a 25 MB COLR+SVG font, too large to bundle. Color emoji render through canvas fillText, and a text family followed by an emoji family in ctx.font works. strokeText on an emoji draws an outline of the glyph. *(confidence medium; source: /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/emoji.png; /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json)*
- The Bold Font's licence is unverifiable: befonts says 'free for personal & commercial use', while font.download says 'Free for Personal Use' with no designer named. It should not be bundled. *(confidence medium, load-bearing; source: https://befonts.com/the-bold-font.html; https://font.download/font/the-bold-font)*
- Komika Axis' licence is unclear: designbeep lists 'Free for personal use' (Vigilante Typeface Corporation), Font Squirrel's licence page blocks automated access, and other Komika families on 1001fonts are listed as free for commercial use with a readme. It should not be bundled. *(confidence low, load-bearing; source: https://designbeep.com/2026/01/11/komika-axis-font/; https://www.1001fonts.com/komika-font.html)*
- CapCut's default caption font is not publicly documented. CapCut's 'Classic' style approximates Proxima Nova (a commercial font), and Montserrat is the closest free match. TikTok Sans was open-sourced under the OFL in July 2025. *(confidence low; source: https://blitzcutai.com/blog/tiktok-fonts-capcut)*
- CapCut's font size is a relative, resolution-independent unit that scales with the canvas (cap height ≈ size x 0.24 px at 1080x1920). *(confidence medium; source: https://www.capcut.com/help/font-units-in-capcut)*
- CapCut desktop/web captions: a Highlight feature that styles keywords; caption templates (Glow, Trending, Aesthetic, Multiline) with 'Style captions with AI'; select all to apply one style; background box, borders or shadow; entrance, exit and emphasis animations. *(confidence medium; source: https://capcut.com/desktop/captions-for-video; https://www.capcut.com/resource/caption-template; https://www.capcut.com/resource/add-captions-with-ai)*
- Captions.ai exposes: text colour, emphasis colour, active-word colour and background, border thickness, shadow, background padding and radius, Split Words (words per line, lines per page), autofit, AI emphasis, emoji (size, timing, position) and randomized rotation. *(confidence high; source: https://captions.ai/help/docs/captions/styles)*
- Captions.ai guidance: units of one word or two to three words perform better on mobile; keep captions above the bottom 20%; highlight the active word by colour, a background box or enlarging it. *(confidence medium, load-bearing; source: https://captions.ai/help/guides/engagement/caption-styles-by-platform)*
- Submagic's API lists 42 templates (including Hormozi 1-5 and Beast; default 'Sara'). Its Hormozi guide: the old style used TheBoldFont uppercase with a shadow and no stroke; the new style uses Anton uppercase, a slight shadow, a yellow stroke and a pop-in; in CapCut at most 4-6 words over 2 lines. *(confidence medium; source: https://docs.submagic.co/api-reference/templates.md; https://www.submagic.co/blog/how-to-make-alex-hormozi-captions)*
- Premiere 26.3 (June 2026) added single-word captions generated from the transcript. Users still asked for a native word highlight through September 2026. *(confidence medium; source: https://community.adobe.com/announcements-727/what-s-new-in-adobe-premiere-26-3-june-2026-1628369; https://community.adobe.com/feature-requests-730/request-for-enhanced-animated-caption-options-and-ai-features-in-premiere-pro-1327436/index7.html)*
- DaVinci Resolve 20 animated subtitles offer the presets Lollipop, Rotate, Slide In, Statement and Word Highlight, with animation speed, font, size, text colour and outline colour adjustable. Beta users reported mis-timed or split words, fixed by beta 3. *(confidence medium; source: https://larryjordan.com/articles/animate-subtitles-in-davinci-resolve-20/; https://forum.blackmagicdesign.com/viewtopic.php?p=1137795)*
- Meta's Edits added a library of text styles (fonts, colours, animations, effects), and per-word font styling in captions in December 2025. The YouTube Shorts editor added auto-generated captions with text styles and colours. *(confidence medium; source: https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/; https://www.inro.social/blog/edits-new-meta-app; https://www.lindseygamble.com/blog/youtube-launches-new-caption-features-for-shorts)*
- TikTok in-feed safe zone at 1080x1920: top 240 px, bottom 660 px, left/right 120 px, plus a right button column about 180 px wide starting around y=840. TikTok publishes template files, not numbers; these were measured from its templates by third parties. *(confidence medium, load-bearing; source: https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads; https://www.manypixels.co/blog/social-media-design/tiktok-ad-specs; https://www.socialync.io/tools/safe-zones/tiktok; https://adkit.so/tools/safe-zones/tiktok)*
- Instagram/Facebook Reels safe zone: top 14% (~269 px at 1920), bottom 35% (~672 px), sides 6% (~65 px), per Meta's Reels ad specs as relayed by third parties. Meta's own help page could not be fetched. *(confidence medium, load-bearing; source: https://www.socialync.io/tools/safe-zones/instagram-reels; https://billo.app/blog/meta-ads-safe-zones)*
- YouTube Shorts at 1080x1920: top 120-290 px, bottom 300-670 px, right 96-190 px, left ~48 px are covered by UI; typical caption size 60-75 px (3.1-3.9% of height). *(confidence low, load-bearing; source: https://blitzcutai.com/blog/best-caption-size-youtube-shorts-2026)*
- EBU R 95 for 16:9: action-safe margin 3.5% and graphics-safe margin 5% on each edge. *(confidence high, load-bearing; source: https://knowledgehub.ebu.ch/publications/r095)*
- BBC subtitle guidelines (relayed by Clevercast): 16:9 captions stay within the central 90% vertically and 75% horizontally, maximum line length 68% of the width, normally at most 2 lines. *(confidence medium, load-bearing; source: https://clevercast.com/bbc-subtitling-guidelines)*
- Netflix pt-BR timed text: 42 characters per line, up to 17 characters per second for adult content, at most two lines, with line-break rules that keep articles and prepositions with their nouns. *(confidence high, load-bearing; source: https://partnerhelp.netflixstudios.com/hc/en-us/articles/215600497-Portuguese-Brazil-Timed-Text-Style-Guide)*
- MDN advises avoiding shadowBlur and text rendering where possible, and pre-rendering repeated drawings on an offscreen canvas. *(confidence high; source: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)*
- Files inside an asar archive can be requested from web pages with the file: protocol. Under the app's CSP (default-src 'self', no font-src), FontFace url() and fetch() of font files from file:// both worked in the Electron 45 spike. *(confidence high, load-bearing; source: https://www.electronjs.org/docs/latest/tutorial/asar-archives; /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/index.html; /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/captions-style/spike/out/results.json)*
- IMSC 1.3 example: with a 32x15 cell grid, a 100% font is 6.66% of video height, and a 120% line height is 8%. This is a broadcast-subtitle size reference. *(confidence medium; source: https://www.w3.org/TR/2026/REC-ttml-imsc1.3-20260521/)*
- The app's current caption renderer uses fillText only. It has a fixed bottom position (block bottom at 0.9H), maxWidth 0.8W, lineHeight 1.2, a box with padX 0.45em, padY 0.2em and radius 0.3em, and a shadow of rgba(0,0,0,0.55) with blur 0.12em and offsetY 0.04em. The v1->v2 migration should map these values. *(confidence high, load-bearing; source: /home/user/Diretor/src/core/render.ts; /home/user/Diretor/src/core/model.ts)*
- The Linux ffmpeg-static dev binary (7.0.2) includes libass ('ass' and 'subtitles' filters). The Windows 6.1.1 build was not checked. *(confidence high; source: /home/user/Diretor/node_modules/ffmpeg-static/ffmpeg -filters)*

## Checagem independente das afirmações

Uma segunda pesquisa tentou refutar cada afirmação (33 no total: confirmed 24, partly 9). Abaixo, só as que foram corrigidas ou que trazem uma ressalva. Onde a correção conflita com o texto acima, vale a correção.

- **captions-0** (confirmed). Afirmação: Electron 45.3.4 ships Chromium 156.0.8078.100 and Node 24.22.3.
  - Correção: package.json declares ^45.3.4, so a fresh npm install can pull a later 45.x with a newer Chromium 156 build. Pin the version if you keep golden pixel tests.
  - Evidência: Local: xvfb-run -a node_modules/electron/dist/electron --no-sandbox /tmp/claude-0/-home-user/363bc653-7968-514d-92c2-e2dec3b6c02a/scratchpad/factcheck-captions/main.cjs -> out/versions.json {electron 45.3.4, chrome 156.0.8078.100, node 24.22.3, v8 15.6.75.57-electron.0}; node_modules/electron/package.json version 45.3.4.
- **captions-2** (confirmed). Afirmação: TextMetrics has actualBoundingBox*, fontBoundingBox* and the baselines, but not emHeight*, getSelectionRects, getActualBoundingBox or getIndexFromOffset.
  - Correção: fontBoundingBoxAscent/Descent come back integer-rounded (97/25 at 100px, 84/22 at 86.4px Montserrat 900). They are the same for any string: 'x' gives the same values as 'ÁÇÉgjpq', so the sample string in the layout plan does nothing.
  - Evidência: Local results.json textMetrics: emHeightAscent/emHeightDescent/getSelectionRects/getActualBoundingBox/getIndexFromOffset are absent from the prototype and undefined on instances. The other fields are numbers.
- **captions-4** (confirmed). Afirmação: Per-word x positions (word widths plus measured space) matched line-prefix measureText exactly for Montserrat 900; fontKerning 'none' widened 969.7 to 996.7 px.
  - Correção: The claim is not universal. Inter VF 800 (the Clássico font) kerns comma+space: the sum of parts was 4.3 px per ', ' wider than the whole line at 100px (21.5 px on one line), and the error disappears with fontKerning 'none' (out/extra.json). Drawing word by word stays self-consistent but loses this cross-word kerning. The effect is cosmetic.
  - Evidência: Local results.json: kern_normal 969.7, kern_none 996.7. Additivity error was 0 px for Montserrat VF 900, Poppins Black, Anton, Bebas Neue and Archivo Black, at letterSpacing 0 and 5px (3 test lines).
- **captions-5** (confirmed). Afirmação: An added but unloaded FontFace is not used by canvas: the first measure/draw uses the fallback and only triggers loading; fonts must be awaited before export.
  - Correção: With a font list ('X, sans-serif'), the fallback while loading is the next family in the list, not serif. With the planned stack, that would be Segoe UI Emoji/Symbol.
  - Evidência: Local results.json fontLoading: statusAfterAdd 'unloaded'; the first measure equals the default serif fallback (1113.82); status is 'loading' after the measure; a fillText on another face also set 'loading'; the same context measured the correct 1340.1 after load. MDN CanvasRenderingContext2D/font: 'you can explicitly load fonts before using them in a canvas' (https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font).
- **captions-6** (partly — **muda a recomendação**). Afirmação: document.fonts.check() returns true for nonexistent and system fonts, so verification must compare widths against the fallback or use the local font list.
  - Correção: The fact about check() is right, but comparing against 'the generic fallback' gives a false 'missing' for an installed font that is itself the generic alias (Arial is the default sans-serif on Windows; Liberation Sans here). Compare against two different fallbacks ('"X", serif' vs serif and '"X", monospace' vs monospace). For bundled faces, check FontFace.status === 'loaded'.
  - Evidência: MDN FontFaceSet/check: check('12px i-dont-exist') is true; a system font only is true (https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check). Local results.json check: missing true, system true, sans-serif true, loaded face true, registered-but-unloaded false, errored face false. Local lfa.json: 'Liberation Sans' 906.1 equals sans-serif 906.1.
- **captions-10** (partly). Afirmação: Montserrat, Inter, Roboto and TikTok Sans VFs have overlapping contours (ç é ê ã K M W R); static Poppins Black, Archivo Black, Bebas Neue and Luckiest Guy have none; Anton has one (ç); a remove-overlaps instance has none.
  - Correção: 'None' only covered 19 sampled characters. Anton also overlaps on uppercase Ç, which matters because the presets use uppercase. Bangers and Oswald (both in the catalog) also overlap. The glyph list is a union: Inter's ã and TikTok Sans' M/W do not overlap. This only matters for hollow styles and direct alpha drawing, which the plan already handles.
  - Evidência: Re-ran captions-style/tools/overlap.py (fontTools 4.60.1 + skia-pathops) and reproduced its output. A full Latin-1 scan (factcheck-captions/tools/overlap_full.py) found: Montserrat VF 126 characters; Inter VF 76; Montserrat 900 --remove-overlaps 0; Bebas Neue, Luckiest Guy and Lilita One 0; Poppins Black/ExtraBold '©'; Archivo Black 'µ' and soft hyphen; Anton 'Ç' and 'ç'; Bangers 'Ç' and 'ç'; Oswald VF 'ç' and 'g'.
- **captions-12** (partly). Afirmação: Word-by-word stroke/fill lets a thick stroke cover the neighbouring word's fill; two passes avoid it.
  - Correção: This happens only with gaps tighter than a normal space, or with outlines near the maximum width. The presets (0.05-0.10em) are not affected at normal spacing. Two passes are still a correct, free default.
  - Evidência: Local out/extra.json (Montserrat 900, 140px): with the spike's 10px gap (~0.07em), per-word drawing lost 127 fill px. With a real space (0.30em = 42px) and visible outlines of 0.10-0.16em it lost 0 px. At 0.30em (the plan's maximum) it lost 28 px.
- **captions-13** (partly). Afirmação: Export-path perf: baseline 6.35 ms; 3-16 words with stroke/box/0.08em blur within noise (5.7-6.5); 0.3em blur 7.33; alpha layer 8.42; per-frame layout 7.11 mean with 92.7 worst.
  - Correção: 'Within noise' hides a real cost of about 0.6 ms per frame (still under the 2 ms budget). The 92.7 ms maximum is not caused by layout: uncached 8-word layout averaged 0.052 ms (spike results.json), and 21-47 ms outliers also appear in runs B and D. The measurements are software-only and say nothing about GPU readback costs.
  - Evidência: The figures match captions-style/spike/out/perf.json exactly. Interleaved A/B re-run in the same sandbox (factcheck-captions/out/results.json perf, 150 frames, 4 vCPU, no GPU, 8 words with stroke, 5px shadow blur, fill and a scaled active word): baseline 6.05 ms, with captions 6.69 ms, +0.64 ms mean (+0.6 p50).
- **captions-15** (confirmed). Afirmação: queryLocalFonts works without a gesture when permitted (108 faces, 27 families, blob bytes); only the check handler is consulted with 'local-fonts'; denial resolves to []; no handler = granted.
  - Correção: blob() was not re-tested here; the spike's lfa.json shows 708,920 bytes.
  - Evidência: Local factcheck-captions/out/lfa.json. No handler: 108 faces / 27 families, permissions.query 'granted'. A request handler alone denying local-fonts: still 108, and the handler was never called. A check handler denying: [] with and without a gesture, no exception, permissions.query 'denied'. The check handler received ('local-fonts', origin 'file:///', details.requestingUrl = page URL, isMainFrame true). Granting: 108; after clearing handlers: 108.
- **captions-16** (confirmed). Afirmação: Electron documents 'local-fonts' for both permission handlers, and by default approves all permission requests.
  - Correção: Although documented for the request handler, in practice only the check handler is consulted (see captions-15).
  - Evidência: https://raw.githubusercontent.com/electron/electron/v45.3.4/docs/api/session.md, lines 1045 and 1143, list 'local-fonts' under both setPermissionRequestHandler and setPermissionCheckHandler (also on https://www.electronjs.org/docs/latest/api/session). docs/tutorial/security.md: 'By default, Electron will automatically approve all permission requests unless the developer has manually configured a custom handler.'
- **captions-17** (confirmed). Afirmação: Installed fonts work in canvas by family name without Local Font Access permission or a FontFace.
  - Correção: Tested on Linux/fontconfig only. Windows (DirectWrite family naming, per-user installed fonts) is untested and should be checked before phase 2.
  - Evidência: Local out/byname_denied.json: with 'local-fonts' DENIED via the check handler (queryLocalFonts returned 0), widths were Caladea 764 and DejaVu Sans 977.39, against missing/serif 821.97 and sans-serif 906.1.
- **captions-18** (confirmed). Afirmação: google/fonts METADATA licences: OFL for Montserrat (100-900), Poppins, Bebas Neue, Anton, Inter, Roboto (VF), Oswald, Archivo Black, TikTok Sans (2025-07-09), Bangers, Lilita One, Titan One, League Spartan, Noto Color Emoji; Apache-2.0 for Luckiest Guy.
  - Correção: Being OFL does not mean there is no Reserved Font Name: Lilita One and Titan One have one (see captions-19).
  - Evidência: Fetched raw.githubusercontent.com/google/fonts/main/{ofl,apache}/*/METADATA.pb (e.g. https://raw.githubusercontent.com/google/fonts/main/ofl/tiktoksans/METADATA.pb, https://raw.githubusercontent.com/google/fonts/main/apache/luckiestguy/METADATA.pb). Licence fields are as stated. Montserrat wght 100-900; Roboto in ofl/ with wdth 75-100 and wght 100-900; TikTok Sans date_added 2025-07-09 with axes opsz/slnt/wdth/wght 300-900; Oswald wght 200-700; Inter opsz 14-32 and wght 100-900; Luckiest Guy APACHE2.
- **captions-19** (partly — **muda a recomendação**). Afirmação: None of the OFL.txt files for Montserrat, Roboto, TikTok Sans, Anton, Bebas Neue, Poppins, Archivo Black, Oswald or Inter declares a Reserved Font Name, so subsets may keep the names.
  - Correção: The claim is correct for the nine fonts it names. But the plan subsets every catalog font, and the catalog includes Lilita One (RFN 'Lilita'). Ship Lilita One unmodified (a plain WOFF2 conversion, 28 KB TTF), drop it, or rename the subset.
  - Evidência: Fetched https://raw.githubusercontent.com/google/fonts/main/ofl/<family>/OFL.txt: no RFN in the nine named files (nor in Bangers or League Spartan). Lilita One's OFL.txt says 'with Reserved Font Name Lilita' and Titan One's says 'with Reserved Font Name Titan.' https://openfontlicense.org/webfonts-and-reserved-font-names/: 'pre-subsetting needs to be considered a Modified Version for which RFN restrictions apply'; a WOFF/WOFF2 conversion that leaves the font data unchanged may keep the name.
- **captions-21** (confirmed). Afirmação: All candidate fonts cover the pt-BR accented letters, º ª €, curly quotes, dashes and the ellipsis.
  - Correção: The Google latin subset range drops some symbols such as → U+2192 (U+2191 and U+2193 are kept). These fall back to other fonts.
  - Evidência: Re-ran captions-style/tools/cov.py on all 17 TTFs and 17 latin WOFF2 subsets: missingPT '-' and missingExtra '-' for every text font. Only Noto Color Emoji, an emoji font, lacks them.
- **captions-24** (confirmed). Afirmação: Captions.ai: one to three words per unit perform better on mobile; keep captions above the bottom 20%; highlight the active word by colour, box or size.
  - Correção: The 20% rule is given for TikTok only. For Reels the page says centre or lower third; for Shorts, lower third or top.
  - Evidência: https://captions.ai/help/guides/engagement/caption-styles-by-platform (last modified 2026-04-20): 'Shorter display units (one word at a time, or two to three words) perform better on mobile'; for TikTok, 'below the midpoint but above the bottom 20% of the frame'; the active word is 'emphasized with a different color, size, or background'.
- **captions-25** (partly). Afirmação: TikTok safe zone at 1080x1920: top 240, bottom 660, sides 120, right button column ~180 px wide from y≈840; TikTok publishes templates, not numbers.
  - Correção: The numbers are consistent. However, Socialync says TikTok's template itself prints the margins and column height on a 720x1280 frame (scaled ×1.5); only the column width was measured by a third party. The column covers x≈780-960 from y=840 down; see other_problems for how this conflicts with the portrait defaults.
  - Evidência: https://www.socialync.io/tools/safe-zones/tiktok: 'top 240 pixels, the bottom 660 pixels and 120 pixels on each side'; 'a column 180 pixels wide inside the right margin, starting 840 pixels from the top'. https://adkit.so/tools/safe-zones/tiktok: right margin '120px, widening to 300px below y=840px'. https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads only links the downloadable safe-zone files.
- **captions-26** (partly). Afirmação: Reels safe zone: top 14% (~269 px), bottom 35% (~672 px), sides 6% (~65 px), per Meta as relayed by third parties.
  - Correção: The primary source is unverified, and one relay gives the bottom margin as 20-35% rather than a flat 35%.
  - Evidência: https://www.socialync.io/tools/safe-zones/instagram-reels: top '14% (about 269 px)', bottom '35% (672 px)', sides '6% (about 65 px)', attributed to Meta's Reels ad spec page. https://billo.app/blog/meta-ads-safe-zones: top 14%, bottom '20%-35%', sides 6%. Meta's ads-guide page could not be fetched (robots_disallowed).
- **captions-27** (partly). Afirmação: YouTube Shorts UI covers top 120-290, bottom 300-670, right 96-190 and left ~48 px; typical caption size 60-75 px.
  - Correção: These are third-party estimates. Use Google's official vertical ad template for the Shorts overlay.
  - Evidência: https://blitzcutai.com/blog/best-caption-size-youtube-shorts-2026 gives these figures but says 'YouTube doesn't publish an official safe zone for organic Shorts' and cites no primary source. https://support.google.com/google-ads/answer/13547298 publishes a 1080x1920 vertical safe-zone diagram and a downloadable vertical PNG template for video ads (the values are only inside the image and were not read).
- **captions-29** (confirmed). Afirmação: BBC guidelines via Clevercast: central 90% vertically and 75% horizontally, maximum line length 68% of a 16:9 width, normally at most 2 lines.
  - Correção: Three lines are allowed when no important picture information is covered.
  - Evidência: https://clevercast.com/bbc-subtitling-guidelines: 'captions should not be placed outside the central 90% vertically and the central 75% horizontally'; 'Maximum line length should be 68% of the width of a 16:9 video and 90% of the width of a 4:3 video'; 'A maximum subtitle length of two lines is recommended'. The BBC's own page is blocked from this environment.
- **captions-31** (confirmed). Afirmação: Pages can read files inside asar with file:, and under the app CSP (no font-src) FontFace url() and fetch() of fonts work.
  - Correção: Keep fonts as files. Vite inlines assets under 4 KiB as data: URLs by default, and the CSP would block those. All current WOFF2 files are 8 KB or more.
  - Evidência: https://www.electronjs.org/docs/latest/tutorial/asar-archives: 'In a web page, files in an archive can be requested with the file: protocol.' Local: the page was loaded from inside a real app.asar (packed with @electron/asar 3.4.1) using the app's exact CSP (out/asar.json). FontFace url() loaded (width 411.82 vs fallback 497.02), and fetch() returned 153,440 bytes and the font loaded. A data: font URL was blocked by 'default-src' because font-src is not set.
- **captions-32** (partly — **muda a recomendação**). Afirmação: The current caption renderer is fillText only, with the block bottom at 0.9H, maxWidth 0.8W, lineHeight 1.2, box 0.45/0.2/0.3em and shadow rgba(0,0,0,0.55) blur 0.12em dy 0.04em; the v1->v2 migration should map these.
  - Correção: The values are right, but the migration is incomplete. 1) The v1 fontFamily is a CSS list. Quoted as one family in the v2 stack, it names a family that does not exist, so text falls through to Segoe UI Emoji/Symbol and the export gate would report the font as missing. Map it, for example to 'Segoe UI' as an allowed system family or to the bundled Inter, and make the gate handle lists for titles. 2) v1 uses a 'middle' baseline with a block of 1.2em × lines, while v2 uses fontBoundingBox, so the result is a few pixels off rather than identical. 3) v1 has no line limit, so maxLines 3 with autoFit false needs a defined overflow rule. 4) Background colours are any CSS string, so core code needs a colour parser.
  - Evidência: /home/user/Diretor/src/core/render.ts: caption cy = H*0.9 - height/2, maxW = W*0.8, lineHeight = fontSize*1.2, box padX/padY/radius = 0.45/0.2/0.3 × fontSize, shadow rgba(0,0,0,0.55) with blur 0.12 and offsetY 0.04 × fontSize, fillText only, textBaseline 'middle'. /home/user/Diretor/src/core/model.ts: the caption and title fontFamily is 'Segoe UI, Inter, Arial, sans-serif'.

### Outros problemas que a checagem encontrou

- The portrait defaults conflict with the TikTok safe zone cited in captions-25. With the 'amarelo' defaults (Montserrat 900, 4.6% = 88 px, uppercase, x 50%, maxWidth 64% = 691 px, block at about y 1017-1211), 5 of 7 sample pages of 2-3 words had a line whose right edge reached x = 787-863. That is past x = 780, where TikTok's right button column starts (from y = 840 down). Evidence: factcheck-captions/out/geo.json. Fix: when centred, use a portrait maxWidth of about 44%, or move the centre left to about x = 45% with maxWidth ≤ 61%, and have the safe-zone overlay flag lines that cross the column.
- Lilita One, which is in the catalog, has the Reserved Font Name 'Lilita'. The plan subsets it with pyftsubset under the original name, which the OFL forbids (pre-subsetting counts as a Modified Version). Ship the unmodified font, only converted to WOFF2, or drop or rename it. Titan One has the RFN 'Titan'. Sources: https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt and https://openfontlicense.org/webfonts-and-reserved-font-names/.
- Luckiest Guy is Apache-2.0. A subset is a modified file, and §4(b) of the bundled LICENSE.txt requires 'prominent notices stating that You changed the files'. Ship the LICENSE plus a note that the font was subsetted.
- Export-gate font check: compare against two different generic fallbacks (serif and monospace), not one. Locally, 'Liberation Sans' measured exactly the same as sans-serif (906.1); on Windows, Arial is the default sans-serif. For bundled faces, use FontFace.status. The gate must also parse the CSS font lists and generic names that titles keep in TextStyle.
- Draw order (e): the top word (the active word in karaoke) is drawn after the shadow-only stroke pass, so it would lose its shadow unless (e) also sets the shadow. Canvas shadowOffset and shadowBlur ignore the current transform: locally, offsetY 10 under scale(2) stayed 10 device pixels (out/shadow.json). Multiply the shadow values by s inside scale(s), and draw preset thumbnails at their real size rather than with ctx.scale.
- Unverified risk that the sandbox (no GPU) cannot show: in the export path, a pooled layer OffscreenCanvas created without willReadFrequently may be GPU-backed on real laptops. Drawing it into the software export canvas would then force a GPU readback every frame. Create the layer with the same willReadFrequently setting as the destination.
- Golden-hash e2e tests: exact pixel hashes from Linux/xvfb break on any change to Electron, Chromium or Skia, and they do not represent Windows (DirectWrite) rendering. Use tolerance-based image diffs, and do not expect migrated v1 captions to match v1 renders pixel for pixel.
- FontFace registration: '100 900' must not be applied to every variable font. Oswald's weight axis is 200-700 and TikTok Sans' is 300-900. Declare each font's real range; otherwise Chromium treats 800/900 as available and silently clamps them to 700 instead of the weight being snapped.
- Clássico (Inter) drawn word by word loses Inter's comma+space kerning: about +0.043em per ', ' compared with whole-line shaping (factcheck-captions/out/extra.json). This is cosmetic. Presets without per-word effects could draw whole lines.
- The YouTube Shorts overlay numbers come from a blog that says no official organic Shorts safe zone exists. Use Google Ads' official 1080x1920 vertical safe-zone template (https://support.google.com/google-ads/answer/13547298) and label the overlay as an approximation.
