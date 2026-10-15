import { expect, mock, test } from 'claude-code/testing'

import {
  capText,
  cardHead,
  describeCall,
  diffSummary,
  editDiff,
  footerParts,
  formatClock,
  formatDuration,
  groupDuration,
  groupSummary,
  isRejection,
  matchTurn,
  pillWidth,
  promptTime,
  share,
  shortPath,
  toolLabel,
} from '../hooks/layout'
import { DEFAULTS, applyArgs, describeAll, describeSection, mergeSettings } from '../hooks/settings'

const viewport = { columns: 100, rows: 40 }

// ---------------------------------------------------------------- layout

test('widths are shares of the terminal', () => {
  expect(share(100, 85)).toBe(85)
  expect(share(100, 75)).toBe(75)
  expect(share(10, 85)).toBe(20)
  // 1 border a side and one space on the left around the widest line.
  expect(pillWidth(['hello'], 100, 70)).toBe(5 + 3)
  expect(pillWidth(['x'.repeat(500)], 100, 70)).toBe(70)
})

test('a long prompt folds to its first rows and counts the rest', () => {
  expect(capText('one\ntwo', 20, 6)).toEqual({ shown: 'one\ntwo', hidden: 0 })
  const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')
  expect(capText(ten, 20, 6)).toEqual({ shown: ten.split('\n').slice(0, 6).join('\n'), hidden: 4 })
  // A line longer than the room takes several rows, and is cut part-way.
  const capped = capText('a'.repeat(50), 10, 2)
  expect(capped.hidden).toBe(1)
  expect(capped.shown.endsWith('…')).toBe(true)
})

const EDIT_OUTPUT = {
  filePath: 'D:/x/app.ts',
  structuredPatch: [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [' keep', '-old', '+new', '+more'] }],
}

test('an Edit result becomes unified-diff hunks', () => {
  const diff = editDiff('Edit', EDIT_OUTPUT)
  expect(diff?.source).toBe('@@ -3,2 +3,3 @@\n keep\n-old\n+new\n+more')
  expect(diff?.path).toBe('D:/x/app.ts')
  expect(diffSummary(diff?.added ?? 0, diff?.removed ?? 0)).toBe('Added 2 lines, removed 1 line')
  expect(editDiff('Write', { filePath: 'a', structuredPatch: [] })).toBeUndefined()
  expect(editDiff('Bash', EDIT_OUTPUT)).toBeUndefined()
})

test('the footer carries the length and the tool count; the clock reads local time', () => {
  expect(formatDuration(12_400)).toBe('12s')
  expect(formatDuration(64_000)).toBe('1m 4s')
  const at = new Date(2026, 9, 16, 14, 3).getTime()
  expect(formatClock(at)).toBe('14:03')
  expect(footerParts(39_000, 2)).toEqual({ took: '39s', used: '2 tools' })
  expect(footerParts(3_000, 1)).toEqual({ took: '3s', used: '1 tool' })
  expect(footerParts(3_000, 0)).toEqual({ took: '3s' })
  const turns = [
    { durationMs: 12_000, tools: 4 },
    { durationMs: 40_000, tools: 9 },
  ]
  expect(matchTurn(turns, 12_300)?.tools).toBe(4)
  expect(matchTurn(turns, 25_000)).toBeUndefined()
})

test('a prompt finds the time it was sent', () => {
  const prompts = [
    { text: 'first', at: 10 },
    { text: 'second', at: 20 },
  ]
  expect(promptTime(prompts, 'second')).toBe(20)
  expect(promptTime(prompts, 'never sent')).toBeUndefined()
})

test('a tool group sums up what it did and how long it took', () => {
  expect(groupSummary(['Read', 'Read', 'Grep', 'Read', 'Glob'])).toBe('Read 3 files, searched 2 patterns')
  expect(groupSummary(['Bash'])).toBe('Ran 1 command')
  expect(groupSummary(['mcp__x__lookup'])).toBe('Used lookup 1 time')
  const timings = [
    { id: 'a', start: 1000, end: 1400 },
    { id: 'b', start: 1200, end: 3100 },
  ]
  expect(groupDuration(['a', 'b'], timings)).toBe(2100)
  expect(groupDuration(['a', 'c'], timings)).toBeUndefined()
  expect(toolLabel('mcp__claude_ai_Gmail__search')).toBe('search')
})

