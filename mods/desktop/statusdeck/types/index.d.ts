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

// The desktop band (ported from deskdeck): its own usage, with the window's
// tokens and size for the ctx pill's hover, and its own turn record.
export type DeskUsage = {
  fiveHour: Window | null
  week: Window | null
  context: number | null
  tokens: number | null
  window: number | null
}
export type DeskRun = { isWorking: boolean; startedAt: number; tokens: number }

// What Clawd shows at the left of the band, and since when (ms).
export type Mood = 'idle' | 'working' | 'done' | 'attention' | 'stopped' | 'sleep'
export type MoodState = { mood: Mood; since: number }

// The repository the session works in, or null outside one.
export type GitFile = { status: string; path: string }
export type Git = { branch: string; ahead: number; behind: number; files: GitFile[] } | null

// One skill or tool the context panel lists.
export type ContextItem = { name: string; description: string }
export type ContextTool = ContextItem & { server: string }
export type Catalog = { skills: ContextItem[]; tools: ContextTool[] }

// What is turned off: as sent to the model (applied) and as the panel's
// checkboxes stand (draft); a draft differing from applied waits for Apply.
export type Choice = { skills: string[]; tools: string[] }
export type Choices = { applied: Choice; draft: Choice }

declare module 'claude-code' {
  interface PluginState {
    statusdeck: {
      usage: Usage
      run: Run
      controls: Controls
      cache: Cache
      clock: Clock
      deskUsage: DeskUsage
      deskCache: Cache
      deskClock: Clock
      deskRun: DeskRun
      mood: MoodState
      git: Git
      catalog: Catalog
      choices: Choices
      expanded: string[]
    }
    panes: { summary: PanesSummary }
  }
}
