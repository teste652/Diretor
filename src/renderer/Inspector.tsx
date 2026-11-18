import { useState } from 'react';
import { type CaptionPreset, type Clip, EASINGS, type Easing, findClip } from '../core/model';
import { ANIMATION_PRESETS, type AnimationPreset, CAPTION_PRESETS, type TrimEdge, clampTrimDelta } from '../core/operations';
import { clipLocalTime, keyframeGroups, propAtPlayhead, propDef, propsForKind } from '../core/properties';
import { playback, session, usePlayback, useSession } from './store';
import { ColorField, NumberField, TextField, run } from './ui';

const EASE_LABEL: Record<Easing, string> = { linear: 'Linear', easeIn: 'Acelerar', easeOut: 'Desacelerar', easeInOut: 'Suave', hold: 'Segurar' };

export function Inspector() {
  const s = useSession();
  const pb = usePlayback();
  const id = s.selection.clipIds[0];
  const c = id ? findClip(s.view, id) : undefined;
  if (!c) return <div className="empty">Selecione um clipe na linha do tempo ou na prévia para editar texto, tempo, estilo e animação.</div>;
  const isDraft = s.draftInfo.clipIds.has(c.id);
  const set = (changes: Record<string, unknown>, label = 'Editar clipe') => run([{ op: 'updateClip', clipId: c.id, set: changes }], label);
  // Aparar pelo painel: mesmo comportamento das bordas na linha do tempo (limitado ao arquivo).
  const trim = (edge: TrimEdge, delta: number, label: string) => {
    const cur = findClip(session.view, c.id);
    if (!cur) return;
    const d = clampTrimDelta(session.view, cur, edge, delta);
    if (Math.abs(d) > 1e-6) run([{ op: 'trimClip', clipId: c.id, edge, delta: d }], label);
  };
  const local = clipLocalTime(c, pb.time);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{c.kind === 'video' ? 'Vídeo' : c.kind === 'title' ? 'Título' : 'Legenda'}</strong>
        {isDraft && <span className="badge">{s.adjustMode ? 'Ajustando rascunho' : 'No rascunho'}</span>}
      </div>
      {isDraft && <p className="hint">Este clipe está no rascunho do Claude: o que você mudar aqui entra no rascunho e só é gravado quando você aceitar.</p>}

      {c.kind !== 'video' && (
        <div className="field" style={{ gridTemplateColumns: '1fr' }}>
          <TextField multiline value={c.text} onCommit={(v) => set({ text: v }, 'Editar texto')} />
        </div>
      )}
      <div className="field">
        <label>Início (s)</label>
        <NumberField value={c.start} min={0} step={1 / 30} digits={3} onCommit={(v) => set({ start: v }, 'Mover clipe')} />
      </div>
      <div className="field">
        <label>{c.kind === 'video' ? 'Duração (s)' : 'Fim (s)'}</label>
        {c.kind === 'video' ? (
          <NumberField value={c.duration} min={0.04} step={1 / 30} digits={3} onCommit={(v) => trim('end', v - c.duration, 'Aparar fim')} />
        ) : (
          <NumberField value={c.start + c.duration} min={c.start + 0.04} step={1 / 30} digits={3} onCommit={(v) => trim('end', v - (c.start + c.duration), 'Editar fim')} />
        )}
      </div>
      {c.kind === 'video' && (
        <>
          <div className="field">
            <label>Corte inicial</label>
            <NumberField value={c.in} min={0} step={1 / 30} digits={3} title="Ponto de entrada no arquivo original (o clipe fica no lugar e o fim acompanha)" onCommit={(v) => trim('start', v - c.in, 'Aparar início')} />
          </div>
          <div className="field">
            <label>Volume</label>
            <div className="row">
              <NumberField value={c.volume} min={0} max={1} step={0.05} onCommit={(v) => set({ volume: v }, 'Volume')} />
              <button className={`btn ${c.muted ? 'on' : ''}`} onClick={() => set({ muted: !c.muted }, 'Mudo')}>
                Mudo
              </button>
            </div>
          </div>
        </>
      )}
      {c.kind !== 'video' && <StyleSection clip={c} set={set} />}

      <div className="section">
        <h4>Animação · {local.toFixed(2)}s do clipe</h4>
        {propsForKind(c.kind).map((d) => {
          const ap = c.props[d.name];
          // Valor e ponto do mesmo instante (o que a prévia mostra; com dois grupos no mesmo tempo, o último).
          const { value, keyframe: kfHere } = propAtPlayhead(c, d.name, pb.time);
          return (
            <div className="prop-row" key={d.name}>
              <label>{d.label}</label>
              <NumberField
                value={value}
                min={d.min}
                max={d.max}
                step={d.step}
                digits={d.step < 1 ? 2 : 0}
                onCommit={(v) =>
                  run(
                    [ap?.keyframes.length ? { op: 'setKeyframe', clipId: c.id, prop: d.name, t: local, v, keyframeId: kfHere?.id } : { op: 'setProperty', clipId: c.id, prop: d.name, value: v }],
                    d.label,
                  )
                }
              />
              <button
                className={`kf-btn ${kfHere ? 'has' : ap?.keyframes.length ? 'animated' : ''}`}
                title={kfHere ? 'Remover ponto neste tempo' : 'Adicionar ponto neste tempo'}
                onClick={() =>
                  run(
                    [kfHere ? { op: 'removeKeyframe', clipId: c.id, prop: d.name, keyframeId: kfHere.id } : { op: 'setKeyframe', clipId: c.id, prop: d.name, t: local, v: value, ease: 'easeInOut' }],
                    kfHere ? 'Remover ponto' : 'Adicionar ponto',
                  )
                }
              >
                <span className="dia" />
              </button>
            </div>
          );
        })}
        <Groups clip={c} />
        <SelectedKeyframe clip={c} />
        <PresetPicker clip={c} />
      </div>
    </div>
  );
}

