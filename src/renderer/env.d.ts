import type { DiretorApi } from '../preload/preload';

declare global {
  interface Window {
    diretor?: DiretorApi;
    __diretor?: Record<string, unknown>;
  }
}
export {};
