import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Cache, Clock, Controls, Run, Usage, Window } from '../types'

const usageAtom = atom({ plugin: 'statusdeck', key: 'usage' } as const, {
  fiveHour: null,
  week: null,
  context: null,
} as Usage)
const runAtom = atom({ plugin: 'statusdeck', key: 'run' } as const, {
  isWorking: false,
  startedAt: 0,
  now: 0,
  tokens: 0,
  frame: 0,
} as Run)
const controlsAtom = atom({ plugin: 'statusdeck', key: 'controls' } as const, {
  effort: null,
  model: null,
} as Controls)
const cacheAtom = atom({ plugin: 'statusdeck', key: 'cache' } as const, {
  touchedAt: null,
} as Cache)
const clockAtom = atom({ plugin: 'statusdeck', key: 'clock' } as const, { now: 0 } as Clock)
const panesSummary = { plugin: 'panes', key: 'summary' } as const

// Palette shared with inkstyle and panes.
const PILL_BG = '#202C34'
const PILL_LABEL = '#D4DCE2'
const PILL_TIMER = '#A7B3BD'
const CACHE_TIME = '#A7B3BD'
// The colour of a percentage used, blended channel by channel between stops.
const USED_STOPS = [
  { at: 0, color: '#8BD5F5' },
  { at: 50, color: '#9FDFB5' },
  { at: 70, color: '#FFD080' },
  { at: 85, color: '#FF9E64' },
  { at: 100, color: '#FF6B6B' },
]
// Blank cells between the parts of the status row.
const MODE_GAP = 2
const PILL_GAP = 1
// The footer's left pad and a margin: a pill row this much narrower than the
// terminal still fits on one line.
const FOOTER_SLACK = 4
const ORANGE = '#F97316'
const PURPLE = '#A855F7'
const PURPLE_LIGHT = '#C4B5FD'
const GREEN = '#22C55E'
const ICE = '#7DD3FC'
const WARM_ICON = '⚡'
const COLD_ICON = '❄'
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const TICK_MS = 160
const POLL_MS = 1000
const COUNT_MS = 3000
const IDLE_CLOCK_MS = 30000

// A coloured glyph and a short word, no background block: the mode at a glance
// in a few cells.
const MODES = [
  { re: /plan mode/i, label: 'Plan', glyph: '◐', color: '#A78BFA' },
  { re: /accept edits/i, label: 'Accept edits', glyph: '◉', color: '#4ADE80' },
  { re: /bypass permissions/i, label: 'Bypass', glyph: '◆', color: '#F87171' },
  { re: /auto mode/i, label: 'Auto', glyph: '◎', color: '#FBBF24' },
  { re: /don'?t ask/i, label: "Don't ask", glyph: '◇', color: '#9CA3AF' },
  { re: /manual mode/i, label: 'Manual', glyph: '○', color: '#94A3B8' },
]
// A mode this list does not know yet ("review mode on") still reads as one
// word, in a neutral colour.
function modeOf(text: string): (typeof MODES)[number] | undefined {
  const known = MODES.find(m => m.re.test(text))
  if (known !== undefined) return known
  const name = /([a-z][a-z']*(?: [a-z][a-z']*)?) mode on/i.exec(text)?.[1]
  if (name === undefined) return undefined
  const label = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  return { re: new RegExp(name, 'i'), label, glyph: '●', color: '#94A3B8' }
}

