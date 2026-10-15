import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Settings } from '../types'
import { drawMarkdown, ORANGE, PURPLE, PURPLE_LIGHT } from './markdown'

const settingsAtom = atom({ plugin: 'inkstyle', key: 'settings' } as const, {
  isEnabled: true,
} as Settings)

const GREEN = '#22C55E'
const RED = '#EF4444'
const GREY = '#71717A'
const GUTTER = 2

// ---------------------------------------------------------------- tool rows

function normalize(path: string): string {
  return path.replace(/\\/g, '/')
}

// Relative to the session's folder when inside it, else its last three parts.
function shortPath(path: string, cwd: string): string {
  const p = normalize(path)
  const root = normalize(cwd).replace(/\/$/, '')
  if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return p.slice(root.length + 1)
  const parts = p.split('/').filter(s => s !== '')
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' && v !== '' ? v : undefined
}

// Lines added and removed, after the lines both sides share at either end.
function lineDelta(before: string, after: string): [number, number] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1
  }
  return [b.length - head - tail, a.length - head - tail]
}

type Row = { name: string; scope?: string; summary: string; delta?: [number, number] }

function describe(tool: string, raw: unknown, cwd: string): Row {
  const input = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp !== null) {
    const scope = (mcp[1] ?? '').replace(/^claude_ai_/, '').replace(/_/g, ' ')
    const first = Object.values(input).find(v => typeof v === 'string')
    return { name: (mcp[2] ?? tool).replace(/_/g, ' '), scope, summary: typeof first === 'string' ? first : '' }
  }
  const path = str(input, 'file_path') ?? str(input, 'notebook_path') ?? str(input, 'path')
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return { name: tool, summary: (str(input, 'command') ?? '').split('\n')[0] ?? '' }
    case 'Read':
    case 'NotebookEdit':
      return { name: tool, summary: path === undefined ? '' : shortPath(path, cwd) }
    case 'Edit':
      return {
        name: tool,
        summary: path === undefined ? '' : shortPath(path, cwd),
        delta: lineDelta(str(input, 'old_string') ?? '', str(input, 'new_string') ?? ''),
      }
    case 'Write': {
      const content = str(input, 'content') ?? ''
      return {
        name: tool,
        summary: path === undefined ? '' : shortPath(path, cwd),
        delta: [content === '' ? 0 : content.split('\n').length, 0],
      }
    }
    case 'Grep': {
      const where = path === undefined ? '' : ` in ${shortPath(path, cwd)}`
      return { name: tool, summary: `${str(input, 'pattern') ?? ''}${where}` }
    }
    case 'Glob':
      return { name: tool, summary: str(input, 'pattern') ?? '' }
    case 'WebFetch':
      return { name: tool, summary: (str(input, 'url') ?? '').replace(/^https?:\/\//, '') }
    case 'WebSearch':
      return { name: tool, summary: str(input, 'query') ?? '' }
    case 'Agent':
      return { name: tool, summary: str(input, 'description') ?? '' }
    case 'Skill':
      return { name: tool, summary: str(input, 'skill') ?? '' }
    default: {
      const first = Object.values(input).find(v => typeof v === 'string')
      return { name: tool, summary: typeof first === 'string' ? first : '' }
    }
  }
}

function clip(text: string, room: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (room <= 1) return ''
  return flat.length > room ? `${flat.slice(0, room - 1)}…` : flat
}

// ---------------------------------------------------------------- toggle

async function setEnabled($: EngineInterface, isEnabled: boolean): Promise<void> {
  await update($, settingsAtom, () => ({ isEnabled }))
  await $.store.set('isEnabled', isEnabled)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('isEnabled')
    if (typeof stored === 'boolean') await update($, settingsAtom, () => ({ isEnabled: stored }))
    await $.command.register({
      name: 'inkstyle',
      description: 'Turn the inkstyle reply colours on or off',
      argumentHint: '[on|off]',
    })
    return next(e)
  })

  on('command.run', { command: 'inkstyle' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = (await read($, settingsAtom)).isEnabled
    const isEnabled = arg === 'on' ? true : arg === 'off' ? false : !current
    await setEnabled($, isEnabled)
    return { text: isEnabled ? 'inkstyle on' : "inkstyle off: replies use Claude Code's own look" }
  })

  // A reply's text, drawn from its markdown in the inkstyle palette.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await read($, settingsAtom)).isEnabled) return next(e)
    const el = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const { Box, Text } = el
    const room = Math.max(20, (e.viewport?.columns ?? 80) - GUTTER - 1)
    return (
      <Box flexDirection="row">
        <Box width={GUTTER} flexShrink={0}>
          <Text color={ORANGE}>{e.props.isFirstOfReply ? '●' : ' '}</Text>
        </Box>
        {drawMarkdown(e.props.text, room, el)}
      </Box>
    )
  })

  // A tool call's row: a status dot, the tool in purple, what it works on.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await read($, settingsAtom)).isEnabled) return next(e)
    const { Box, Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    const cwd = await $.session.cwd()
    const row = describe(e.props.tool, e.props.input, cwd)
    const dot = e.props.isInterrupted
      ? GREY
      : e.props.isErrored
        ? RED
        : e.props.isRunning
          ? PURPLE_LIGHT
          : PURPLE
    const delta = row.delta !== undefined && (row.delta[0] > 0 || row.delta[1] > 0) ? row.delta : undefined
    const deltaText = delta === undefined ? '' : ` +${delta[0]} −${delta[1]}`
    const scope = row.scope === undefined ? '' : ` ${row.scope}`
    const note = e.props.isInterrupted ? ' · interrupted' : ''
    const room =
      (e.viewport?.columns ?? 80) - GUTTER - row.name.length - scope.length - deltaText.length - note.length - 2
    return (
      <Box flexDirection="row">
        <Box width={GUTTER} flexShrink={0}>
          <Text color={dot}>{e.props.isRunning ? '○' : '●'}</Text>
        </Box>
        <Text>
          <Text color={PURPLE} bold>
            {row.name}
          </Text>
          {scope !== '' && <Text dimColor>{scope}</Text>}
          {row.summary !== '' && <Text dimColor>{` ${clip(row.summary, room)}`}</Text>}
          {delta !== undefined && (
            <Text>
              <Text color={GREEN}>{` +${delta[0]}`}</Text>
              <Text color={RED}>{` −${delta[1]}`}</Text>
            </Text>
          )}
          {note !== '' && <Text dimColor>{note}</Text>}
        </Text>
      </Box>
    )
  })
}
