import type { Prompt, Timing, Turn } from '../types'

// the reply colours' palette; prettier's own dim fills.
export const PURPLE = '#A855F7'
export const PURPLE_LIGHT = '#C4B5FD'
export const GREY = '#71717A'
export const RED = '#EF4444'
export const GREEN = '#22C55E'
export const CARD_BORDER = '#3F3F46'

// The prompt pill's rounded border: the deep structure purple.
export const PILL_BORDER = '#7C3AED'

// One space inside the pill on each side, between the text and the border.
export const PILL_PAD = 1
export const RESULT_GUTTER = '  ⎿  '
export const ROW_GUTTER = 2
export const EXPAND_KEY = 'ctrl+o'

// A fenced code block's panel: charcoal fill, thin violet border, lavender label.
export const PANEL_FILL = '#111114'
export const PANEL_BORDER = '#8B7CBD'
export const PANEL_LABEL = '#B9A7E8'
// The language chip's fill, a shade lighter than the panel's.
export const PANEL_CHIP = '#2E2A3A'
export const PANEL_PAD_X = 1
export const COPY_LABEL = '⧉ Copy'
export const COPIED_LABEL = 'Copied!'
export const COPIED_MS = 3500

// The copy mark beside a prompt's time, and what it reads just after a copy.
// A space each side: terminals draw ⧉ wider than its one cell, so the hover
// fill needs the cells around it to cover the whole glyph.
export const PROMPT_COPY = ' ⧉ '
export const PROMPT_COPIED = ' ✓ '

// An opened group: each call on a filled block, its output up to this many lines.
export const CALL_FILL = '#1C1B22'
export const CALL_OUTPUT_LINES = 40

// ---------------------------------------------------------------- measuring

export function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // Wide East Asian characters and most emoji take two cells.
    n += (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0x1f300 && code <= 0x1faff)
      ? 2
      : 1
  }
  return n
}

// `percent` of the terminal, in whole cells, never under 20.
export function share(columns: number, percent: number): number {
  return Math.max(20, Math.floor((columns * percent) / 100))
}

// The pill's outer width: its widest line plus a space and the border each side, no wider
// than `percent` of the terminal.
export function pillWidth(lines: readonly string[], columns: number, percent: number): number {
  const widest = Math.max(1, ...lines.map(cellWidth))
  return Math.min(widest + PILL_PAD * 2 + 2, Math.max(12, Math.floor((columns * percent) / 100)))
}

// ---------------------------------------------------------------- an edit's count

// Lines added and removed, after the lines both sides share at either end.
function lineDelta(before: string, after: string): { added: number; removed: number } {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1
  }
  return { added: b.length - head - tail, removed: a.length - head - tail }
}

// The `+12 −3` of an Edit or Write call, read from its input so it shows while
// the call runs; undefined for other tools and for a change of no lines.
export function inputDelta(tool: string, input: unknown): { added: number; removed: number } | undefined {
  const fields = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const text = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : '')
  const delta =
    tool === 'Edit'
      ? lineDelta(text('old_string'), text('new_string'))
      : tool === 'Write'
        ? { added: text('content') === '' ? 0 : text('content').split('\n').length, removed: 0 }
        : undefined
  return delta === undefined || (delta.added === 0 && delta.removed === 0) ? undefined : delta
}

// ---------------------------------------------------------------- spinner

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const SPIN_MS = 160

// The spinner's words: the tool running now, else the engine's message or
// word; one ellipsis after, unless the text already ends in one.
export function spinnerText(props: { word: string; message: string | null; suffix: string }, tool?: string): string {
  const text = tool !== undefined ? `▸ running ${tool}` : props.message ?? props.word
  return text.endsWith('…') ? text : `${text}${props.suffix}`
}

// ---------------------------------------------------------------- code panels

// A reply cut at its fenced code blocks: prose between them, and each block's
// language (empty when unlabeled) and raw code. A fence still open at the end
// (a reply being written) runs to the end.
export type ReplyPart = { kind: 'prose'; text: string } | { kind: 'code'; language: string; code: string }

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/

