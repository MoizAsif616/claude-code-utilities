import { expect, mock, test } from 'claude-code/testing'

import { parse, plainText } from '../hooks/markdown'

// The colours of replies and tool rows, drawn inside prettier's layout.

type Kit = Parameters<Parameters<typeof test>[1]>
const COMMAND = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

// A command run as the person types it; called after the test's own hooks.
async function run($: Kit[0], command: string, args: string) {
  return $.command.run({ command, args, ...COMMAND } as never)
}

const REPLY = [
  '## Plan',
  '',
  'This uses **bold**, `code`, a [link](https://example.com) and snake_case_names.',
  '',
  '| Mod | State |',
  '| --- | :---: |',
  '| **statusdeck** | built |',
  '| prettier | built |',
  '',
  '- first',
  '  - nested',
  '- second',
  '',
  '1. one',
  '2. two',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '> a quote',
  '',
  '---',
].join('\n')

const message = (text: string) =>
  ({
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 100, rows: 40 },
  }) as const

test('the parser finds every block of a reply', () => {
  const kinds = parse(REPLY).map(b => b.kind)
  expect(kinds).toEqual(['heading', 'para', 'table', 'list', 'list', 'code', 'quote', 'rule'])
  const list = parse('- a\n  - b\n- c')[0]
  expect(list?.kind === 'list' ? list.items.map(i => i.level) : []).toEqual([0, 1, 0])
  const table = parse('| a | b |\n| - | -: |\n| 1 | 2 |')[0]
  expect(table?.kind === 'table' ? table.align : []).toEqual(['left', 'right'])
})

test('cell widths are measured on the text a cell shows', () => {
  expect(plainText('**bold** and `code` and [x](https://a.b)')).toBe('bold and code and x')
  expect(plainText('snake_case_name')).toBe('snake_case_name')
})

test('a column rule spans its row however the cells wrap, and no column passes 30%', async ($, on) => {
  mock.clock(on)
  const long = 'a cell long enough to wrap onto several rows of its column'
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    ...message(`| name | note |\n| - | - |\n| x | ${long} |`),
  })
  // The rule floats in a column that stretches to the row and cuts it there,
  // and holds more lines than the cell can wrap to.
  // Two rows, each with a rule at both edges and one between the columns.
  const columns = (await ui.findAll({ type: 'Box' })).filter(box => box.props.overflow === 'hidden' && box.props.width === 1)
  expect(columns).toHaveLength(6)
  const pinned = (await ui.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
  expect(pinned).toHaveLength(6)
  const rules = await ui.findAll({ type: 'Text', text: /│/ })
  expect(Math.max(...rules.map(rule => rule.text.split('\n').length))).toBeGreaterThanOrEqual(long.length)
  // The reply is 100 columns less its gutter: 30% of that is 29 cells, padding included.
  const cells = (await ui.findAll({ type: 'Box' })).filter(box => box.props.paddingX === 1)
  expect(Math.max(...cells.map(cell => Number(cell.props.width)))).toBeLessThanOrEqual(29)
  // No blank rows: each row sits right under the one before.
  expect(cells.map(cell => cell.props.paddingTop)).toEqual([0, 0, 0, 0])
  expect(cells.some(cell => cell.props.paddingBottom !== undefined || cell.props.paddingY !== undefined)).toBe(false)
  await ui.unmount()
})

test('a table is framed: header-orange rules at the edges, between columns, under the header, round at the corners', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    ...message('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |'),
  })
  expect(await ui.findAll({ type: 'Text', text: /│/ })).toHaveLength(8)
  const corners = await ui.findAll({ type: 'Text', text: /^[╭┬╮├┼┤╰┴╯]$/ })
  expect(corners.map(corner => corner.text)).toEqual(['╭', '┬', '┬', '╮', '├', '┼', '┼', '┤', '╰', '┴', '┴', '╯'])
  const runs = await ui.findAll({ type: 'Text', text: /^─+$/ })
  expect(runs).toHaveLength(9)
  // One orange for every line; the header has no fill, only bold names.
  const frame = [...corners, ...runs, ...(await ui.findAll({ type: 'Text', text: /│/ }))]
  expect(new Set(frame.map(t => t.props.color))).toEqual(new Set(['#EA580C']))
  const head = await ui.find({ type: 'Text', text: 'a' })
  expect(head?.props).toMatchObject({ bold: true })
  expect(head?.props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

test('a reply draws on the terminal with its words intact', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'prettier', surface: 'terminal', ...message(REPLY) })
  for (const words of [/Plan/, /bold/, /snake_case_names/, /statusdeck/, /nested/, /a quote/]) {
    expect(await ui.find({ type: 'Text', text: words })).toBeDefined()
  }
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  await ui.unmount()
})

