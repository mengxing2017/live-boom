import { createRoot } from 'react-dom/client';
import { invoke as nativeInvoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DesktopApp } from '@likeboom/desktop-ui';
import type { DesktopTransport, Snapshot, PluginInfo } from '@likeboom/plugin-sdk';
import '@likeboom/desktop-ui/styles';
const hostToken = (window as Window & { __LIKEBOOM_HOST_TOKEN__?: string }).__LIKEBOOM_HOST_TOKEN__;
if (!hostToken) throw new Error('可信宿主凭证缺失，请通过 Tauri 启动');
const invoke = <T,>(command: string, args?: Record<string, unknown>): Promise<T> => nativeInvoke<T>(command, args, { headers: { 'x-likeboom-host': hostToken } });
const transport: DesktopTransport = {
  importMedia: (bytes, expectedDigest) => invoke('import_media',{bytes,expectedDigest}),
  savePng: bytes => invoke('export_png',{bytes}),
  subscribeExport: callback => listen<number[]>('export-png', event => callback(event.payload)),
  exportPng: (instance, bytes) => invoke('export_preview', {instance,bytes}),
  sessionService: (instance, method, params) => invoke('session_service', {instance,method,params}),
  preview: (instance, bytes) => invoke('preview_frame', {instance,bytes}),
  subscribeMetrics: callback => listen<Record<string,unknown>>('render-metrics',event=>callback(event.payload)),
  subscribePreview: callback => listen<number[]>('preview-frame', event => callback(event.payload)),
  subscribeControl: callback => listen<Record<string,unknown>>('preview-control', event => callback(event.payload)),
  changes: (version,session) => invoke('snapshot_changes',{version,session}),
  snapshot: () => invoke<Snapshot>('snapshot'),
  subscribe: callback => listen<Snapshot>('snapshot', event => callback(event.payload)),
  plugins: () => invoke<PluginInfo[]>('plugins'),
  document: async (digest, surface = 'display') => convertFileSrc(surface === 'control' ? `${digest}/control` : digest, 'lbplugin'),
  command: (name, args = {}) => invoke('host_command', { name, args }),
  result: request => invoke('report_result', { request }),
  prepare: (request, input) => invoke('prepare_task', { request, input }),
  service: (request, method, params) => invoke('plugin_service', { request, method, params }),
};
const root = document.getElementById('root'); if (!root) throw new Error('Missing #root');
createRoot(root).render(<DesktopApp role={getCurrentWindow().label === 'display' ? 'display' : 'control'} transport={transport} />);