export function splitFences(text: string): ReplyPart[] {
  const parts: ReplyPart[] = []
  const lines = text.split('\n')
  let prose: string[] = []
  const flushProse = () => {
    const joined = prose.join('\n')
    if (joined.trim() !== '') parts.push({ kind: 'prose', text: joined.replace(/^\n+|\n+$/g, '') })
    prose = []
  }
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i] ?? '')
    if (open === null) {
      prose.push(lines[i] ?? '')
      continue
    }
    flushProse()
    const indent = (open[1] ?? '').length
    const fence = open[2] ?? '```'
    const close = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
    const code: string[] = []
    i++
    while (i < lines.length && !close.test(lines[i] ?? '')) {
      // Drop the fence's own indent from each line (a block inside a list item).
      const line = lines[i] ?? ''
      const lead = /^[ \t]*/.exec(line)?.[0].length ?? 0
      code.push(line.slice(Math.min(lead, indent)))
      i++
    }
    parts.push({ kind: 'code', language: open[3] ?? '', code: code.join('\n') })
  }
  flushProse()
  return parts
}

// The label in the panel's top border.
export function panelLabel(language: string): string {
  return language === '' ? 'code' : language.toLowerCase()
}

// Tabs as four spaces, so what is measured is what is drawn.
export function untab(code: string): string {
  return code.replace(/\t/g, '    ')
}

// The panel's outer width: the longest line, or the top row (the language chip,
// a space, the Copy control) when wider, plus padding and border; never more
// than `room`.
export function panelWidth(code: string, label: string, room: number): number {
  const widest = Math.max(0, ...untab(code).split('\n').map(cellWidth))
  const controls = cellWidth(label) + 2 + 1 + Math.max(cellWidth(COPY_LABEL), cellWidth(COPIED_LABEL))
  const inner = Math.max(widest, controls) + 2 * PANEL_PAD_X
  return Math.max(12, Math.min(inner + 2, room))
}

// ---------------------------------------------------------------- folding a prompt

export type Capped = { shown: string; hidden: number }

// The head of `text` that fits in `rows` rows of `room` cells, and how many of
// its lines are left out (a line cut part-way counts as left out).
export function capText(text: string, room: number, rows: number): Capped {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  let used = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const need = Math.max(1, Math.ceil(cellWidth(line) / Math.max(1, room)))
    if (used + need <= rows) {
      kept.push(line)
      used += need
      continue
    }
    const left = rows - used
    if (left > 0) {
      // Fill the rows that are left with the head of this line.
      let cut = ''
      for (const ch of line) {
        if (cellWidth(cut + ch) > left * room - 1) break
        cut += ch
      }
      kept.push(`${cut}…`)
    }
    return { shown: kept.join('\n'), hidden: lines.length - i }
  }
  return { shown: text, hidden: 0 }
}

// ---------------------------------------------------------------- diffs

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
export type EditDiff = { path: string | undefined; source: string; added: number; removed: number; isNew: boolean }

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

