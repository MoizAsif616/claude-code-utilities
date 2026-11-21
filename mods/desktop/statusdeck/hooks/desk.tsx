import { atom, read, update } from 'claude-code'
import type {
  Args,
  Color,
  EngineInterface,
  EventResult,
  Register,
  RenderChildren,
  RenderInput,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import type { Cache, Catalog, Choice, Choices, Clock, ContextTool, DeskRun as Run, DeskUsage as Usage, Git, Mood, MoodState, Window } from '../types'
import { CLAWD_HEIGHT, CLAWD_WIDTH, clawd } from './clawd'
import {
  isLockedTool,
  parseSkills,
  serverOf,
  shortTool,
  withoutFunctions,
  withoutNames,
  withoutServers,
  withoutSkills,
} from './context'
import { parseGit } from './git'

// statusdeck's desktop band, ported from deskdeck, right above the prompt: Clawd and the turn's timer at
// the left; the git, 5h, 7d, ctx and cache pills at the right, each a rounded
// outline on no fill of its own, in theme colours only. The app frames this band itself
// (padding, rounded corners, a faint tint), which no prop reaches; it draws
// mod trees in the bar under the prompt for its cloud sessions only, as of
// app 2.37337. Every other surface (the CLI, VS Code, mobile) gets the
// engine's own band.

const usageAtom = atom({ plugin: 'statusdeck', key: 'deskUsage' } as const, {
  fiveHour: null,
  week: null,
  context: null,
  tokens: null,
  window: null,
} as Usage)
const cacheAtom = atom({ plugin: 'statusdeck', key: 'deskCache' } as const, { touchedAt: null } as Cache)
const clockAtom = atom({ plugin: 'statusdeck', key: 'deskClock' } as const, { now: 0 } as Clock)
const moodAtom = atom({ plugin: 'statusdeck', key: 'mood' } as const, { mood: 'idle', since: 0 } as MoodState)
const runAtom = atom({ plugin: 'statusdeck', key: 'deskRun' } as const, { isWorking: false, startedAt: 0, tokens: 0 } as Run)
const gitAtom = atom({ plugin: 'statusdeck', key: 'git' } as const, null as Git)
const catalogAtom = atom({ plugin: 'statusdeck', key: 'catalog' } as const, { skills: [], tools: [] } as Catalog)
const NONE: Choice = { skills: [], tools: [] }
const choicesAtom = atom({ plugin: 'statusdeck', key: 'choices' } as const, { applied: NONE, draft: NONE } as Choices)
const expandedAtom = atom({ plugin: 'statusdeck', key: 'expanded' } as const, [] as string[])

const CONTEXT_PANE = 'statusdeck-context'


// Theme colours by name, which the app resolves to its own light or dark
// value; a hex colour would stay one colour in both themes.
const COLD: Color = 'error'
const RUN: Color = 'suggestion'
// The warm cache's time, by the sixth of its lifetime left (ten minutes each
// on the 1h cache): from the brightest green down to red.
const CACHE_BANDS: Color[] = ['error', 'diffRemoved', 'claude', 'warning', 'diffAdded', 'success']
// The colour of a percentage used, by the first band it falls under.
const USED_BANDS: { below: number; color: Color }[] = [
  { below: 50, color: 'suggestion' },
  { below: 70, color: 'success' },
  { below: 85, color: 'warning' },
  { below: Infinity, color: 'error' },
]
// The context gauge's colour by the tenth of the window filled: a distinct
// theme colour per tenth, from the accent blue through green, yellow and the
// brand orange to red, each resolved by the app for light or dark.
const CONTEXT_BANDS: Color[] = [
  'suggestion',
  'success',
  'diffAdded',
  'diffAddedWord',
  'warning',
  'claudeShimmer',
  'claude',
  'diffRemoved',
  'diffRemovedWord',
  'error',
]
// From here a toast suggests /compact once.
const CONTEXT_WARN = 85

// When the bar runs out of room, parts go in this order, and come back in
// reverse once there is room again. Clawd and the running turn's pill never go.
const DROP_ORDER = ['7d', 'cache', 'git', '5h', 'ctx']
// Blank cells between parts, and room kept for whatever the app draws itself.
const GAP = 1
const SLACK = 4
// The context disc: 1.9 cells across by 0.8 of a line down, about the
// height of the percentage's digits, which reads as a circle.
const GAUGE_WIDTH = 1.9
const GAUGE_HEIGHT = 0.8
// A pill's border and padding, in cells, and Clawd's track.
const PILL_CHROME = 4
const CLAWD_CELLS = 10
// Below this the band has not been measured yet (the desktop starts it at 1):
// everything draws, so the band shows and gets its real width.
const MEASURED_COLUMNS = 8
const MAX_BRANCH = 18
// How long Clawd celebrates a finished turn, droops after a stopped one, and
// stays idle before he falls asleep.
const DONE_MS = 5000
const STOPPED_MS = 3000
const SLEEP_MS = 300000

const POLL_MS = 1000
const COUNT_MS = 3000
const GIT_MS = 5000
const IDLE_CLOCK_MS = 30000
// Tools whose run may change the working tree, so the git pill reads it again.
const WRITERS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])

