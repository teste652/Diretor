# Entrega 1: Dividir e apagar trecho — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** Dividir clipes (Ctrl+B) e apagar trechos marcados na régua (Shift+Delete) em todas as faixas, com as legendas sincronizadas, reprodução sem tela preta nas emendas e exportação que aguenta 300 pedaços no Windows.

**Arquitetura:** Três primitivas novas (`splitClip`, `shiftClips`, `cutTextTime`) e uma macro (`removeRanges`) cuja expansão sai de um planejador puro em `src/core/ripple.ts`; aparar vídeo com ripple passa a usar o mesmo planejador. As emendas de um rascunho são derivadas comparando projeto e view (`draftSeams`), sem campo novo no arquivo. A exportação abre cada mídia uma vez e monta o áudio com `asplit/atrim/concat` num arquivo de filtro ao lado do `.part`; a prévia passa a ter até 3 `<video>` por mídia, com pré-busca antes de cada emenda.

**Tecnologias:** Electron 45, React 18, TypeScript estrito, Vite 5, vitest 2, ffmpeg-static (6.1.1 no Windows, 7.0.2 no Linux), playwright-core no e2e.

**Spec:** `docs/superpowers/specs/2026-11-19-audio-e-legendas-design.md`: seção D2, "Restrições" e a linha E1 da tabela "Entregas". As restrições do código atual estão em `docs/pesquisa/bloco-1/mapa-do-codigo.md` ("Constraints").

## Restrições globais

- O arquivo de projeto continua na versão 1: a E1 não cria campo novo (`parseProject` não muda).
- Tempo arredondado a 1 ms (`round`). O Ctrl+B cai no quadro mais próximo (`snapToFrame`). Pedaços contíguos são reconhecidos com tolerância de 1 amostra a 48 kHz (`SAMPLE = 1/48000`).
- Pedaço mínimo `MIN_DURATION = 0.04` s de cada lado de uma divisão.
- `removeRanges`: até `MAX_RANGES = 500` trechos por op, em segundos da linha do tempo atual. Faixa travada que mudaria dá erro `locked` com o nome da faixa. Faixas ocultas também andam.
- Listas fechadas de chaves (`OP_KEYS`), mensagens em pt-BR, `describeOp` e `OPS_HELP` para cada op nova.
- WYSIWYG: prévia e exportação continuam no mesmo `renderFrame`. O áudio provisório da exportação (`asplit/atrim/concat`) é a exceção documentada até a E5.
- Windows: linha de comando de no máximo 32.767 caracteres. O grafo de filtros vai num `-filter_complex_script`; os argumentos têm teto de `MAX_ARGS_CHARS = 30_000`.
- O script de filtro fica ao lado do `.part`, com o mesmo nome e extensão `.filtro`, e é apagado em todo caminho que apaga o `.part` e logo depois de um ffmpeg bem-sucedido.
- As chamadas MCP expiram em 15 s (main) e 20 s (servidor): 500 trechos têm de aplicar em bem menos que isso (menos de 1 s no teste).
- Nenhuma dependência nova.
- Texto para o usuário em pt-BR, sem jargão. Nunca escreva nome de pessoa nem identificador de modelo de IA em código, testes, commits ou documentos.
- Cada commit termina com as linhas de atribuição que a sessão fornece.

## Foco da revisão

1. **Faixa travada + Shift+Delete:** o aviso diz qual faixa está travada e nada muda (teste na Tarefa 3, `faixa "Legendas" está travada`).
2. **Ctrl+B perto da borda ou fora de um clipe:** não divide, só mostra a dica (testes de `splitTargets` e e2e na Tarefa 9).
3. **Mídia sem som, pedaço mudo e começo vazio:** o som exportado fica no lugar certo (teste de montagem na Tarefa 6).
4. **Pedaços fora da ordem do arquivo:** exportam o som certo, abrindo o arquivo de novo (teste de montagem e teste com ffmpeg na Tarefa 6).
5. **Marcas I e O invertidas ou de tamanho zero:** "Apagar trecho" fica desligado (testes de `markedRange` na Tarefa 9).

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefas |
|---|---|---|
| `src/core/time.ts` (novo) | Constantes de tempo, `round`, `snapToFrame` | 1 |
| `src/core/keyframes.ts` (novo) | Remapear, limitar, repartir e cortar keyframes | 1 |
| `src/core/operations.ts` | Primitivas, macro, validação, expansão, descrição | 1, 2, 3 |
| `src/core/ripple.ts` (novo) | Planejador puro de cortes e do ripple do aparar | 3 |
| `src/core/pieces.ts` (novo) | Contiguidade, emendas do rascunho, agulha Antes/Depois | 2, 4 |
| `src/core/session.ts` | Rota para o rascunho, `draftInfo` memorizado | 4 |
| `src/renderer/ChatPanel.tsx` | Dica da etapa mostra o pedido, não a expansão | 4 |
| `src/mcp/server.ts` | `OPS_HELP` | 5 |
| `src/core/exportAudio.ts` (novo) | Segmentos, faixas e grafo de áudio | 6 |
| `src/core/export.ts` | Argumentos do ffmpeg + texto do script | 6 |
| `src/main/main.ts` | Arquivo `.filtro`, limpeza, erro de montagem | 7 |
| `src/renderer/App.tsx` | Aviso de som demorado; teclas | 7, 9 |
| `src/renderer/videoSlots.ts` (novo) | Escolha de elemento por mídia e pré-busca (puro) | 8 |
| `src/renderer/video.ts` | VideoPool por mídia; preflight por mídia | 8 |
| `src/renderer/Preview.tsx` | Reprodução sem tela preta; Antes/Depois | 8, 9 |
| `src/renderer/exporter.ts` | Protege os pedaços ativos do quadro | 8 |
| `src/renderer/timelineLogic.ts` (novo) | Marcas, alvos do Ctrl+B, chips, visibilidade, régua, zoom (puro) | 9, 10 |
| `src/renderer/store.ts` | Marcas e Antes/Depois | 9 |
| `src/renderer/Timeline.tsx` | Botões, régua, chips; desempenho | 9, 10 |
| `src/renderer/ui.tsx`, `src/renderer/styles.css` | Ícones e estilos novos | 9, 10 |
| `scripts/e2e.mjs` | Seção "Entrega 1"; temporário duplo | 7, 8, 9, 10, 11 |

Comandos: `npx vitest run <arquivo>` roda um arquivo de teste; `npm test` roda todos; `npm run typecheck`; `xvfb-run -a npm run test:e2e` faz o build e roda o e2e (alguns minutos).

---

### Task 1: Tempo e keyframes em módulos próprios

**Arquivos:**
- Criar: `src/core/time.ts`, `src/core/keyframes.ts`
- Modificar: `src/core/operations.ts:142-151` (constantes e `round` passam a vir de `time.ts`), `:183` (`sameGroup` sai), `:566-614` (`remapKeyframes` e `clampKeyframes` saem, corpo igual)
- Teste: `tests/keyframes.test.ts`

**Interfaces:**
- Produz (`time.ts`): `EPS = 1e-6`, `SAME_T = 1e-3`, `MIN_DURATION = 0.04`, `SAMPLE_RATE = 48000`, `SAMPLE = 1 / 48000`, `round(n: number): number` (1 ms), `snapToFrame(t: number, fps: number): number` (`Math.round(t * fps) / fps`).
- Produz (`keyframes.ts`): `sameGroup(a?: string, b?: string): boolean`; `remapKeyframes(c: Clip, newDur: number, contentShift: number): void`; `clampKeyframes(kfs: Keyframe[], dur: number, value: number): Keyframe[]`; `partitionKeyframes(c: Clip, at: number): { left: Record<string, AnimProp>; right: Record<string, AnimProp> }`; `cutKeyframes(c: Clip, t0: number, t1: number): Record<string, AnimProp>`.
- `operations.ts` continua exportando `MIN_DURATION` (reexporta de `time.ts`).