test('a tool row names the tool and what it works on', async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => ({ value: 'C:/x' }))
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      tool_use_id: 't1',
      tool: 'Edit',
      input: { file_path: 'C:/x/src/app.ts', old_string: 'a\nb', new_string: 'a\nc\nd' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
    viewport: { columns: 100, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: /Edit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /app\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+2/ })).toBeDefined()
  await ui.unmount()
})

test('a long command is drawn whole, never cut', async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => ({ value: 'C:/x' }))
  const command = `npm run build && ${'x'.repeat(200)} && echo done`
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 't2', tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false },
    viewport: { columns: 60, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: /echo done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /…/ })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- merged

const EDIT = {
  tool_use_id: 't9',
  tool: 'Edit',
  input: { file_path: 'C:/x/src/app.ts', old_string: 'a\nb', new_string: 'a\nc\nd' },
  isRunning: true,
  isErrored: false,
  isInterrupted: false,
}

const sized = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Box' })).some(box => box.props.width === 85)

test('a reply draws in colours inside the layout width', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'prettier', surface: 'terminal', ...message('Some **bold** words.') })
  expect(await sized(ui)).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('#F97316')
  expect((await ui.find({ type: 'Text', text: /^bold$/ }))?.props.color).toBe('#FED7AA')
  await ui.unmount()
})

test("a tool row is coloured, held to the layout width, with prettier's +n −n", async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => ({ value: 'C:/x' }))
  const ui = await $.ui.mount({ plugin: 'prettier', surface: 'terminal', component: 'ToolUse', props: EDIT, viewport: { columns: 100, rows: 40 } })
  expect(await sized(ui)).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Edit$/ }))?.props.color).toBe('#A855F7')
  expect((await ui.find({ type: 'Text', text: /^○$/ }))?.props.color).toBe('#C4B5FD')
  expect((await ui.find({ type: 'Text', text: /^ \+2$/ }))?.props.color).toBe('#22C55E')
  await ui.unmount()
})

test('/prettier off is Claude Code alone, colours and layout; on brings both back', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    return Text({ children: `beneath:${e.props.text}` })
  })
  on('store.set', () => ({ value: undefined }))
  const reply = () => $.ui.mount({ plugin: 'prettier', surface: 'terminal', ...message('Some **bold** words.') })

  await run($, 'prettier', 'off')
  let ui = await reply()
  expect(await ui.find({ type: 'Text', text: /beneath:Some \*\*bold\*\* words\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^bold$/ })).toBeUndefined()
  expect(await sized(ui)).toBe(false)
  await ui.unmount()

  await run($, 'prettier', 'on')
  ui = await reply()
  expect(await ui.find({ type: 'Text', text: /beneath:/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^bold$/ }))?.props.color).toBe('#FED7AA')
  expect(await sized(ui)).toBe(true)
  await ui.unmount()
})

test('a colour drawing that fails hands its row on, as a failed mod hook was passed by', async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => {
    throw new Error('no folder')
  })
  on('ui.render', { component: 'ToolUse' }, async ($, e) => {
    const { Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    return Text({ children: 'beneath row' })
  })
  const ui = await $.ui.mount({ plugin: 'prettier', surface: 'terminal', component: 'ToolUse', props: EDIT, viewport: { columns: 100, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /beneath row/ })).toBeDefined()
  expect(await sized(ui)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^ \+2$/ })).toBeDefined()
  await ui.unmount()
})
