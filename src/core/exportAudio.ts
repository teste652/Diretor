// Som da exportação (provisório até o motor de áudio): cada vídeo audível vira
// um segmento em amostras a 48 kHz. Os segmentos se arrumam em faixas sem
// sobreposição; cada arquivo é aberto uma vez por faixa enquanto a leitura anda
// para frente, e os trechos saem dele com asplit/atrim e se juntam com concat.
// Só faixas que se sobrepõem passam pelo amix.

import type { Project, VideoClip } from './model';
import { SAMPLE_RATE } from './time';

/** Posição na linha do tempo (`tl0`), posição no arquivo (`src0`) e tamanho (`n`), em amostras a 48 kHz. */
export interface AudioSegment {
  mediaId: string;
  path: string;
  tl0: number;
  src0: number;
  n: number;
  volume: number;
}

/** Segundos → número inteiro de amostras. */
const samples = (t: number) => Math.round(t * SAMPLE_RATE);

/**
 * Segmentos de som dos vídeos audíveis (sem mudo, com volume, faixa de vídeo
 * visível e mídia com som), ordenados por `tl0`. Um segmento se junta ao
 * anterior da mesma mídia quando o volume é igual e as bordas encostam, na linha
 * do tempo e no arquivo (até 1 amostra de diferença): dividir sem cortar sai
 * igual a um clipe só.
 */
export function audioSegments(p: Project): AudioSegment[] {
  if (p.tracks.find((t) => t.kind === 'video')?.hidden) return [];
  const media = new Map(p.media.map((m) => [m.id, m]));
  const audible = p.clips
    .filter((c): c is VideoClip => c.kind === 'video' && !c.muted && c.volume > 0 && !!media.get(c.mediaId)?.hasAudio)
    .map((c): AudioSegment => ({ mediaId: c.mediaId, path: media.get(c.mediaId)!.path, tl0: samples(c.start), src0: samples(c.in), n: samples(c.duration), volume: c.volume }))
    .sort((a, b) => a.tl0 - b.tl0);
  const out: AudioSegment[] = [];
  const last = new Map<string, AudioSegment>();
  for (const s of audible) {
    const prev = last.get(s.mediaId);
    if (prev && prev.volume === s.volume && Math.abs(prev.tl0 + prev.n - s.tl0) <= 1 && Math.abs(prev.src0 + prev.n - s.src0) <= 1) {
      prev.n = s.tl0 + s.n - prev.tl0;
      continue;
    }
    out.push(s);
    last.set(s.mediaId, s);
  }
  return out;
}

/** Faixas sem sobreposição: cada segmento vai para a primeira faixa cujo último fim é ≤ `tl0`; senão, abre uma faixa. */
export function audioLanes(segs: AudioSegment[]): AudioSegment[][] {
  const lanes: AudioSegment[][] = [];
  const ends: number[] = [];
  for (const s of segs) {
    let f = ends.findIndex((e) => e <= s.tl0);
    if (f < 0) {
      f = lanes.length;
      lanes.push([]);
    }
    lanes[f].push(s);
    ends[f] = s.tl0 + s.n;
  }
  return lanes;
}

/**
 * Grafo de áudio para o script de filtros. `inputs` são os arquivos a abrir (a
 * entrada `k` do grafo é a `firstInput + k` do ffmpeg); `out` é a saída a mapear,
 * com `totalSamples` amostras, ou null sem som. Na mesma faixa, uma mídia
 * reaproveita a entrada que já abriu enquanto o arquivo anda para frente; ao
 * voltar no arquivo, abre outra. Uma entrada nunca serve a duas faixas: assim
 * nenhum ramo do asplit guarda som esperando outro.
 */
export function audioGraph(segs: AudioSegment[], totalSamples: number, firstInput: number): { inputs: string[]; filters: string[]; out: string | null } {
  if (!segs.length) return { inputs: [], filters: [], out: null };
  const lanes = audioLanes(segs);
  const inputs: string[] = [];
  /** Quantos segmentos leem de cada entrada (as saídas do asplit dela). */
  const reads: number[] = [];
  const chains: string[] = [];
  let j = 0;
  lanes.forEach((lane, f) => {
    /** Última entrada aberta para cada mídia nesta faixa e o fim do último trecho lido nela. */
    const open = new Map<string, { k: number; end: number }>();
    const parts: string[] = [];
    let at = 0;
    for (const s of lane) {
      let input = open.get(s.mediaId);
      if (!input || s.src0 < input.end) {
        input = { k: inputs.length, end: 0 };
        open.set(s.mediaId, input);
        inputs.push(s.path);
        reads.push(0);
      }
      input.end = s.src0 + s.n;
      // Vão antes do segmento (começo da faixa ou espaço entre dois): silêncio do tamanho exato.
      if (s.tl0 > at) {
        chains.push(`anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=end_sample=${s.tl0 - at}[g${j}]`);
        parts.push(`[g${j}]`);
      }
      // apad sempre com whole_len: um apad sem tamanho gera som sem fim.
      const volume = s.volume !== 1 ? `,volume=${s.volume}` : '';
      chains.push(`[i${input.k}_${reads[input.k]++}]atrim=start_sample=${s.src0}:end_sample=${s.src0 + s.n},asetpts=PTS-STARTPTS,apad=whole_len=${s.n}${volume}[s${j}]`);
      parts.push(`[s${j}]`);
      at = s.tl0 + s.n;
      j++;
    }
    chains.push(`${parts.join('')}${parts.length > 1 ? `concat=n=${parts.length}:v=0:a=1` : 'anull'}[l${f}]`);
  });
  // aresample com first_pts=0 mantém o silêncio antes da primeira amostra: a amostra
  // contada pelo atrim é a posição no arquivo (áudio que começa depois do vídeo continua no lugar).
  const splits = inputs.map((_, k) => {
    const outs = Array.from({ length: reads[k] }, (_, m) => `[i${k}_${m}]`).join('');
    return `[${firstInput + k}:a]aresample=${SAMPLE_RATE}:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=${reads[k]}${outs}`;
  });
  const mix = lanes.length > 1 ? `${lanes.map((_, f) => `[l${f}]`).join('')}amix=inputs=${lanes.length}:normalize=0:duration=longest,` : '[l0]';
  return { inputs, filters: [...splits, ...chains, `${mix}apad=whole_len=${totalSamples}[aout]`], out: '[aout]' };
}
