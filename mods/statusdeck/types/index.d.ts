export type Window = { percent: number; resetsAt: string | null }

export type Usage = {
  fiveHour: Window | null
  week: Window | null
  context: number | null
}

export type Run = {
  isWorking: boolean
  startedAt: number
  now: number
  tokens: number
  frame: number
}

export type Controls = {
  effort: string | null
  model: string | null
}

// When the main thread's prompt cache was last read or written (ms), or null
// when it is cold or unknown.
export type Cache = { touchedAt: number | null }

// A coarse clock the band reads, so countdowns redraw without the turn ticker.
export type Clock = { now: number }

// What the panes mod publishes for the chips (its own contract owns it).
export type PanesSummary = {
  isPanelShown: boolean
  branch: string | null
  ahead: number
  behind: number
  changed: number
  edited: number
  done: number
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    statusdeck: { usage: Usage; run: Run; controls: Controls; cache: Cache; clock: Clock }
    panes: { summary: PanesSummary }
  }
}
