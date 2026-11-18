import { contextBridge, ipcRenderer } from 'electron';
import type { ConfigState, ConnectResult, McpEntry } from '../main/claudeDesktop';

const api = {
  openMediaDialog: (): Promise<string[]> => ipcRenderer.invoke('media:openDialog'),
  probeMedia: (path: string) => ipcRenderer.invoke('media:probe', path),
  mediaExists: (path: string): Promise<boolean> => ipcRenderer.invoke('media:exists', path),
  openProject: (path?: string): Promise<{ path: string; json: unknown } | { error: string } | null> => ipcRenderer.invoke('project:open', path),
  saveProject: (project: unknown, path?: string): Promise<{ path: string } | { error: string } | null> => ipcRenderer.invoke('project:save', { project, path }),
  exportStart: (project: unknown, outPath?: string) => ipcRenderer.invoke('export:start', { project, outPath }),
  exportFrame: (jobId: number, frame: Uint8Array): Promise<boolean> => ipcRenderer.invoke('export:frame', jobId, frame),
  exportFinish: (jobId: number, abandon?: boolean): Promise<{ ok: boolean; outPath?: string; error?: string; warning?: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('export:finish', jobId, abandon),
  exportCancel: (jobId: number) => ipcRenderer.invoke('export:cancel', jobId),
  appInfo: (): Promise<{ version: string; packaged: boolean; ffmpeg: string; mcp: McpEntry; bridgeFile: string; platform: string }> => ipcRenderer.invoke('app:info'),
  claudeStatus: (): Promise<{ configs: ConfigState[]; serverFound: boolean }> => ipcRenderer.invoke('claude:status'),
  connectClaude: (): Promise<{ results?: ConnectResult[]; error?: string }> => ipcRenderer.invoke('claude:connect'),
  copyClaudeConfig: (): Promise<boolean> => ipcRenderer.invoke('claude:copyConfig'),
  showItem: (p: string) => ipcRenderer.invoke('shell:showItem', p),
  onBridgeRequest: (fn: (req: { id: number; method: string; params: unknown }) => void) => {
    const h = (_e: unknown, req: { id: number; method: string; params: unknown }) => fn(req);
    ipcRenderer.on('bridge:request', h);
    return () => ipcRenderer.removeListener('bridge:request', h);
  },
  onBridgeCancel: (fn: (id: number) => void) => {
    const h = (_e: unknown, msg: { id: number }) => fn(msg.id);
    ipcRenderer.on('bridge:cancel', h);
    return () => ipcRenderer.removeListener('bridge:cancel', h);
  },
  bridgeRespond: (id: number, result: unknown) => ipcRenderer.send('bridge:response', { id, result }),
};

export type DiretorApi = typeof api;
contextBridge.exposeInMainWorld('diretor', api);