function usedColor(percent: number): Color {
  return USED_BANDS.find(band => percent < band.below)?.color ?? 'error'
}

// The largest unit alone ("3h", "4d", "42m"), and the finer units after it
// ("47m", "3h 12m"), shown on hover.
function countdown(resetsAt: string | null, now: number): { short: string; more: string } {
  if (resetsAt === null) return { short: '', more: '' }
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return { short: '', more: '' }
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return { short: `${days}d`, more: `${hours}h ${mins}m` }
  if (hours > 0) return { short: `${hours}h`, more: `${mins}m` }
  return { short: `${mins}m`, more: '' }
}

function tenth(percent: number): number {
  return Math.max(0, Math.min(9, Math.floor(percent / 10)))
}

function contextColor(percent: number): Color {
  return CONTEXT_BANDS[tenth(percent)] ?? 'error'
}

function cacheColor(remaining: number): Color {
  const band = Math.min(CACHE_BANDS.length - 1, Math.floor((remaining / ttlMs) * CACHE_BANDS.length))
  return CACHE_BANDS[Math.max(0, band)] ?? 'error'
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

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// "claude-opus-5-5[1m]", "claude-opus-5-5-20261001" and "opus" all name one model.
function baseModel(id: string): string {
  return id
    .toLowerCase()
    .replace(/\[.*?\]/g, '')
    .replace(/-\d{8}$/, '')
    .trim()
}

function toWindow(limit: SessionRateLimit | undefined): Window | null {
  return limit === undefined ? null : { percent: limit.percentUsed, resetsAt: limit.resetsAt ?? null }
}

// A window whose reset has passed holds nothing worth showing.
function fresh(w: Window | null, now: number): Window | null {
  if (w === null || w.resetsAt === null) return w
  return Date.parse(w.resetsAt) > now ? w : null
}

// One failing step (the engine not ready yet at launch) must not stop the rest.
async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // The next poll tries again.
  }
}

let poll: Timer | undefined
let settle: Timer | undefined
let ttlMs = 3600000
// Whether the last local count of the window worked, and when it ran.
let isCounted = false
let lastCountAt = 0
let lastGitAt = 0
// The model at the last poll: each model keeps a cache of its own.
let lastModel = ''
// Whether the context warning was already toasted at this fill.
let isContextWarned = false
// The turn's output tokens: those of finished responses, and the estimates of
// responses still streaming, by step.
let tokensDone = 0
const pending = new Map<string, number>()

function liveTokens(): number {
  return tokensDone + [...pending.values()].reduce((a, b) => a + b, 0)
}

function usageFrom(
  prev: Usage,
  context: { percent?: number; tokens?: number; window?: number } | undefined,
  rateLimits: readonly SessionRateLimit[] | undefined,
): Usage {
  const limits = rateLimits ?? []
  return {
    fiveHour: toWindow(limits.find(l => l.kind === 'five_hour')) ?? prev.fiveHour,
    week: toWindow(limits.find(l => l.kind === 'seven_day')) ?? prev.week,
    context: isCounted ? prev.context : (context?.percent ?? prev.context),
    tokens: isCounted ? prev.tokens : (context?.tokens ?? prev.tokens),
    window: isCounted ? prev.window : (context?.window ?? prev.window),
  }
}

// The rate-limit windows are the account's, so the last reading carries over
// to the next session until a response brings a new one.
async function saveUsage($: EngineInterface, usage: Usage): Promise<void> {
  if (usage.fiveHour === null && usage.week === null) return
  await $.store.set('limits', { fiveHour: usage.fiveHour, week: usage.week })
}

// Once per crossing: the fill has to drop back under the line to warn again.
async function warnContext($: EngineInterface): Promise<void> {
  const { context } = await read($, usageAtom)
  const isOver = context !== null && context >= CONTEXT_WARN
  if (isOver && !isContextWarned) {
    $.ui.toast(`Context ${Math.round(context)}% full: run /compact to free it`)
  }
  isContextWarned = isOver
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const { context, rateLimits } = await $.session.usage()
  const prev = await read($, usageAtom)
  const next = usageFrom(prev, context, rateLimits)
  if (JSON.stringify(next) === JSON.stringify(prev)) return
  await update($, usageAtom, () => next)
  await saveUsage($, next)
  await warnContext($)
}