// An Edit's or Write's result as unified-diff hunks: a new file's whole
// content as added lines. Undefined when it carries none (an unchanged file),
// which the engine then draws.
export function editDiff(tool: string, output: unknown): EditDiff | undefined {
  if (tool !== 'Edit' && tool !== 'Write') return undefined
  if (output === null || typeof output !== 'object') return undefined
  const out = output as { structuredPatch?: unknown; filePath?: unknown; type?: unknown; content?: unknown }
  const path = typeof out.filePath === 'string' ? out.filePath : undefined
  if (tool === 'Write' && out.type === 'create' && typeof out.content === 'string') {
    const lines = out.content.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
    const source = `@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}`
    return { path, source, added: lines.length, removed: 0, isNew: true }
  }
  if (!Array.isArray(out.structuredPatch) || out.structuredPatch.length === 0) return undefined
  const hunks = out.structuredPatch as Hunk[]
  let added = 0
  let removed = 0
  const parts = hunks.map(h => {
    for (const line of h.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
    return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}`
  })
  return { path, source: parts.join('\n'), added, removed, isNew: false }
}

// A file's path relative to the session's folder when inside it, else its
// last three parts.
export function shortPath(path: string, cwd: string): string {
  const p = path.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return p.slice(root.length + 1)
  const parts = p.split('/').filter(s => s !== '')
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p
}

// As the engine sums a diff up: `Added 3 lines, removed 1 line`.
export function diffSummary(added: number, removed: number): string {
  if (added > 0 && removed > 0) return `Added ${plural(added, 'line')}, removed ${plural(removed, 'line')}`
  if (added > 0) return `Added ${plural(added, 'line')}`
  if (removed > 0) return `Removed ${plural(removed, 'line')}`
  return 'No lines changed'
}

// ---------------------------------------------------------------- errors

// A refusal at the permission dialog is an error to the model, not a failure
// to show in red: the engine draws those itself.
export function isRejection(output: unknown): boolean {
  return typeof output === 'string' && /user (doesn't|does not) want|rejected|was denied|permission denied by the user/i.test(output)
}

// A failed call's error as plain words: Claude Code's <tool_use_error> wrapper
// dropped, tabs as spaces, no carriage returns. Undefined when it is no text.
export function errorText(output: unknown): string | undefined {
  if (typeof output !== 'string') return undefined
  const text = output.replace(/<\/?tool_use_error>/g, '').replace(/\r/g, '').replace(/\t/g, '    ').trim()
  return text === '' ? undefined : text
}

// The red frame's outer width: its widest line (the title or the error) plus a
// space and a border each side, never more than `room`.
export function frameWidth(lines: readonly string[], room: number): number {
  const widest = Math.max(1, ...lines.map(cellWidth))
  return Math.max(12, Math.min(widest + 4, room))
}

// ---------------------------------------------------------------- times

// As the engine formats a turn's length: `3s`, `1m 4s`, `1h 2m`.
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// A short duration for a tool run: `0.4s` under ten seconds, else as above.
export function formatShort(ms: number): string {
  return ms < 10_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : formatDuration(ms)
}

// The local wall-clock time, `14:02`.
export function formatClock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// How far apart turn.complete's duration and the footer's may be and still match.
const MATCH_SLACK_MS = 2000

// The recorded turn whose length is nearest the footer's, newest first on a tie.
export function matchTurn(turns: readonly Turn[], durationMs: number): Turn | undefined {
  let best: Turn | undefined
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t === undefined) continue
    const gap = Math.abs(t.durationMs - durationMs)
    if (gap <= MATCH_SLACK_MS && (best === undefined || gap < Math.abs(best.durationMs - durationMs))) best = t
  }
  return best
}

// The closing line's two parts, `39s` and `2 tools`; no count where none is known.
export function footerParts(durationMs: number, tools: number | undefined): { took: string; used?: string } {
  const took = formatDuration(durationMs)
  return tools === undefined || tools === 0 ? { took } : { took, used: plural(tools, 'tool') }
}

// When the person sent this prompt: the newest record with the same words.
export function promptTime(prompts: readonly Prompt[], text: string): number | undefined {
  const want = text.trim()
  for (let i = prompts.length - 1; i >= 0; i--) {
    const p = prompts[i]
    if (p !== undefined && p.text.trim() === want) return p.at
  }
  return undefined
}

// ---------------------------------------------------------------- tool groups

// What a tool call worked on, in one short line: a command's first line, a
// file's last two path parts, a pattern, a URL, a query.
export function describeCall(tool: string, input: unknown): string {
  const flat = callText(tool, input, false).replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

// What a tool call worked on, whole: a command with all its lines, a file's
// full path, a pattern, a URL, a query.
export function describeCallWhole(tool: string, input: unknown): string {
  const text = callText(tool, input, true)
  return tool === 'Bash' || tool === 'PowerShell' ? text.trim() : text.replace(/\s+/g, ' ').trim()
}

function callText(tool: string, input: unknown, isWhole: boolean): string {
  const i = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (k: string) => (typeof i[k] === 'string' && i[k] !== '' ? (i[k] as string) : undefined)
  const short = (p: string) => p.replace(/\\/g, '/').split('/').filter(s => s !== '').slice(-2).join('/')
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  let text: string
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      text = isWhole ? str('command') ?? '' : (str('command') ?? '').split('\n')[0] ?? ''
      break
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      text = path === undefined ? '' : isWhole ? path.replace(/\\/g, '/') : short(path)
      break
    case 'Grep':
    case 'Glob':
      text = str('pattern') ?? ''
      break
    case 'WebFetch':
      text = (str('url') ?? '').replace(/^https?:\/\//, '')
      break
    case 'WebSearch':
      text = str('query') ?? ''
      break
    case 'Agent':
      text = str('description') ?? ''
      break
    case 'Skill':
      text = str('skill') ?? ''
      break
    default: {
      const first = Object.entries(i).find(([k, v]) => typeof v === 'string' && k !== 'tool' && k !== 'tool_use_id')
      text = typeof first?.[1] === 'string' ? first[1] : ''
    }
  }
  return text
}

// What a finished call gave back, as text to show under it in an opened
// group: a command's output, the matches of a search, a read's line count.
export function callOutput(tool: string, output: unknown): string {
  if (typeof output === 'string') return output.trim()
  if (output === null || typeof output !== 'object') return ''
  const o = output as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  if (tool === 'Bash' || tool === 'PowerShell') return [text(o.stdout), text(o.stderr)].filter(t => t !== '').join('\n')
  if (tool === 'Read') {
    const file = o.file as Record<string, unknown> | undefined
    return typeof file?.numLines === 'number' ? `${file.numLines} ${file.numLines === 1 ? 'line' : 'lines'}` : ''
  }
  if (text(o.content) !== '') return text(o.content)
  if (Array.isArray(o.filenames)) return o.filenames.filter(f => typeof f === 'string').join('\n')
  return ''
}

// `mcp__server__tool` reads as its tool's name.
export function toolLabel(tool: string): string {
  const mcp = /^mcp__.+?__(.+)$/.exec(tool)
  return mcp?.[1] ?? tool
}

const VERBS: Record<string, { verb: string; one: string; many: string }> = {
  Read: { verb: 'Read', one: 'file', many: 'files' },
  Grep: { verb: 'Searched', one: 'pattern', many: 'patterns' },
  Glob: { verb: 'Searched', one: 'pattern', many: 'patterns' },
  LS: { verb: 'Listed', one: 'folder', many: 'folders' },
  Bash: { verb: 'Ran', one: 'command', many: 'commands' },
  PowerShell: { verb: 'Ran', one: 'command', many: 'commands' },
  WebFetch: { verb: 'Fetched', one: 'page', many: 'pages' },
  WebSearch: { verb: 'Searched the web', one: 'time', many: 'times' },
  NotebookRead: { verb: 'Read', one: 'notebook', many: 'notebooks' },
}

// `Read 3 files, searched 2 patterns`, in the order the kinds first appear.
export function groupSummary(tools: readonly string[]): string {
  const counts = new Map<string, { verb: string; one: string; many: string; n: number }>()
  for (const tool of tools) {
    const v = VERBS[tool] ?? { verb: `Used ${toolLabel(tool)}`, one: 'time', many: 'times' }
    const key = `${v.verb}|${v.one}`
    const cur = counts.get(key)
    if (cur === undefined) counts.set(key, { ...v, n: 1 })
    else cur.n += 1
  }
  const parts = [...counts.values()].map(c => `${c.verb} ${plural(c.n, c.one, c.many)}`)
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(', ')
}

// The wall time the group's calls took, first start to last end; undefined
// while one runs or when a call's timing was not recorded.
export function groupDuration(ids: readonly (string | undefined)[], timings: readonly Timing[]): number | undefined {
  let start = Infinity
  let end = -Infinity
  for (const id of ids) {
    const t = id === undefined ? undefined : timings.find(x => x.id === id)
    if (t === undefined || t.end === undefined) return undefined
    start = Math.min(start, t.start)
    end = Math.max(end, t.end)
  }
  return ids.length === 0 ? undefined : end - start
}

// ---------------------------------------------------------------- message cards

export type CardHead = { icon: string; label: string; color: string; meta: string }

type Origin = { kind: string }
type Task = { status?: string; durationMs?: number }

// The heading of a card for a row the person did not type: a background
// task's notification, or a message another agent, session or channel sent.
export function cardHead(origin: Origin, task: Task | undefined, from: { name: string } | undefined): CardHead {
  if (task !== undefined || origin.kind === 'task-notification') {
    const status = task?.status
    const color = status === 'failed' ? RED : status === 'completed' ? GREEN : GREY
    const meta = [status, task?.durationMs === undefined ? undefined : formatDuration(task.durationMs)]
      .filter((s): s is string => s !== undefined && s !== '')
      .join(' · ')
    return { icon: '⚙', label: 'Background task', color, meta }
  }
  if (origin.kind === 'scheduled-trigger') return { icon: '⏰', label: 'Scheduled task', color: PURPLE_LIGHT, meta: '' }
  if (origin.kind === 'channel') return { icon: '#', label: from?.name ?? 'Channel', color: PURPLE_LIGHT, meta: 'channel' }
  if (origin.kind === 'plugin') return { icon: '◆', label: 'From a mod', color: PURPLE_LIGHT, meta: '' }
  if (origin.kind === 'slack-ping') return { icon: '✉', label: from?.name ?? 'Slack', color: PURPLE_LIGHT, meta: 'Slack' }
  return { icon: '✉', label: from === undefined ? 'Message' : `From ${from.name}`, color: PURPLE_LIGHT, meta: '' }
}
