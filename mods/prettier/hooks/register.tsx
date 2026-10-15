import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Call, Live, Prompt, Settings, Timing, Turn } from '../types'
import type { EditDiff } from './layout'
import {
  CARD_BORDER,
  EXPAND_KEY,
  GREEN,
  GREY,
  PILL_BORDER,
  PILL_PAD_LEFT,
  PURPLE,
  PURPLE_LIGHT,
  RED,
  RESULT_GUTTER,
  ROW_GUTTER,
  capText,
  cardHead,
  describeCall,
  diffSummary,
  editDiff,
  footerParts,
  formatClock,
  formatShort,
  groupDuration,
  groupSummary,
  isRejection,
  matchTurn,
  pillWidth,
  promptTime,
  share,
  shortPath,
  toolLabel,
} from './layout'
import { COMMANDS, DEFAULTS, EXPAND_HINT, applyArgs, describeAll, describeSection, mergeSettings } from './settings'
import type { Section } from './settings'

const settingsAtom = atom({ plugin: 'prettier', key: 'settings' } as const, DEFAULTS as Settings)
const turnsAtom = atom({ plugin: 'prettier', key: 'turns' } as const, [] as Turn[])
const liveAtom = atom({ plugin: 'prettier', key: 'live' } as const, { running: [], tools: 0, calls: [] } as Live)
const promptsAtom = atom({ plugin: 'prettier', key: 'prompts' } as const, [] as Prompt[])
const timingsAtom = atom({ plugin: 'prettier', key: 'timings' } as const, [] as Timing[])
// Whether a compact row is open, one value per row (memberOf adds its requestId).
const openAtom = atom({ plugin: 'prettier', key: 'open' } as const, false)

const MAX_TURNS = 500
const MAX_PROMPTS = 300
const MAX_TIMINGS = 600
const MAX_CALLS = 100
const EMPTY_LIVE: Live = { running: [], tools: 0, calls: [] }

let nextId = 0

async function settingsOf($: EngineInterface): Promise<Settings> {
  return mergeSettings(await read($, settingsAtom))
}

async function saveSettings($: EngineInterface, settings: Settings): Promise<void> {
  await update($, settingsAtom, () => settings)
  await $.store.set('settings', settings)
}

// The diff of an edit or new file that is folded to one row: once its turn is
// done, and only where a click can open it again (the fullscreen terminal).
// The tool row draws that one row and the result row draws nothing, so the
// two hooks must agree; both ask here.
async function foldedDiff(
  $: EngineInterface,
  call: { tool: string; id: string; output: unknown; isErrored: boolean; isRunning: boolean },
  isFullscreen: boolean,
): Promise<EditDiff | undefined> {
  if (!isFullscreen || call.isErrored || call.isRunning) return undefined
  const diff = editDiff(call.tool, call.output)
  if (diff === undefined) return undefined
  const isLive = ((await read($, liveAtom)).calls ?? []).some(c => c.id === call.id)
  return isLive ? undefined : diff
}

async function cwdOf($: EngineInterface): Promise<string> {
  try {
    return await $.session.cwd()
  } catch {
    // Without the session's folder a path reads as its last parts.
    return ''
  }
}

