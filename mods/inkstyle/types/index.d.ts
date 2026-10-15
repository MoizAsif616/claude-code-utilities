export type Settings = { isEnabled: boolean }

declare module 'claude-code' {
  interface PluginState {
    inkstyle: { settings: Settings }
  }
}