test('a row someone else sent is labelled by who sent it', () => {
  const task = cardHead({ kind: 'task-notification' }, { status: 'completed', durationMs: 122_000 }, undefined)
  expect(task.label).toBe('Background task')
  expect(task.meta).toBe('completed · 2m 2s')
  expect(cardHead({ kind: 'peer' }, undefined, { name: 'reviewer' }).label).toBe('From reviewer')
})

test('a refusal at the dialog is not drawn as a failure', () => {
  expect(isRejection("The user doesn't want to proceed with this tool use.")).toBe(true)
  expect(isRejection('Error: ENOENT: no such file')).toBe(false)
})

// ---------------------------------------------------------------- settings

test('stored settings keep what is valid and default the rest', () => {
  const s = mergeSettings({ prompt: { width: 55, lines: 999 }, code: { width: 'wide' } })
  expect(s.prompt).toEqual({ ...DEFAULTS.prompt, width: 55 })
  expect(s.code.width).toBe(DEFAULTS.code.width)
  expect(mergeSettings(undefined)).toEqual(DEFAULTS)
})

test('a command changes several settings and refuses a wrong one', () => {
  const applied = applyArgs(DEFAULTS, 'prompt', 'width 60 lines 4 time off color pink size 3')
  expect(applied.settings.prompt).toEqual({ width: 60, lines: 4, time: false })
  expect(applied.changed).toEqual(['width 60', 'lines 4', 'time off'])
  expect(applied.errors).toHaveLength(2)
  expect(applyArgs(DEFAULTS, 'code', 'width 75%').settings.code.width).toBe(75)
  expect(applyArgs(DEFAULTS, 'response', 'width 10').errors[0]).toMatch(/40 to 100/)
})

test('the help says what each setting does and what to press', () => {
  expect(describeSection(DEFAULTS, 'response')).toMatch(/`fold on` fold runs of reads and searches/)
  expect(describeSection(DEFAULTS, 'response')).toMatch(/\/prettier-response width 80 fold off/)
  expect(describeAll(DEFAULTS)).toMatch(/ctrl\+o/)
})

// ---------------------------------------------------------------- drawing

test('a typed prompt draws in a purple-bordered pill', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'fix the login bug please', origin: { kind: 'composer' }, isExpanded: false },
    viewport,
  })
  expect(await ui.find({ type: 'Text', text: /fix the login bug please/ })).toBeDefined()
  const pill = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
  expect(pill?.props.borderColor).toBe('#7C3AED')
  expect(pill?.props.backgroundColor).toBeUndefined()
  expect(pill?.props.width).toBe(24 + 3)
  expect(pill?.props.paddingLeft).toBe(1)
  await ui.unmount()
})

test('a long prompt says how many lines are folded and what to press', async ($, on) => {
  mock.clock(on)
  const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
    viewport,
  })
  expect(await ui.find({ type: 'Text', text: /… 14 more lines · ctrl\+o to see all/ })).toBeDefined()
  await ui.unmount()
})

test('a background task draws as a card on the left', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'UserMessage',
    props: {
      text: 'Agent "review" finished\nfull report here',
      origin: { kind: 'task-notification' },
      task: { status: 'completed', durationMs: 5_000 },
      isExpanded: false,
    },
    viewport,
  })
  expect(await ui.find({ type: 'Text', text: /Background task/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctrl\+o to read all/ })).toBeDefined()
  await ui.unmount()
})

test('an Edit result draws its diff at the code width', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 't1', tool: 'Edit', output: EDIT_OUTPUT, isErrored: false },
    viewport,
  })
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
  expect((await ui.findAll({ type: 'Box' }))[0]?.props.width).toBe(75)
  await ui.unmount()
})

test('a failed tool draws its error in a red frame', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 't2', tool: 'Bash', output: 'Error: exit code 1', isErrored: true },
    viewport,
  })
  expect(await ui.find({ type: 'Text', text: /✗ Bash failed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /exit code 1/ })).toBeDefined()
  await ui.unmount()
})