- [ ] **Passo 1: Escrever o teste que falha** (`tests/keyframes.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { cutKeyframes, partitionKeyframes } from '../src/core/keyframes';
import { type AnimProp, type Clip, createProject, findClip } from '../src/core/model';
import { applyOps } from '../src/core/operations';
import { round, snapToFrame } from '../src/core/time';

// Título [0,4): x feito à mão a(1→0) e b(3→400); entrada fadeIn 0,5; saída fadeOut 0,5.
function titulo(): Clip {
  const p = applyOps(createProject(), [
    { op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } },
    { op: 'setKeyframe', clipId: 't', prop: 'x', t: 1, v: 0, keyframeId: 'a' },
    { op: 'setKeyframe', clipId: 't', prop: 'x', t: 3, v: 400, keyframeId: 'b' },
    { op: 'animate', clipId: 't', preset: 'fadeIn', duration: 0.5 },
    { op: 'animate', clipId: 't', preset: 'fadeOut', duration: 0.5 },
  ]).project;
  return findClip(p, 't')!;
}
const pts = (ap: AnimProp) => ap.keyframes.map((k) => [k.t, Math.round(k.v * 1000) / 1000, k.group ?? null]);

describe('keyframes ao dividir e cortar', () => {
  it('dividir em 2: cada lado fica com a sua parte e um ponto na borda com o valor de lá', () => {
    const { left, right } = partitionKeyframes(titulo(), 2);
    expect(pts(left.x)).toEqual([[1, 0, null], [2, 200, null]]);
    expect(pts(right.x)).toEqual([[0, 200, null], [1, 400, null]]);
    expect(pts(left.opacity)).toEqual([[0, 0, 'entrada'], [0.5, 1, 'entrada'], [2, 1, 'saida']]);
    expect(pts(right.opacity)).toEqual([[0, 1, 'entrada'], [1.5, 1, 'saida'], [2, 0, 'saida']]);
  });

  it('apagar [1,5; 2,5]: some o que está dentro e o resto anda junto', () => {
    const props = cutKeyframes(titulo(), 1.5, 2.5);
    expect(pts(props.x)).toEqual([[1, 0, null], [2, 400, null]]);
    expect(pts(props.opacity).filter((k) => k[2] === 'saida')).toEqual([[2.5, 1, 'saida'], [3, 0, 'saida']]);
  });

  it('dois pontos do mesmo grupo no mesmo instante depois do corte: fica o de antes', () => {
    expect(pts(cutKeyframes(titulo(), 1, 3).x)).toEqual([[1, 0, null]]);
  });

  it('tempo em ms e quadro mais próximo', () => {
    expect(round(1.23456)).toBe(1.235);
    expect(snapToFrame(2.01, 30)).toBeCloseTo(2, 9);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/keyframes.test.ts` → FAIL (módulos não existem).

- [ ] **Passo 3: Criar `src/core/time.ts`** com as constantes e funções da seção Interfaces.

- [ ] **Passo 4: Criar `src/core/keyframes.ts`.** Mova `sameGroup`, `remapKeyframes` e `clampKeyframes` de `operations.ts` sem mudar o corpo e exporte-os. Depois:
  - `partitionKeyframes(c, at)`: para cada propriedade com pontos, `left = clampKeyframes(pontos, at, value)` e `right = clampKeyframes(pontos com t = round(t − at), round(c.duration − at), value)`; propriedades sem pontos vão iguais para os dois lados. Devolve objetos novos e nunca altera `c`.
  - `cutKeyframes(c, t0, t1)`: com `d = round(t1 − t0)`, remove os pontos com `t0 + EPS < t < t1 − EPS`, leva os pontos com `t ≥ t1 − EPS` para `round(t − d)`, e, quando dois pontos do mesmo grupo caem a menos de `SAME_T` um do outro, fica o que estava antes do corte. Termina com `clampKeyframes(…, round(c.duration − d), value)`.

- [ ] **Passo 5: Ligar `operations.ts` aos módulos novos** (imports de `time.ts` e `keyframes.ts`; `export { MIN_DURATION } from './time'`).

- [ ] **Passo 6: Rodar.** `npx vitest run tests/keyframes.test.ts` → PASS. `npm test` → tudo passa (nada mudou de comportamento). `npm run typecheck` → sem erros.

- [ ] **Passo 7: Commit.** `git add src/core/time.ts src/core/keyframes.ts src/core/operations.ts tests/keyframes.test.ts && git commit -m "Cortes: tempo e keyframes em módulos próprios"`

---

### Task 2: Primitivas `splitClip`, `shiftClips` e `cutTextTime`

**Arquivos:**
- Modificar: `src/core/operations.ts` (união `Op` `:84-125`, `OP_KEYS` `:158-173`, `validateOp` `:214+`, `expandOp` `:462+`, `applyPrimitive` `:616+`, `touchedClipIds` `:825`, `describeOp` `:835`)
- Criar: `src/core/pieces.ts` (só `isContiguous` nesta tarefa), `tests/fixtures.ts` (ajudantes de teste compartilhados; não é suíte, então o vitest não o roda)
- Teste: `tests/operations.test.ts` (novo `describe`), `tests/pieces.test.ts` (novo)

**Interfaces:**
- Consome: Tarefa 1 (`round`, `EPS`, `MIN_DURATION`, `SAMPLE`, `partitionKeyframes`, `cutKeyframes`).
- Produz: variantes de `Op`:
  - `{ op: 'splitClip'; clipId: string; at: number; newId?: string }` (`at` em segundos da linha do tempo), `OP_KEYS` `['clipId', 'at', 'newId']`
  - `{ op: 'shiftClips'; clipIds: string[]; delta: number }`, `OP_KEYS` `['clipIds', 'delta']`
  - `{ op: 'cutTextTime'; clipId: string; t0: number; t1: number }` (relativos ao início do clipe), `OP_KEYS` `['clipId', 't0', 't1']`
- Produz: `isContiguous(a: Clip, b: Clip): boolean` em `pieces.ts`: os dois são vídeo da mesma mídia, `|a.start + a.duration − b.start| ≤ SAMPLE` e `|a.in + a.duration − b.in| ≤ SAMPLE`.

- [ ] **Passo 1: Escrever os testes que falham.** Em `tests/operations.test.ts` (use `base`, `run`, `fails`, `clip` que já existem lá; importe `isContiguous`):

```ts
describe('dividir, mover e encurtar texto', () => {
  it('splitClip: dois pedaços contíguos, o novo logo depois do original', () => {
    const p = run(base(), [{ op: 'splitClip', clipId: 'v1', at: 2.5, newId: 'v1b' }]);
    const a = clip(p, 'v1');
    const b = clip(p, 'v1b');
    expect([a.start, a.duration, a.kind === 'video' && a.in]).toEqual([0, 2.5, 0]);
    expect([b.start, b.duration, b.kind === 'video' && b.in]).toEqual([2.5, 3.5, 2.5]);
    expect(b).toMatchObject({ kind: 'video', trackId: a.trackId, volume: 1, muted: false, name: a.kind === 'video' ? a.name : '' });
    expect(isContiguous(a, b)).toBe(true);
    expect(p.clips.findIndex((c) => c.id === 'v1b')).toBe(p.clips.findIndex((c) => c.id === 'v1') + 1);
  });

  it('splitClip: tempo em ms, bordas e id repetido', () => {
    expect(clip(run(base(), [{ op: 'splitClip', clipId: 't1', at: 1.23456, newId: 'x' }]), 'x').start).toBe(1.235);
    expect(fails(base(), [{ op: 'splitClip', clipId: 'v1', at: 0.03 }])).toMatch(/entre 0\.040 e 5\.960/);
    expect(fails(base(), [{ op: 'splitClip', clipId: 'v1', at: 7 }])).toMatch(/entre 0\.040 e 5\.960/);
    expect(fails(base(), [{ op: 'splitClip', clipId: 'v1', at: 3, newId: 'v2' }])).toMatch(/Já existe/);
  });

  it('splitClip sem newId: a expansão cria o id e reaplicar dá o mesmo projeto', () => {
    const p0 = base();
    const { project, applied } = applyOps(p0, [{ op: 'splitClip', clipId: 'v1', at: 3 }]);
    expect((applied[0] as { newId: string }).newId).toMatch(/^vid_/);
    expect(run(p0, applied)).toEqual(project);
  });

  it('shiftClips move vários clipes de uma vez, nunca para antes do zero', () => {
    const p = run(base(), [{ op: 'shiftClips', clipIds: ['v2', 'c1'], delta: 0.5 }]);
    expect([clip(p, 'v2').start, clip(p, 'c1').start]).toEqual([6.5, 0.5]);
    expect(fails(base(), [{ op: 'shiftClips', clipIds: ['v2', 'c1'], delta: -1 }])).toMatch(/antes do zero/);
    expect(fails(base(), [{ op: 'shiftClips', clipIds: ['v2', 'v2'], delta: 1 }])).toMatch(/repetidos/);
  });

  it('cutTextTime encurta o texto e leva a saída junto', () => {
    let p = run(base(), [{ op: 'animate', clipId: 't1', preset: 'fadeOut', duration: 0.6 }]);
    p = run(p, [{ op: 'cutTextTime', clipId: 't1', t0: 1, t1: 2 }]);
    expect([clip(p, 't1').start, clip(p, 't1').duration]).toEqual([0, 2]);
    expect(keyframeGroups(clip(p, 't1')).find((g) => g.group === 'saida')).toMatchObject({ start: 1.4, end: 2 });
    expect(fails(base(), [{ op: 'cutTextTime', clipId: 'v1', t0: 1, t1: 2 }])).toMatch(/só para título e legenda/);
    expect(fails(base(), [{ op: 'cutTextTime', clipId: 'c1', t0: 0, t1: 1.19 }])).toMatch(/menos de 0\.04s/);
  });
});
```

E `tests/fixtures.ts`, com um ajudante que monta vídeos de duas mídias de 20 s:

```ts
import { type Project, createProject } from '../src/core/model';
import { type Op, applyOps } from '../src/core/operations';

/** Vídeos [id, start, duration, in, mídia?]; a mídia é m1 quando omitida (m1 e m2 têm 20 s e som). */
export function videos(list: [string, number, number, number, ('m1' | 'm2')?][]): Project {
  const ops: Op[] = [
    { op: 'addMedia', media: { id: 'm1', path: '/v/a.mp4', name: 'a.mp4', duration: 20, width: 64, height: 64, hasAudio: true } },
    { op: 'addMedia', media: { id: 'm2', path: '/v/b.mp4', name: 'b.mp4', duration: 20, width: 64, height: 64, hasAudio: true } },
  ];
  for (const [id, start, duration, inn, m] of list) ops.push({ op: 'addClip', clip: { kind: 'video', id, mediaId: m ?? 'm1', start, duration, in: inn } });
  return applyOps(createProject(), ops).project;
}
```

E `tests/pieces.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findClip } from '../src/core/model';
import { isContiguous } from '../src/core/pieces';
import { videos } from './fixtures';

describe('pedaços', () => {
  it('contíguos: mesma mídia, encostados na linha do tempo e no arquivo, com tolerância de 1 amostra', () => {
    const p = videos([['A', 0, 2, 0], ['B', 2, 2, 2.00001], ['C', 4, 2, 4.002], ['D', 6, 2, 6, 'm2']]);
    const c = (id: string) => findClip(p, id)!;
    expect(isContiguous(c('A'), c('B'))).toBe(true);
    expect(isContiguous(c('B'), c('C'))).toBe(false);
    expect(isContiguous(c('C'), c('D'))).toBe(false);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/operations.test.ts tests/pieces.test.ts` → FAIL (ops desconhecidas, `pieces.ts` não existe).

- [ ] **Passo 3: Validação em `validateOp`**, com estas mensagens exatas:
  - `splitClip`: `need(clipId)`; `at` não numérico → `invalid_param` `'at deve ser um número (segundos da linha do tempo).'`; com `lo = c.start + MIN_DURATION` e `hi = c.start + c.duration − MIN_DURATION`, `round(at)` fora de `[lo − EPS, hi + EPS]` → `out_of_range` `` `Para dividir, at fica entre ${lo.toFixed(3)} e ${hi.toFixed(3)}s (pelo menos ${MIN_DURATION}s de cada lado).` ``; `newId` presente e não texto não vazio → `invalid_param` `'newId deve ser um texto.'`; `newId` que já existe → `invalid_param` `` `Já existe um clipe "${newId}".` ``.
  - `shiftClips`: lista vazia ou com algo que não é texto não vazio → `'clipIds deve ser uma lista de ids.'`; repetidos → `'clipIds tem ids repetidos.'`; `delta` não numérico → `'delta deve ser um número (segundos).'`; cada id passa por `need`; `start + delta < −EPS` → `out_of_range` `` `O clipe "${id}" começaria antes do zero.` ``.
  - `cutTextTime`: `need(clipId)`; vídeo → `invalid_param` `'cutTextTime vale só para título e legenda.'`; fora de `0 ≤ t0 < t1 ≤ duration` (com `EPS`) → `out_of_range` `` `t0 e t1 (relativos ao clipe) ficam entre 0 e ${c.duration.toFixed(3)}s, com t0 < t1.` ``; `duration − round(t1 − t0) < MIN_DURATION − EPS` → `out_of_range` `` `O texto ficaria com menos de ${MIN_DURATION}s; remova o clipe.` ``.

- [ ] **Passo 4: Aplicação, expansão e descrição.**
  - `splitClip`: `L = round(round(at) − c.start)`, `R = round(c.duration − L)`, `{left, right} = partitionKeyframes(c, L)`. O pedaço novo é um clone inteiro de `c` (todos os campos, para os que vierem nas próximas entregas passarem às duas partes) com `id = newId`, `start = round(c.start + L)`, `duration = R`, `props = right` e, no vídeo, `in = c.in + L` **sem arredondar** (a contiguidade com o original fica exata). O original fica com `duration = L` e `props = left`. O novo entra em `p.clips` logo depois do original.
  - `shiftClips`: cada clipe recebe `start = Math.max(0, round(start + delta))`.
  - `cutTextTime`: `props = cutKeyframes(c, t0, t1)` e `duration = round(duration − round(t1 − t0))`; o início não muda.
  - `expandOp`: `splitClip` sem `newId` ganha `newId(kind === 'video' ? 'vid' : kind === 'title' ? 'ttl' : 'cap')`.
  - `touchedClipIds`: inclui o `newId` do `splitClip` e todos os `clipIds` do `shiftClips`.
  - `describeOp`: `'Dividir clipe'`, `'Mover clipes'`, `'Encurtar texto'`.

- [ ] **Passo 5: Criar `src/core/pieces.ts`** com `isContiguous`.

- [ ] **Passo 6: Rodar.** `npx vitest run tests/operations.test.ts tests/pieces.test.ts` → PASS; `npm test` e `npm run typecheck` → sem falhas.

- [ ] **Passo 7: Commit.** `git commit -m "Cortes: dividir clipe, mover vários e encurtar texto"` (com os arquivos desta tarefa).

---

### Task 3: `removeRanges` e o ripple do aparar

**Arquivos:**
- Criar: `src/core/ripple.ts`
- Modificar: `src/core/operations.ts` (op `removeRanges`; `trimClip` em `validateOp` `:332-348` e em `expandOp` `:473-482`; `lockedTrackError`), `tests/fixtures.ts`
- Teste: `tests/ripple.test.ts`

**Interfaces:**
- Consome: Tarefa 2 (primitivas). `ripple.ts` importa de `operations.ts` **só tipos** (`import type { Op, TrimEdge }`), para não criar ciclo em tempo de execução.
- Produz (`ripple.ts`):
  - `type TimeRange = [number, number]`; `MAX_RANGES = 500`; `interface RippleOptions { exclude?: string; extend?: boolean }` (`extend` vale `true` quando omitido)
  - `normalizeRanges(p: Project, ranges: TimeRange[], opts?: RippleOptions): TimeRange[]`
  - `mapTime(ranges: TimeRange[], t: number): number` (trechos já normalizados)
  - `planRemoveRanges(p: Project, ranges: TimeRange[], opts?: RippleOptions): Op[]` (só primitivas, na ordem de aplicação)
  - `trimRipple(p: Project, c: VideoClip, edge: TrimEdge, delta: number): Op[]`
- Produz (`operations.ts`): `{ op: 'removeRanges'; ranges: TimeRange[] }` com `OP_KEYS` `['ranges']`; `lockedTrackError(p: Project, ops: Op[]): string | null`.
- Produz (`tests/fixtures.ts`): `base()`, `run`, `fails` e `clip`, iguais aos de `tests/operations.test.ts` (copie para cá; `operations.test.ts` não muda).

- [ ] **Passo 1: Escrever os testes que falham** (`tests/ripple.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { type Project, type VideoClip, createProject, findClip, projectDuration } from '../src/core/model';
import { type Op, applyOps } from '../src/core/operations';
import { type TimeRange, mapTime, normalizeRanges } from '../src/core/ripple';
import { round } from '../src/core/time';
import { base, clip, fails, run } from './fixtures';

const vids = (p: Project) =>
  p.clips.filter((c): c is VideoClip => c.kind === 'video').sort((a, b) => a.start - b.start).map((c) => [c.start, round(c.start + c.duration), round(c.in)]);
const span = (p: Project, id: string) => [clip(p, id).start, round(clip(p, id).start + clip(p, id).duration)];
const cut = (p: Project, ranges: TimeRange[]) => run(p, [{ op: 'removeRanges', ranges }]);
const shape = (p: Project) =>
  p.clips.map((c) => [c.trackId, c.kind, c.start, c.duration, c.kind === 'video' ? round(c.in) : c.text]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[2]) - Number(b[2]));
/** base() + legenda c2 [5,5; 6,5) e título t2 [6,5; 7,5). */
const withTail = () =>
  run(base(), [
    { op: 'addClip', clip: { kind: 'caption', id: 'c2', text: 'depois', start: 5.5, duration: 1 } },
    { op: 'addClip', clip: { kind: 'title', id: 't2', text: 'fim', start: 6.5, duration: 1 } },
  ]);

describe('apagar trechos', () => {
  it('apagar [2,3]: o vídeo perde o trecho, tudo depois anda 1 s e o texto em cima é cortado', () => {
    const p0 = run(base(), [
      { op: 'addClip', clip: { kind: 'caption', id: 'c3', text: 'depois', start: 4, duration: 1 } },
      { op: 'addClip', clip: { kind: 'title', id: 't3', text: 'meio', start: 2.5, duration: 2 } },
    ]);
    const p = cut(p0, [[2, 3]]);
    expect(vids(p)).toEqual([[0, 2, 0], [2, 5, 3], [5, 8, 6]]);
    expect([span(p, 't1'), span(p, 'c1'), span(p, 'c3'), span(p, 't3')]).toEqual([[0, 2], [0, 1.2], [3, 4], [2, 3.5]]);
    expect(projectDuration(p)).toBe(8);
  });

  it('ordena, junta trechos quase encostados e leva a borda até o clipe quando sobraria um pedaço curto', () => {
    expect(normalizeRanges(base(), [[4, 5], [1, 2], [1.5, 2.5]])).toEqual([[1, 2.5], [4, 5]]);
    expect(normalizeRanges(base(), [[1, 2], [2.03, 3]])).toEqual([[1, 3]]);
    expect(normalizeRanges(base(), [[0.02, 1]])).toEqual([[0, 1]]);
    expect(normalizeRanges(base(), [[3, 5.98]])).toEqual([[3, 6]]);
    expect(vids(cut(base(), [[3, 5.98]]))).toEqual([[0, 3, 0], [3, 6, 6]]);
  });

  it('legenda que ficaria curta demais sai; título cortado no começo encosta no zero', () => {
    const p = cut(base(), [[0, 1.18]]);
    expect(findClip(p, 'c1')).toBeUndefined();
    expect(span(p, 't1')).toEqual([0, 1.82]);
  });

  it('apagar um vão sem clipe só puxa o que vem depois', () => {
    const p = cut(run(base(), [{ op: 'updateClip', clipId: 'v2', set: { start: 7 } }]), [[6, 7]]);
    expect(vids(p)).toEqual([[0, 6, 0], [6, 9, 6]]);
  });

  it('faixa travada que mudaria recusa o corte com o nome dela; faixa oculta anda junto', () => {
    const locked = run(base(), [{ op: 'updateTrack', trackId: 'trk_captions', set: { locked: true } }]);
    expect(fails(locked, [{ op: 'removeRanges', ranges: [[0.5, 1]] }])).toMatch(/faixa "Legendas" está travada/);
    expect(vids(cut(locked, [[8, 9]]))).toEqual([[0, 6, 0], [6, 8, 6]]);
    const hidden = run(base(), [{ op: 'updateTrack', trackId: 'trk_text', set: { hidden: true } }]);
    expect(span(cut(hidden, [[2, 3]]), 't1')).toEqual([0, 2]);
  });

  it('limites e mensagens', () => {
    const many: TimeRange[] = Array.from({ length: 501 }, (_, i) => [i * 0.01, i * 0.01 + 0.005]);
    expect(fails(base(), [{ op: 'removeRanges', ranges: many }])).toMatch(/Até 500 trechos/);
    expect(fails(base(), [{ op: 'removeRanges', ranges: [[20, 30]] }])).toMatch(/Nada para apagar/);
    expect(fails(base(), [{ op: 'removeRanges', ranges: [[3, 2]] }])).toMatch(/início < fim/);
  });

  it('mapTime: antes, dentro e depois dos trechos', () => {
    expect([0.5, 1.5, 2, 3, 4.5, 6].map((t) => mapTime([[1, 2], [4, 5]], t))).toEqual([0.5, 1, 1, 2, 3, 4]);
  });

  it('várias removeRanges na mesma etapa, do fim para o começo, dão o mesmo que uma só', () => {
    const a = run(base(), [{ op: 'removeRanges', ranges: [[5, 5.5]] }, { op: 'removeRanges', ranges: [[1, 1.5]] }]);
    expect(shape(a)).toEqual(shape(cut(base(), [[1, 1.5], [5, 5.5]])));
  });

  it('vídeo de 1 hora: 500 trechos aplicam em menos de 1 s e cada clipe anda uma vez só', () => {
    const ops: Op[] = [
      { op: 'addMedia', media: { id: 'mL', path: 'C:/v/longo.mp4', name: 'longo.mp4', duration: 3600, width: 1280, height: 720, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'vL', mediaId: 'mL', start: 0, duration: 3600 } },
    ];
    for (let i = 0; i < 600; i++) ops.push({ op: 'addClip', clip: { kind: 'caption', id: `k${i}`, text: `fala ${i}`, start: 6 * i, duration: 2 } });
    const p0 = run(createProject(), ops);
    const ranges: TimeRange[] = Array.from({ length: 500 }, (_, i) => [7 * i + 3, round(7 * i + 3.4)]);
    const t0 = performance.now();
    const { project, applied } = applyOps(p0, [{ op: 'removeRanges', ranges }]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(project.clips.filter((c) => c.kind === 'video')).toHaveLength(501);
    expect(projectDuration(project)).toBeCloseTo(3400, 6);
    expect(span(project, 'k1')).toEqual([5.6, 7.6]);
    const moved = applied.flatMap((o) => (o.op === 'shiftClips' ? o.clipIds : []));
    expect(new Set(moved).size).toBe(moved.length);
    expect(run(p0, applied)).toEqual(project);
  });
});

describe('aparar vídeo com ripple vale para todas as faixas', () => {
  it('fim −1: legenda e título depois andam junto', () => {
    const p = run(withTail(), [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1 }]);
    expect(vids(p)).toEqual([[0, 5, 0], [5, 8, 6]]);
    expect([span(p, 'c2'), span(p, 't2')]).toEqual([[5, 5.5], [5.5, 6.5]]);
  });

  it('início +1: o vídeo fica no lugar e o texto em cima do pedaço aparado é cortado', () => {
    const p = run(withTail(), [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: 1 }]);
    expect(vids(p)).toEqual([[0, 5, 1], [5, 8, 6]]);
    expect([span(p, 't1'), span(p, 'c1')]).toEqual([[0, 2], [0, 0.2]]);
  });

  it('alongar o fim empurra o que começa a partir do fim antigo', () => {
    const p0 = run(base(), [
      { op: 'updateClip', clipId: 'v1', set: { duration: 5 } },
      { op: 'addClip', clip: { kind: 'caption', id: 'c2', text: 'x', start: 5, duration: 1 } },
      { op: 'addClip', clip: { kind: 'title', id: 't2', text: 'y', start: 6, duration: 1 } },
    ]);
    const p = run(p0, [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: 0.5 }]);
    expect(vids(p)).toEqual([[0, 5.5, 0], [6.5, 9.5, 6]]);
    expect([span(p, 'c2'), span(p, 't2'), span(p, 'c1')]).toEqual([[5.5, 6.5], [6.5, 7.5], [0, 1.2]]);
  });

  it('revelar o começo empurra tudo o que começa a partir do início do vídeo', () => {
    const p0 = run(base(), [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: 1, ripple: false }]);
    const p = run(p0, [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: -0.5 }]);
    expect(vids(p)).toEqual([[0, 5.5, 0.5], [6.5, 9.5, 6]]);
    expect(span(p, 't1')).toEqual([0.5, 3.5]);
  });

  it('ripple:false não mexe em mais nada; faixa de texto travada recusa', () => {
    expect(span(run(withTail(), [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1, ripple: false }]), 'c2')).toEqual([5.5, 6.5]);
    const locked = run(withTail(), [{ op: 'updateTrack', trackId: 'trk_text', set: { locked: true } }]);
    expect(fails(locked, [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1 }])).toMatch(/faixa "Texto" está travada/);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/ripple.test.ts` → FAIL.

- [ ] **Passo 3: `normalizeRanges` e `mapTime`.**
  - `normalizeRanges`: cada `[a, b]` vira `[round(max(0, a)), round(b)]`; descarta `b − a ≤ EPS`; ordena por `a`; junta vizinhos com `a₂ − b₁ < MIN_DURATION − EPS` em `[a₁, max(b₁, b₂)]`. Com `extend` (padrão), faz até 10 passadas: para cada trecho e cada vídeo (menos `exclude`) que ele toca, com `s` e `e` o início e o fim do vídeo, se `s < a` e `a − s < MIN_DURATION − EPS` então `a = s`; se `b < e` e `e − b < MIN_DURATION − EPS` então `b = e`. Depois de cada passada, ordena e junta de novo; para quando uma passada não muda nada.
  - `mapTime(R, t)`: subtrai o tamanho inteiro de cada trecho com `b ≤ t + EPS` e, se `a < t < b`, também `t − a`; devolve `round`. Use somas acumuladas e busca binária (é chamada uma vez por clipe).

- [ ] **Passo 4: `planRemoveRanges`.** `R = normalizeRanges(p, ranges, opts)`; vazio devolve `[]`. Fase 1 percorre `p.clips` (menos `opts.exclude`); fase 2 desloca. Os ids novos vêm de `newId('vid' | 'ttl' | 'cap')`.
  - **Corte efetivo** de um trecho `[a, b]` num clipe que hoje vai de `s` a `fim`: `a' = a − s < MIN_DURATION − EPS ? s : a` e `b' = fim − b < MIN_DURATION − EPS ? fim : b`, limitados a `[s, fim]`. Um trecho toca o clipe quando `a < fim − EPS` e `b > s + EPS`.
  - **Vídeo:** os trechos que tocam o clipe são percorridos da direita para a esquerda; `fim` começa no fim do clipe e o id original continua sendo o pedaço mais à esquerda:
    - `a' ≤ s` e `b' ≥ fim` → `removeClip(id)`.
    - `a' ≤ s` e `b' < fim` → `splitClip(id, b', Y)`, `removeClip(id)`.
    - `a' > s` e `b' ≥ fim` → `splitClip(id, a', X)`, `removeClip(X)`; `fim = a'`.
    - senão → `splitClip(id, b', Y)`, `splitClip(id, a', X)`, `removeClip(X)`; `fim = a'`.

    Sobreviventes: o id original (se ficou), com primeiro instante `s`, e cada `Y`, com início e primeiro instante `b'`.
  - **Título e legenda:** com os cortes efetivos (no clipe inteiro, `fim = s + duration`), se `duration − Σ(b' − a') < MIN_DURATION − EPS` → `removeClip(id)`. Senão, um `cutTextTime(id, round(a' − s), round(b' − s))` por trecho, da direita para a esquerda. Sobrevivente: o primeiro instante é o `b'` do corte que começa em `s`, se houver; senão, `s`.
  - Clipes que nenhum trecho toca são sobreviventes com primeiro instante `s`.
  - **Fase 2:** para cada sobrevivente, em ordem de início, `delta = round(mapTime(R, primeiro) − início)`. Os com `|delta| > EPS` são agrupados por `delta.toFixed(3)`, e cada grupo vira **um** `shiftClips {clipIds, delta}`, na ordem em que o grupo aparece. Assim cada clipe anda no máximo uma vez e a expansão é linear.
  - Devolve fase 1 seguida da fase 2.

- [ ] **Passo 5: `trimRipple`.** `|delta| ≤ EPS` → `[]`. Encurtar o fim (`edge 'end'`, `delta < 0`): `planRemoveRanges(p, [[round(fim + delta), fim]], { exclude: c.id, extend: false })`, com `fim = c.start + c.duration`. Encurtar o início (`'start'`, `delta > 0`): o mesmo com `[[c.start, round(c.start + delta)]]`. Alongar (os outros dois casos): `at` é o fim antigo (`'end'`) ou `c.start` (`'start'`); todos os outros clipes com `start ≥ at − SAME_T` viram um `shiftClips` com `delta = round(|delta|)` (ou `[]` se não houver nenhum).

- [ ] **Passo 6: Ligar em `operations.ts`.**
  - `lockedTrackError(p, ops)`: monta uma vez um `Map` id → clipe de `p`; para cada op, os ids existentes que ela nomeia (`clipId` de `splitClip`, `removeClip`, `cutTextTime`, `updateClip`, `trimClip`; `clipIds` de `shiftClips`) cuja faixa está travada devolvem `` `A faixa "${track.name}" está travada e mudaria junto com o corte. Destrave a faixa para continuar.` ``; ids novos (que ainda não existem) são ignorados. Sem nada travado, `null`.
  - `validateOp('removeRanges')`, nesta ordem: não é lista ou está vazia → `invalid_param` `'ranges deve ser uma lista de trechos [início, fim] em segundos.'`; mais de `MAX_RANGES` → `invalid_param` `` `Até ${MAX_RANGES} trechos por removeRanges (vieram ${n}). Envie várias removeRanges na mesma etapa, começando pelos trechos do fim do vídeo.` ``; um trecho que não seja `[número, número]` com `0 ≤ início < fim` → `invalid_param` `` `Trecho ${i + 1}: use [início, fim] em segundos, com 0 ≤ início < fim.` ``; depois calcula o plano: `lockedTrackError` → `locked`; plano vazio → `out_of_range` `'Nada para apagar nesses trechos.'`.
  - `validateOp('trimClip')`: depois das conferências de hoje, se `ripple !== false` e é vídeo, `lockedTrackError(p, trimRipple(p, c, edge, delta))` → `locked`.
  - `expandOp`: `removeRanges` → `planRemoveRanges(p, o.ranges)`; `trimClip` de vídeo com ripple → `[{ ...o, ripple: false }, ...trimRipple(p, c, o.edge, o.delta)]` (substitui o ripple antigo, que só puxava os vídeos da mesma faixa).
  - `describeOp('removeRanges')`: um trecho → `'Apagar trecho'`; mais → `` `Apagar ${n} trechos` ``.

- [ ] **Passo 7: Rodar.** `npx vitest run tests/ripple.test.ts` → PASS. `npm test` → tudo passa (os testes de "aparar" de hoje continuam valendo: por exemplo, `v2.start` fica em 5 depois de aparar o início em 1). `npm run typecheck`.

- [ ] **Passo 8: Commit.** `git commit -m "Cortes: apagar trechos em todas as faixas e aparar com ripple igual"`

---

### Task 4: Sessão: rota para o rascunho, `draftInfo` memorizado, emendas e agulha

**Arquivos:**
- Modificar: `src/core/pieces.ts`, `src/core/session.ts:240-283` (`draftInfo`) e `:316-324` (`shouldRouteToDraft`), `src/renderer/ChatPanel.tsx:471`
- Teste: `tests/pieces.test.ts`, `tests/session.test.ts`

**Interfaces:**
- Consome: Tarefas 2 e 3.
- Produz (`pieces.ts`): `interface Seam { at: number; removed: number }`; `draftSeams(project: Project, view: Project): Seam[]`; `mapPlayhead(from: Project, to: Project, t: number): number`.
- Produz (`session.ts`): `export interface DraftInfo { clipIds; createdClipIds; addedClipIds; removedClipIds; keyframeIds: Set<string>; range: { clipId: string; start: number; end: number }[]; seams: Seam[]; ripple: boolean }` e `get draftInfo(): DraftInfo`.
  - `createdClipIds`: ids de `addClip` **e** os `newId` de `splitClip`.
  - `addedClipIds`: só `addClip`; é o que a linha do tempo pinta como "clipe novo".
  - `seams = draftSeams(this.project, this.view)`.
  - `ripple = seams.length > 0 || alguma op do rascunho é shiftClips`.
  - `range` ignora `splitClip` e `cutTextTime`: num corte, quem marca o lugar é o chip da emenda.

- [ ] **Passo 1: Escrever os testes que falham.** Em `tests/pieces.test.ts` (use `videos` da Tarefa 2 e `base`/`run` de `tests/fixtures.ts`):

```ts
describe('emendas do rascunho', () => {
  // A [0,2) in 0, B [2,4) in 5, C [4,6) in 8: já tem emendas no projeto, que não contam.
  const abc = () => videos([['A', 0, 2, 0], ['B', 2, 2, 5], ['C', 4, 2, 8]]);
  it('sem mudança, sem emenda nova', () => expect(draftSeams(abc(), abc())).toEqual([]));
  it('apagar [2,4] deixa uma emenda em 2 com 2 s tirados', () =>
    expect(draftSeams(abc(), run(abc(), [{ op: 'removeRanges', ranges: [[2, 4]] }]))).toEqual([{ at: 2, removed: 2 }]));
  it('aparar 0,5 do começo de B conta 0,5', () =>
    expect(draftSeams(abc(), run(abc(), [{ op: 'trimClip', clipId: 'B', edge: 'start', delta: 0.5 }]))).toEqual([{ at: 2, removed: 0.5 }]));
  it('dividir sem cortar não cria emenda', () => expect(draftSeams(abc(), run(abc(), [{ op: 'splitClip', clipId: 'A', at: 1 }]))).toEqual([]));
  it('base(): apagar [2,3] dá uma emenda de 1 s em 2', () =>
    expect(draftSeams(base(), run(base(), [{ op: 'removeRanges', ranges: [[2, 3]] }]))).toEqual([{ at: 2, removed: 1 }]));
});

describe('agulha no Antes/Depois', () => {
  const antes = base();
  const depois = run(antes, [{ op: 'removeRanges', ranges: [[2, 3]] }]);
  it('o mesmo instante do conteúdo nas duas versões', () => {
    expect(mapPlayhead(depois, antes, 2.5)).toBeCloseTo(3.5, 6);
    expect(mapPlayhead(antes, depois, 3.5)).toBeCloseTo(2.5, 6);
    expect(mapPlayhead(antes, depois, 7)).toBeCloseTo(6, 6);
  });
  it('instante cortado vai para a borda do corte; depois do fim, para o fim', () => {
    expect(mapPlayhead(antes, depois, 2.5)).toBeCloseTo(2, 6);
    expect(mapPlayhead(antes, depois, 9.5)).toBeCloseTo(8, 6);
  });
});
```

Em `tests/session.test.ts` (use `setup` e `entradaSaida` de lá):

```ts
describe('cortes e rascunhos', () => {
  it('um Ctrl+Z desfaz o corte inteiro', () => {
    const s = setup();
    const before = structuredClone(s.project.clips);
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[1.5, 2.5]] }]).ok).toBe(true);
    s.undo();
    expect(s.project.clips).toEqual(before);
  });

  it('corte da IA: emenda, ripple, pedaço que não é "clipe novo" e ajuste manual no rascunho', () => {
    const s = setup();
    const steps = [{ label: 'Corte', ops: [{ op: 'removeRanges' as const, ranges: [[1.5, 2.5]] as [number, number][] }] }];
    expect(s.propose({ requestId: 'corte', baseRevision: s.project.revision, title: 'Corte', steps }).ok).toBe(true);
    const d = s.draftInfo;
    expect(d.seams).toEqual([{ at: 1.5, removed: 1 }]);
    expect(d.ripple).toBe(true);
    const piece = s.view.clips.find((c) => c.kind === 'video' && c.id !== 'v1')!;
    expect(d.createdClipIds.has(piece.id)).toBe(true);
    expect(d.addedClipIds.has(piece.id)).toBe(false);
    expect(s.draftInfo).toBe(d);
    s.setSelection({ clipIds: [piece.id] });
    expect(s.openProposal!.status).toBe('active');
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[3, 3.5]] }])).toEqual({ ok: true, target: 'draft' });
    expect(s.draftInfo.seams).toEqual([{ at: 1.5, removed: 1 }, { at: 3, removed: 0.5 }]);
  });

  it('dividir um clipe fora do rascunho grava no projeto e desatualiza a proposta', () => {
    const s = setup();
    s.propose(entradaSaida(s.project.revision));
    expect(s.dispatch([{ op: 'splitClip', clipId: 'v1', at: 3 }])).toEqual({ ok: true, target: 'project' });
    expect(s.openProposal!.status).toBe('stale');
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/pieces.test.ts tests/session.test.ts` → FAIL.

- [ ] **Passo 3: `draftSeams`.** Pares de uma versão: vídeos ordenados por início; dois seguidos `A, B` formam par quando `|A.start + A.duration − B.start| ≤ SAME_T` e `!isContiguous(A, B)`; a chave do par é `` `${A.mediaId}|${(A.in + A.duration).toFixed(4)}|${B.mediaId}|${B.in.toFixed(4)}` ``. Os pares da view cuja chave não está nos pares do projeto viram emenda com `at = B.start` e `removed = round(posição(B.in) − posição(A.in + A.duration))`, onde `posição(src)` é `Q.start + (src − Q.in)` com `Q` = clipe do projeto com o mesmo id ou, se não houver, o primeiro vídeo do projeto da mesma mídia cujo trecho do arquivo contém `src` (tolerância `SAMPLE`). Sem posição de algum lado, ou `removed ≤ SAME_T`, não há emenda. Ordene por `at`.

- [ ] **Passo 4: `mapPlayhead(from, to, t)`.** Pega o vídeo de `from` sob `t`; sem vídeo, devolve `t` limitado a `[0, projectDuration(to)]`. Com `src = P.in + (t − P.start)`, procura em `to` o clipe de mesmo id que contém `src` e, se não houver, qualquer vídeo da mesma mídia que contém `src`; achou → `Q.start + (src − Q.in)`. Não achou (o instante foi cortado) → o início do vídeo da mesma mídia com o menor `in ≥ src`; nem isso → `t` limitado como acima.

- [ ] **Passo 5: Sessão.**
  - `draftInfo` memorizado: guarda `{ project, view, step, info }` e só recalcula quando a identidade de `this.project`, de `this.view` ou da etapa ativa muda. Sem etapa ativa devolve sempre o mesmo objeto vazio.
  - `shouldRouteToDraft`: depois das regras de hoje (USER_ONLY_OPS, nome, formato, modo ajustar), calcula `touchedClipIds(applyOps(this.view, ops).applied)` e vai para o rascunho se algum id estiver em `draftInfo.clipIds`. Se `applyOps` lançar, cai na conferência de hoje (`'clipId' in o`).
  - `ChatPanel.tsx:471`: a dica da etapa usa `st.requested.map(describeOp)` (com mil cortes, `st.ops` tem milhares de primitivas).

- [ ] **Passo 6: Rodar.** `npx vitest run tests/pieces.test.ts tests/session.test.ts` → PASS; `npm test`; `npm run typecheck`.

- [ ] **Passo 7: Commit.** `git commit -m "Cortes: rascunho com emendas, ajuste manual no rascunho e agulha Antes/Depois"`

---

### Task 5: A IA aprende a dividir e a apagar trechos

**Arquivos:**
- Modificar: `src/mcp/server.ts:53-63` (`OPS_HELP`)
- Teste: `tests/mcp.test.ts`

**Interfaces:** Consome as ops das Tarefas 2 e 3. Não produz nada para outras tarefas.

- [ ] **Passo 1: Escrever o teste que falha** (`tests/mcp.test.ts`, no `describe('servidor MCP')`):

```ts
it('a ajuda das operações ensina a dividir e a apagar trechos', async () => {
  const { tools } = await client.listTools();
  const d = tools.find((t) => t.name === 'propose_edit')!.description!;
  expect(d).toContain('"op":"splitClip"');
  expect(d).toContain('"op":"removeRanges"');
  expect(d).toMatch(/até 500/);
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/mcp.test.ts` → FAIL.

- [ ] **Passo 3: Texto exato.** Troque a linha do `trimClip` e acrescente as duas linhas logo depois dela:

```
- {"op":"trimClip","clipId","edge":"start"|"end","delta","ripple"?} apara uma borda (delta>0 = para a direita). Entrada fica no começo, saída no fim. Em vídeo, aparar vale como apagar aquele pedaço em todas as faixas (legendas e títulos em cima saem junto e o que vem depois anda junto); ripple:false não mexe em mais nada.
- {"op":"splitClip","clipId","at"} divide o clipe no tempo "at" da linha do tempo (segundos); a parte da direita vira um clipe novo.
- {"op":"removeRanges","ranges":[[início,fim],...]} apaga trechos (até 500 por vez, em segundos da linha do tempo atual) em todas as faixas: o que está dentro sai, o que atravessa é cortado, e tudo depois anda para trás (sem buraco); legendas e títulos continuam sincronizados. Mais de 500: várias removeRanges na mesma etapa, começando pelos trechos do FIM do vídeo.
```

- [ ] **Passo 4: Rodar.** `npx vitest run tests/mcp.test.ts` → PASS.

- [ ] **Passo 5: Commit.** `git commit -m "Cortes: a IA sabe dividir e apagar trechos"`

---

### Task 6: Som da exportação com cortes

**Arquivos:**
- Criar: `src/core/exportAudio.ts`
- Modificar: `src/core/export.ts:15-50` (`buildFfmpegArgs`)
- Teste: `tests/export.test.ts` (os testes de hoje passam à assinatura nova; dois `describe` novos)

**Interfaces:**
- Consome: Tarefas 2 e 3 (para montar os casos de teste); `SAMPLE_RATE` da Tarefa 1.
- Produz (`exportAudio.ts`):
  - `interface AudioSegment { mediaId: string; path: string; tl0: number; src0: number; n: number; volume: number }`: posição na linha do tempo, posição no arquivo e tamanho, em amostras a 48 kHz.
  - `audioSegments(p: Project): AudioSegment[]`, ordenados por `tl0`.
  - `audioLanes(segs: AudioSegment[]): AudioSegment[][]`.
  - `audioGraph(segs: AudioSegment[], totalSamples: number, firstInput: number): { inputs: string[]; filters: string[]; out: string | null }`.
- Produz (`export.ts`): `buildFfmpegArgs(p: Project, outPath: string, scriptPath: string): { args: string[]; script: string }` e `MAX_ARGS_CHARS = 30_000`.

- [ ] **Passo 1: Atualizar os testes de hoje e escrever os novos.** Em todo lugar que chama `buildFfmpegArgs(project, out)`, use `const { args, script } = buildFfmpegArgs(project, out, `${out}.filtro`)` e grave `script` em `` `${out}.filtro` `` com `writeFileSync` antes de rodar o ffmpeg (inclusive dentro de `exportFrames`). O teste do `.diretor-1-1-abc.part` continua conferindo `args.slice(-3)`. Testes novos:

```ts
/** Mídias m1 e m2 com som e m3 sem som (10 s); clipes de vídeo com mudo e volume opcionais. */
function audioProject(list: { id: string; media?: 'm1' | 'm2' | 'm3'; start: number; duration: number; in: number; muted?: boolean; volume?: number }[]): Project {
  const media = (id: string, path: string, hasAudio: boolean): Op => ({ op: 'addMedia', media: { id, path, name: path, duration: 10, width: 64, height: 64, hasAudio } });
  const ops: Op[] = [media('m1', '/v/a.mp4', true), media('m2', '/v/b.mp4', true), media('m3', '/v/mudo.mp4', false)];
  for (const c of list) {
    ops.push({ op: 'addClip', clip: { kind: 'video', id: c.id, mediaId: c.media ?? 'm1', start: c.start, duration: c.duration, in: c.in } });
    if (c.muted !== undefined || c.volume !== undefined) ops.push({ op: 'updateClip', clipId: c.id, set: { ...(c.muted !== undefined ? { muted: c.muted } : {}), ...(c.volume !== undefined ? { volume: c.volume } : {}) } });
  }
  const p = applyOps(createProject(), ops).project;
  p.settings = { width: 64, height: 64, fps: 30 };
  return p;
}
const cmd = (p: Project) => buildFfmpegArgs(p, '/o/x.part', '/o/x.filtro');

describe('som com cortes (montagem)', () => {
  const one = () => audioProject([{ id: 'v1', start: 0, duration: 4, in: 0 }]);
  it('dividir sem cortar: um segmento só e os mesmos argumentos', () => {
    const split = applyOps(one(), [{ op: 'splitClip', clipId: 'v1', at: 1.5 }]).project;
    expect(audioSegments(split)).toEqual([{ mediaId: 'm1', path: '/v/a.mp4', tl0: 0, src0: 0, n: 192000, volume: 1 }]);
    expect(cmd(split)).toEqual(cmd(one()));
  });
  it('cortar [1; 1,5]: uma entrada, dois trechos e concat', () => {
    const { args, script } = cmd(applyOps(one(), [{ op: 'removeRanges', ranges: [[1, 1.5]] }]).project);
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args).toContain('-filter_complex_script');
    for (const s of ['asplit=2', 'atrim=start_sample=0:end_sample=48000', 'atrim=start_sample=72000:end_sample=192000', 'concat=n=2:v=0:a=1']) expect(script).toContain(s);
    expect(script).not.toContain('amix');
  });
  it('sobreposição vira duas faixas misturadas', () => {
    const p = audioProject([{ id: 'a', start: 0, duration: 3, in: 0 }, { id: 'b', media: 'm2', start: 2, duration: 2, in: 0 }]);
    expect(audioLanes(audioSegments(p)).map((l) => l.map((s) => s.mediaId))).toEqual([['m1'], ['m2']]);
    expect(cmd(p).script).toContain('amix=inputs=2:normalize=0:duration=longest');
  });
  it('pedaço que volta no arquivo abre o arquivo de novo', () => {
    const p = audioProject([{ id: 'a', start: 0, duration: 2, in: 5 }, { id: 'b', start: 2, duration: 2, in: 0 }]);
    expect(audioGraph(audioSegments(p), 4 * 48000, 1).inputs).toEqual(['/v/a.mp4', '/v/a.mp4']);
  });
  it('mídia sem som, pedaço mudo e começo vazio: o som fica no lugar', () => {
    const p = audioProject([
      { id: 'semSom', media: 'm3', start: 0, duration: 1, in: 0 },
      { id: 'fala', start: 1, duration: 2, in: 0 },
      { id: 'mudo', start: 3, duration: 1, in: 2, muted: true },
    ]);
    expect(audioSegments(p).map((s) => s.mediaId)).toEqual(['m1']);
    expect(cmd(p).script).toContain('anullsrc=r=48000:cl=stereo,atrim=end_sample=48000');
    const hidden = applyOps(p, [{ op: 'updateTrack', trackId: 'trk_video', set: { hidden: true } }]).project;
    expect(audioSegments(hidden)).toEqual([]);
    expect(cmd(hidden).script).not.toContain('[aout]');
  });
  it('arquivos demais para a linha de comando do Windows', () => {
    const ops: Op[] = [];
    for (let i = 0; i < 300; i++) {
      ops.push({ op: 'addMedia', media: { id: `m${i}`, path: `C:/videos/${'x'.repeat(110)}${i}.mp4`, name: `${i}.mp4`, duration: 1, width: 64, height: 64, hasAudio: true } });
      ops.push({ op: 'addClip', clip: { kind: 'video', id: `v${i}`, mediaId: `m${i}`, start: round(i * 0.1), duration: 0.1 } });
    }
    expect(() => cmd(applyOps(createProject(), ops).project)).toThrow(/arquivos demais/);
  });
});
```

E, com o ffmpeg de verdade (`describe('som com cortes (ffmpeg)')`, cada teste com tempo limite de 60 s, a não ser o de 1 hora):
  - **300 pedaços:** fonte de 30 s (`testsrc=size=64x64:rate=30:duration=30` + `sine=frequency=330:duration=30`, `-c:v libx264 -g 15 -pix_fmt yuv420p -c:a aac -shortest`), clipe inteiro, `removeRanges` com `Array.from({ length: 299 }, (_, i) => [round(0.1 * (i + 1) - 0.02), round(0.1 * (i + 1))])`. Espera 300 clipes; exporta com `exportFrames`; `probe(out).duration` perto de 24,02 (`toBeCloseTo(24.02, 1)`); a saída de `silencedetect=n=-40dB:d=0.05` não tem `silence_start`.
  - **Divisão sem corte sai perfeita:** a mesma fonte, uma vez com um clipe `[0, 3)` e outra com dois clipes de **duas mídias com o mesmo caminho** (`[0, 1,5)` in 0 e `[1,5, 3)` in 1,5), o que força dois segmentos com `concat`. Decodifique o som dos dois MP4 (`-f f32le -ac 1 -`) e calcule `SNR = 10·log10(Σx² / Σ(x − y)²)`: espera `≥ 90` dB (diferença zero conta como infinito).
  - **Fora da ordem do arquivo:** clipes `[0, 1)` in 2 e `[1, 2)` in 0 da fonte de 30 s: duração perto de 2 e nenhum `silence_start` com `d=0.05`.
  - **1 hora (só no CI):** `it.runIf(!!(process.env.CI || process.env.DIRETOR_TESTE_LONGO))`, tempo limite de 20 minutos. Fonte só de som: `sine=frequency=330:duration=3600`, `-c:a aac -b:a 96k`, num `.m4a` (a mídia declara 64×64). Um clipe de 3600 s; `ranges = Array.from({ length: 300 }, (_, i) => [round(12 * i + 0.1), i === 299 ? 3600 : 12 * (i + 1)])`, o que deixa 300 pedaços de 0,1 s espalhados pela hora. Exporta, confere duração perto de 30 s e som presente, e escreve `console.log` com o tempo da exportação em segundos.

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/export.test.ts` → FAIL.

- [ ] **Passo 3: `audioSegments`.** Um clipe de vídeo é audível quando não está mudo, tem `volume > 0`, a faixa de vídeo não está oculta e a mídia tem som. Cada um vira `{ mediaId, path, tl0: round(start·48000), src0: round(in·48000), n: round(duration·48000), volume }`. Ordene por `tl0`. Um segmento se junta ao anterior **da mesma mídia** quando o volume é igual e as duas bordas encostam, na linha do tempo e no arquivo, com no máximo 1 amostra de diferença. É isso que faz uma divisão sem corte sair igual a um clipe só.

- [ ] **Passo 4: `audioLanes` e `audioGraph`.**
  - Faixas: cada segmento vai para a primeira faixa cujo último fim é `≤ tl0`; se não houver, abre uma faixa nova.
  - Entradas (`inputs`): dentro de uma faixa, a mídia reaproveita a última entrada aberta para ela **naquela faixa** enquanto o arquivo anda para frente (`src0` maior ou igual ao fim do último trecho lido nessa entrada). Quando volta no arquivo, abre outra entrada. Uma entrada nunca é dividida entre faixas: assim nenhum ramo do `asplit` precisa guardar som esperando outro.
  - Filtros, com `k` = índice da entrada e `idx = firstInput + k`:
    - por entrada: `` `[${idx}:a]aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=${K}[i${k}_0][i${k}_1]…` ``;
    - por segmento `j`: `` `[i${k}_${m}]atrim=start_sample=${src0}:end_sample=${src0 + n},asetpts=PTS-STARTPTS,apad=whole_len=${n}` ``, mais `` `,volume=${volume}` `` se o volume não for 1, saindo em `` `[s${j}]` ``;
    - vão antes de um segmento (o começo de uma faixa ou o espaço entre dois): `` `anullsrc=r=48000:cl=stereo,atrim=end_sample=${G}[g${j}]` ``;
    - por faixa: `` `…concat=n=${partes}:v=0:a=1[l${f}]` ``, ou `anull` quando só há uma parte;
    - saída: com uma faixa, `` `[l0]apad=whole_len=${totalSamples}[aout]` ``; com várias, `` `[l0][l1]…amix=inputs=${N}:normalize=0:duration=longest,apad=whole_len=${totalSamples}[aout]` ``.

    O `apad` sempre leva `whole_len`: um `apad` sem tamanho gera som sem fim, e a checagem mostrou que isso encheu o disco. Sem segmentos, `out` é `null` e não há filtro de áudio.
- [ ] **Passo 5: `buildFfmpegArgs`.** Os argumentos são os de hoje até `-i pipe:0`, depois um `-i caminho` por entrada do grafo, `-filter_complex_script scriptPath`, `-map [vout]` e, se houver som, `-map [aout] -c:a aac -b:a 192k`; o resto (vídeo, cores, `+faststart`, `-t total`, `-f mp4 outPath`) fica igual. `totalSamples = round(total · 48000)`, com `total = frameCount/fps`. `script = [filtro de vídeo de hoje, ...filtros de áudio].join(';\n')`. Se a soma de `arg.length + 3` de todos os argumentos passar de `MAX_ARGS_CHARS`, lance `Error` com `` `Este projeto abre arquivos demais de uma vez para exportar (${inputs.length} aberturas). Use menos vídeos diferentes ou menos trechos fora da ordem do arquivo.` ``.

- [ ] **Passo 6: Manter o build compilando.** No `export:start` do `src/main/main.ts`, calcule `scriptPath = tmpPath.replace(/\.part$/, '.filtro')`, grave `script` nele com `writeFileSync` e passe `args` ao `spawn`. Só isso: a limpeza e os erros ficam para a Tarefa 7.

- [ ] **Passo 7: Rodar.** `npx vitest run tests/export.test.ts` → PASS (o de 1 hora fica pulado fora do CI; rode uma vez com `DIRETOR_TESTE_LONGO=1` e anote o tempo no relatório da tarefa). `npm test`; `npm run typecheck`.

- [ ] **Passo 8: Commit.** `git commit -m "Cortes: som da exportação com cortes, uma entrada por vídeo"`

---

### Task 7: Arquivo de filtro no main, limpeza e aviso de som demorado

**Arquivos:**
- Modificar: `src/main/main.ts:249-262` (`ExportJob`), `:295-307` (`abortExport`), `:314-358` (`export:start`), `:384-431` (`export:finish`); `src/renderer/App.tsx` (janela de exportação, perto da linha 190); `scripts/e2e.mjs:743-746`
- Teste: `scripts/e2e.mjs`

**Interfaces:**
- Consome: `buildFfmpegArgs(p, outPath, scriptPath)` da Tarefa 6.
- Produz: `ExportJob.scriptPath: string`; `removeTemps(job: ExportJob): void`, que apaga o `.part` e o `.filtro` sem lançar erro.

- [ ] **Passo 1: Mudar o teste do e2e.** Na verificação final ("a interface cai no meio da exportação"), troque `tmpDuring === 1` por `tmpDuring === 2` (o `.part` e o `.filtro`).

- [ ] **Passo 2: `export:start`.** Guarde `scriptPath` no `ExportJob`. A montagem dos argumentos e a gravação do script (da Tarefa 6) passam para dentro de um `try`: se falhar (inclusive o erro de "arquivos demais"), apague o `.part` e o `.filtro` e devolva `{ error: e.message }`, que já é a mensagem em pt-BR. Só então chame o `spawn`; se o `spawn` falhar, apague os dois também.

- [ ] **Passo 3: Limpeza.** Use `removeTemps(job)` em todo lugar que hoje apaga `job.tmpPath` (os dois do `abortExport` e o de falha ou abandono no `export:finish`). No caminho de sucesso, apague só o `.filtro` logo que o ffmpeg termina com código 0, antes do `moveIntoPlace`.

- [ ] **Passo 4: Aviso.** Na janela de exportação do `App.tsx`, quando o projeto exportado tem mais de 300 clipes de vídeo, mostre abaixo do progresso: `Com muitos cortes, o som pode levar alguns minutos a mais para ficar pronto.` (conte ao iniciar a exportação e guarde no estado dela).

- [ ] **Passo 5: Rodar.** `npm run typecheck`; `npm test`; `xvfb-run -a npm run test:e2e` → todas as verificações passam. As conferências de hoje (`leftovers().length === 0` depois de exportar, cancelar e falhar) agora cobrem o `.filtro` também, porque o nome dele contém `.diretor-`.

- [ ] **Passo 6: Commit.** `git commit -m "Cortes: o arquivo de filtro some junto com o temporário; aviso de som demorado"`

---

### Task 8: Prévia e exportação com até 3 vídeos por mídia

**Arquivos:**
- Criar: `src/renderer/videoSlots.ts`
- Modificar: `src/renderer/video.ts:7-80` (VideoPool) e `:139-154` (`preflight`); `src/renderer/Preview.tsx:73-161` (os dois efeitos e o `draw` da reprodução); `src/renderer/exporter.ts:80-84`
- Teste: `tests/videoSlots.test.ts`; seção "Entrega 1" no `scripts/e2e.mjs`

**Interfaces:**
- Consome: `isContiguous` (Tarefa 2); `removeRanges` e `splitClip` (para o e2e).
- Produz (`videoSlots.ts`, puro, sem DOM):
  - `MAX_SLOTS_PER_MEDIA = 3`; `PREFETCH_SECONDS = 0.5`
  - `interface SlotState { clipId: string | null; used: number }` (`used` = carimbo de último uso)
  - `type SlotPick = { kind: 'keep' | 'reuse' | 'free' | 'steal'; index: number } | { kind: 'new' }`
  - `pickSlot(slots: readonly SlotState[], clip: VideoClip, clipOf: (id: string) => Clip | undefined, protect: ReadonlySet<string>): SlotPick`, nesta ordem:
    1. **keep:** o elemento que já é deste clipe;
    2. **reuse:** o de um pedaço contíguo anterior (`isContiguous(dele, clip)`) que não está protegido;
    3. **free:** um sem clipe ou cujo clipe não existe mais;
    4. **new:** abaixo do teto;
    5. **steal:** o menos usado entre os não protegidos;
    6. **new:** mesmo acima do teto, quando todos estão protegidos (mais de 3 pedaços da mesma mídia na tela ao mesmo tempo).
  - `nextToPrefetch(p: Project, t: number, active: readonly VideoClip[]): VideoClip | null`: o primeiro vídeo que começa em `(t, t + PREFETCH_SECONDS]`, que não está ativo e que não continua um pedaço ativo.
- Produz (`video.ts`, `VideoPool`, agora por mídia):
  - `element(clip: VideoClip, project: Project, protect?: ReadonlySet<string>): HTMLVideoElement | null` (escolhe com `pickSlot` e marca o uso)
  - `peek(clip: VideoClip): HTMLVideoElement | null` (o elemento deste clipe, sem atribuir nada)
  - `prefetch(clip: VideoClip, project: Project, protect: ReadonlySet<string>): void` (atribui e, se o elemento estiver parado e longe de `clip.in`, posiciona em `clip.in + SEEK_EPSILON`, sem tocar)
  - `warm(project: Project): void` (um elemento por mídia usada, para os metadados chegarem cedo)
  - `prune(project: Project): void` (fecha os elementos de mídias que saíram e solta os de clipes que sumiram)
  - `all(): HTMLVideoElement[]`; `frame(clip)`, `dispose()` e `failed` como hoje
  - `preflight` confere uma vez por mídia

- [ ] **Passo 1: Escrever os testes que falham** (`tests/videoSlots.test.ts`, com `videos` de `tests/fixtures.ts`):

```ts
describe('elementos de vídeo por mídia', () => {
  // A [0,2) in 0, B [2,4) in 2 (continua A), C [4,6) in 8, D [6,8) in 10
  const p = videos([['A', 0, 2, 0], ['B', 2, 2, 2], ['C', 4, 2, 8], ['D', 6, 2, 10]]);
  const c = (id: string) => findClip(p, id) as VideoClip;
  const clipOf = (id: string) => findClip(p, id);
  it('escolhe o elemento certo', () => {
    expect(pickSlot([{ clipId: 'A', used: 1 }], c('B'), clipOf, new Set(['B']))).toEqual({ kind: 'reuse', index: 0 });
    expect(pickSlot([{ clipId: 'C', used: 5 }], c('C'), clipOf, new Set())).toEqual({ kind: 'keep', index: 0 });
    expect(pickSlot([{ clipId: 'sumiu', used: 1 }], c('C'), clipOf, new Set())).toEqual({ kind: 'free', index: 0 });
    expect(pickSlot([{ clipId: 'A', used: 1 }], c('C'), clipOf, new Set(['A']))).toEqual({ kind: 'new' });
    const three = [{ clipId: 'A', used: 1 }, { clipId: 'B', used: 2 }, { clipId: 'D', used: 3 }];
    expect(pickSlot(three, c('C'), clipOf, new Set(['A']))).toEqual({ kind: 'steal', index: 1 });
    expect(pickSlot(three, c('C'), clipOf, new Set(['A', 'B', 'D']))).toEqual({ kind: 'new' });
  });
  it('pré-busca só o próximo pedaço que não continua o atual, até 0,5 s antes', () => {
    expect(nextToPrefetch(p, 1.8, [c('A')])).toBeNull();
    expect(nextToPrefetch(p, 3.6, [c('B')])?.id).toBe('C');
    expect(nextToPrefetch(p, 3.4, [c('B')])).toBeNull();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/videoSlots.test.ts` → FAIL.

- [ ] **Passo 3: `videoSlots.ts` e o `VideoPool` por mídia.** O mapa passa a ser mídia → lista de `{ el, path, state: SlotState }`. `element` usa `pickSlot` (com `new` cria um `<video>` igual ao de hoje: mesmos eventos de erro, `seeked` e `loadeddata`) e muda o `clipId` do slot escolhido. `reuse` não recarrega nem busca: o elemento segue tocando de onde o pedaço anterior terminou.

- [ ] **Passo 4: Prévia.**
  - **Parada:** `prune` + `warm`; `element(c, view, protect)` só para os vídeos ativos (`protect` = ids dos ativos); o resto igual a hoje.
  - **Reprodução:** `sync` percorre só os ativos (volume, mudo, busca se a diferença passar de 0,3 s, tocar) com `protect`; chama `prefetch(nextToPrefetch(p, t, ativos))`; e pausa todo elemento de `all()` que não é de um ativo. `masterTime` usa `peek`. O `tick` só chama `draw()` quando cada vídeo ativo tem quadro (`peek` com `readyState ≥ 2` e sem `seeking`) ou erro, então durante a troca o canvas mantém o último quadro bom.
  - `pool.all()` agora devolve elementos: ajuste os dois laços que hoje desestruturam `[, el]`.

- [ ] **Passo 5: Exportação.** `exporter.ts` passa `new Set(active.map((c) => c.id))` como `protect` em `pool.element`.

- [ ] **Passo 6: Seção "Entrega 1" do e2e** (em `scripts/e2e.mjs`, depois de `await page.click('[data-testid=ai-tab-claude]');` e antes do `writeFileSync` final). Projeto novo, corte por `dispatch` (a Tarefa 9 troca as duas linhas marcadas pelo teclado), conferência de quadros e reprodução:

```js
// ---------- Entrega 1: dividir e apagar trecho ----------
const freshProject = (name) =>
  ev((n) => {
    const s = window.__diretor.session;
    s.dirty = false;
    const p = structuredClone(s.project);
    p.clips = [];
    p.media = [];
    p.name = n;
    p.tracks = p.tracks.map((t) => ({ ...t, hidden: false, locked: false }));
    s.load(p, null);
  }, name);
const e1State = () =>
  ev(() => {
    const p = window.__diretor.session.project;
    const r = (n) => Math.round(n * 1000) / 1000;
    const of = (k) => p.clips.filter((c) => c.kind === k).sort((a, b) => a.start - b.start);
    return {
      dur: r(Math.max(...p.clips.map((c) => c.start + c.duration))),
      vids: of('video').map((c) => [r(c.start), r(c.start + c.duration), r(c.in)]),
      caps: of('caption').map((c) => [r(c.start), r(c.start + c.duration)]),
    };
  });
await freshProject('Cortes');
await ev((f) => window.__diretor.importPaths([f]), src);
await page.waitForFunction(() => window.__diretor.session.project.clips.length === 1);
// [Tarefa 9 troca por teclado] dividir em 2 s
await ev(() => { const s = window.__diretor.session; s.dispatch([{ op: 'splitClip', clipId: s.project.clips[0].id, at: 2 }]); });
await ev(() => window.__diretor.session.dispatch([
  { op: 'addClip', clip: { kind: 'caption', text: 'depois do corte', start: 3.6, duration: 1 } },
  { op: 'addClip', clip: { kind: 'caption', text: 'atravessa o corte', start: 2.8, duration: 0.5 } },
]));
// [Tarefa 9 troca por teclado] apagar [3; 3,5]
await ev(() => window.__diretor.session.dispatch([{ op: 'removeRanges', ranges: [[3, 3.5]] }]));
const e1 = await e1State();
check(
  'dividir e apagar trecho: pedaços certos e legendas sincronizadas',
  JSON.stringify(e1) === JSON.stringify({ dur: 5.5, vids: [[0, 2, 0], [2, 3, 2], [3, 5.5, 3.5]], caps: [[2.8, 3], [3.1, 4.1]] }),
  JSON.stringify(e1),
);
```

  Depois, exporte o projeto para `cortes.mp4` (como em "Exportar") e, para `[f, n]` em `[[89, 89], [90, 105], [95, 110]]`, faça a mesma conferência do laço "quadro f: prévia = exportação = quadro n do original" (linhas 351–371 de hoje) usando `cortes.mp4`: prévia = exportação (PSNR > 30) e as duas mostram o quadro `n` do original (contador do testsrc2). Por fim, a reprodução:

```js
await ev(() => window.__diretor.playback.seek(1.7));
await settled();
await ev(() => {
  window.__lum = [];
  const cv = document.querySelector('[data-testid=preview-canvas]');
  const small = Object.assign(document.createElement('canvas'), { width: 32, height: 18 });
  const g = small.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!window.__diretor.playback.get().playing) return;
    g.drawImage(cv, 0, 0, 32, 18);
    const d = g.getImageData(0, 0, 32, 18).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    window.__lum.push([window.__diretor.playback.get().time, s / (d.length / 4)]);
    requestAnimationFrame(tick);
  };
  window.__diretor.playback.set({ playing: true });
  requestAnimationFrame(tick);
});
await page.waitForTimeout(1600);
await ev(() => window.__diretor.playback.set({ playing: false }));
const lum = await ev(() => window.__lum);
check(
  'a reprodução passa pelas emendas (2 s e 3 s) sem quadro preto',
  lum.length > 10 && lum.some(([t]) => t > 3.05) && lum.every(([, l]) => l > 10),
  `${lum.length} quadros, luz mínima ${Math.min(...lum.map(([, l]) => l)).toFixed(0)}`,
);
```

- [ ] **Passo 7: Rodar.** `npx vitest run tests/videoSlots.test.ts` → PASS; `npm run typecheck`; `xvfb-run -a npm run test:e2e` → tudo passa, inclusive as verificações de prévia × exportação de hoje.

- [ ] **Passo 8: Commit.** `git commit -m "Cortes: prévia passa pelas emendas sem tela preta"`

---

### Task 9: Dividir, marcar trecho e apagar pela interface; Antes/Depois

**Arquivos:**
- Criar: `src/renderer/timelineLogic.ts`
- Modificar: `src/renderer/store.ts` (marcas, Antes/Depois), `src/renderer/Timeline.tsx` (botões `:149-184`, régua `:219-231`, chips e hachurados `:270-292`), `src/renderer/App.tsx:90-97` (teclas), `src/renderer/Preview.tsx` (Antes/Depois), `src/renderer/ui.tsx` (ícones `scissors` e `cutRange`), `src/renderer/styles.css`
- Teste: `tests/timelineLogic.test.ts`; e2e

**Interfaces:**
- Consome: `snapToFrame` (Tarefa 1), `splitClip`/`removeRanges` (Tarefas 2 e 3), `DraftInfo` com `seams`, `ripple` e `addedClipIds`, e `mapPlayhead` (Tarefa 4).
- Produz (`timelineLogic.ts`, puro):
  - `interface Marks { in: number | null; out: number | null }`; `withIn(m: Marks, t: number): Marks`; `withOut(m: Marks, t: number): Marks` (tempo com `round`); `markedRange(m: Marks): [number, number] | null` (só quando os dois existem e `out − in ≥ 0.001`)
  - `splitTargets(view: Project, selection: string[], t: number): string[]`: os selecionados em faixa destravada que contêm `t` com pelo menos `MIN_DURATION` de cada lado; se nenhum, os vídeos em faixa destravada que contêm `t` com a mesma folga
  - `fmtRemoved(sec: number): string`: abaixo de 10 s, `−0,4 s` (uma casa, vírgula); senão `−m:ss`. Usa o sinal U+2212 e é formatado ali mesmo, sem importar o `store`
- Produz (`store.ts`): `marks` (`get`, `set`, `subscribe`) e `useMarks(): Marks`; `compare` (`get(): boolean`, `set(v: boolean)`, `subscribe`), `useCompare(): boolean` e `shownProject(): Project`, que devolve `session.project` quando `compare.get() && session.draftInfo.ripple` e `session.view` nos outros casos.
- Produz (`Timeline.tsx`): `splitAtPlayhead(): void` e `deleteMarkedRange(): void`.

- [ ] **Passo 1: Escrever os testes que falham** (`tests/timelineLogic.test.ts`):

```ts
describe('marcas, alvos do Ctrl+B e chips', () => {
  it('marcas I e O', () => {
    const m = withOut(withIn({ in: null, out: null }, 3), 3.5);
    expect(markedRange(m)).toEqual([3, 3.5]);
    expect(markedRange(withIn(m, 4))).toBeNull(); // invertidas
    expect(markedRange({ in: 3, out: 3.0005 })).toBeNull(); // tamanho zero
    expect(markedRange({ in: null, out: 2 })).toBeNull();
  });
  it('Ctrl+B divide o selecionado sob a agulha; sem seleção útil, o vídeo; perto da borda, nada', () => {
    // v1 [0,6), t1 título [0,6), c1 legenda [3,4)
    const p = applyOps(createProject(), [
      { op: 'addMedia', media: { id: 'm1', path: '/v/a.mp4', name: 'a.mp4', duration: 10, width: 64, height: 64, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', start: 0, duration: 6 } },
      { op: 'addClip', clip: { kind: 'title', id: 't1', text: 'A', start: 0, duration: 6 } },
      { op: 'addClip', clip: { kind: 'caption', id: 'c1', text: 'b', start: 3, duration: 1 } },
    ]).project;
    expect(splitTargets(p, ['t1', 'c1'], 2)).toEqual(['t1']);
    expect(splitTargets(p, [], 2)).toEqual(['v1']);
    expect(splitTargets(p, [], 6.02)).toEqual([]);
    expect(splitTargets(p, [], 0.02)).toEqual([]);
    expect(splitTargets(p, ['c1'], 5)).toEqual(['v1']);
    const locked = applyOps(p, [{ op: 'updateTrack', trackId: 'trk_video', set: { locked: true } }]).project;
    expect(splitTargets(locked, [], 2)).toEqual([]);
  });
  it('chip da emenda', () => {
    expect([0.4, 4, 12, 75].map(fmtRemoved)).toEqual(['\u22120,4 s', '\u22124,0 s', '\u22120:12', '\u22121:15']);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/timelineLogic.test.ts` → FAIL.

- [ ] **Passo 3: `timelineLogic.ts` e as stores** de Interfaces.

- [ ] **Passo 4: Ações.**
  - `splitAtPlayhead()`: `t = snapToFrame(playback.get().time, fps)`; `ids = splitTargets(session.view, selection, t)`; vazio → `showToast('Para dividir, coloque a agulha no meio de um clipe (longe das bordas).')`; senão `run(ids.map((clipId) => ({ op: 'splitClip', clipId, at: t })), 'Dividir')`.
  - `deleteMarkedRange()`: sem `markedRange` → `showToast('Marque o trecho na régua (Shift+arrastar, ou I e O) para apagar.')`; senão `run([{ op: 'removeRanges', ranges: [r] }], 'Apagar trecho')` e, se deu certo, limpa as marcas e leva a agulha para `r[0]`.

- [ ] **Passo 5: Teclas** (`App.tsx`, depois da conferência de campo de texto): Ctrl+B → `splitAtPlayhead` (com `preventDefault`); Shift+Delete ou Shift+Backspace → `deleteMarkedRange`, **antes** do Delete comum; `i` e `o` sem Ctrl → `withIn`/`withOut` na agulha; Escape → limpa as marcas.

- [ ] **Passo 6: Linha do tempo.**
  - **Barra, nesta ordem:** desfazer, refazer, lixeira; `Dividir` (`data-testid="split"`, dica `'Dividir na agulha (Ctrl+B)'`); `Apagar trecho` (`data-testid="delete-range"`, desligado sem `markedRange`, dica `'Apagar o trecho marcado em todas as faixas (Shift+Delete)'`); `Adicionar legenda`; `Título`.
  - **Régua:** Shift+arrastar marca o trecho (início e fim no quadro, em qualquer direção); sem Shift, continua arrastando a agulha. Uma faixa `.range-band` mostra o trecho marcado; linhas finas `.mark-in`/`.mark-out` mostram uma marca sozinha.
  - **Rascunho:** um `.seam-chip` por emenda na faixa Vídeo, em `seam.at * pps`, com `fmtRemoved(seam.removed)` e a dica `` `Corte do rascunho: ${fmtRemoved(removed)}` ``. Os clipes hachurados de "Remoção proposta" não aparecem quando `draftInfo.ripple` (as posições do projeto não valem mais). `isNewDraft` e o filtro das zonas usam `addedClipIds`.
- [ ] **Passo 7: Antes/Depois na prévia.** Com `s.activeStep && draftInfo.ripple`, dois botões ao lado do selo do rascunho: `Antes` (`data-testid="ab-before"`) e `Depois` (`data-testid="ab-after"`). Trocar faz `from = shownProject()`, `compare.set(…)`, `playback.seek(mapPlayhead(from, shownProject(), t))`. A prévia, o `togglePlay`, o `hitTest` e a caixa de seleção usam `shownProject()` em vez de `session.view`. Em "Antes", clicar no canvas não seleciona nem arrasta, e o selo diz `Antes do rascunho`. Quando o rascunho deixa de ter ripple (aceito, descartado ou outra etapa), `compare` volta a `false`.

- [ ] **Passo 8: e2e.** Na seção "Entrega 1":
  - Troque a linha do `splitClip` por: tirar o foco de qualquer campo (`document.activeElement?.blur()`), ir a 0,01 s, apertar `Control+B` e conferir (`check`) que continua 1 clipe e que `document.body.innerText` contém `coloque a agulha`. Depois, ir a 2 s e apertar `Control+B`.
  - Troque a linha do `removeRanges` por: agulha em 3, tecla `i`; agulha em 3,5, tecla `o`; conferir que `[data-testid=delete-range]` está ligado; apertar `Shift+Delete`. O `check` de pedaços e legendas continua igual.
  - Depois da verificação de reprodução:

```js
const ctxE1 = await tool('get_context');
const pE1 = await tool('propose_edit', { requestId: 'e2e-corte', baseRevision: ctxE1.revision, title: 'Tirar um trecho', steps: [{ label: 'Corte', ops: [{ op: 'removeRanges', ranges: [[1, 1.5]] }] }] });
await page.waitForSelector('.seam-chip');
const chips = await ev(() => [...document.querySelectorAll('.seam-chip')].map((e) => e.textContent.trim()));
check('rascunho com corte mostra a emenda "−0,5 s"', pE1.status === 'active' && chips.length === 1 && chips[0] === '\u22120,5 s', JSON.stringify(chips));
await page.click('[data-testid=ab-before]');
const tcBefore = await page.textContent('[data-testid=timecode]');
await page.click('[data-testid=ab-after]');
const tcAfter = await page.textContent('[data-testid=timecode]');
check('Antes/Depois troca a prévia entre o projeto e o rascunho', /\/ 0:05\.50/.test(tcBefore) && /\/ 0:05\.00/.test(tcAfter), `${tcBefore} | ${tcAfter}`);
await discardOpen();
```

- [ ] **Passo 9: Rodar.** `npx vitest run tests/timelineLogic.test.ts` → PASS; `npm run typecheck`; `xvfb-run -a npm run test:e2e` → tudo passa.

- [ ] **Passo 10: Commit.** `git commit -m "Cortes: Ctrl+B, trecho na régua, Shift+Delete e Antes/Depois"`

---

### Task 10: Linha do tempo leve com milhares de pedaços e vídeos de horas

**Arquivos:**
- Modificar: `src/renderer/Timeline.tsx` (componente inteiro: `usePlayback` sai, zoom `:72-79` e `:183`, régua `:116-118` e `:219-231`, `geom` `:120-141`, `ClipBlock` `:313+`), `src/renderer/timelineLogic.ts`, `src/renderer/styles.css`
- Teste: `tests/timelineLogic.test.ts`; e2e

**Interfaces:**
- Produz (`timelineLogic.ts`):
  - `visibleClips<T extends { start: number; duration: number }>(clips: T[], t0: number, t1: number): T[]`, que filtra `start < t1 && start + duration > t0`
  - `tickStep(pps: number): number`: o menor de `[0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]` com `passo · pps ≥ 70`
  - `zoomBounds(total: number, viewportPx: number): { min: number; fit: number; max: number }`: com `raw = (viewportPx − 40) / max(total, 5)`, `min = Math.min(20, Math.max(0.05, raw))`, `fit = clamp(raw, min, 300)` e `max = 400`

- [ ] **Passo 1: Escrever os testes que falham** (em `tests/timelineLogic.test.ts`):

```ts
describe('linha do tempo longa', () => {
  it('só os pedaços na janela', () => {
    const clips = Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, start: 1.2 * i, duration: 1 }));
    expect(visibleClips(clips, 600, 612).map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p${500 + i}`));
  });
  it('passo da régua acompanha o zoom', () => {
    expect([80, 300, 1].map(tickStep)).toEqual([1, 0.5, 120]);
  });
  it('o zoom mínimo cabe uma hora na janela', () => {
    const h = zoomBounds(3600, 1240);
    expect(h.fit).toBeCloseTo(1200 / 3600, 6);
    expect(h.min).toBeLessThanOrEqual(h.fit);
    expect(zoomBounds(10, 1240)).toMatchObject({ fit: 120, max: 400 });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx vitest run tests/timelineLogic.test.ts` → FAIL.

- [ ] **Passo 3: Implementar as três funções.**

- [ ] **Passo 4: Desempenho no componente.**
  - **Agulha própria:** um componente `Playhead({ pps })` com `usePlayback`, e o `Timeline` deixa de usar `usePlayback`. Assim tocar o vídeo não redesenha a linha do tempo a cada quadro.
  - **`ClipBlock` com `React.memo`:** recebe callbacks estáveis (`useCallback` que leem o estado atual por ref) com as assinaturas `onDown(clipId: string, kind: 'move' | 'trimL' | 'trimR', e: React.PointerEvent)` e `onKfDown(clipId: string, t: number, prop: string, keyframeId: string, e: React.PointerEvent)`.
  - **Só o visível:** guarde `scrollLeft` e a largura da área (evento `scroll` agrupado por `requestAnimationFrame`, mais `ResizeObserver`) e desenhe só `visibleClips(clips, (scrollLeft − 300)/pps, (scrollLeft + largura + 300)/pps)` em cada faixa, inclusive Áudio e os chips.
  - **Régua:** `tickStep(pps)`, só os traços na janela; o rótulo continua só nos segundos inteiros (`fmtTime`).
  - **Zoom:** o controle passa a ser logarítmico (`data-testid="zoom"`, `min = log2(zb.min)`, `max = log2(zb.max)`, `step = 0.01`, `pps = 2 ** valor`), com `zb = zoomBounds(total, largura)`. O ajuste automático usa `zb.fit` em vez de limitar a `[20, 300]`.
  - **Arrastar a borda:** a prévia do arrasto passa a ser `applyOps(view, [{ op: 'trimClip', clipId, edge, delta: clampTrimDelta(…) }]).project` memorizado por `(view, clipId, edge, delta)` (se falhar, a view sem mudança). O `geom` lê as posições dessa prévia, então durante o arrasto as legendas e os títulos também mostram onde vão parar. O e2e de hoje ("arrastar a borda esquerda do vídeo…") continua valendo.

- [ ] **Passo 5: e2e** (na seção "Entrega 1", depois do bloco do Antes/Depois):

```js
const pedacos = join(out, 'pedacos.mp4');
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=30', '-c:v', 'libx264', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', pedacos]);
await freshProject('Pedaços');
await ev((f) => window.__diretor.importPaths([f]), pedacos);
await page.waitForFunction(() => window.__diretor.session.project.clips.length === 1);
const applyE1 = await ev(() => {
  const s = window.__diretor.session;
  const r = (n) => Math.round(n * 1000) / 1000;
  const ranges = Array.from({ length: 299 }, (_, i) => [r(0.1 * (i + 1) - 0.02), r(0.1 * (i + 1))]);
  const t0 = performance.now();
  const res = s.dispatch([{ op: 'removeRanges', ranges }]);
  return { ok: res.ok, ms: performance.now() - t0, n: s.project.clips.length };
});
const tSettle = Date.now();
await settled();
const settleMs = Date.now() - tSettle;
await ev(() => {
  const z = document.querySelector('[data-testid=zoom]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(z, z.max);
  z.dispatchEvent(new Event('input', { bubbles: true }));
});
const inDom = await ev(() => document.querySelectorAll('[data-clip]').length);
check('300 pedaços: aplica e a linha do tempo desenha só os visíveis', applyE1.ok && applyE1.n === 300 && inDom < 120, `aplicar ${applyE1.ms.toFixed(0)} ms, prévia pronta em ${settleMs} ms, ${inDom} blocos desenhados`);
```

- [ ] **Passo 6: Rodar.** `npx vitest run tests/timelineLogic.test.ts`; `npm run typecheck`; `xvfb-run -a npm run test:e2e` → tudo passa.

- [ ] **Passo 7: Commit.** `git commit -m "Cortes: linha do tempo leve com muitos pedaços e zoom para vídeos longos"`

---

### Task 11: Exportar 300 pedaços no app e verificação completa

**Arquivos:**
- Modificar: `scripts/e2e.mjs` (seção "Entrega 1")
- Teste: e2e e a suíte inteira

**Interfaces:** Consome tudo o que veio antes.

- [ ] **Passo 1: e2e**, logo depois do bloco dos 300 pedaços:

```js
const pedOut = join(out, 'pedacos-exportado.mp4');
const tExp = Date.now();
const pedExp = await ev((p) => window.__diretor.exportProject(window.__diretor.session.project, { outPath: p }), pedOut);
const pedProbe = spawnSync(FFMPEG, ['-hide_banner', '-i', pedOut], { encoding: 'utf8' }).stderr;
const pd = /Duration: (\d+):(\d+):([\d.]+)/.exec(pedProbe);
const pedSecs = pd ? Number(pd[1]) * 3600 + Number(pd[2]) * 60 + Number(pd[3]) : 0;
const pedSil = String(spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', pedOut, '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']).stderr);
check(
  'exporta 300 pedaços: duração certa, som contínuo e nenhum temporário sobrando',
  pedExp.ok && Math.abs(pedSecs - 24.02) < 0.1 && /Audio:/.test(pedProbe) && !/silence_start/.test(pedSil) && leftovers().length === 0,
  `${((Date.now() - tExp) / 1000).toFixed(1)} s; ${pedSecs} s; ${pedExp.error ?? ''}`,
);
```

- [ ] **Passo 2: Verificação completa.** `npm run typecheck` → sem erros; `npm test` → todos passam; `xvfb-run -a npm run test:e2e` → `N/N verificações passaram`. Anote no relatório os tempos que o e2e escreveu (aplicar 299 trechos, prévia pronta, exportar 300 pedaços) e o tempo do teste de 1 hora, se tiver rodado.

- [ ] **Passo 3: Conferir o aceite da E1 contra a spec** (linha E1 da tabela): Ctrl+B divide (Tarefa 9); Shift+Delete apaga em todas as faixas com legendas sincronizadas (Tarefas 3 e 9); reprodução sem tela preta nas emendas (Tarefa 8); 300 pedaços de uma mídia de 1 h exportam no Windows com o tempo do áudio medido no CI (Tarefa 6, teste de 1 hora, que roda no CI do Windows); divisão sem corte sai perfeita no áudio (Tarefa 6).

- [ ] **Passo 4: Commit.** `git commit -m "Cortes: e2e exporta 300 pedaços no app"`

---

## Decisões de quem escreveu o plano (ajustáveis sem voltar ao usuário)

- O chip da emenda mostra `−0,4 s` abaixo de 10 s e `−m:ss` a partir daí: "−0:00" esconderia os cortes de respiração, que têm menos de 1 s.
- `cutTextTime` e `shiftClips` não entram no `OPS_HELP`: são peças da expansão. A IA usa `removeRanges`, `splitClip` e `trimClip`.
- Uma entrada de áudio da exportação nunca é dividida entre faixas que se sobrepõem, para nenhum ramo do `asplit` ter de guardar som esperando outro.
- O teste de 1 hora roda só no CI (variável `CI`) ou com `DIRETOR_TESTE_LONGO=1`, para não pesar no `npm test` do dia a dia.

## Correções durante a execução

- **Tarefa 1, keyframes (revisões da tarefa):** o algoritmo original de `cutKeyframes` só tirava ou movia pontos, e um corte que pegava um fade podia deixar o título invisível ou criar um fade longo. `partitionKeyframes` dava a cada camada o valor da própria curva na borda, mas a prévia desenha uma curva só por propriedade: todas as camadas juntas, e pontos de grupos diferentes no mesmo instante ficam na ordem da extensão dos grupos. Regra adotada: tudo é decidido pela curva desenhada. Na divisão, os pontos que caem na borda levam o valor que chegava (lado esquerdo) e o valor que sai (lado direito, com a aceleração do trecho seguinte). Sem ponto na borda, cada lado ganha no máximo um ponto novo, só onde o desenho mudaria, e ele fica no grupo da animação só quando o trecho dividido é de um grupo só. Um corte que encosta no começo ou no fim do texto dá o mesmo resultado que aparar aquela borda (`remapKeyframes`). Num corte no meio, uma propriedade só com animações prontas presas às bordas segue o aparar do fim: entrada fica, saída acompanha o fim, grupo do clipe inteiro estica. Nas demais propriedades, os pontos do trecho saem e os de depois andam junto. A emenda ganha um ponto feito à mão, ou um degrau (o valor que chegava e depois o valor que volta, no mesmo instante), com ids determinísticos e únicos. As listas devolvidas ficam na ordem de `sortedKeyframes`. Limites aceitos: dividir ou cortar dentro de um trecho com aceleração (easeIn, easeOut, easeInOut) recomeça a aceleração em cada lado; trechos lineares e 'hold' ficam exatos. Pontos de camadas diferentes no mesmo instante, longe da emenda, podem trocar de ordem quando o corte tira a ponta de um grupo; isso já acontece ao aparar, ao editar um ponto e ao reabrir o projeto.
- **Tarefa 3, trecho curto (relato da implementação):** as sequências do plano criavam o pedaço a apagar e depois o removiam, e o `splitClip` recusa pedaço com menos de 40 ms. Assim, apagar 1 quadro, apagar 1 quadro depois de uma emenda, ou os 299 cortes de 20 ms da Tarefa 6 davam erro. Regra adotada: quando o pedaço que sairia do vídeo tem menos de `MIN_DURATION`, o plano apara o vizinho que fica com `trimClip` (`ripple: false`) em vez de dividir. No meio do clipe: divide em `b'` e apara o fim em `b' − a'`. No começo: apara o início em `b' − s`. No fim: apara o fim em `fim − a'`. Os casos longos seguem o plano. Nessas emendas os keyframes seguem a regra do aparar.
- **Tarefa 3, desempenho dos keyframes:** o corte de texto não copia mais o clipe inteiro, e `remapKeyframes` aceita um conjunto opcional `only` de propriedades. Num corte no meio, só as propriedades presas às bordas passam pelo aparar. O resultado é o mesmo, mais rápido; um teste extra corta com os 500 trechos um título de 1 hora com movimento e fades em menos de 1 s.
- **Tarefa 4, faixa do rascunho (da revisão da Tarefa 3):** `range` também ignora o `trimClip` de vídeo cuja borda aparada tem uma emenda no rascunho, porque o chip da emenda marca o lugar. Sem isso, apagar 1 quadro pintaria a faixa "Rascunho da IA" no pedaço inteiro, e um corte maior não pintaria nada.
- **Tarefa 4, agulha e faixa do rascunho (revisão da tarefa):** a busca do Passo 4 para um instante cortado ("o início do vídeo da mesma mídia com o menor `in ≥ src`") só chega à borda do corte quando o mesmo arquivo continua depois dele. Com dois arquivos, pedaços fora da ordem do arquivo ou uma tomada inteira cortada, a agulha parava longe do corte, contra a especificação ("se aquele instante foi cortado, ela vai para a borda do corte"). Regra adotada: um vídeo de `to` só vale para o conteúdo de um vídeo de `from` quando é da mesma mídia e tem o mesmo id, ou é um pedaço novo (id que `from` não tem), ou o vídeo de `from` não existe em `to`; havendo vários, vale o de mesmo id e depois o mais perto. Para um instante cortado, na sequência de vídeos de `from` sem buraco que contém a agulha, o último instante até ela que ainda existe em `to` (senão, o primeiro depois dela) dá a borda do corte; nem isso, `t` limitado. Na segunda rodada: um vídeo de outro id só vale quando mostra de fato o trecho, sem contar o simples encostar na ponta do arquivo (senão o fim do vizinho no arquivo "mostrava" o primeiro instante cortado), e, quando o vídeo de `from` sumiu de `to`, um vídeo que existe nas duas versões só vale se não for uma cópia do mesmo trecho (senão tirar a cópia de abertura levava a agulha para o meio do vídeo). Limite aceito: com o mesmo trecho do arquivo em dois lugares e as duas cópias cortadas, a agulha pode ir para a outra cópia. Na faixa do rascunho, dividir e encurtar texto seguem a regra do aparar: só ficam fora da faixa quando uma emenda marca o lugar (na borda da divisão, ou dentro do texto). Sem emenda (corte no começo ou no fim da linha do tempo, ou num trecho só de texto), a faixa continua nos pedaços.

- **Tarefa 4, agulha (terceira e quarta rodadas):** "mostrar o ponto" usa a mesma tolerância da prévia (`ACTIVE_EPS`, exportada de `render.ts`): um vídeo mostra um instante do arquivo de `in` (inclusive) até o fim (exclusive), qualquer que seja o id. Assim o último instante de um pedaço não passa para o vizinho no arquivo, e o instante exato de uma divisão vai para o pedaço da direita, mesmo depois de ele ser movido. Na busca da borda de um corte, o pedaço de mesmo id ainda conta até o fim (o fim do que ficou é a borda), e um de outro id precisa ter mais de 1 amostra em comum.
- **Tarefa 6, som de pedaço depois do fim do áudio (revisão da tarefa):** quando o trecho de um pedaço fica todo depois do fim do som do arquivo (vídeo com som mais curto que a imagem), o `atrim` não entrega nada e o silêncio do `apad` sai sem marcação de tempo. O `concat` recusa e a exportação falha ("Invalid data found when processing input"), ou, com o pedaço no fim da faixa, o som dele sai encolhido. Regra adotada: cada trecho ganha `asetpts=N/SR/TB` logo depois do `apad` (antes do `volume`), o que remarca o tempo pela contagem de amostras e não muda nada quando o tempo já era contínuo. Testes: a montagem com o `asetpts`, duas exportações com som mais curto que a imagem (Shift+Delete com um clipe depois, e o pedaço no fim da faixa) e um teste de posição com um som que cresce com o tempo do arquivo.
- **Tarefa 8, emendas e caixa de seleção na prévia (relato da implementação e revisão da tarefa):** só com a ordem do Passo 3 (keep antes de reuse), o pedaço da direita de uma divisão ficava com um elemento parado em outro ponto, e a imagem congelava uns 170 ms na emenda. Regra adotada: quando um pedaço ganha elemento, os pedaços não protegidos que o continuam sem emenda soltam o deles (`slotsToRelease`) e seguem no mesmo elemento. A sincronização forçada não busca quando o elemento já está a menos de 1 ms do ponto, e o relógio da reprodução não volta para antes do começo do pedaço ativo. Durante a reprodução, o redesenho que vem dos eventos do vídeo espera os quadros como o `tick`. A conferência da reprodução no e2e espera o tempo passar de 3,1 s, por no máximo 3,2 s, em vez de 1,6 s fixos. Na revisão: `frame(clip)` só devolve quadro quando o pedaço tem elemento, e, com a prévia parada, só os vídeos ativos ganham um, depois de a prévia montar a caixa de seleção. Assim, ao pular para um pedaço sem elemento (por exemplo, voltar para a esquerda de uma divisão), a caixa sumia até a próxima mudança. Regra adotada: sem quadro do pedaço, a caixa usa a largura e a altura do vídeo lidas de outro elemento da mesma mídia (`videoSize(clip)` do `VideoPool`); o desenho e o clique na prévia não mudam. Na mesma rodada, a espera por quadros conta só os vídeos que aparecem (com a faixa de vídeo escondida, os textos não congelam), e o redesenho da prévia parada não roda se a reprodução começou durante a busca.