// The window counted locally, as /context counts it (no request sent), so ctx
// is right after a /compact or /clear too.
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
  if (percent === null || b === undefined) return
  const tokens = b.totalTokens
  const held = await read($, usageAtom)
  if (held.context === percent && held.tokens === tokens && held.window === max) return
  await update($, usageAtom, u => ({ ...u, context: percent, tokens, window: max }))
  await warnContext($)
}

async function refreshGit($: EngineInterface): Promise<void> {
  lastGitAt = await $.clock.now()
  // Null outside a repository, or where git is missing.
  const { exitCode, stdout } = await $.process.run(['git', 'status', '--porcelain=v1', '--branch', '--untracked-files=normal'], {
    timeoutMs: 5000,
  })
  const git = exitCode === 0 ? parseGit(stdout) : null
  if (JSON.stringify(git) === JSON.stringify(await read($, gitAtom))) return
  await update($, gitAtom, () => git)
}

// A switch of model starts its cache cold.
async function followModel($: EngineInterface): Promise<void> {
  const model = baseModel(await $.session.model())
  if (model === '') return
  if (lastModel !== '' && model !== lastModel) await update($, cacheAtom, () => ({ touchedAt: null }))
  lastModel = model
}

// A mood that passes (done, stopped) settles back to idle after its while,
// unless another mood has taken over by then.
async function setMood($: EngineInterface, mood: Mood): Promise<void> {
  settle?.cancel()
  settle = undefined
  const since = await $.clock.now()
  const current = await read($, moodAtom)
  if (current.mood !== mood) await update($, moodAtom, () => ({ mood, since }))
  const lasts = mood === 'done' ? DONE_MS : mood === 'stopped' ? STOPPED_MS : null
  if (lasts === null) return
  settle = $.clock.after(lasts, () => {
    void safely(async () => {
      if ((await read($, moodAtom)).mood === mood) await setMood($, 'idle')
    })
  })
}

async function pulse($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const mood = await read($, moodAtom)
  if (mood.mood === 'idle' && mood.since > 0 && now - mood.since >= SLEEP_MS) await setMood($, 'sleep')
  const run = await read($, runAtom)
  const { touchedAt } = await read($, cacheAtom)
  const clock = await read($, clockAtom)
  const isWarm = touchedAt !== null && touchedAt + ttlMs > now
  const isJustCold = touchedAt !== null && !isWarm && clock.now < touchedAt + ttlMs
  // Every second while a turn runs (its timer) or the cache counts down.
  if (run.isWorking || isWarm || isJustCold || now - clock.now >= IDLE_CLOCK_MS) {
    await update($, clockAtom, () => ({ now }))
  }
  if (run.isWorking && run.tokens !== liveTokens()) {
    const tokens = liveTokens()
    await update($, runAtom, r => ({ ...r, tokens }))
  }
  await safely(() => followModel($))
  await safely(() => refreshUsage($))
  if (now - lastCountAt >= COUNT_MS) await safely(() => recountContext($))
  if (now - lastGitAt >= GIT_MS) await safely(() => refreshGit($))
}



// Whether this process is a session the desktop app started: the context
// choices apply there alone, never in the CLI or VS Code.
let isDesktop: boolean | undefined

async function onDesktop($: EngineInterface): Promise<boolean> {
  if (isDesktop === undefined) isDesktop = (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) === 'claude-desktop'
  return isDesktop
}

const sameChoice = (a: Choice, b: Choice) =>
  JSON.stringify([...a.skills].sort()) === JSON.stringify([...b.skills].sort()) &&
  JSON.stringify([...a.tools].sort()) === JSON.stringify([...b.tools].sort())

function changeCount(c: Choices): number {
  const diff = (x: string[], y: string[]) => x.filter(n => !y.includes(n)).length + y.filter(n => !x.includes(n)).length
  return diff(c.applied.skills, c.draft.skills) + diff(c.applied.tools, c.draft.tools)
}

// Servers every one of whose tools is off: their instructions go too.
function offServers(tools: readonly ContextTool[], off: readonly string[]): Set<string> {
  const servers = new Set<string>()
  for (const server of new Set(tools.map(t => t.server))) {
    const own = tools.filter(t => t.server === server)
    if (own.length > 0 && own.every(t => off.includes(t.name))) servers.add(server)
  }
  return servers
}

