// Ponte local entre o servidor MCP (iniciado pelo Claude Desktop) e o editor.
// Só escuta em 127.0.0.1 e exige um token aleatório gravado num arquivo que
// apenas o seu usuário lê. Nenhum dado sai do computador por aqui.

import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname } from 'node:path';

export type BridgeHandler = (method: string, params: unknown) => Promise<unknown>;

export interface BridgeInfo {
  port: number;
  token: string;
  pid: number;
}

export async function startBridge(infoFile: string, handler: BridgeHandler): Promise<{ server: Server; info: BridgeInfo; close: () => void }> {
  const token = randomBytes(24).toString('hex');
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/rpc') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { method, params } = JSON.parse(body || '{}');
        const result = await handler(String(method), params ?? {});
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const info: BridgeInfo = { port, token, pid: process.pid };
  mkdirSync(dirname(infoFile), { recursive: true });
  writeFileSync(infoFile, JSON.stringify(info), { mode: 0o600 });
  return {
    server,
    info,
    close: () => {
      server.close();
      try {
        rmSync(infoFile);
      } catch {
        /* já removido */
      }
    },
  };
}