function hex(color: string): number[] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: string, b: string, t: number): string {
  const [ar = 0, ag = 0, ab = 0] = hex(a)
  const [br = 0, bg = 0, bb = 0] = hex(b)
  const part = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${part(ar, br)}${part(ag, bg)}${part(ab, bb)}`
}

function usedColor(percent: number): string {
  const p = Math.min(100, Math.max(0, percent))
  const i = USED_STOPS.findIndex(stop => stop.at >= p)
  const hi = USED_STOPS[Math.max(1, i)]!
  const lo = USED_STOPS[Math.max(1, i) - 1]!
  return mix(lo.color, hi.color, (p - lo.at) / (hi.at - lo.at))
}

function countdown(resetsAt: string | null, now: number): string {
  if (resetsAt === null) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return ''
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  return `${minutes}m`
}

// Minutes while there is room to spare, m:ss for the last five.
function warmth(ms: number): string {
  if (ms >= 300000) return `${Math.ceil(ms / 60000)}m`
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function prettyModel(id: string | null): string {
  if (id === null) return '…'
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(id)
  if (m === null) return id
  const name = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1).toLowerCase()
  return m[3] === undefined ? `${name} ${m[2]}` : `${name} ${m[2]}.${m[3]}`
}

function toWindow(limit: SessionRateLimit | undefined): Window | null {
  return limit === undefined ? null : { percent: limit.percentUsed, resetsAt: limit.resetsAt ?? null }
}

// A window whose reset has passed holds nothing worth showing.
function fresh(w: Window | null, now: number): Window | null {
  if (w === null || w.resetsAt === null) return w
  return Date.parse(w.resetsAt) > now ? w : null
}

// Before the first response of a session the engine has no reading yet
// (rateLimits empty, no context fill), so a reading only replaces what it has.
// While the window is counted as /context counts it, that count owns ctx: the
// engine's figure is the last response's, stale after a /compact or /clear.
function usageFrom(
  prev: Usage,
  context: { percent?: number } | undefined,
  rateLimits: readonly SessionRateLimit[] | undefined,
): Usage {
  const limits = rateLimits ?? []
  return {
    fiveHour: toWindow(limits.find(l => l.kind === 'five_hour')) ?? prev.fiveHour,
    week: toWindow(limits.find(l => l.kind === 'seven_day')) ?? prev.week,
    context: isCounted ? prev.context : (context?.percent ?? prev.context),
  }
}

// The rate-limit windows are the account's, so the last reading carries over
// to the next session until a response brings a new one.
async function saveUsage($: EngineInterface, usage: Usage): Promise<void> {
  if (usage.fiveHour === null && usage.week === null) return
  await $.store.set('limits', { fiveHour: usage.fiveHour, week: usage.week })
}

async function storedUsage($: EngineInterface, now: number): Promise<Usage> {
  const held = (await $.store.get('limits')) as Partial<Usage> | undefined
  return {
    fiveHour: fresh(held?.fiveHour ?? null, now),
    week: fresh(held?.week ?? null, now),
    context: null,
  }
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const { context, rateLimits } = await $.session.usage()
  const prev = await read($, usageAtom)
  const next = usageFrom(prev, context, rateLimits)
  if (JSON.stringify(next) === JSON.stringify(prev)) return
  await update($, usageAtom, () => next)
  await saveUsage($, next)
}

// The window counted locally, as /context counts it (no request sent), so ctx
// shows the figure /context shows: right after a /compact or /clear too, when
// the engine has no fill until the next response. A count that fails leaves
// ctx to the engine's figure.
async function recountContext($: EngineInterface): Promise<void> {
  lastCountAt = await $.clock.now()
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  const max = b?.rawMaxTokens ?? context.window
  const percent =
    b === undefined
      ? null
      : typeof b.percentage === 'number'
        ? b.percentage
        : max > 0
          ? Math.round((b.totalTokens / max) * 100)
          : null
  isCounted = percent !== null
  if (percent === null) return
  if ((await read($, usageAtom)).context === percent) return
  await update($, usageAtom, u => ({ ...u, context: percent }))
}

// "claude-opus-5-5[1m]", "claude-opus-5-5-20261001" and "opus" all name one model.
function baseModel(id: string): string {
  return id
    .toLowerCase()
    .replace(/\[.*?\]/g, '')
    .replace(/-\d{8}$/, '')
    .trim()
}

// This build keeps the effort per model, in settings.modelSettings[<model id>].
function effortFor(settings: Record<string, unknown>, model: string): string | null {
  const perModel = settings['modelSettings']
  const want = baseModel(model)
  if (want !== '' && perModel !== null && typeof perModel === 'object') {
    const entries = Object.entries(perModel as Record<string, unknown>)
    const exact = entries.filter(([name]) => baseModel(name) === want)
    const loose = entries.filter(([name]) => {
      const have = baseModel(name)
      return have !== want && (have.includes(want) || want.includes(have))
    })
    for (const [, value] of [...exact, ...loose]) {
      const level = (value as { effortLevel?: unknown } | null)?.effortLevel
      if (typeof level === 'string') return level
    }
  }
  const level = settings['effortLevel']
  return typeof level === 'string' ? level : null
}

// One failing step (the engine not ready yet at launch) must not stop the rest.
async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // The next poll tries again.
  }
}

let ticker: Timer | undefined
let poll: Timer | undefined
let tokensDone = 0
let ttlMs = 3600000
// Whether the last local count of the window worked, and when it ran.
let isCounted = false
let lastCountAt = 0
// What the settings said at the last poll; a poll only moves the label when
// this changes, so a session-only /effort max is not flipped back.
let seenKey = ''
// Each model keeps a cache of its own: switching away and back (/model, or a
// view whose model differs) brings back the one it left.
const touchedByModel = new Map<string, number>()
const pending = new Map<string, number>()

function live(): number {
  return tokensDone + [...pending.values()].reduce((a, b) => a + b, 0)
}

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const tokens = live()
  await update($, runAtom, r => ({ ...r, now, tokens, frame: r.frame + 1 }))
}

function startTicker($: EngineInterface): void {
  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => void tick($))
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = undefined
}

// Writes only on a change, so the slow poll redraws nothing while idle.
async function refreshControls($: EngineInterface, effort?: string): Promise<void> {
  const model = await $.session.model()
  const settings = (await $.settings.read()) as Record<string, unknown>
  const level = effortFor(settings, model)
  const key = `${model}|${level}`
  const isChanged = key !== seenKey
  // A miss (model or settings not ready at launch) is not remembered, so the
  // next poll fills the label in rather than leaving "…".
  if (level !== null && model !== '') seenKey = key
  const current = await read($, controlsAtom)
  const next = {
    model: model !== '' ? model : current.model,
    effort: effort ?? (level !== null && (isChanged || current.effort === null) ? level : current.effort),
  }
  // "claude-opus-5-5" and "claude-opus-5-5[1m]" share one cache.
  const was = current.model === null ? '' : baseModel(current.model)
  const now = next.model === null ? '' : baseModel(next.model)
  if (was !== '' && now !== '' && was !== now) {
    const { touchedAt } = await read($, cacheAtom)
    if (touchedAt !== null) touchedByModel.set(was, touchedAt)
    await update($, cacheAtom, () => ({ touchedAt: touchedByModel.get(now) ?? null }))
  }
  if (next.model === current.model && next.effort === current.effort) return
  await update($, controlsAtom, () => next)
}

// Keeps the countdowns moving: every second while the cache is warm, else rarely.
async function pulse($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const { touchedAt } = await read($, cacheAtom)
  const clock = await read($, clockAtom)
  const isWarm = touchedAt !== null && touchedAt + ttlMs > now
  const isJustCold = touchedAt !== null && !isWarm && clock.now < touchedAt + ttlMs
  if (isWarm || isJustCold || now - clock.now >= IDLE_CLOCK_MS) {
    await update($, clockAtom, () => ({ now }))
  }
  await safely(() => refreshControls($))
  // The plain usage call is free and writes only on a change: catches the
  // first reading of a session, and any measurement missed.
  await safely(() => refreshUsage($))
  // The local count every few seconds, so ctx never trails /context.
  if (now - lastCountAt >= COUNT_MS) await safely(() => recountContext($))
}

function startPoll($: EngineInterface): void {
  poll?.cancel()
  poll = $.clock.every(POLL_MS, () => void safely(() => pulse($)))
}

async function pickEffort($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: 'effort' })
  } catch {
    $.ui.toast('Could not open the effort picker; type /effort')
  }
  await refreshControls($)
}

// A chip opens that pane of the panes mod, beside the conversation or inline.
async function openPane($: EngineInterface, id: string): Promise<void> {
  try {
    await $.command.run({ command: 'panes', args: id })
  } catch {
    $.ui.toast(`Could not open the pane; type /panes ${id}`)
  }
}

async function pickModel($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: 'model' })
  } catch {
    $.ui.toast('Could not open the model picker; type /model')
  }
  await refreshControls($)
}

export const register: Register = (on, options) => {
  ttlMs = (options as Record<string, unknown>)['cacheTtl'] === '5m' ? 300000 : 3600000

  // At launch the engine may not have the model, settings or a usage reading
  // yet: the poll starts first and each step stands alone, so a miss here is
  // filled in a second later instead of leaving the row blank.
  on('session.start', async ($, e, next) => {
    startPoll($)
    await safely(async () => {
      const started = await $.clock.now()
      await update($, clockAtom, () => ({ now: started }))
      const held = await storedUsage($, started)
      await update($, usageAtom, u => ({
        fiveHour: u.fiveHour ?? held.fiveHour,
        week: u.week ?? held.week,
        context: u.context,
      }))
    })
    await safely(() => refreshUsage($))
    await safely(() => refreshControls($))
    await safely(async () => {
      if ((await read($, runAtom)).isWorking) startTicker($)
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const measured = usageFrom(await read($, usageAtom), e.context, e.rateLimits)
    await update($, usageAtom, () => measured)
    await safely(() => saveUsage($, measured))
    // The live window's fill moves after each main-thread response: a request
    // that went out over the cached prefix, so the cache was just refreshed.
    if (e.changed.includes('context') && (e.context.tokens ?? 0) > 0) {
      const now = await $.clock.now()
      const { touchedAt } = await read($, cacheAtom)
      if (touchedAt === null || now - touchedAt > 2000) {
        await update($, cacheAtom, () => ({ touchedAt: now }))
      }
      await safely(() => recountContext($))
    }
    return next(e)
  })

  // A /clear starts an empty window with nothing cached.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      touchedByModel.clear()
      await update($, cacheAtom, () => ({ touchedAt: null }))
      await update($, usageAtom, u => ({ ...u, context: null }))
      // The next poll counts the new window.
      lastCountAt = 0
    }
    return next(e)
  })

  // The summarizer's request reads the cached system prompt and tools, which
  // the next request reuses: the cache stays warm from that moment, and the
  // window's fill drops to the summary's.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && done.skip === undefined && e.trigger !== 'precompute') {
      const now = await $.clock.now()
      await update($, cacheAtom, () => ({ touchedAt: now }))
      await safely(() => recountContext($))
    }
    return done
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      tokensDone = 0
      pending.clear()
      const now = await $.clock.now()
      await update($, runAtom, r => ({ ...r, isWorking: true, startedAt: now, now, tokens: 0 }))
      startTicker($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      stopTicker()
      pending.clear()
      await update($, runAtom, r => ({ ...r, isWorking: false }))
      await safely(() => refreshControls($))
    }
    return next(e)
  })

  // Counts the turn's output tokens as they stream (an estimate while text
  // arrives, the API's own count when a response ends), follows the effort the
  // turn really runs at, and stamps the cache each main-thread request touches.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const startedAt = await $.clock.now()
    if (isMain && typeof e.effort === 'string') {
      const effort = e.effort
      if ((await read($, controlsAtom)).effort !== effort) {
        await update($, controlsAtom, c => ({ ...c, effort }))
      }
    }
    const id = `${e.agentId ?? 'main'}:${e.turnId}:${e.index}`
    let chars = 0
    let counted = false
    let isStamped = false
    const stamp = async (usage: { cache_read_input_tokens: number; cache_creation_input_tokens: number } | null) => {
      if (!isMain || isStamped || usage === null) return
      if (usage.cache_read_input_tokens + usage.cache_creation_input_tokens <= 0) return
      isStamped = true
      await update($, cacheAtom, () => ({ touchedAt: startedAt }))
    }
    const stream = next(e)
    try {
      let step = await stream.next()
      while (step.done !== true) {
        const chunk = step.value
        if (chunk.kind === 'text' || chunk.kind === 'thinking') chars += chunk.text.length
        else if (chunk.kind === 'input') chars += chunk.json.length
        else if (chunk.kind === 'stop' && chunk.usage !== null) {
          tokensDone += chunk.usage.output_tokens
          counted = true
          await stamp(chunk.usage)
        }
        pending.set(id, counted ? 0 : Math.round(chars / 4))
        yield chunk
        step = await stream.next()
      }
      const result = step.value
      if (result !== undefined) await stamp(result.usage)
      return result
    } finally {
      if (!counted) tokensDone += Math.round(chars / 4)
      pending.delete(id)
    }
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)
    const typed = e.args.trim().toLowerCase()
    await refreshControls($, EFFORTS.includes(typed) ? typed : undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    await refreshControls($)
    return ran
  }).catch(($, e, next) => next(e))

  // The line the engine animates while a turn runs: just the word, so the
  // time and tokens appear once, in the footer after the effort.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Text } = $.ui.resolve(e)
    const run = await read($, runAtom)
    const word = e.props.message ?? e.props.word
    const text = word.endsWith('…') ? word : `${word}${e.props.suffix}`
    return (
      <Text color="#A855F7">
        {SPINNER[run.frame % SPINNER.length]} {text}
      </Text>
    )
  })

  // The band above the prompt: only the panes chips, so without them it draws
  // nothing and takes no row.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const { value: panes } = await $.state.get(panesSummary)

    // While the panes panel is off screen, its news folds into one quiet row.
    const chips = (p: NonNullable<typeof panes>) => {
      const items = []
      if (p.branch !== null) {
        items.push(
          <Button key="chip-git" plain onPress={() => openPane($, 'git')}>
            <Text color={PURPLE} bold>{`⎇ ${p.branch}`}</Text>
            {p.ahead > 0 && <Text color={PURPLE_LIGHT}>{` ↑${p.ahead}`}</Text>}
            {p.behind > 0 && <Text color={ORANGE}>{` ↓${p.behind}`}</Text>}
            {p.changed > 0 && <Text dimColor>{` · ${p.changed} changed`}</Text>}
          </Button>,
        )
      }
      if (p.edited > 0) {
        items.push(
          <Button key="chip-files" plain onPress={() => openPane($, 'files')}>
            <Text color={ORANGE}>◆</Text>
            <Text>{` ${p.edited} edited`}</Text>
          </Button>,
        )
      }
      if (p.total > 0) {
        items.push(
          <Button key="chip-tasks" plain onPress={() => openPane($, 'tasks')}>
            <Text color={GREEN}>✓</Text>
            <Text>{` ${p.done}/${p.total} tasks`}</Text>
          </Button>,
        )
      }
      if (items.length === 0) return null
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {items}
        </Box>
      )
    }

    const chipRow = panes !== undefined && !panes.isPanelShown ? chips(panes) : null
    return chipRow ?? next(e)
  })

  // The footer row under the prompt is the engine's: its own mode text, then
  // " · " and the hint at the left, the SessionMode slot at the far right,
  // which it moves to a row of its own, still flush right, when the two do not
  // fit side by side. So the hint draws the mode, model and effort, the slot
  // draws the pills and the cache, and neither asks for more width than its
  // words: a part that did would squeeze the engine's mode text until it ran
  // into the model ("auto mode onOpus") and its " ·" fell to a row of its own.

  // The 5h, 7d and ctx pills and the cache time. None of the engine's mode
  // labels draw, nor the " · " it sets before them.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // A blank of fixed width that never shrinks, so on a narrow terminal the
    // words keep their spacing and wrap whole instead of running together.
    const gap = (key: string, cells: number) => <Box key={key} width={cells} flexShrink={0} />
    const usage = await read($, usageAtom)
    const cache = await read($, cacheAtom)
    const clock = await read($, clockAtom)
    const now = clock.now > 0 ? clock.now : await $.clock.now()

    const remaining = cache.touchedAt === null ? 0 : cache.touchedAt + ttlMs - now
    const isWarm = remaining > 0
    const cacheText = isWarm ? warmth(remaining) : 'cold'
    const percentText = (p: number | null) => (p === null ? '–' : `${Math.round(p)}%`)

    const pills = [
      usage.fiveHour === null
        ? null
        : { key: '5h', name: '5h', percent: usage.fiveHour.percent, reset: countdown(usage.fiveHour.resetsAt, now) },
      usage.week === null
        ? null
        : { key: '7d', name: '7d', percent: usage.week.percent, reset: countdown(usage.week.resetsAt, now) },
      { key: 'ctx', name: 'ctx', percent: usage.context, reset: '' },
    ].filter(p => p !== null)

    // Each pill sets its own background on every piece, so nothing bleeds past
    // its closing pad.
    const pill = (p: (typeof pills)[number]) => (
      <Box key={p.key} flexDirection="row" flexShrink={0}>
        <Text backgroundColor={PILL_BG} color={PILL_LABEL} bold>
          {` ${p.name} `}
        </Text>
        <Text backgroundColor={PILL_BG} color={p.percent === null ? PILL_TIMER : usedColor(p.percent)} bold>
          {percentText(p.percent)}
        </Text>
        <Text backgroundColor={PILL_BG} color={PILL_TIMER}>
          {p.reset === '' ? ' ' : ` ${p.reset} `}
        </Text>
      </Box>
    )

    const parts = [
      ...pills.map(p => (
        <Box key={`gap-${p.key}`} flexDirection="row" flexShrink={0}>
          {pill(p)}
          {gap(`gap-after-${p.key}`, PILL_GAP)}
        </Box>
      )),
      <Box key="cache" flexDirection="row" flexShrink={0}>
        <Text color={isWarm ? ORANGE : ICE}>{isWarm ? WARM_ICON : COLD_ICON}</Text>
        <Text color={CACHE_TIME}>{` ${cacheText}`}</Text>
      </Box>,
    ]

    // Cells the group takes on one line (⚡ is two wide, ❄ one).
    const cells =
      pills.reduce(
        (n, p) => n + p.name.length + 2 + percentText(p.percent).length + (p.reset === '' ? 1 : p.reset.length + 2) + PILL_GAP,
        0,
      ) +
      (isWarm ? 2 : 1) +
      1 +
      cacheText.length
    // A row of exactly its words while it fits the terminal; only narrower
    // than that does it wrap, flush right, on the row the engine gives it.
    const isOneLine = cells + FOOTER_SLACK <= (e.viewport?.columns ?? 80)
    return isOneLine ? (
      <Box key="right" flexDirection="row" flexShrink={0}>
        {parts}
      </Box>
    ) : (
      <Box key="right" flexDirection="row" flexWrap="wrap" justifyContent="flex-end">
        {parts}
      </Box>
    )
  })

  // The mode, model and effort, after the engine's own mode text; while a turn
  // runs, its time and live output tokens follow the effort.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // A blank of fixed width that never shrinks, so on a narrow terminal the
    // words keep their spacing and wrap whole instead of running together.
    const gap = (key: string, cells: number) => <Box key={key} width={cells} flexShrink={0} />
    const controls = await read($, controlsAtom)
    const run = await read($, runAtom)
    const mode = modeOf(e.props.hint)
    const model = prettyModel(controls.model)
    const effort = controls.effort ?? '…'

    return (
      <Box key="left" flexDirection="row" flexShrink={0}>
        {mode !== undefined && (
          <Box key="mode" flexShrink={0}>
            <Text color={mode.color} bold>
              {`${mode.glyph} ${mode.label}`}
            </Text>
          </Box>
        )}
        {mode !== undefined && gap('gap-mode', MODE_GAP)}
        <Box key="model-effort" flexDirection="row" flexShrink={0}>
          <Button key="model" plain onPress={() => pickModel($)}>
            <Text color={ORANGE} bold>
              {model}
            </Text>
          </Button>
          {gap('gap-effort', 1)}
          <Button key="effort" plain onPress={() => pickEffort($)}>
            <Text color={ORANGE} bold>
              {effort}
            </Text>
          </Button>
        </Box>
        {run.isWorking && gap('gap-run', MODE_GAP)}
        {run.isWorking && (
          <Box key="run" flexDirection="row" flexShrink={0}>
            <Text color={PURPLE_LIGHT}>{`⏱ ${elapsed(run.now - run.startedAt)}`}</Text>
            {gap('gap-tokens', 1)}
            <Text color={PURPLE_LIGHT}>{`↓ ${compact(run.tokens)} tok`}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
