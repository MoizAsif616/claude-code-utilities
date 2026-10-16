import { expect, mock, test } from 'claude-code/testing'

import { parse, plainText, wrappedRows } from '../hooks/markdown'

const REPLY = [
  '## Plan',
  '',
  'This uses **bold**, `code`, a [link](https://example.com) and snake_case_names.',
  '',
  '| Mod | State |',
  '| --- | :---: |',
  '| **statusdeck** | built |',
  '| inkstyle | next |',
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

test('a column rule is as tall as its row wraps', () => {
  expect(wrappedRows('short', 10)).toBe(1)
  expect(wrappedRows('two words here', 9)).toBe(2)
  expect(wrappedRows('abcdefghijkl', 5)).toBe(3)
})

test('a table draws an orange rule between body columns', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'inkstyle',
    surface: 'terminal',
    ...message('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |'),
  })
  expect(await ui.findAll({ type: 'Text', text: /│/ })).toHaveLength(4)
  await ui.unmount()
})

test('a reply draws on the terminal with its words intact', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'inkstyle', surface: 'terminal', ...message(REPLY) })
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
    plugin: 'inkstyle',
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
  // The +n −n count is prettier's to draw, not inkstyle's.
  expect(await ui.find({ type: 'Text', text: /\+2/ })).toBeUndefined()
  await ui.unmount()
})

test('a long command is drawn whole, never cut', async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => ({ value: 'C:/x' }))
  const command = `npm run build && ${'x'.repeat(200)} && echo done`
  const ui = await $.ui.mount({
    plugin: 'inkstyle',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 't2', tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false },
    viewport: { columns: 60, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: /echo done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /…/ })).toBeUndefined()
  await ui.unmount()
})
