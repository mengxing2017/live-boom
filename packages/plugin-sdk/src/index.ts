export * from './protocol';
import type { PluginInfo, Snapshot, ResultRequest } from './protocol';
export const PLUGIN_API = '1';
export interface DesktopTransport {
  snapshot(): Promise<Snapshot>;
  subscribe(callback: (snapshot: Snapshot) => void): Promise<() => void>;
  plugins(): Promise<PluginInfo[]>;
  document(digest: string): Promise<string>;
  command(name: string, args?: Record<string, unknown>): Promise<unknown>;
  result(request: ResultRequest): Promise<void>;
  prepare(request: ResultRequest, input: Record<string, unknown>): Promise<void>;
  service(request: ResultRequest, method: string, params: Record<string, unknown>): Promise<unknown>;
}
export interface PlaybackContext { task_id: string; epoch: string; instance: string }
export function sameContext(a: PlaybackContext | undefined, b: PlaybackContext): boolean {
  return !!a && a.task_id === b.task_id && a.epoch === b.epoch && a.instance === b.instance;
}
