export type HarkPhase = 'off' | 'loading' | 'ready' | 'recording' | 'finishing'

export type HarkModel = {
  id: string
  name: string
  // The main language first; `language_count` counts all, when more than are named.
  languages: string[]
  language_count?: number
  size_mb: number
  ram_mb: number
  accuracy: string
  // The catalog's word for how fast it runs: "very fast", "slow on CPU".
  speed: string
  installed: boolean
  recommended?: boolean
}

export type HarkDownload = {
  id: string
  name: string
  step: string
  done: number
  total: number
}

// What the model picker shows: the list, or one model's question.
export type HarkPickerView =
  | { kind: 'list' }
  | { kind: 'install'; id: string }
  | { kind: 'installed'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'progress'; id: string }

declare module 'claude-code' {
  interface PluginState {
    hark: {
      phase: HarkPhase
      modelName: string
      levels: number[]
      seconds: number
      download: HarkDownload | null
      models: HarkModel[]
      active: string | null
      view: HarkPickerView
      isPickerOpen: boolean
      speeds: Record<string, number>
    }
  }
}
