import type { Elements, RenderNode } from 'claude-code'

type El = Elements['terminal']
type Inline = (RenderNode | string)[]

// Palette shared with statusdeck and panes: orange for emphasis, purple for
// structure. Body text keeps the terminal's own colour.
export const ORANGE = '#F97316'
export const ORANGE_BOLD = '#FB923C'
export const ORANGE_LIGHT = '#FED7AA'
export const PURPLE = '#A855F7'
export const PURPLE_DEEP = '#7C3AED'
export const PURPLE_LIGHT = '#C4B5FD'
export const LAVENDER = '#D8B4FE'
export const WHITE = '#FFFFFF'
export const TABLE_HEAD = '#EA580C'
export const ZEBRA = '#262626'
export const RULE = '#3F3F46'
export const BLACK = '#000000'

type Ctx = { bold: string; color?: string }

// ---------------------------------------------------------------- inline

const INLINE: [RegExp, (m: RegExpExecArray, ctx: Ctx, el: El) => RenderNode][] = [
  [/^(`+)([\s\S]+?)\1(?!`)/, (m, _ctx, { Text }) => <Text color={PURPLE_LIGHT}>{m[2] ?? ''}</Text>],
  [
    /^\*\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*\*/,
    (m, ctx, el) => (
      <el.Text bold italic color={ctx.bold}>
        {inline(m[1] ?? '', ctx, el)}
      </el.Text>
    ),
  ],
  [
    /^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/,
    (m, ctx, el) => (
      <el.Text bold color={ctx.color ?? ctx.bold}>
        {inline(m[2] ?? '', ctx, el)}
      </el.Text>
    ),
  ],
  [
    /^~~(?=\S)([\s\S]+?)(?<=\S)~~/,
    (m, ctx, el) => <el.Text strikethrough>{inline(m[1] ?? '', ctx, el)}</el.Text>,
  ],
  [
    /^\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*(?!\*)/,
    (m, ctx, el) => <el.Text italic>{inline(m[1] ?? '', ctx, el)}</el.Text>,
  ],
  [
    /^_(?=\S)([\s\S]+?)(?<=\S)_(?!\w)/,
    (m, ctx, el) => <el.Text italic>{inline(m[1] ?? '', ctx, el)}</el.Text>,
  ],
  [
    /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
    (m, ctx, el) => (
      <el.Link href={m[2] ?? ''}>
        <el.Text color={LAVENDER} underline>
          {inline(m[1] ?? '', ctx, el)}
        </el.Text>
      </el.Link>
    ),
  ],
  [
    /^<?(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"`*])>?/,
    (m, _ctx, el) => (
      <el.Link href={m[1] ?? ''}>
        <el.Text color={LAVENDER} underline>
          {m[1] ?? ''}
        </el.Text>
      </el.Link>
    ),
  ],
]

export function inline(text: string, ctx: Ctx, el: El): Inline {
  const out: Inline = []
  let plain = ''
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const escaped = /^\\([\\`*_{}[\]()#+\-.!~|>])/.exec(rest)
    if (escaped !== null) {
      plain += escaped[1]
      i += 2
      continue
    }
    // Underscores and asterisks inside a word are text, not emphasis.
    const prev = i > 0 ? text[i - 1] ?? '' : ''
    const isWordEdge = !/\w/.test(prev)
    let matched = false
    for (const [re, make] of INLINE) {
      if ((rest.startsWith('_') || rest.startsWith('*')) && !isWordEdge && !rest.startsWith('**')) break
      if (rest.startsWith('http') && !isWordEdge) break
      const m = re.exec(rest)
      if (m === null) continue
      if (plain !== '') out.push(plain)
      plain = ''
      out.push(make(m, ctx, el))
      i += m[0].length
      matched = true
      break
    }
    if (!matched) {
      plain += text[i]
      i += 1
    }
  }
  if (plain !== '') out.push(plain)
  return out
}

// The text a cell shows, for measuring its width.
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, '$1')
    .replace(/(\*\*\*|\*\*|__|~~)(?=\S)([\s\S]+?)(?<=\S)\1/g, '$2')
    .replace(/(`+)([\s\S]+?)\1/g, '$2')
    .replace(/(^|\W)[*_](?=\S)([\s\S]+?)(?<=\S)[*_](?!\w)/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1')
}

function width(text: string): number {
  let n = 0
  for (const ch of plainText(text)) {
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

// How many rows a cell's text takes when word-wrapped at `room` columns.
export function wrappedRows(text: string, room: number): number {
  let rows = 1
  let used = 0
  for (const word of plainText(text).split(/\s+/).filter(w => w !== '')) {
    const w = width(word)
    if (used === 0) {
      rows += Math.max(0, Math.ceil(w / room) - 1)
      used = w % room === 0 ? room : w % room
    } else if (used + 1 + w <= room) {
      used += 1 + w
    } else {
      rows += Math.ceil(w / room)
      used = w % room === 0 ? room : w % room
    }
  }
  return rows
}

// ---------------------------------------------------------------- blocks

type Item = { level: number; marker: string; isOrdered: boolean; text: string }
type Align = 'left' | 'center' | 'right'
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; lang: string; source: string }
  | { kind: 'list'; items: Item[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][]; align: Align[] }
  | { kind: 'rule' }

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE_LINE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function cells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out: string[] = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? ''
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i += 1
    } else if (ch === '`') {
      inCode = !inCode
      cur += ch
    } else if (ch === '|' && !inCode) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || RULE_LINE.test(line) || ITEM.test(line) ||
    QUOTE.test(line) || (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-'))
  )
}

export function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const next = lines[i + 1]
    if (line.trim() === '') {
      i += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence !== null) {
      const mark = fence[2] ?? '```'
      const body: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(mark)) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      out.push({ kind: 'code', lang: fence[3] ?? '', source: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      out.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      i += 1
      continue
    }

    if (RULE_LINE.test(line)) {
      out.push({ kind: 'rule' })
      i += 1
      continue
    }

    if (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-')) {
      const head = cells(line)
      const align = cells(next).map(c =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left',
      ) as Align[]
      const rows: string[][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(cells(lines[i] ?? ''))
        i += 1
      }
      out.push({ kind: 'table', head, rows, align })
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        body.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '')
        i += 1
      }
      out.push({ kind: 'quote', text: body.join('\n') })
      continue
    }

    if (ITEM.test(line)) {
      const items: Item[] = []
      const indents: number[] = []
      while (i < lines.length) {
        const cur = lines[i] ?? ''
        const m = ITEM.exec(cur)
        if (m !== null) {
          const indent = (m[1] ?? '').replace(/\t/g, '    ').length
          // A top-level item of the other kind (bullets, numbers) starts a new list.
          const first = items[0]
          if (first !== undefined && indent <= (indents[0] ?? 0) && /\d/.test(m[2] ?? '') !== first.isOrdered) break
          while (indents.length > 0 && (indents[indents.length - 1] ?? 0) > indent) indents.pop()
          if (indents.length === 0 || (indents[indents.length - 1] ?? 0) < indent) indents.push(indent)
          const marker = m[2] ?? '-'
          items.push({ level: indents.length - 1, marker, isOrdered: /\d/.test(marker), text: m[3] ?? '' })
          i += 1
          continue
        }
        if (cur.trim() === '') {
          // A blank line ends the list unless another item follows it.
          let j = i + 1
          while (j < lines.length && (lines[j] ?? '').trim() === '') j += 1
          if (j < lines.length && ITEM.test(lines[j] ?? '')) {
            i = j
            continue
          }
          break
        }
        // An indented line continues the item above it.
        if (/^\s+\S/.test(cur) && items.length > 0 && !isBlockStart(cur.trim(), lines[i + 1])) {
          const last = items[items.length - 1]
          if (last !== undefined) last.text += `\n${cur.trim()}`
          i += 1
          continue
        }
        break
      }
      out.push({ kind: 'list', items })
      continue
    }

    const body: string[] = [line]
    i += 1
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !isBlockStart(lines[i] ?? '', lines[i + 1])) {
      body.push(lines[i] ?? '')
      i += 1
    }
    out.push({ kind: 'para', text: body.join('\n') })
  }
  return out
}