function StyleSection({ clip: c, set }: { clip: Extract<Clip, { kind: 'title' | 'caption' }>; set: (ch: Record<string, unknown>, l?: string) => void }) {
  return (
    <div className="section">
      <h4>Estilo</h4>
      {c.kind === 'caption' && (
        <div className="field">
          <label>Modelo</label>
          <select className="input" value={c.preset} onChange={(e) => set({ preset: e.target.value as CaptionPreset }, 'Estilo da legenda')}>
            <option value="padrao">Padrão (sombra)</option>
            <option value="caixa">Caixa escura</option>
            <option value="destaque">Destaque azul</option>
          </select>
        </div>
      )}
      <div className="field">
        <label>Tamanho</label>
        <NumberField value={c.style.fontSize} min={6} max={400} step={1} digits={0} onCommit={(v) => set({ style: { fontSize: v } }, 'Tamanho do texto')} />
      </div>
      <div className="field">
        <label>Peso</label>
        <select className="input" value={c.style.fontWeight} onChange={(e) => set({ style: { fontWeight: Number(e.target.value) } }, 'Peso do texto')}>
          {[400, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Cor</label>
        <ColorField value={toHex(c.style.color)} onCommit={(v) => set({ style: { color: v } }, 'Cor do texto')} />
      </div>
      <div className="field">
        <label>Fundo</label>
        <div className="row">
          <ColorField value={toHex(c.style.background || '#000000')} onCommit={(v) => set({ style: { background: v } }, 'Fundo do texto')} />
          <button className={`btn ${c.style.background ? 'on' : ''}`} onClick={() => set({ style: { background: c.style.background ? '' : 'rgba(0,0,0,0.55)' } }, 'Fundo do texto')}>
            {c.style.background ? 'Com' : 'Sem'}
          </button>
          <button className={`btn ${c.style.shadow ? 'on' : ''}`} onClick={() => set({ style: { shadow: !c.style.shadow } }, 'Sombra')}>
            Sombra
          </button>
        </div>
      </div>
    </div>
  );
}

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

const GROUP_LABEL: Record<string, string> = { entrada: 'Entrada', saida: 'Saída' };

function Groups({ clip: c }: { clip: Clip }) {
  const groups = keyframeGroups(c);
  if (!groups.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="group-chip hint">
        <span>Grupo</span>
        <span>Início</span>
        <span>Duração</span>
      </div>
      {groups.map((g) => (
        <div className="group-chip" key={g.group}>
          <span className="name">{GROUP_LABEL[g.group] ?? g.group}</span>
          <NumberField
            value={g.start}
            min={0}
            max={Math.max(0, c.duration - Math.max(0.01, g.end - g.start))}
            step={0.05}
            onCommit={(v) => run([{ op: 'retimeGroup', clipId: c.id, group: g.group, start: v, duration: Math.max(0.01, g.end - g.start) }], 'Mover animação')}
          />
          <NumberField
            value={g.end - g.start}
            min={0.01}
            max={Math.max(0.01, c.duration - g.start)}
            step={0.05}
            onCommit={(v) => run([{ op: 'retimeGroup', clipId: c.id, group: g.group, start: g.start, duration: v }], 'Duração da animação')}
          />
        </div>
      ))}
    </div>
  );
}

function SelectedKeyframe({ clip: c }: { clip: Clip }) {
  const s = useSession();
  const sel = s.selection.keyframe;
  if (!sel || sel.clipId !== c.id) return null;
  const k = c.props[sel.prop]?.keyframes.find((x) => x.id === sel.keyframeId);
  if (!k) return null;
  const d = propDef(sel.prop);
  const upd = (patch: Partial<{ t: number; v: number; ease: Easing }>) =>
    run([{ op: 'setKeyframe', clipId: c.id, prop: sel.prop, keyframeId: k.id, t: patch.t ?? k.t, v: patch.v ?? k.v, ease: patch.ease ?? k.ease }], 'Editar ponto');
  return (
    <div className="card" style={{ margin: '10px 0' }}>
      <strong>Ponto selecionado</strong> <span className="hint">({propsForKind(c.kind).find((d) => d.name === sel.prop)?.label})</span>
      <div className="field">
        <label>Tempo (s)</label>
        <NumberField value={k.t} min={0} max={c.duration} step={1 / 30} digits={3} onCommit={(t) => upd({ t })} />
      </div>
      <div className="field">
        <label>Valor</label>
        <NumberField value={k.v} min={d?.min} max={d?.max} step={d?.step ?? 0.1} onCommit={(v) => upd({ v })} />
      </div>
      <div className="field">
        <label>Suavização</label>
        <select className="input" value={k.ease} onChange={(e) => upd({ ease: e.target.value as Easing })}>
          {EASINGS.map((e) => (
            <option key={e} value={e}>
              {EASE_LABEL[e]}
            </option>
          ))}
        </select>
      </div>
      <button className="btn danger" onClick={() => run([{ op: 'removeKeyframe', clipId: c.id, prop: sel.prop, keyframeId: k.id }], 'Remover ponto')}>
        Remover ponto
      </button>
    </div>
  );
}

function PresetPicker({ clip: c }: { clip: Clip }) {
  const [chosen, setPreset] = useState<AnimationPreset>('slideUpIn');
  const [dur, setDur] = useState(0.6);
  const options = ANIMATION_PRESETS.filter((p) => c.kind !== 'caption' || CAPTION_PRESETS.includes(p.name));
  // Legenda só aceita alguns presets: o escolhido precisa estar na lista mostrada.
  const preset = options.some((o) => o.name === chosen) ? chosen : options[0].name;
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--muted)' }}>ANIMAÇÃO PRONTA</h4>
      <div className="row">
        <select className="input" value={preset} onChange={(e) => setPreset(e.target.value as AnimationPreset)}>
          {options.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
            </option>
          ))}
        </select>
        <div style={{ width: 70 }}>
          <NumberField value={dur} min={0.05} max={c.duration} step={0.1} onCommit={setDur} />
        </div>
        <button className="btn" onClick={() => run([{ op: 'animate', clipId: c.id, preset, duration: Math.min(dur, c.duration) }], 'Animação pronta')}>
          Aplicar
        </button>
      </div>
      <p className="hint">Vira pontos editáveis. Playhead: {playback.get().time.toFixed(2)}s.</p>
    </div>
  );
}
