export interface PluginServices {
  result(status: 'completed' | 'failed'): void;
  progress(value: unknown): void;
  request(method: 'storage.get' | 'storage.set' | 'assets.resolve' | 'units.complete' | 'audio.play' | 'audio.stop' | 'speech.say', params: Record<string, unknown>): Promise<unknown>;
}
export interface SessionServices {
  metrics(value: Record<string, unknown>): void;
  request(method: 'preferences.get' | 'preferences.set' | 'assets.resolve' | 'media.resolve', params: Record<string, unknown>): Promise<unknown>;
  frame(blob: Blob): Promise<void>;
  exportPng(bytes: ArrayBuffer): void;
}
export interface PluginLifecycle<Input, Config, Plan = Input> {
  prepare?(input: Input, config: Config): Plan | Promise<Plan>;
  play(input: Input, config: Config, state?: {plan: Plan | null; completedUnits: number; source: string}): void | Promise<void>;
  pause?(): void;
  resume?(): void;
  restore?(snapshot: unknown): void;
  dispose?(): void;
}
export function connectPlugin<Input = Record<string, unknown>, Config = Record<string, unknown>, Plan = Input>(
  factory: (services: PluginServices) => PluginLifecycle<Input, Config, Plan> | Promise<PluginLifecycle<Input, Config, Plan>>,
  options?: { session: (services: SessionServices, config?: Record<string, unknown>) => {presentation?(value: Record<string, unknown>): void | Promise<void>; control?(value: unknown): void; dispose?(): void} | Promise<{presentation?(value: Record<string, unknown>): void | Promise<void>; control?(value: unknown): void; dispose?(): void}> },
): () => void;
