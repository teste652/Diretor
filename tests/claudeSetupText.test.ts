// O que o cartão "Conectar ao Claude Desktop" diz em cada situação.
import { describe, expect, it } from 'vitest';
import type { ConfigState } from '../src/main/claudeDesktop';
import { NOT_FOUND, connectOutcome, setupView } from '../src/renderer/claudeSetupText';

const A = 'C:\\Claude-Data\\claude_x\\claude_desktop_config.json';
const B = 'C:\\Roaming\\Claude\\claude_desktop_config.json';

describe('depois do clique em Conectar', () => {
  it('"Pronto" só quando todos os arquivos foram gravados; com o Claude fechado, é só abrir', () => {
    const o = connectOutcome({ results: [{ file: A, state: 'added' }, { file: B, state: 'unchanged' }] }, false);
    expect(o.tone).toBe('ok');
    expect(o.text).toMatch(/^Pronto! Agora abra o Claude Desktop\./);
  });

  it('com o Claude aberto, pede para fechar por completo e abrir de novo', () => {
    expect(connectOutcome({ results: [{ file: A, state: 'updated' }] }, true).text).toMatch(/feche o Claude Desktop por completo \(botão direito .*Sair\) e abra de novo/);
    expect(connectOutcome({ results: [{ file: A, state: 'updated' }] }, true, true).text).toMatch(/Cmd\+Q/);
  });

  it('um arquivo gravado e outro não: avisa qual ficou de fora, sem dizer "Pronto"', () => {
    const o = connectOutcome({ results: [{ file: A, state: 'added' }, { file: B, state: 'invalid', error: 'o arquivo não é um JSON válido' }] }, false);
    expect(o.tone).toBe('warn');
    expect(o.text).not.toMatch(/Pronto/);
    expect(o.text).toContain(B);
    expect(o.file).toBe(B);
  });

  it('nenhum gravado: erro com o motivo e o arquivo', () => {
    const o = connectOutcome({ results: [{ file: A, state: 'error', error: 'EACCES: permission denied' }] }, false);
    expect(o).toMatchObject({ tone: 'error', file: A });
    expect(o.text).toMatch(/EACCES/);
    expect(o.text).not.toMatch(/Pronto/);
  });

  it('sem o Claude Desktop, ou sem o servidor do Diretor', () => {
    expect(connectOutcome({ results: [] }, null)).toEqual({ tone: 'error', text: NOT_FOUND });
    expect(connectOutcome({ error: 'Não encontrei o servidor do Claude' }, null)).toEqual({ tone: 'error', text: 'Não encontrei o servidor do Claude' });
  });
});

describe('antes do clique', () => {
  const st = (configs: ConfigState[]) => ({ configs, serverFound: true, claudeRunning: false });
  it('não achou, já configurado, arquivo com erro e os passos', () => {
    expect(setupView(st([]))).toEqual({ kind: 'not-found' });
    expect(setupView(st([{ file: A, state: 'connected' }]))).toEqual({ kind: 'ready' });
    expect(setupView(st([{ file: A, state: 'invalid', error: 'x' }]))).toEqual({ kind: 'broken', error: 'x', file: A });
    expect(setupView(st([{ file: A, state: 'missing' }]))).toEqual({ kind: 'steps' });
    expect(setupView(st([{ file: A, state: 'connected' }, { file: B, state: 'outdated' }]))).toEqual({ kind: 'steps' });
    expect(setupView(st([{ file: A, state: 'connected' }, { file: B, state: 'invalid', error: 'x' }]))).toEqual({ kind: 'steps' });
  });
});