// One of the three section commands: no arguments lists the section,
// `name value` pairs change it.
async function runSection($: EngineInterface, section: Section, args: string): Promise<{ text: string }> {
  const current = await settingsOf($)
  if (args.trim() === '') return { text: describeSection(current, section) }
  const applied = applyArgs(current, section, args)
  if (applied.changed.length > 0) await saveSettings($, applied.settings)
  const done = applied.changed.length > 0 ? [`Set ${applied.changed.join(', ')}.`] : []
  const wrong = applied.errors.map(err => `Not changed: ${err}.`)
  const off = applied.settings.isEnabled ? [] : ['prettier is off: `/prettier on` to see it.']
  return { text: [...done, ...wrong, ...off].join('\n') }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('settings')
    const legacy = await $.store.get('isEnabled')
    const settings = mergeSettings(stored)
    if (stored === undefined && typeof legacy === 'boolean') settings.isEnabled = legacy
    await update($, settingsAtom, () => settings)

    await $.command.register({
      name: 'prettier',
      description: 'prettier chat layout: on, off, reset, or list its settings',
      argumentHint: '[on|off|reset]',
    })
    for (const section of Object.keys(COMMANDS) as Section[]) {
      await $.command.register({
        name: COMMANDS[section].name,
        description: COMMANDS[section].description,
        argumentHint: `[${COMMANDS[section].example}]`,
      })
    }

    // Once per machine: say where the details went.
    if ((await $.store.get('hintShown')) !== true) {
      $.ui.toast(`prettier: ${EXPAND_HINT} /prettier lists the settings.`, { timeoutMs: 12_000 })
      await $.store.set('hintShown', true)
    }
    return next(e)
  })

  // ---------------------------------------------------------------- commands

  on('command.run', { command: 'prettier' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await settingsOf($)
    if (arg === 'on' || arg === 'off') {
      await saveSettings($, { ...current, isEnabled: arg === 'on' })
      return { text: arg === 'on' ? 'prettier on.' : "prettier off: the transcript uses Claude Code's own layout." }
    }
    if (arg === 'reset') {
      await saveSettings($, { ...structuredClone(DEFAULTS), isEnabled: current.isEnabled })
      return { text: 'Every prettier setting is back to its default.' }
    }
    if (arg !== '') return { text: `\`${arg}\` is not a choice: \`/prettier on\`, \`/prettier off\` or \`/prettier reset\`.` }
    return { text: describeAll(current) }
  })

  const unsaved = { text: 'prettier: the setting could not be saved; nothing changed.' }
  on('command.run', { command: 'prettier-prompt' }, async ($, e) => runSection($, 'prompt', e.args)).catch(
    () => unsaved,
  )
  on('command.run', { command: 'prettier-response' }, async ($, e) => runSection($, 'response', e.args)).catch(
    () => unsaved,
  )
  on('command.run', { command: 'prettier-code' }, async ($, e) => runSection($, 'code', e.args)).catch(
    () => unsaved,
  )

  // ---------------------------------------------------------------- recording

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if ((kind === 'composer' || kind === 'bridge') && e.command === undefined && e.isMeta !== true) {
      const at = Date.now()
      await update($, promptsAtom, prompts => [...prompts, { text: e.text, at }].slice(-MAX_PROMPTS))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, liveAtom, () => EMPTY_LIVE)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    nextId += 1
    const id = e.tool_use_id ?? `prettier-${nextId}`
    const start = Date.now()
    const call: Call = { id, tool: toolLabel(e.tool), detail: describeCall(e.tool, e) }
    await update($, liveAtom, live => ({
      running: [...live.running, { id, tool: call.tool }],
      tools: live.tools + 1,
      calls: [...(live.calls ?? []), call].slice(-MAX_CALLS),
    }))
    await update($, timingsAtom, timings => [...timings, { id, start }].slice(-MAX_TIMINGS))
    let failed = true
    try {
      const ran = await next(e)
      failed = ran.deny !== undefined || ran.isError === true
      return ran
    } finally {
      const end = Date.now()
      await update($, liveAtom, live => ({
        ...live,
        running: live.running.filter(r => r.id !== id),
        calls: (live.calls ?? []).map(c => (c.id === id ? { ...c, ms: end - start, failed } : c)),
      }))
      await update($, timingsAtom, timings => timings.map(t => (t.id === id ? { ...t, end } : t)))
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const live = await read($, liveAtom)
      const turn: Turn = { durationMs: e.durationMs, tools: live.tools, calls: live.calls ?? [] }
      await update($, turnsAtom, turns => [...turns, turn].slice(-MAX_TURNS))
      await update($, liveAtom, () => EMPTY_LIVE)
    }
    return next(e)
  })

  // ---------------------------------------------------------------- drawing
  //
  // LOAD ORDER: prettier must load before any mod that draws these rows itself
  // without calling next (inkstyle does, for replies and tool rows). Such a mod
  // ends the chain, so a hook beneath it never runs and the width is lost. List
  // prettier first in CLAUDE_CODE_PLUGIN_DIRS; see README.md.

  // A user-role row. The person's own prompt is a purple-bordered pill on the right
  // with its time under it; a row someone else sent (a background task, another
  // agent, a channel) is a quiet card on the left.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box, Button, Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const columns = e.viewport?.columns ?? 80
    const { origin, task, from, text, isExpanded } = e.props
    const isOwn =
      origin.kind === 'composer' ||
      origin.kind === 'bridge' ||
      (origin.kind === 'unclassified' && task === undefined && from === undefined)
    // Clicks reach a row only in the fullscreen terminal; elsewhere ctrl+o
    // (isExpanded) is the one way to see a folded row whole.
    const canClick = e.viewport?.isFullscreen === true
    const isOpen = canClick && (await read($, memberOf(openAtom, e)))
    const toggle = () => update($, memberOf(openAtom, e), v => !v)

    if (isOwn) {
      const p = settings.prompt
      const room = Math.max(8, Math.floor((columns * p.width) / 100) - PILL_PAD_LEFT - 2)
      const folded = capText(text, room, p.lines)
      const capped = isExpanded || isOpen ? { shown: text, hidden: 0 } : folded
      const more = `${folded.hidden} more ${folded.hidden === 1 ? 'line' : 'lines'}`
      const hint =
        isExpanded || folded.hidden === 0
          ? undefined
          : !canClick
            ? `… ${more} · ${EXPAND_KEY} to see all`
            : isOpen
              ? '▾ show less'
              : `▸ ${more}`
      const width = pillWidth([...capped.shown.split('\n'), ...(hint === undefined ? [] : [hint])], columns, p.width)
      const at = p.time ? promptTime(await read($, promptsAtom), text) : undefined
      return (
        <Box flexDirection="column" alignItems="flex-end" width={columns}>
          <Box
            flexDirection="column"
            width={width}
            flexShrink={0}
            borderStyle="round"
            borderColor={PILL_BORDER}
            paddingLeft={PILL_PAD_LEFT}
          >
            <Text wrap="wrap">{capped.shown}</Text>
            {hint !== undefined &&
              (canClick ? (
                <Button plain key="more" onPress={toggle}>
                  <Text color={PURPLE_LIGHT}>{hint}</Text>
                </Button>
              ) : (
                <Text color={GREY}>{hint}</Text>
              ))}
          </Box>
          {at !== undefined && (
            <Box paddingRight={1}>
              <Text color={GREY}>{formatClock(at)}</Text>
            </Box>
          )}
        </Box>
      )
    }

    if (origin.kind === 'auto-continuation' || origin.kind === 'sdk') return next(e)
    const head = cardHead(origin, task, from)
    const lines = text.split('\n')
    const isWhole = isExpanded || isOpen
    const body = isWhole ? text : lines[0] ?? ''
    const canFold = !isExpanded && lines.length > 1
    return (
      <Box flexDirection="column" width={share(columns, settings.response.width)}>
        <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={CARD_BORDER} paddingX={1}>
          <Text>
            <Text color={head.color}>{`${head.icon} ${head.label}`}</Text>
            {head.meta !== '' && <Text color={GREY}>{` · ${head.meta}`}</Text>}
          </Text>
          {body !== '' && (
            <Text color={GREY} wrap={isWhole ? 'wrap' : 'truncate-end'}>
              {body}
            </Text>
          )}
          {canFold &&
            (canClick ? (
              <Button plain key="more" onPress={toggle}>
                <Text color={PURPLE_LIGHT}>{isOpen ? '▾ show less' : '▸ read all'}</Text>
              </Button>
            ) : (
              <Text color={GREY}>{`${EXPAND_KEY} to read all`}</Text>
            ))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const inner = await next(e)
    return (
      <Box flexDirection="column" width={share(e.viewport?.columns ?? 80, settings.response.width)}>
        {inner}
      </Box>
    )
  })

  // A tool call's row. A finished edit or new file is one row of its own,
  // `▸ Edit hooks/app.ts +12 −3`, that a click opens to its diff and closes;
  // its result row then draws nothing. Any other row is the one beneath
  // (inkstyle's or the engine's), held to the response width.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box, Button, Code, Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const columns = e.viewport?.columns ?? 80
    const { tool, tool_use_id, output, isErrored, isRunning, isInterrupted } = e.props
    const diff = isInterrupted
      ? undefined
      : await foldedDiff($, { tool, id: tool_use_id, output, isErrored, isRunning }, e.viewport?.isFullscreen === true)
    if (diff === undefined) {
      const inner = await next(e)
      return (
        <Box flexDirection="column" width={share(columns, settings.response.width)}>
          {inner}
        </Box>
      )
    }
    const isOpen = await read($, memberOf(openAtom, e))
    const name = diff.path === undefined ? 'file' : shortPath(diff.path, await cwdOf($))
    return (
      <Box flexDirection="column" width={share(columns, settings.code.width)}>
        <Box flexDirection="row">
          <Box width={ROW_GUTTER} flexShrink={0}>
            <Text color={PURPLE}>{isOpen ? '▾' : '▸'}</Text>
          </Box>
          <Button plain key="diff" onPress={() => update($, memberOf(openAtom, e), v => !v)}>
            <Text color={GREY}>{diff.isNew ? 'Created ' : `${toolLabel(tool)} `}</Text>
            <Text color={PURPLE}>{name}</Text>
            <Text color={GREEN}>{` +${diff.added}`}</Text>
            <Text color={RED}>{` −${diff.removed}`}</Text>
          </Button>
        </Box>
        {isOpen && (
          <Box marginLeft={ROW_GUTTER}>
            <Code source={diff.source} format="diff" path={diff.path} />
          </Box>
        )}
      </Box>
    )
  })

  // A run of reads and searches, folded to one line. A click on it (fullscreen)
  // opens the engine's rows under it and closes them again; ctrl+o, or
  // `fold off`, shows the engine's rows as they are.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box, Button, Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const width = share(e.viewport?.columns ?? 80, settings.response.width)
    if (!settings.response.fold || e.props.isExpanded) {
      const inner = await next(e)
      return (
        <Box flexDirection="column" width={width}>
          {inner}
        </Box>
      )
    }
    const canClick = e.viewport?.isFullscreen === true
    const isOpen = canClick && (await read($, memberOf(openAtom, e)))
    const calls = e.props.calls
    const isRunning = calls.some(c => c.isRunning)
    const failed = calls.filter(c => c.isErrored).length
    const took = isRunning ? undefined : groupDuration(calls.map(c => c.tool_use_id), await read($, timingsAtom))
    const mark = isRunning ? '○' : !canClick ? '▸' : isOpen ? '▾' : '▸'
    const line = (
      <Text wrap="wrap">
        <Text>{groupSummary(calls.map(c => c.tool))}</Text>
        {took !== undefined && <Text color={GREY}>{` · ${formatShort(took)}`}</Text>}
        {failed > 0 && <Text color={RED}>{` · ✗ ${failed} failed`}</Text>}
      </Text>
    )
    const head = (
      <Box flexDirection="row">
        <Box width={ROW_GUTTER} flexShrink={0}>
          <Text color={isRunning ? PURPLE_LIGHT : PURPLE}>{mark}</Text>
        </Box>
        {canClick ? (
          <Button plain key="group" onPress={() => update($, memberOf(openAtom, e), v => !v)}>
            {line}
          </Button>
        ) : (
          line
        )}
      </Box>
    )
    if (!isOpen) {
      return (
        <Box flexDirection="column" width={width}>
          {head}
        </Box>
      )
    }
    const rows = await next({ ...e, props: { ...e.props, isExpanded: true } })
    return (
      <Box flexDirection="column" width={width}>
        {head}
        {rows}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const inner = await next(e)
    return (
      <Box flexDirection="column" width={share(e.viewport?.columns ?? 80, settings.response.width)}>
        {inner}
      </Box>
    )
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const inner = await next(e)
    return (
      <Box flexDirection="column" width={share(e.viewport?.columns ?? 80, settings.response.width)}>
        {inner}
      </Box>
    )
  })

  // A tool's result. An edit's or new file's diff is drawn here at the code
  // width; a failure in a red frame; anything else is the engine's drawing at
  // the response width.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box, Code, Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const columns = e.viewport?.columns ?? 80
    const width = share(columns, settings.response.width)
    const { output, isErrored, tool } = e.props

    if (isErrored && !isRejection(output)) {
      const message = typeof output === 'string' ? output.trim() : undefined
      const inner = message === undefined ? await next(e) : undefined
      return (
        <Box flexDirection="row" width={width}>
          <Box width={RESULT_GUTTER.length} flexShrink={0}>
            <Text dimColor>{RESULT_GUTTER}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} borderStyle="round" borderColor={RED} paddingX={1}>
            <Text color={RED} bold>{`✗ ${toolLabel(tool)} failed`}</Text>
            {message !== undefined ? <Text wrap="wrap">{message}</Text> : inner}
          </Box>
        </Box>
      )
    }

    const diff = isErrored ? undefined : editDiff(tool, output)
    if (diff === undefined) {
      const inner = await next(e)
      return (
        <Box flexDirection="column" width={width}>
          {inner}
        </Box>
      )
    }

    // A finished edit is one row, drawn by the tool row's hook above: its
    // result draws nothing. While its turn runs (or where no click could open
    // it again) the diff shows whole here.
    const folded = await foldedDiff(
      $,
      { tool, id: e.props.tool_use_id, output, isErrored, isRunning: false },
      e.viewport?.isFullscreen === true,
    )
    if (folded !== undefined) return <Box />
    return (
      <Box flexDirection="row" width={share(columns, settings.code.width)}>
        <Box width={RESULT_GUTTER.length} flexShrink={0}>
          <Text dimColor>{RESULT_GUTTER}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text dimColor>
            {diff.isNew ? `Created, ${diffSummary(diff.added, 0).toLowerCase()}` : diffSummary(diff.added, diff.removed)}
          </Text>
          <Code source={diff.source} format="diff" path={diff.path} />
        </Box>
      </Box>
    )
  })

  // The line closing a turn, under the reply's text: `39s · ▸ 2 tools`, the
  // length dim like a prompt's time, the count in purple. A click on the count
  // (fullscreen) lists the turn's calls under it, and closes the list again.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { Box, Button, Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const turn = matchTurn(await read($, turnsAtom), e.props.durationMs)
    const { took, used } = footerParts(e.props.durationMs, turn?.tools)
    const calls = turn?.calls ?? []
    const canClick = e.viewport?.isFullscreen === true && calls.length > 0
    const isOpen = canClick && (await read($, memberOf(openAtom, e)))
    const room = Math.max(10, share(e.viewport?.columns ?? 80, settings.response.width) - ROW_GUTTER - 4)
    return (
      <Box flexDirection="column" marginLeft={ROW_GUTTER}>
        <Box flexDirection="row">
          <Text color={GREY}>{took}</Text>
          {used !== undefined && <Text color={GREY}>{' · '}</Text>}
          {used !== undefined &&
            (canClick ? (
              <Button plain key="tools" onPress={() => update($, memberOf(openAtom, e), v => !v)}>
                <Text color={PURPLE_LIGHT}>{`${isOpen ? '▾' : '▸'} ${used}`}</Text>
              </Button>
            ) : (
              <Text color={PURPLE_LIGHT}>{used}</Text>
            ))}
        </Box>
        {isOpen &&
          calls.map(c => (
            <Box key={c.id} flexDirection="row" marginLeft={2}>
              <Box width={2} flexShrink={0}>
                <Text color={c.failed === true ? RED : GREEN}>{c.failed === true ? '✗' : '✓'}</Text>
              </Box>
              <Text wrap="truncate-end">
                <Text color={PURPLE_LIGHT}>{c.tool}</Text>
                {c.detail !== '' && <Text color={GREY}>{` ${c.detail.slice(0, room)}`}</Text>}
                {c.ms !== undefined && <Text color={GREY}>{` · ${formatShort(c.ms)}`}</Text>}
              </Text>
            </Box>
          ))}
      </Box>
    )
  })

  // The spinner names the tool running now: `▸ running Bash…`.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const settings = await settingsOf($)
    if (!settings.isEnabled) return next(e)
    const { running } = await read($, liveAtom)
    const current = running[running.length - 1]
    if (current === undefined) return next(e)
    return next({ ...e, props: { ...e.props, message: `▸ running ${current.tool}` } })
  })
}
