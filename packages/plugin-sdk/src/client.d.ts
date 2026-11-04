export interface PluginServices {
  result(status: 'completed' | 'failed'): void;
  progress(value: unknown): void;
  request(method: 'storage.get', params: { key: string }): Promise<unknown>;
  request(method: 'storage.set', params: { key: string; value: unknown }): Promise<unknown>;
  request(method: 'assets.resolve', params: { path: string }): Promise<string>;
}
export interface PluginLifecycle<Input, Config> {
  prepare?(input: Input, config: Config): Input | Promise<Input>;
  play(input: Input, config: Config): void | Promise<void>;
  pause?(): void;
  resume?(): void;
  restore?(snapshot: unknown): void;
  dispose?(): void;
}
export function connectPlugin<Input = Record<string, unknown>, Config = Record<string, unknown>>(
  factory: (services: PluginServices) => PluginLifecycle<Input, Config> | Promise<PluginLifecycle<Input, Config>>,
): () => void;
