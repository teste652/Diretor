// Botão "Conectar ao Claude Desktop": grava o servidor "diretor" na configuração
// do Claude Desktop sem estragar o resto dela (outros servidores, preferências).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKUP_NAME, CONFIG_NAME, claudeConfigDirs, connectClaude, readClaudeConfigs, type McpEntry, unpackedPath } from '../src/main/claudeDesktop';

const ENTRY: McpEntry = { command: 'C:\\Users\\Bruno\\AppData\\Local\\Programs\\Diretor\\Diretor.exe', args: ['C:\\x\\server.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const scratch = () => mkdtempSync(join(tmpdir(), 'diretor-claude-'));
const dirWith = (content?: string | Buffer) => {
  const dir = scratch();
  if (content !== undefined) writeFileSync(join(dir, CONFIG_NAME), content);
  return dir;
};
const json = (dir: string) => JSON.parse(readFileSync(join(dir, CONFIG_NAME), 'utf8'));

describe('onde fica a configuração do Claude Desktop', () => {
  it('Windows: a instalação atual (pacote MSIX) e a clássica, só as que existem', () => {
    const home = scratch();
    const local = join(home, 'Local');
    const roaming = join(home, 'Roaming');
    const msix = join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
    mkdirSync(msix, { recursive: true });
    mkdirSync(join(local, 'Packages', 'Claude_semconfig', 'LocalCache'), { recursive: true }); // nunca abriu: ignora
    mkdirSync(join(local, 'Packages', 'OutroApp_123', 'LocalCache', 'Roaming', 'Claude'), { recursive: true }); // não é o Claude
    const env = { LOCALAPPDATA: local, APPDATA: roaming };
    expect(claudeConfigDirs({ env, platform: 'win32', home })).toEqual([msix]);
    mkdirSync(join(roaming, 'Claude'), { recursive: true });
    expect(claudeConfigDirs({ env, platform: 'win32', home })).toEqual([msix, join(roaming, 'Claude')]);
  });

  it('Windows sem o Claude Desktop: nenhuma pasta (e não cria nada)', () => {
    const home = scratch();
    expect(claudeConfigDirs({ env: { LOCALAPPDATA: join(home, 'L'), APPDATA: join(home, 'R') }, platform: 'win32', home })).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
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

  it('as duas instalações do Windows ao mesmo tempo, e uma falha não impede a outra', async () => {
    const good = dirWith('{}');
    const bad = dirWith('{ quebrado');
    const rs = await connectClaude([bad, good], ENTRY);
    expect(rs.map((r) => r.state)).toEqual(['invalid', 'added']);
    expect(json(good).mcpServers.diretor).toEqual(ENTRY);
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