// ---------------------------------------------------------------- drawing

// Headings are bold bright orange (the table-header orange), no background.
const HEADINGS: Record<number, { color: string; underline?: boolean }> = {
  1: { color: TABLE_HEAD, underline: true },
  2: { color: TABLE_HEAD },
  3: { color: TABLE_HEAD },
}

function drawTable(b: Extract<Block, { kind: 'table' }>, room: number, el: El): RenderNode {
  const { Box, Text } = el
  const count = Math.max(b.head.length, ...b.rows.map(r => r.length))
  const widths: number[] = []
  for (let c = 0; c < count; c++) {
    widths.push(Math.max(3, width(b.head[c] ?? ''), ...b.rows.map(r => width(r[c] ?? ''))))
  }
  // Each cell has one cell of padding a side and one column rule between
  // cells; shrink the widest column until the table fits.
  while (widths.reduce((a, w) => a + w + 2, 0) + count - 1 > room) {
    let at = 0
    for (let c = 1; c < count; c++) if ((widths[c] ?? 0) > (widths[at] ?? 0)) at = c
    if ((widths[at] ?? 0) <= 6) break
    widths[at] = (widths[at] ?? 0) - 1
  }
  const justify = (a: Align | undefined) =>
    a === 'right' ? 'flex-end' : a === 'center' ? 'center' : 'flex-start'

  // The rule between columns spans the row's full height, so a row whose
  // cells wrap keeps an unbroken line.
  const row = (values: string[], isHead: boolean, bg: string | undefined) => {
    const height = Math.max(1, ...widths.map((w, c) => wrappedRows(values[c] ?? '', w)))
    const rule = Array.from({ length: height }, () => '│').join('\n')
    const cellsOut: RenderNode[] = []
    widths.forEach((w, c) => {
      if (c > 0) {
        cellsOut.push(
          <Box width={1} flexShrink={0}>
            <Text color={isHead ? BLACK : ORANGE}>{rule}</Text>
          </Box>,
        )
      }
      cellsOut.push(
        <Box width={w + 2} paddingX={1} justifyContent={justify(b.align[c])}>
          <Text bold={isHead} color={isHead ? WHITE : undefined} backgroundColor={bg} wrap="wrap">
            {inline(values[c] ?? '', isHead ? { bold: WHITE, color: WHITE } : { bold: ORANGE_LIGHT }, el)}
          </Text>
        </Box>,
      )
    })
    return (
      <Box flexDirection="row" backgroundColor={bg}>
        {cellsOut}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {row(b.head, true, TABLE_HEAD)}
      {b.rows.map((r, n) => row(r, false, n % 2 === 1 ? ZEBRA : undefined))}
    </Box>
  )
}

function drawList(items: Item[], el: El): RenderNode {
  const { Box, Text } = el
  const counters: number[] = []
  return (
    <Box flexDirection="column">
      {items.map(item => {
        counters.length = item.level + 1
        counters[item.level] = (counters[item.level] ?? 0) + 1
        const start = /^\d+/.exec(item.marker)
        if (item.isOrdered && counters[item.level] === 1 && start !== null) counters[item.level] = Number(start[0])
        const task = /^\[([ xX])\]\s+/.exec(item.text)
        const marker = item.isOrdered ? `${counters[item.level]}.` : '-'
        const text = task !== null ? item.text.slice(task[0].length) : item.text
        return (
          <Box flexDirection="row" marginLeft={item.level * 2}>
            <Text color={PURPLE} bold={item.isOrdered}>
              {`${marker} `}
            </Text>
            {task !== null && <Text color={PURPLE}>{task[1] === ' ' ? '☐ ' : '☑ '}</Text>}
            <Box flexShrink={1}>
              <Text>{inline(text, { bold: ORANGE_LIGHT }, el)}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

function drawBlock(b: Block, room: number, el: El): RenderNode {
  const { Box, Code, Text } = el
  switch (b.kind) {
    case 'heading': {
      const style = HEADINGS[b.level] ?? { color: TABLE_HEAD }
      return (
        <Text bold color={style.color} underline={style.underline}>
          {inline(b.text, { bold: style.color }, el)}
        </Text>
      )
    }
    case 'para':
      return <Text>{inline(b.text, { bold: ORANGE_LIGHT }, el)}</Text>
    case 'code':
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={PURPLE_DEEP}>▎</Text>
            <Text dimColor>{` ${b.lang === '' ? 'code' : b.lang}`}</Text>
          </Text>
          <Box marginLeft={2}>
            <Code source={b.source} language={b.lang === '' ? undefined : b.lang} />
          </Box>
        </Box>
      )
    case 'list':
      return drawList(b.items, el)
    case 'quote':
      return (
        <Box flexDirection="row">
          <Text color={PURPLE_DEEP}>▎ </Text>
          <Box flexShrink={1}>
            <Text italic dimColor>
              {inline(b.text, { bold: ORANGE_LIGHT }, el)}
            </Text>
          </Box>
        </Box>
      )
    case 'table':
      return drawTable(b, room, el)
    case 'rule':
      return <Text color={RULE}>{'─'.repeat(Math.max(3, Math.min(room, 60)))}</Text>
  }
}

// A reply block: one blank row between blocks, as the engine spaces them.
export function drawMarkdown(text: string, room: number, el: El): RenderNode {
  const { Box } = el
  const blocks = parse(text)
  return (
    <Box flexDirection="column" width={room}>
      {blocks.map((b, n) => (
        <Box marginTop={n === 0 ? 0 : 1}>{drawBlock(b, room, el)}</Box>
      ))}
    </Box>
  )
}
