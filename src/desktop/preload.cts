import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppData,
  Champion,
  Item,
  Perk,
  Plan,
  Settings,
  ServiceState,
  CompanionBridge,
} from '../core/types.js';

// IPC is a private, main-process-owned protocol; no arbitrary channel is exposed.
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);

  return result as T;
}
const bridge: CompanionBridge = {
  init: () => invoke<AppData>('init'),
  detail: (kind, id) => invoke<Champion | Item | Perk | undefined>('detail', kind, id),
  plan: (id) => invoke<Plan>('plan', id),
  saveSettings: (value) => invoke<Settings>('settings', value),
  importSelected: () => invoke<ServiceState>('import'),
  pickLeague: () => invoke<string | undefined>('pick-league'),
  onState: (callback) => {
    const listener = (_event: unknown, value: ServiceState) => callback(value);
    ipcRenderer.on('state', listener);

    return () => ipcRenderer.removeListener('state', listener);
  },
};
contextBridge.exposeInMainWorld('companion', bridge);
