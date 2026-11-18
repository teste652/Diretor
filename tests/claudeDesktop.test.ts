// Botão "Conectar ao Claude Desktop": grava o servidor "diretor" na configuração
// do Claude Desktop sem estragar o resto dela (outros servidores, preferências).
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_NAME,
  CONFIG_NAME,
  claudeConfigCandidates,
  claudeConfigDirs,
  connectClaude,
  disconnectClaude,
  readClaudeConfigs,
  type McpEntry,
  unpackedPath,
} from '../src/main/claudeDesktop';

const ENTRY: McpEntry = { command: 'C:\\Users\\Bruno\\AppData\\Local\\Programs\\diretor\\Diretor.exe', args: ['C:\\x\\server.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const scratch = () => mkdtempSync(join(tmpdir(), 'diretor-claude-'));
const dirWith = (content?: string | Buffer) => {
  const dir = scratch();
  if (content !== undefined) writeFileSync(join(dir, CONFIG_NAME), content);
  return dir;
};
const json = (dir: string) => JSON.parse(readFileSync(join(dir, CONFIG_NAME), 'utf8'));
/** Cria a pasta com os arquivos dados (nome → conteúdo). */
const make = (dir: string, files: Record<string, string> = {}) => {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
};
/** Marca que o Claude Desktop deixa na pasta antiga quando muda os dados para Claude-Data. */
const LEFT = '.user-data-left.claude_pzs8sxrjxfjjc';

/** Um perfil do Windows de mentira, com as pastas que o Claude Desktop usa em cada versão. */
function winProfile() {
  const home = scratch();
  const local = join(home, 'Local');
  const roaming = join(home, 'Roaming');
  const env = { LOCALAPPDATA: local, APPDATA: roaming };
  return {
    home,
    local,
    /** Claude Desktop 4: %LOCALAPPDATA%\Claude-Data\<família do pacote> */
    moved: (family = 'claude_pzs8sxrjxfjjc') => join(local, 'Claude-Data', family),
    /** Instalador MSIX mais antigo: a cópia particular do pacote. */
    pkg: (family = 'Claude_pzs8sxrjxfjjc') => join(local, 'Packages', family, 'LocalCache', 'Roaming', 'Claude'),
    /** Instalação clássica: %APPDATA%\Claude */
    classic: join(roaming, 'Claude'),
    dirs: (extra: Record<string, string> = {}) => claudeConfigDirs({ env: { ...env, ...extra }, platform: 'win32', home }),
    candidates: () => claudeConfigCandidates({ env, platform: 'win32', home }),
  };
}

describe('onde fica a configuração do Claude Desktop', () => {
  it('Windows, Claude Desktop 4: só a pasta nova (Claude-Data); as antigas, com a marca de mudança, ficam de fora', () => {
    const w = winProfile();
    make(w.moved());
    make(w.pkg(), { [LEFT]: '', [CONFIG_NAME]: '{"mcpServers":{}}' });
    make(w.classic, { [LEFT]: '', [CONFIG_NAME]: '{}' });
    expect(w.dirs()).toEqual([w.moved()]); // ainda sem arquivo: é lá que ele vai ser criado
    make(w.moved(), { [CONFIG_NAME]: '{}' });
    expect(w.dirs()).toEqual([w.moved()]);
  });

  it('Windows, Claude-Data depois de "Redefinir" o app (a pasta do pacote só tem marcas): a pasta nova', () => {
    const w = winProfile();
    make(w.moved());
    make(w.pkg());
    expect(w.dirs()).toEqual([w.moved()]);
    make(w.pkg(), { '.user-data-outra-marca': '' });
    expect(w.dirs()).toEqual([w.moved()]);
  });

  it('Windows, instalador MSIX mais antigo (sem Claude-Data): a cópia particular do pacote', () => {
    const w = winProfile();
    make(w.pkg(), { Preferences: '{}' });
    expect(w.dirs()).toEqual([w.pkg()]);
  });

  it('Windows, MSIX antigo com a configuração só na pasta clássica: grava na clássica e não cria uma cópia particular que esconderia a dela', () => {
    const w = winProfile();
    make(w.pkg(), { Preferences: '{}' });
    make(w.classic, { [CONFIG_NAME]: '{"mcpServers":{"outro":{"command":"x"}}}' });
    expect(w.dirs()).toEqual([w.classic]);
    make(w.pkg(), { [CONFIG_NAME]: '{}' });
    expect(w.dirs()).toEqual([w.pkg(), w.classic]);
  });

  it('Windows, instalação clássica: %APPDATA%\\Claude, com ou sem arquivo', () => {
    const w = winProfile();
    make(w.classic);
    expect(w.dirs()).toEqual([w.classic]);
    make(w.classic, { [CONFIG_NAME]: '{}' });
    expect(w.dirs()).toEqual([w.classic]);
  });

  it('Windows: a outra família do pacote (AnthropicPBC.Claude_…) também vale; pastas de outros apps não', () => {
    const w = winProfile();
    make(w.moved('anthropicpbc.claude_fnn82j28hfe8t'));
    make(join(w.local, 'Claude-Data', 'outra-coisa'));
    make(join(w.local, 'Packages', 'OutroApp_123', 'LocalCache', 'Roaming', 'Claude'));
    make(join(w.local, 'Packages', 'Claude_nuncaabriu', 'LocalCache'));
    expect(w.dirs()).toEqual([w.moved('anthropicpbc.claude_fnn82j28hfe8t')]);
  });

  it('Windows sem o Claude Desktop: nenhuma pasta (e não cria nada)', () => {
    const w = winProfile();
    expect(w.dirs()).toEqual([]);
    expect(readdirSync(w.home)).toEqual([]);
  });

  it('CLAUDE_USER_DATA_DIR (pasta escolhida pelo usuário) manda em tudo', () => {
    const w = winProfile();
    make(w.moved());
    const custom = make(join(w.home, 'meu-claude'));
    expect(w.dirs({ CLAUDE_USER_DATA_DIR: custom })).toEqual([custom]);
    expect(w.dirs({ CLAUDE_USER_DATA_DIR: join(w.home, 'nao-existe') })).toEqual([]);
  });

  it('a mesma pasta por dois caminhos (atalho de pasta) aparece uma vez só', () => {
    const w = winProfile();
    make(w.moved(), { [CONFIG_NAME]: '{}' });
    mkdirSync(join(w.home, 'Roaming'), { recursive: true });
    symlinkSync(w.moved(), w.classic, 'dir');
    expect(w.dirs()).toEqual([w.moved()]);
  });

  it('para desconectar, olha todas as pastas que existem, inclusive as abandonadas', () => {
    const w = winProfile();
    make(w.moved());
    make(w.pkg(), { [LEFT]: '' });
    make(w.classic);
    expect(w.candidates()).toEqual([w.moved(), w.pkg(), w.classic]);
  });

  it('macOS e Linux', () => {
    const home = scratch();
    mkdirSync(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
    expect(claudeConfigDirs({ env: {}, platform: 'darwin', home })).toEqual([join(home, 'Library', 'Application Support', 'Claude')]);
    const xdg = join(home, 'cfg');
    mkdirSync(join(xdg, 'Claude'), { recursive: true });
    expect(claudeConfigDirs({ env: { XDG_CONFIG_HOME: xdg }, platform: 'linux', home })).toEqual([join(xdg, 'Claude')]);
  });
});

describe('conectar', () => {
  it('mantém preferências e outros servidores, guarda uma cópia do original e preserva as quebras de linha do Windows', async () => {
    const original = '\uFEFF{\r\n  "preferences": { "tema": "escuro" },\r\n  "mcpServers": { "outro": { "command": "x" } }\r\n}\r\n';
    const dir = dirWith(original);
    const [r] = await connectClaude([dir], ENTRY);
    expect(r).toMatchObject({ file: join(dir, CONFIG_NAME), state: 'added' });
    expect(json(dir)).toEqual({ preferences: { tema: 'escuro' }, mcpServers: { outro: { command: 'x' }, diretor: ENTRY } });
    const text = readFileSync(join(dir, CONFIG_NAME), 'utf8');
    expect(text.includes('\r\n') && !/[^\r]\n/.test(text)).toBe(true);
    expect(text.startsWith('{')).toBe(true); // sem BOM: o Claude lê com JSON.parse
    expect(readFileSync(join(dir, BACKUP_NAME), 'utf8')).toBe(original);
    expect(readdirSync(dir).sort()).toEqual([BACKUP_NAME, CONFIG_NAME].sort()); // nenhum temporário sobrando
  });

  it('a cópia do original é a de antes da primeira mudança: conectar de novo não a substitui', async () => {
    const original = '{"preferences":{"tema":"claro"}}';
    const dir = dirWith(original);
    await connectClaude([dir], ENTRY);
    const moved = { ...ENTRY, command: 'D:\\Diretor\\Diretor.exe' };
    expect((await connectClaude([dir], moved))[0].state).toBe('updated');
    expect(json(dir).mcpServers.diretor).toEqual(moved);
    expect(readFileSync(join(dir, BACKUP_NAME), 'utf8')).toBe(original);
  });

  it('pasta do Claude sem arquivo de configuração: cria só com o Diretor', async () => {
    const dir = dirWith();
    expect((await connectClaude([dir], ENTRY))[0].state).toBe('added');
    expect(json(dir)).toEqual({ mcpServers: { diretor: ENTRY } });
    expect(existsSync(join(dir, BACKUP_NAME))).toBe(false);
  });

  it('arquivo vazio conta como configuração vazia', async () => {
    const dir = dirWith('  \n');
    expect((await connectClaude([dir], ENTRY))[0].state).toBe('added');
    expect(json(dir)).toEqual({ mcpServers: { diretor: ENTRY } });
  });

  it('arquivo com erro de formato: não mexe nele', async () => {
    for (const bad of ['{ "mcpServers": { "a": 1, } }', '[1, 2]', '{ "mcpServers": [] }', 'null']) {
      const dir = dirWith(bad);
      const [r] = await connectClaude([dir], ENTRY);
      expect(r.state, bad).toBe('invalid');
      expect('error' in r && r.error, bad).toBeTruthy();
      expect(readFileSync(join(dir, CONFIG_NAME), 'utf8')).toBe(bad);
      expect(readdirSync(dir), bad).toEqual([CONFIG_NAME]);
    }
  });

  it('já conectado: não regrava o arquivo', async () => {
    const dir = dirWith(JSON.stringify({ mcpServers: { diretor: { ...ENTRY, env: { ELECTRON_RUN_AS_NODE: '1' } } } }));
    const before = statSync(join(dir, CONFIG_NAME)).mtimeMs;
    const [r] = await connectClaude([dir], ENTRY);
    expect(r.state).toBe('unchanged');
    expect(statSync(join(dir, CONFIG_NAME)).mtimeMs).toBe(before);
    expect(existsSync(join(dir, BACKUP_NAME))).toBe(false);
  });

  it('apontando para outro lugar (instalação antiga ou cópia de desenvolvimento): atualiza', async () => {
    const old = JSON.stringify({ mcpServers: { diretor: { command: 'node', args: ['C:\\velho\\server.cjs'] } } });
    const dir = dirWith(old);
    expect((await connectClaude([dir], ENTRY))[0].state).toBe('updated');
    expect(json(dir).mcpServers.diretor).toEqual(ENTRY);
    expect(readFileSync(join(dir, BACKUP_NAME), 'utf8')).toBe(old);
  });

  it('duas pastas ao mesmo tempo, e uma falha não impede a outra', async () => {
    const good = dirWith('{}');
    const bad = dirWith('{ quebrado');
    const rs = await connectClaude([bad, good], ENTRY);
    expect(rs.map((r) => r.state)).toEqual(['invalid', 'added']);
    expect(json(good).mcpServers.diretor).toEqual(ENTRY);
  });

  it('arquivo que é um atalho (link simbólico): grava no arquivo de verdade e o atalho continua', async () => {
    const real = join(make(join(scratch(), 'dotfiles')), 'claude.json');
    writeFileSync(real, '{"preferences":{}}');
    const dir = scratch();
    symlinkSync(real, join(dir, CONFIG_NAME));
    expect((await connectClaude([dir], ENTRY))[0].state).toBe('added');
    expect(lstatSync(join(dir, CONFIG_NAME)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf8')).mcpServers.diretor).toEqual(ENTRY);
  });

  it('arquivo com outro nome no disco (link físico): os dois nomes continuam o mesmo arquivo', async () => {
    const dir = dirWith('{"preferences":{}}');
    const other = join(scratch(), 'copia.json');
    linkSync(join(dir, CONFIG_NAME), other);
    expect((await connectClaude([dir], ENTRY))[0].state).toBe('added');
    expect(JSON.parse(readFileSync(other, 'utf8')).mcpServers.diretor).toEqual(ENTRY);
    expect(statSync(other).nlink).toBe(2);
  });

  it('erro ao gravar: o original fica intacto e não sobra temporário', async () => {
    const dir = dirWith('{"preferences":{}}');
    const fail = async () => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    };
    const [r] = await connectClaude([dir], ENTRY, { rename: fail });
    expect(r).toMatchObject({ state: 'error', error: expect.stringMatching(/ENOSPC/) });
    expect(readFileSync(join(dir, CONFIG_NAME), 'utf8')).toBe('{"preferences":{}}');
    expect(readdirSync(dir).filter((f) => f !== BACKUP_NAME)).toEqual([CONFIG_NAME]);
  });

  it('arquivo preso por instantes (o Claude gravando): tenta de novo', async () => {
    const dir = dirWith('{}');
    let left = 2;
    const { rename } = await import('node:fs/promises');
    const flaky = async (a: string, b: string) => {
      if (left-- > 0) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
      await rename(a, b);
    };
    expect((await connectClaude([dir], ENTRY, { rename: flaky }))[0].state).toBe('added');
    expect(json(dir).mcpServers.diretor).toEqual(ENTRY);
  });
});

describe('desconectar (ao desinstalar)', () => {
  it('tira só o Diretor desta instalação e mantém o resto, com as quebras de linha do Windows', async () => {
    const dir = dirWith(
      JSON.stringify({ preferences: { tema: 'escuro' }, mcpServers: { outro: { command: 'x' }, diretor: ENTRY } }, null, 2).replace(/\n/g, '\r\n'),
    );
    // No Windows, maiúsculas e minúsculas no caminho não importam.
    const [r] = await disconnectClaude([dir], ENTRY.command.toUpperCase(), { platform: 'win32' });
    expect(r).toMatchObject({ file: join(dir, CONFIG_NAME), state: 'removed' });
    expect(json(dir)).toEqual({ preferences: { tema: 'escuro' }, mcpServers: { outro: { command: 'x' } } });
    expect(readFileSync(join(dir, CONFIG_NAME), 'utf8')).toContain('\r\n');
  });

  it('não mexe no Diretor de outra instalação (cópia de desenvolvimento, outra pasta)', async () => {
    const text = JSON.stringify({ mcpServers: { diretor: { command: 'node', args: ['C:\\dev\\server.cjs'] } } });
    const dir = dirWith(text);
    expect((await disconnectClaude([dir], ENTRY.command, { platform: 'win32' }))[0].state).toBe('kept');
    expect(readFileSync(join(dir, CONFIG_NAME), 'utf8')).toBe(text);
  });

  it('fora do Windows, o caminho tem que ser idêntico', async () => {
    const dir = dirWith(JSON.stringify({ mcpServers: { diretor: { command: '/opt/Diretor/diretor' } } }));
    expect((await disconnectClaude([dir], '/OPT/Diretor/diretor', { platform: 'linux' }))[0].state).toBe('kept');
    expect((await disconnectClaude([dir], '/opt/Diretor/diretor', { platform: 'linux' }))[0].state).toBe('removed');
  });

  it('sem o Diretor, sem arquivo ou com erro de formato: não mexe', async () => {
    const dirs = [dirWith('{"mcpServers":{"outro":{"command":"x"}}}'), dirWith(), dirWith('{ quebrado')];
    const rs = await disconnectClaude(dirs, ENTRY.command, { platform: 'win32' });
    expect(rs.map((r) => r.state)).toEqual(['absent', 'absent', 'invalid']);
    expect(readFileSync(join(dirs[0], CONFIG_NAME), 'utf8')).toBe('{"mcpServers":{"outro":{"command":"x"}}}');
    expect(existsSync(join(dirs[1], CONFIG_NAME))).toBe(false);
  });
});

describe('situação da conexão', () => {
  it('conectado, desatualizado, faltando e com erro', () => {
    const dirs = [
      dirWith(JSON.stringify({ mcpServers: { diretor: ENTRY } })),
      dirWith(JSON.stringify({ mcpServers: { diretor: { ...ENTRY, args: ['outro.cjs'] } } })),
      dirWith(JSON.stringify({ preferences: {} })),
      dirWith(),
      dirWith('{ quebrado'),
    ];
    expect(readClaudeConfigs(dirs, ENTRY).map((c) => c.state)).toEqual(['connected', 'outdated', 'missing', 'missing', 'invalid']);
  });
});

describe('caminho do servidor no instalador', () => {
  it('troca só a pasta app.asar por app.asar.unpacked', () => {
    expect(unpackedPath('C:\\P\\Diretor\\resources\\app.asar\\dist\\mcp\\server.cjs')).toBe('C:\\P\\Diretor\\resources\\app.asar.unpacked\\dist\\mcp\\server.cjs');
    expect(unpackedPath('/opt/Diretor/resources/app.asar/dist/mcp/server.cjs')).toBe('/opt/Diretor/resources/app.asar.unpacked/dist/mcp/server.cjs');
    expect(unpackedPath('/home/u/app.asar-projeto/dist/mcp/server.cjs')).toBe('/home/u/app.asar-projeto/dist/mcp/server.cjs');
  });
});