async function refreshTools($: EngineInterface): Promise<void> {
  const tools = (await $.tool.list())
    .filter(t => t.mcp)
    .map(t => ({ name: t.name, description: t.description.split('\n')[0] ?? '', server: serverOf(t.name) ?? 'mcp' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const held = await read($, catalogAtom)
  if (JSON.stringify(held.tools) !== JSON.stringify(tools)) await update($, catalogAtom, c => ({ ...c, tools }))
}

// What the model reads changes from the next request: the listings and the
// tool schemas are computed again, which re-caches the conversation once.
async function applyChoices($: EngineInterface): Promise<void> {
  const { draft, applied } = await read($, choicesAtom)
  if (sameChoice(draft, applied)) return
  await update($, choicesAtom, c => ({ ...c, applied: c.draft }))
  await $.store.set('context-off', draft)
  $.ui.invalidate('prompt.attachment')
  $.ui.invalidate('tool.describe')
}

async function toggle($: EngineInterface, kind: 'skills' | 'tools', names: readonly string[], isOff: boolean): Promise<void> {
  await update($, choicesAtom, c => {
    const rest = c.draft[kind].filter(n => !names.includes(n))
    return { ...c, draft: { ...c.draft, [kind]: isOff ? [...rest, ...names] : rest } }
  })
}

async function openContext($: EngineInterface): Promise<void> {
  await safely(() => refreshTools($))
  // The skill listing went out before the panel could read it: the next
  // request asks for it again, unchanged while nothing is off, so no re-cache.
  if ((await read($, catalogAtom)).skills.length === 0) $.ui.invalidate('prompt.attachment')
  try {
    await $.ui.open({ id: CONTEXT_PANE, title: 'Context' })
  } catch {
    $.ui.toast('Could not open the context panel')
  }
}


export const registerDesk: Register = (on, options) => {
  ttlMs = (options as Record<string, unknown>)['cacheTtl'] === '5m' ? 300000 : 3600000

  // Only a session the desktop app started keeps the poll running: anywhere
  // else nothing draws the bar, so there is nothing to keep fresh.


  // A /clear starts an empty window with nothing cached.

  // Clawd and the timer follow the main thread's turns: working while one
  // runs, done or stopped when it ends, and needs-you while a prompt waits.


  // Counts the turn's output tokens as they stream: an estimate while text
  // arrives, the API's own count once a response ends.

  // A verdict of "ask" means a permission prompt is about to wait on you.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') await safely(() => setMood($, 'attention'))
    return verdict
  }).catch(($, e, next) => next(e))

  // A compaction re-caches the conversation anyway: pending choices go with it.

  on('command.run', { command: 'statusdeck-context' }, async $ => {
    await openContext($)
    return { text: 'Context panel opened.' }
  })

  // The skills Claude is told about: the panel reads the full listing, the
  // model reads it without the skills turned off.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    const answer = await next(e)
    if (answer.text === null || !(await onDesktop($))) return answer
    const text = answer.text
    await safely(async () => {
      const skills = parseSkills(text)
      if (skills.length > 0 && JSON.stringify((await read($, catalogAtom)).skills) !== JSON.stringify(skills)) {
        await update($, catalogAtom, c => ({ ...c, skills }))
      }
    })
    const off = new Set((await read($, choicesAtom)).applied.skills)
    return { text: withoutSkills(text, off) }
  }).catch(($, e, next) => next(e))

  // The deferred tools Claude may load by name: none it is not to see.
  on('prompt.attachment', { type: 'deferred_tools_delta' }, async ($, e, next) => {
    const answer = await next(e)
    if (answer.text === null || !(await onDesktop($))) return answer
    const off = new Set((await read($, choicesAtom)).applied.tools)
    return { text: withoutNames(answer.text, off) }
  }).catch(($, e, next) => next(e))

  // A tool turned off leaves the prompt's tool list for the deferred one,
  // which in turn leaves it out: its schema reaches the model nowhere.
  on('tool.describe', async ($, e, next) => {
    const described = await next(e)
    if (!(await onDesktop($))) return described
    const { applied } = await read($, choicesAtom)
    return applied.tools.includes(e.tool) ? { ...described, isDeferred: true } : described
  }).catch(($, e, next) => next(e))

  // The MCP instructions of a server whose every tool is off.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await onDesktop($))) return composed
    const { applied } = await read($, choicesAtom)
    const servers = offServers((await read($, catalogAtom)).tools, applied.tools)
    if (servers.size === 0) return composed
    return { sections: composed.sections.map(section => ({ ...section, text: withoutServers(section.text, servers) })) }
  }).catch(($, e, next) => next(e))

  // On the desktop a call to what is off is refused, and a tool search never
  // surfaces it. A question to you waits like a prompt; once a call that
  // waited is answered (allowed, denied or replied to), the turn is working
  // again. A tool that may change the working tree has the git pill read it.
  on('tool.call', async ($, e, next) => {
    const applied = (await onDesktop($)) ? (await read($, choicesAtom)).applied : NONE
    if (applied.tools.includes(e.tool)) return { deny: 'This tool is turned off in statusdeck.' }
    // A tool's own arguments ride the event itself: the Skill tool's `skill`.
    const skill = (e as { skill?: unknown }).skill
    if (e.tool === 'Skill' && typeof skill === 'string' && applied.skills.includes(skill)) {
      return { deny: 'This skill is turned off in statusdeck.' }
    }
    if (e.tool === 'AskUserQuestion') await safely(() => setMood($, 'attention'))
    const result = await next(e)
    await safely(async () => {
      if ((await read($, moodAtom)).mood === 'attention') await setMood($, 'working')
    })
    if (WRITERS.has(e.tool) && (await onDesktop($))) await safely(() => refreshGit($))
    if (e.tool === 'ToolSearch' && typeof result.result === 'string' && applied.tools.length > 0) {
      return { ...result, result: withoutFunctions(result.result, new Set(applied.tools)) }
    }
    return result
  }).catch(($, e, next) => next(e))


  // The time and tokens line under each answer: the run pill shows both while
  // the turn runs, so on the desktop the line draws nothing.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box key="no-duration" />
  })


  // The context panel: every skill and MCP tool the session offers, a
  // checkbox each; what is unchecked is hidden from Claude once applied.
  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const catalog = await read($, catalogAtom)
    const choices = await read($, choicesAtom)
    const expanded = await read($, expandedAtom)
    const cache = await read($, cacheAtom)
    const clock = await read($, clockAtom)
    const now = clock.now > 0 ? clock.now : await $.clock.now()
    const width = Math.max(24, e.props.bodyColumns - 2)
    const changes = changeCount(choices)
    const offSkills = new Set(choices.draft.skills)
    const offTools = new Set(choices.draft.tools)
    const warmFor = cache.touchedAt === null ? 0 : cache.touchedAt + ttlMs - now

    const box = (isOn: boolean | 'some', isLocked = false) => (
      <Text key="box" color={isLocked ? undefined : isOn === false ? undefined : 'suggestion'} dimColor={isLocked || isOn === false}>
        {isOn === 'some' ? '◩' : isOn ? '☑' : '☐'}
      </Text>
    )
    const fit = (text: string, room: number) => (text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`)
    const heading = (key: string, title: string, note: string) => (
      <Box key={key} flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text key="title" bold>
          {title}
        </Text>
        <Text key="note" dimColor>
          {note}
        </Text>
      </Box>
    )

    const skillRows = catalog.skills.map(skill => {
      const isOn = !offSkills.has(skill.name)
      return (
        <Button key={`skill:${skill.name}`} plain onPress={() => void toggle($, 'skills', [skill.name], isOn)}>
          {box(isOn)}
          <Text key="name">{` ${fit(skill.name, Math.floor(width / 2))}`}</Text>
          <Text key="about" dimColor>
            {`  ${fit(skill.description, width - Math.min(skill.name.length, Math.floor(width / 2)) - 6)}`}
          </Text>
        </Button>
      )
    })

    const servers = [...new Set(catalog.tools.map(t => t.server))]
    const serverRows = servers.flatMap(server => {
      const tools = catalog.tools.filter(t => t.server === server)
      const isLocked = tools.every(t => isLockedTool(t.name))
      const onCount = tools.filter(t => !offTools.has(t.name)).length
      const state: boolean | 'some' = onCount === tools.length ? true : onCount === 0 ? false : 'some'
      const isOpen = expanded.includes(server)
      const head = (
        <Box key={`server:${server}`} flexDirection="row" columnGap={1}>
          {isLocked ? (
            <Text key="locked" dimColor>
              {`☑ ${fit(server, width - 22)}`}
            </Text>
          ) : (
            <Button
              key={`server-toggle:${server}`}
              plain
              onPress={() => void toggle($, 'tools', tools.filter(t => !isLockedTool(t.name)).map(t => t.name), state !== false)}
            >
              {box(state)}
              <Text key="name">{` ${fit(server, width - 22)}`}</Text>
            </Button>
          )}
          <Button
            key={`server-open:${server}`}
            plain
            onPress={() => void update($, expandedAtom, list => (isOpen ? list.filter(s => s !== server) : [...list, server]))}
          >
            <Text key="count" dimColor>
              {`${isLocked ? 'required · ' : ''}${onCount}/${tools.length} ${isOpen ? '▾' : '▸'}`}
            </Text>
          </Button>
        </Box>
      )
      if (!isOpen) return [head]
      return [
        head,
        ...tools.map(tool => {
          const isOn = !offTools.has(tool.name)
          const locked = isLockedTool(tool.name)
          const label = ` ${fit(shortTool(tool.name), width - 6)}`
          return locked ? (
            <Box key={`tool:${tool.name}`} paddingLeft={3} flexDirection="row">
              {box(true, true)}
              <Text key="name" dimColor>
                {label}
              </Text>
            </Box>
          ) : (
            <Box key={`tool:${tool.name}`} paddingLeft={3} flexDirection="row">
              <Button key={`tool-toggle:${tool.name}`} plain onPress={() => void toggle($, 'tools', [tool.name], isOn)}>
                {box(isOn)}
                <Text key="name">{label}</Text>
              </Button>
            </Box>
          )
        }),
      ]
    })

    const skillsOn = catalog.skills.filter(s => !offSkills.has(s.name)).length
    const toolsOn = catalog.tools.filter(t => !offTools.has(t.name)).length

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text key="lead" dimColor>
          Unchecked skills and tools are hidden from Claude.
        </Text>
        {changes > 0 ? (
          <Box key="pending" flexDirection="column" marginTop={1} rowGap={0}>
            <Text key="what" color="warning" bold>
              {`${changes} change${changes === 1 ? '' : 's'} not applied`}
            </Text>
            <Text key="cost" dimColor>
              {warmFor > 0
                ? `Cache warm (${warmth(warmFor)}): applying re-caches the conversation once.`
                : 'Cache cold: applying now costs nothing extra.'}
            </Text>
            <Text key="later" dimColor>
              Or leave them: they apply on their own at the next /clear or /compact.
            </Text>
            <Box key="actions" flexDirection="row" columnGap={1} marginTop={1}>
              <Button key="apply" label="Apply" variant="primary" onPress={() => void applyChoices($)} />
              <Button
                key="discard"
                label="Discard"
                onPress={() => void update($, choicesAtom, c => ({ ...c, draft: c.applied }))}
              />
            </Box>
          </Box>
        ) : null}
        {heading('skills-head', 'Skills', catalog.skills.length === 0 ? '' : `${skillsOn} of ${catalog.skills.length} on`)}
        {catalog.skills.length === 0 ? (
          <Text key="no-skills" dimColor>
            The skill list arrives with your next message.
          </Text>
        ) : (
          <Box key="skills" flexDirection="column">
            {skillRows}
          </Box>
        )}
        {heading('tools-head', 'MCP tools', catalog.tools.length === 0 ? '' : `${toolsOn} of ${catalog.tools.length} on`)}
        {catalog.tools.length === 0 ? (
          <Text key="no-tools" dimColor>
            No MCP tools in this session.
          </Text>
        ) : (
          <Box key="servers" flexDirection="column">
            {serverRows}
          </Box>
        )}
      </Box>
    )
  })
}

// Each function below is the desktop's part of a hook register.tsx owns: a
// plugin hooks an event once, so the CLI's hook calls these.
export async function deskSessionStart($: EngineInterface): Promise<void> {
  if (!(await onDesktop($))) return
  poll?.cancel()
  await safely(async () => {
    const held = (await $.store.get('context-off')) as Choice | undefined
    const applied = { skills: held?.skills ?? [], tools: held?.tools ?? [] }
    await update($, choicesAtom, () => ({ applied, draft: applied }))
  })
  await safely(() => refreshTools($))
  await safely(() =>
    $.command.register({ name: 'statusdeck-context', description: 'Choose which skills and MCP tools Claude sees' }),
  )
  poll = $.clock.every(POLL_MS, () => void safely(() => pulse($)))
  await safely(async () => {
    const now = await $.clock.now()
    await update($, clockAtom, () => ({ now }))
    const held = (await $.store.get('limits')) as Partial<Usage> | undefined
    await update($, usageAtom, u => ({
      ...u,
      fiveHour: u.fiveHour ?? fresh(held?.fiveHour ?? null, now),
      week: u.week ?? fresh(held?.week ?? null, now),
    }))
  })
  await safely(() => refreshUsage($))
  await safely(() => followModel($))
  await safely(() => refreshGit($))
  await safely(() => setMood($, 'idle'))

}

export async function deskMeasure($: EngineInterface, e: Args<'session.measure'>): Promise<void> {
  const measured = usageFrom(await read($, usageAtom), e.context, e.rateLimits)
  await update($, usageAtom, () => measured)
  await safely(() => saveUsage($, measured))
  await safely(() => warnContext($))
  // The window's fill moves after each main-thread response: a request that
  // went out over the cached prefix, so the cache was just refreshed.
  if (e.changed.includes('context') && (e.context.tokens ?? 0) > 0) {
    const now = await $.clock.now()
    await update($, cacheAtom, () => ({ touchedAt: now }))
    await safely(() => recountContext($))
  }

}

export async function deskEnd($: EngineInterface, e: Args<'session.end'>): Promise<void> {
  if (e.reason === 'clear') {
    // The cache starts over anyway: pending choices cost nothing now.
    await safely(() => applyChoices($))
    await update($, cacheAtom, () => ({ touchedAt: null }))
    await update($, usageAtom, u => ({ ...u, context: null, tokens: null }))
    lastCountAt = 0
  }

}

export async function deskTurnStart($: EngineInterface, e: Args<'turn.start'>): Promise<void> {
  if (e.agentId === undefined) {
    tokensDone = 0
    pending.clear()
    const now = await $.clock.now()
    await update($, runAtom, () => ({ isWorking: true, startedAt: now, tokens: 0 }))
    await update($, clockAtom, () => ({ now }))
    await safely(() => setMood($, 'working'))
  }

}

export async function deskTurnComplete($: EngineInterface, e: Args<'turn.complete'>): Promise<void> {
  if (e.agentId === undefined && (await onDesktop($))) {
    pending.clear()
    await update($, runAtom, r => ({ ...r, isWorking: false }))
    await safely(() => setMood($, e.reason === 'answer' ? 'done' : 'stopped'))
    await safely(() => refreshGit($))
  }

}

export async function deskAfterCompact($: EngineInterface, e: Args<'session.compact'>, done: EventResult<'session.compact'>): Promise<void> {
  if (e.agentId === undefined && done.skip === undefined) await safely(() => applyChoices($))

}

// The turn's output tokens, as register.tsx's turn.step counts them.
export function deskStepPending(id: string, estimate: number): void {
  pending.set(id, estimate)
}

export function deskStepCounted(tokens: number): void {
  tokensDone += tokens
}

export function deskStepEnd(id: string): void {
  pending.delete(id)
}

// The band above the prompt on the desktop.
export async function deskBand($: EngineInterface, e: RenderInput<'AbovePrompt', 'desktop'>, next: (e: RenderInput<'AbovePrompt', 'desktop'>) => Promise<EventResult<'ui.render'>>): Promise<EventResult<'ui.render'>> {
  if (e.props.hasSurvey) return next(e)
  const { Box, Button, Svg, Text } = $.ui.resolve(e)
  const { mood } = await read($, moodAtom)
  const usage = await read($, usageAtom)
  const cache = await read($, cacheAtom)
  const run = await read($, runAtom)
  const git = await read($, gitAtom)
  const clock = await read($, clockAtom)
  const now = clock.now > 0 ? clock.now : await $.clock.now()

  const remaining = cache.touchedAt === null ? 0 : cache.touchedAt + ttlMs - now
  const isWarm = remaining > 0
  const cacheText = isWarm ? warmth(remaining) : '❄'
  const percentText = (p: number | null) => (p === null ? '–' : `${Math.round(p)}%`)

  // The 5h and 7d usage pills are left out of the desktop band for now.
  const pills = [
    { key: 'ctx', percent: usage.context, reset: { short: '', more: '' } },
  ].filter(p => p !== null)
  const runText = run.isWorking ? `⏱ ${elapsed(now - run.startedAt)}  ↓ ${compact(run.tokens)}` : ''
  const branch = git === null ? '' : shorten(git.branch, MAX_BRANCH)
  const gitText = git === null ? '' : `⎇ ${branch}${git.files.length > 0 ? ` ±${git.files.length}` : ''}`

  // Each part's width in cells, its border and padding included, so parts
  // drop one by one as the band narrows.
  const widths = new Map<string, number>()
  widths.set('clawd', CLAWD_CELLS)
  widths.set('open', 2)
  if (run.isWorking) widths.set('run', runText.length + PILL_CHROME)
  if (git !== null) widths.set('git', gitText.length + PILL_CHROME)
  for (const p of pills) {
    // The ctx pill's gauge is one cell where the others have their label.
    const label = p.key === 'ctx' ? '●●' : p.key
    const words = `${label} ${percentText(p.percent)}${p.reset.short === '' ? '' : ` ${p.reset.short}`}`
    widths.set(p.key, words.length + PILL_CHROME)
  }
  widths.set('cache', cacheText.length + PILL_CHROME)

  // Parts drop one by one only once the band has a real width; Clawd and
  // the running turn's pill stay whatever the width, so the band always has
  // something drawn in it.
  const shown = new Set(widths.keys())
  const columns = e.props.bodyColumns
  const total = () => [...shown].reduce((n, k) => n + (widths.get(k) ?? 0) + GAP, 0) + SLACK
  if (columns >= MEASURED_COLUMNS) {
    for (const key of DROP_ORDER) {
      if (total() <= columns) break
      shown.delete(key)
    }
  }

  // A softly rounded outline in the theme's own border colour, no fill, so
  // the pills sit on the band as the app draws it in light and dark alike.
  // Words a pill keeps for hover (`before`, `after`) stay hidden until the
  // pointer is on it: revealed in place, with no hover fill of any kind.
  const pill = (key: string, children: RenderChildren[], hover: { before?: string; after?: string } = {}) => {
    const scope = `deskdeck-${key}`
    const hidden = (side: string, words: string | undefined) =>
      words !== undefined &&
      words !== '' && (
        <Box key={`${key}-${side}`} display="none" hover={{ scope, display: 'flex' }}>
          <Text key="words" dimColor>
            {words}
          </Text>
        </Box>
      )
    return (
      <Box
        key={key}
        borderStyle="single"
        paddingX={1}
        paddingY={0}
        flexDirection="row"
        columnGap={1}
        flexShrink={0}
        hover={{ scope }}
      >
        {hidden('before', hover.before)}
        {children}
        {hidden('after', hover.after)}
      </Box>
    )
  }
  const drawing = clawd(mood)

  return (
    <Box key="deck" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={GAP} width="100%">
      <Box key="left" flexDirection="row" alignItems="center" columnGap={GAP} flexShrink={0}>
        {shown.has('clawd') && (
          <Svg
            key={`clawd-${mood}`}
            source={drawing.source}
            alt={drawing.alt}
            width={CLAWD_WIDTH}
            height={CLAWD_HEIGHT}
            isInteractive
          />
        )}
      </Box>
      <Box key="pills" flexDirection="row" justifyContent="flex-end" alignItems="center" columnGap={GAP}>
        {git !== null &&
          shown.has('git') &&
          pill(
            'git',
            [
              <Text key="branch" dimColor>
                {`⎇ ${branch}`}
              </Text>,
              git.files.length > 0 && (
                <Text key="changed" color="warning" bold>
                  {`±${git.files.length}`}
                </Text>
              ),
            ],
          )}
        {shown.has('run') &&
          pill('run', [
            <Text key="time" color={RUN}>
              {`⏱ ${elapsed(now - run.startedAt)}`}
            </Text>,
            <Text key="tokens" dimColor>
              {`↓ ${compact(run.tokens)}`}
            </Text>,
          ])}
        {pills
          .filter(p => shown.has(p.key) && p.key !== 'ctx')
          .map(p =>
            pill(
              p.key,
              [
                <Text key="name" dimColor>
                  {p.key}
                </Text>,
                <Text key="percent" color={p.percent === null ? undefined : usedColor(p.percent)} bold>
                  {percentText(p.percent)}
                </Text>,
                p.reset.short !== '' && (
                  <Text key="reset" dimColor>
                    {p.reset.short}
                  </Text>
                ),
              ],
              { after: p.reset.more },
            ),
          )}
        {shown.has('ctx') &&
          pill(
            'ctx',
            [
              // A small disc, its corners rounded past its half so it is a
              // circle the height of the text beside it, outlined and filled
              // from the bottom by the tenth of the window used, in that
              // tenth's theme colour; the disc clips the fill to its round.
              <Box
                key="gauge"
                borderStyle="round"
                borderColor={usage.context === null ? undefined : contextColor(usage.context)}
                width={GAUGE_WIDTH}
                height={GAUGE_HEIGHT}
                padding={0}
                overflow="hidden"
                flexDirection="column"
                justifyContent="flex-end"
                alignSelf="center"
                flexShrink={0}
              >
                {usage.context !== null && usage.context >= 1 && (
                  <Box
                    key="fill"
                    width="100%"
                    height={`${(tenth(usage.context) + 1) * 10}%`}
                    backgroundColor={contextColor(usage.context)}
                  />
                )}
              </Box>,
              <Text key="percent" color={usage.context === null ? undefined : contextColor(usage.context)} bold>
                {percentText(usage.context)}
              </Text>,
            ],
            {
              before: 'context',
              after: usage.tokens === null || usage.window === null ? '' : `${compact(usage.tokens)} / ${compact(usage.window)}`,
            },
          )}
        {shown.has('cache') &&
          pill(
            'cache',
            [
              <Text key="time" color={isWarm ? cacheColor(remaining) : COLD} bold={isWarm}>
                {cacheText}
              </Text>,
            ],
            isWarm ? { before: 'cache warm' } : { before: 'cache', after: 'cold' },
          )}
        <Button key="open-context" plain onPress={() => void openContext($)}>
          <Text key="glyph" dimColor>
            ☰
          </Text>
        </Button>
      </Box>
    </Box>
  )
}
