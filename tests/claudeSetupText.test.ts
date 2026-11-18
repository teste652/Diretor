// O que o cartão "Conectar ao Claude Desktop" diz em cada situação.
import { describe, expect, it } from 'vitest';
import type { ConfigState } from '../src/main/claudeDesktop';
import { NOT_FOUND, connectOutcome, keepOutcome, setupMessage, setupView } from '../src/renderer/claudeSetupText';

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
    // No Windows, o ícone pode estar escondido na setinha ao lado do relógio.
    expect(connectOutcome({ results: [{ file: A, state: 'updated' }] }, true).text).toMatch(/setinha \^/);
  });

  it('vale como o Claude estava na hora do clique, não na última conferência', () => {
    const results = [{ file: A, state: 'added' as const }];
    expect(connectOutcome({ results, claudeRunning: true }, false).text).toMatch(/feche o Claude Desktop por completo .* e abra de novo/);
    expect(connectOutcome({ results, claudeRunning: false }, true).text).toMatch(/^Pronto! Agora abra o Claude Desktop\. O conector/);
    // Sem saber se está aberto: abrir, ou fechar e abrir se já estava aberto.
    expect(connectOutcome({ results, claudeRunning: null }, true).text).toMatch(/^Pronto! Agora abra o Claude Desktop\. Se ele já estava aberto, feche por completo/);
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
  it('arquivo com erro: corrigir o arquivo (colar a configuração não conserta)', () => {
    const text = setupMessage({ kind: 'broken', error: 'vírgula sobrando', file: A });
    expect(text).toContain('vírgula sobrando');
    expect(text).toMatch(/Mostrar o arquivo/);
    expect(text).not.toMatch(/Copiar configuração/);
    expect(setupMessage({ kind: 'not-found' })).toBe(NOT_FOUND);
    expect(setupMessage({ kind: 'ready' }, true)).toMatch(/Cmd\+Q/);
  });

  it('não achou, já configurado, arquivo com erro e os passos', () => {
    expect(setupView(st([]))).toEqual({ kind: 'not-found' });
    expect(setupView(st([{ file: A, state: 'connected' }]))).toEqual({ kind: 'ready' });
    expect(setupView(st([{ file: A, state: 'invalid', error: 'x' }]))).toEqual({ kind: 'broken', error: 'x', file: A });
    expect(setupView(st([{ file: A, state: 'missing' }]))).toEqual({ kind: 'steps' });
    expect(setupView(st([{ file: A, state: 'connected' }, { file: B, state: 'outdated' }]))).toEqual({ kind: 'steps' });
    expect(setupView(st([{ file: A, state: 'connected' }, { file: B, state: 'invalid', error: 'x' }]))).toEqual({ kind: 'steps' });
  });
});

describe('o resultado do Conectar depois de conferir de novo', () => {
  const st = (configs: ConfigState[]) => ({ configs, serverFound: true, claudeRunning: false });
  const connected = { file: A, state: 'connected' as const };
  it('"Pronto" só enquanto está tudo gravado', () => {
    const ok = connectOutcome({ results: [{ file: A, state: 'added' }] }, false);
    expect(keepOutcome(ok, st([connected]))).toBe(ok);
    // O Claude regravou o arquivo e tirou o Diretor: volta aos passos.
    expect(keepOutcome(ok, st([{ file: A, state: 'missing' }]))).toBeNull();
  });

  it('não gravou (arquivo preso): o aviso fica até o arquivo mudar', () => {
    const err = connectOutcome({ results: [{ file: B, state: 'error', error: 'EPERM: operation not permitted' }] }, false);
    expect(err.text).toMatch(/Copiar configuração/);
    expect(keepOutcome(err, st([{ file: B, state: 'missing' }]))).toBe(err);
    // Colado à mão, mas com um erro: o cartão passa a mostrar o erro do arquivo, e não manda colar de novo.
    expect(keepOutcome(err, st([{ file: B, state: 'invalid', error: 'vírgula sobrando' }]))).toBeNull();
    // Colado à mão, certo, e outro arquivo ainda sem o Diretor: o aviso velho sai.
    expect(keepOutcome(err, st([{ file: A, state: 'missing' }, { file: B, state: 'connected' }]))).toBeNull();
    // O Claude Desktop foi desinstalado: vale o "não encontrei".
    expect(keepOutcome(err, st([]))).toBeNull();
  });

  it('arquivo com erro de formato: manda corrigir (colar não conserta), e o aviso sai quando ele muda', () => {
    const warn = connectOutcome({ results: [{ file: A, state: 'added' }, { file: B, state: 'invalid', error: 'vírgula sobrando' }] }, false);
    expect(warn.text).toMatch(/Mostrar o arquivo”, corrija o erro/);
    expect(warn.text).not.toMatch(/Copiar configuração/);
    expect(keepOutcome(warn, st([connected, { file: B, state: 'invalid', error: 'vírgula sobrando' }]))).toBe(warn);
    expect(keepOutcome(warn, st([connected, { file: B, state: 'invalid', error: 'outro erro' }]))).toBeNull();
    expect(keepOutcome(warn, st([connected, { file: B, state: 'missing' }]))).toBeNull();
    const all = connectOutcome({ results: [{ file: B, state: 'invalid', error: 'vírgula sobrando' }, { file: A, state: 'error', error: 'EPERM' }] }, false);
    expect(all.tone).toBe('error');
    expect(all.text).toMatch(/^Não consegui gravar .*\. Clique em “Mostrar o arquivo”, corrija o erro, salve e clique em Conectar de novo\.$/);
  });

  it('todos os arquivos com erro: o cartão mostra qual corrigir, no lugar do resultado', () => {
    const err = connectOutcome({ results: [{ file: A, state: 'error', error: 'EPERM' }] }, false);
    expect(keepOutcome(err, st([{ file: A, state: 'invalid', error: 'x' }]))).toBeNull();
  });

  it('"não encontrei o Claude" sai quando ele aparece', () => {
    const notFound = connectOutcome({ results: [] }, null);
    expect(keepOutcome(notFound, st([]))).toBe(notFound);
    expect(keepOutcome(notFound, st([{ file: A, state: 'missing' }]))).toBeNull();
    expect(keepOutcome(null, st([]))).toBeNull();
  });
});
