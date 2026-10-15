# prettier

Chat layout for the Claude Code terminal:

- **Your prompts:** a pill with a rounded purple border (no fill, one space of padding on the left) on the right, at most 70% of the
  terminal wide, with the time you sent it under it. A long prompt shows its first 6
  lines, then `… 14 more lines · ctrl+o to see all`.
- **Replies and tool output:** held to the left 85% of the terminal.
- **Edit diffs:** redrawn by prettier so added/removed lines wrap inside a narrower 75%. While
  the reply is being written each diff shows whole; once it is done (fullscreen) each edited or
  created file is one row in place of its tool row, `▸ Edit hooks/app.ts +12 −3` (name in purple,
  `+n` green, `−n` red), that opens to its diff and closes on a click. A new file's content shows as added lines.
- **Reads and searches:** a run of them folds to one line, `▸ Read 3 files, searched 2 patterns ·
  1.2s`.
- **Failures:** a failed tool's error in a red frame, `✗ Bash failed`. A refusal at the permission
  dialog is not a failure and keeps Claude Code's own drawing.
- **Rows you did not type:** background tasks finishing, messages from other agents, sessions or
  channels show as a quiet card on the left (`⚙ Background task · completed · 2m 2s`), not as your
  pill.
- **End of a reply:** `39s · ▸ 2 tools` under the reply: how long it took, dim like the prompt's
  time, and how many tools it used in purple. The time of day is shown only under your prompt.
- **Spinner:** names the running tool, `▸ running Bash…`.

### Seeing the details

**Click to toggle (fullscreen mode).** Every compact row opens and closes on a click, marked `▸`
(closed) and `▾` (open): a folded prompt (`▸ 14 more lines` / `▾ show less`), a folded run of
reads and searches (its calls appear under it), a background-task card (`▸ read all`), and the
tool count under a reply (`▸ 2 tools` lists each call: `✓ Bash npm test · 1.2s`). Claude Code
only reports mouse clicks to mods in its fullscreen (alternate-screen) layout; on the normal
screen these rows stay compact and show `ctrl+o` where something is hidden.

**Press `ctrl+o`** (Claude Code's own transcript view) to see every folded thing in full: each tool
call of a group, whole outputs, whole long prompts and messages. Press `ctrl+o` again to go back.
A folded prompt or message says so; the first session after installing shows a one-time tip, and
`/prettier` repeats it.

### Commands

| Command | Settings (defaults) |
| --- | --- |
| `/prettier` | lists the commands; `on`, `off`, `reset` (every setting to its default) |
| `/prettier-prompt` | `width 70` (% of the terminal), `lines 6` (shown before folding), `time on` |
| `/prettier-response` | `width 85` (% of the terminal), `fold on` (fold reads and searches) |
| `/prettier-code` | `width 75` (% of the terminal, for diffs) |

Each command alone lists its settings and what they do. Change one or several at once:
`/prettier-prompt width 60 lines 4`. Settings are kept across sessions.

Long Bash and Read output is already folded by Claude Code itself (`… +42 lines (ctrl+o to
expand)`); prettier leaves that as it is, since a mod cannot tell when `ctrl+o` is open for a
result and would hide the output for good.


## Load order: prettier goes FIRST

> **For Claude or anyone installing this mod:** prettier must be loaded **before every other mod**,
> in particular before `inkstyle` and `statusdeck`. Otherwise the 85% width (and the spinner
> text) silently does nothing.

### Why

Mods hook the same drawing in a chain: the first mod loaded is the outermost and calls `next(e)`
to reach the ones beneath it. prettier only *wraps* what is beneath it:

- **Replies and tool rows:** `inkstyle` draws every reply and tool row itself (to color them) and
  never calls `next(e)`. A mod loaded after inkstyle is never reached for those, so prettier's 85%
  box is never applied. Loaded first, prettier wraps inkstyle's colored rows in the 85% box.
- **Spinner:** `statusdeck` draws its own spinner from the props it is handed. prettier rewrites
  the spinner's `message` to `▸ running <tool>` and passes it on, so it has to be above statusdeck.

Neither mod imports or reads the other: they are independent in code, and only the order connects
them. In the wrong order nothing breaks: replies go back to full width and the spinner to its
usual words.

### How

List prettier first in `CLAUDE_CODE_PLUGIN_DIRS` (`;`-separated on Windows, `:` elsewhere). The
mod API puts every installed mod in one tier and does not document the order within it, so this
relies on Claude Code loading the list in order: confirm it with the check below.

```powershell
[Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS',
  "$env:USERPROFILE\.claude\mods\prettier;$env:USERPROFILE\.claude\mods\statusdeck;$env:USERPROFILE\.claude\mods\inkstyle",
  'User')
```

On macOS/Linux, in your shell profile:

```sh
export CLAUDE_CODE_PLUGIN_DIRS="$HOME/.claude/mods/prettier:$HOME/.claude/mods/statusdeck:$HOME/.claude/mods/inkstyle"
```

Then restart Claude Code. The variable is read at startup, and on Windows a terminal only sees a
changed user variable if the **whole terminal app** started after the change (Windows Terminal,
VS Code, any IDE): closing a tab is not enough, since new tabs inherit the app's old copy. Check
with `echo $env:CLAUDE_CODE_PLUGIN_DIRS` before starting `claude`; or refresh one terminal by hand:

```powershell
$env:CLAUDE_CODE_PLUGIN_DIRS = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS','User')
```

### Checking it worked

Ask Claude anything with a long answer. If the reply wraps at about 85% of the terminal, the order
is right. If it runs the full width, prettier is not first.

## Known limit

inkstyle sizes tables for the full terminal width. Inside the 85% box their columns are squeezed
to fit, so a wide table's `│` column lines may come out shorter than its wrapped cells.

Rows Claude Code draws itself (a Bash or Read result, a tool group) are wrapped in the 85% box
but sized by Claude Code; if one of them still runs the full width, it needs redrawing in prettier
as the edit diff is.

The dim `● <mod>: ...` lines Claude Code prints when a mod loads, reloads or fails are drawn by
Claude Code itself, and no mod can restyle them. They only appear while mods are being developed
or something is wrong with one.
