export * from './protocol';
import type { PluginInfo, Snapshot, ResultRequest } from './protocol';
export const PLUGIN_API = '1';
export interface DesktopTransport {
  snapshot(): Promise<Snapshot>;
  changes?(version: number, session: string): Promise<Snapshot|null>;
  importMedia?(bytes: number[], expectedDigest?: string): Promise<string>;
  savePng?(bytes: number[]): Promise<void>;
  subscribeExport?(callback: (bytes: number[]) => void): Promise<() => void>;
  sessionService?(instance: string, method: string, params: Record<string, unknown>): Promise<unknown>;
  preview?(instance: string, bytes: number[]): Promise<void>;
  subscribeMetrics?(callback: (value: Record<string, unknown>) => void): Promise<() => void>;
  subscribePreview?(callback: (bytes: number[]) => void): Promise<() => void>;
  subscribeControl?(callback: (value: Record<string, unknown>) => void): Promise<() => void>;
  exportPng?(instance: string, bytes: number[]): Promise<void>;
  subscribe(callback: (snapshot: Snapshot) => void): Promise<() => void>;
  plugins(): Promise<PluginInfo[]>;
  document(digest: string, surface?: 'display' | 'control'): Promise<string>;
  command(name: string, args?: Record<string, unknown>): Promise<unknown>;
  result(request: ResultRequest): Promise<void>;
  prepare(request: ResultRequest, input: Record<string, unknown>): Promise<void>;
  service(request: ResultRequest, method: string, params: Record<string, unknown>): Promise<unknown>;
}
export interface PlaybackContext { task_id: string; epoch: string; instance: string }
export function sameContext(a: PlaybackContext | undefined, b: PlaybackContext): boolean {
  return !!a && a.task_id === b.task_id && a.epoch === b.epoch && a.instance === b.instance;
}
