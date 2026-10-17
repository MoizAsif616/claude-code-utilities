// The colours inside replies and on tool-call rows. prettier's layout draws
// around them; /prettier on|off turns both on or off together.
import type { EngineInterface, RenderInput, RenderNode } from 'claude-code'

import { drawMarkdown, ORANGE, PURPLE, PURPLE_LIGHT } from './markdown'

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

// `isCommand`: the summary is a shell command, drawn whole with its own lines.
type Row = { name: string; scope?: string; summary: string; isCommand?: true }

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
      return { name: tool, summary: (str(input, 'command') ?? '').trim(), isCommand: true }
    case 'Read':
    case 'NotebookEdit':
      return { name: tool, summary: path === undefined ? '' : shortPath(path, cwd) }
    case 'Edit':
    case 'Write':
      return { name: tool, summary: path === undefined ? '' : shortPath(path, cwd) }
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

// Whitespace runs as one space, so a summary reads as one line of words.
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------- drawing
//
// Each answers what the row beneath prettier's layout draws: the colours when
// they are on, else `next`. A drawing that fails is passed by, as Claude Code
// passed by a mod's hook that failed, and `next` draws the row.

type Next<E> = (e: E) => Promise<RenderNode>

// The colours draw on the terminal; prettier hands every row on when it is off.
function isInkOn(surface: string): boolean {
  return surface === 'terminal'
}

// A reply's text, drawn from its markdown in the ink palette.
export async function inkReply(
  $: EngineInterface,
  e: RenderInput<'AssistantMessage'>,
  next: Next<RenderInput<'AssistantMessage'>>,
): Promise<RenderNode> {
  if (!isInkOn(e.surface)) return next(e)
  try {
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
  } catch {
    return next(e)
  }
}

// A tool call's row: a status dot, the tool in purple, what it works on.
export async function inkToolRow(
  $: EngineInterface,
  e: RenderInput<'ToolUse'>,
  next: Next<RenderInput<'ToolUse'>>,
): Promise<RenderNode> {
  if (!isInkOn(e.surface)) return next(e)
  try {
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
    const scope = row.scope === undefined ? '' : ` ${row.scope}`
    const note = e.props.isInterrupted ? ' · interrupted' : ''
    // Drawn whole, never cut: the row wraps in whatever width it is given.
    const summary = row.isCommand === true ? row.summary : flatten(row.summary)
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
          {summary !== '' && <Text dimColor>{` ${summary}`}</Text>}
          {note !== '' && <Text dimColor>{note}</Text>}
        </Text>
      </Box>
    )
  } catch {
    return next(e)
  }
}