test('a folded tool group sums up its calls, with no key hint', async ($, on) => {
  mock.clock(on)
  const call = (tool: string, id: string) => ({
    tool_use_id: id,
    tool,
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  })
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Read', 'a'), call('Read', 'b'), call('Grep', 'c')], isActive: false, isExpanded: false },
    viewport,
  })
  expect(await ui.find({ type: 'Text', text: /Read 2 files, searched 1 pattern/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctrl\+o/ })).toBeUndefined()
  await ui.unmount()
})

test('the turn footer draws its length without dashes', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 12_000 },
    viewport,
  })
  expect(await ui.find({ type: 'Text', text: /^12s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /──/ })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- toggles

const fullscreen = { columns: 100, rows: 40, isFullscreen: true }

test('a tool call reads as what it worked on', () => {
  expect(describeCall('Bash', { command: 'npm test\nmore' })).toBe('npm test')
  expect(describeCall('Read', { file_path: 'C:\\a\\b\\c.ts' })).toBe('b/c.ts')
  expect(describeCall('Grep', { pattern: 'login' })).toBe('login')
  expect(describeCall('WebFetch', { url: 'https://x.dev/p' })).toBe('x.dev/p')
})

test('in fullscreen a folded prompt opens and closes on a click', async ($, on) => {
  mock.clock(on)
  const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
    viewport: fullscreen,
  })
  expect(await ui.find({ type: 'Text', text: /▸ 14 more lines/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctrl\+o/ })).toBeUndefined()
  await ui.press({ key: 'more' })
  expect(await ui.find({ type: 'Text', text: /line 20/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▾ show less/ })).toBeDefined()
  await ui.press({ key: 'more' })
  expect(await ui.find({ type: 'Text', text: /▸ 14 more lines/ })).toBeDefined()
  await ui.unmount()
})

test('in fullscreen a tool group toggles open on a click', async ($, on) => {
  mock.clock(on)
  // Beneath the plugin, the engine's own drawing of the opened group.
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    const { Text } = $.ui.resolve({ ...e, surface: 'terminal' as const })
    return Text({ children: e.props.isExpanded ? 'engine rows' : 'engine line' })
  })
  const call = (tool: string, id: string) => ({
    tool_use_id: id,
    tool,
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  })
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolGroup',
    props: { calls: [call('Read', 'a'), call('Grep', 'b')], isActive: false, isExpanded: false },
    viewport: fullscreen,
  })
  expect(await ui.find({ type: 'Text', text: /^▸$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await ui.press({ key: 'group' })
  expect(await ui.find({ type: 'Text', text: /^▾$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine rows/ })).toBeDefined()
  await ui.press({ key: 'group' })
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await ui.unmount()
})

test('a new file reads as added lines', () => {
  const diff = editDiff('Write', { type: 'create', filePath: 'D:/x/new.ts', content: 'a\nb\n', structuredPatch: [] })
  expect(diff?.source).toBe('@@ -0,0 +1,2 @@\n+a\n+b')
  expect(diff?.added).toBe(2)
  expect(diff?.isNew).toBe(true)
  expect(shortPath('D:/POC/app/src/x.ts', 'D:\\POC\\app')).toBe('src/x.ts')
  expect(shortPath('C:/a/b/c/d/e.ts', 'D:/other')).toBe('…/c/d/e.ts')
})

test('in fullscreen a finished edit is one row that opens on a click', async ($, on) => {
  mock.clock(on)
  on('session.cwd', () => ({ value: 'D:/x' }))
  const ui = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      tool_use_id: 'done-1',
      tool: 'Edit',
      input: { file_path: 'D:/x/app.ts' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: EDIT_OUTPUT,
    },
    viewport: fullscreen,
  })
  expect(await ui.find({ type: 'Text', text: /^app\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \+2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ −1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.press({ key: 'diff' })
  expect((await ui.find({ type: 'Code' }))?.props.format).toBe('diff')
  await ui.press({ key: 'diff' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()

  // Its result row draws nothing, so the edit takes one line.
  const result = await $.ui.mount({
    plugin: 'prettier',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'done-1', tool: 'Edit', output: EDIT_OUTPUT, isErrored: false },
    viewport: fullscreen,
  })
  expect(await result.find({ type: 'Text' })).toBeUndefined()
  expect(await result.find({ type: 'Code' })).toBeUndefined()
  await result.unmount()
})
