// What /prettier-prompt sets: the pill holding the person's own prompt.
export type PromptSettings = { width: number; lines: number; time: boolean }

// What /prettier-response sets: everything a turn draws.
export type ResponseSettings = { width: number; fold: boolean }

// What /prettier-code sets: an edit's diff.
export type CodeSettings = { width: number }

export type Settings = {
  isEnabled: boolean
  prompt: PromptSettings
  response: ResponseSettings
  code: CodeSettings
}

// One main-loop tool call of a turn: what it worked on, how long it took,
// whether it failed.
export type Call = { id: string; tool: string; detail: string; ms?: number; failed?: boolean }

// A finished main-loop turn: its length as turn.complete reported it, how many
// tool calls it made, and those calls (absent on a turn recorded before).
export type Turn = { durationMs: number; tools: number; calls?: Call[] }

// The main loop's turn in progress: the tool calls running now, oldest first,
// how many it has made so far, and each of them.
export type Live = { running: { id: string; tool: string }[]; tools: number; calls?: Call[] }

// A prompt the person sent, and when (epoch ms).
export type Prompt = { text: string; at: number }

// When a main-loop tool call started and ended (epoch ms).
export type Timing = { id: string; start: number; end?: number }

declare module 'claude-code' {
  interface PluginState {
    prettier: {
      settings: Settings
      turns: Turn[]
      live: Live
      prompts: Prompt[]
      timings: Timing[]
      // Whether a compact row (a folded prompt, a group, a turn's tools) is open,
      // by the row's requestId.
      open: StateFamily<boolean>
    }
  }
}
