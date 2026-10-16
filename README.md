# claude-code-utilities

Mods for Claude Code. Each mod has one job and works on its own: none imports, reads or calls
another.

| Mod | Its job |
| --- | --- |
| `mods/statusdeck` | The status row under the prompt: live stats and their colours |
| `mods/inkstyle` | Colours inside Claude's replies and on tool-call rows |
| `mods/prettier` | The layout of the whole chat: prompts, replies, code, tool rows, the spinner |

Copy the mods into `~/.claude/mods`, then point Claude Code at them with the `CLAUDE_CODE_PLUGIN_DIRS`
environment variable, **prettier first** (see [Load order](#load-order-prettier-goes-first)).
Restart Claude Code after installing.

## Install

### Windows (PowerShell)

```powershell
git clone https://github.com/MoizAsif616/claude-code-utilities.git
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\mods" | Out-Null
Copy-Item -Recurse -Force .\claude-code-utilities\mods\* "$env:USERPROFILE\.claude\mods\"
[Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS',
  "$env:USERPROFILE\.claude\mods\prettier;$env:USERPROFILE\.claude\mods\statusdeck;$env:USERPROFILE\.claude\mods\inkstyle",
  'User')
```

Then **quit and reopen your whole terminal app** (Windows Terminal, VS Code, any IDE), not just the
tab: a new tab inherits the app's old copy of the environment and won't see the variable. Check it
before starting `claude`:

```powershell
echo $env:CLAUDE_CODE_PLUGIN_DIRS   # must start with ...\mods\prettier
```

Or refresh a single terminal by hand:

```powershell
$env:CLAUDE_CODE_PLUGIN_DIRS = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS','User')
```

### Linux (Ubuntu)

```bash
git clone https://github.com/MoizAsif616/claude-code-utilities.git
mkdir -p ~/.claude/mods
cp -r claude-code-utilities/mods/* ~/.claude/mods/
echo 'export CLAUDE_CODE_PLUGIN_DIRS="$HOME/.claude/mods/prettier:$HOME/.claude/mods/statusdeck:$HOME/.claude/mods/inkstyle"' >> ~/.bashrc
```

Open a new shell (or `source ~/.bashrc`) before starting `claude`.

### macOS

```bash
git clone https://github.com/MoizAsif616/claude-code-utilities.git
mkdir -p ~/.claude/mods
cp -R claude-code-utilities/mods/* ~/.claude/mods/
echo 'export CLAUDE_CODE_PLUGIN_DIRS="$HOME/.claude/mods/prettier:$HOME/.claude/mods/statusdeck:$HOME/.claude/mods/inkstyle"' >> ~/.zshrc
```

Open a new shell (or `source ~/.zshrc`) before starting `claude`.

## Load order: prettier goes first

**prettier must be listed before inkstyle** in `CLAUDE_CODE_PLUGIN_DIRS` (`;`-separated on Windows,
`:` on Linux and macOS). The install commands above list it first.

Mods hook the same drawing in a chain: the first one loaded is the outermost, and it reaches the
ones under it by handing the drawing on. prettier only *wraps* what is under it. inkstyle draws
every reply and tool-call row itself (to colour them) and hands nothing on, so a mod loaded after
inkstyle is never reached for those rows. Loaded first, prettier holds inkstyle's coloured replies
and rows to 85% of the terminal; loaded after, they run the full width.

statusdeck's place in the list doesn't matter: it and prettier never draw the same thing.

In the wrong order nothing breaks; replies just go back to full width. Claude Code doesn't
document the order mods load in; listing prettier first in this variable is what works. To check:
ask Claude something with a long answer. If the reply wraps at about 85% of the terminal, the order
is right.

## statusdeck

The row under the prompt, with every colour in it:

- **Mode, model and effort** at the left. A click on the model or the effort opens Claude Code's
  picker for it.
- **Usage pills** at the right: the 5-hour and 7-day rate-limit windows and the context fill, each
  coloured from blue (little used) through green and amber to red (nearly full), with the time
  until a window resets.
- **Cache warmth:** `⚡` and a countdown while the prompt cache is warm, `❄` once it has gone cold.
  The cache lifetime (`1h` on a Claude subscription, `5m` with an API key) is a plugin option.
- **While Claude works:** the turn's running time and live output tokens after the effort.
- **Pane chips** above the prompt when the panes mod is installed.

statusdeck has no commands of its own. It doesn't draw the spinner; prettier does.

## inkstyle

Colours only, inside Claude's replies and on tool-call rows:

- **Replies:** orange headings and bold, lavender links, purple list and quote markers, and tables
  with orange headers and striped rows.
- **Tool-call rows:** a status dot (purple when done, light purple while running, red when it
  failed, grey when interrupted), the tool's name in purple and what it worked on in grey. The
  command or path is shown whole, never cut.

| Command | What it does |
| --- | --- |
| `/inkstyle` | `on`, `off`, or no argument to switch between them |

## prettier

The layout of the chat. What it changes:

- **Your prompts:** a pill with a rounded purple border on the right, one space of padding on the
  left, at most 70% of the terminal wide, with the time you sent it under it. A long prompt shows
  its first 6 lines, then `▸ 14 more lines`.
- **Replies and tool-call rows:** held to the left 85% of the terminal (needs the
  [load order](#load-order-prettier-goes-first)).
- **Code blocks in replies:** each fenced block is a charcoal panel with a thin violet rounded
  border. Its top row holds the language on a lighter chip at the left (`python`, or `code` when
  unlabeled) and `⧉ Copy` at the right, which copies only the code and reads `Copied!` for 3.5
  seconds. A panel is as wide as its longest line, never wider than the reply.
- **Edits:** `+12 −3` (green and red) after an edit's row. While a reply is being written each
  diff shows whole at 75% of the terminal; once it is done, each edited or created file is one row,
  `▸ Edit hooks/app.ts +12 −3`, that opens to its diff on a click.
- **Reads, searches and commands:** a run of them folds to one row, `▸ Ran 2 commands · 1.2s`. A
  click opens it: each call on a filled block with the whole command and its output (up to 40
  lines). A click on any block, or on the row, closes it.
- **Failures:** a failed tool's error in a red frame, `✗ Bash failed`, as wide as the error and no
  wider than the reply. Once the reply is done the call is one row, `▸ Edit app.ts · ✗ failed`
  (`✗ failed` in red), that opens to its frame on a click. Declining a permission prompt is not a
  failure.
- **Rows you didn't type:** background tasks finishing and messages from other agents, sessions or
  channels show as a quiet card on the left (`⚙ Background task · completed · 2m 2s`), not as your
  pill.
- **End of a reply:** `39s · ▸ 2 tools`, how long it took (dim) and how many tools it used (purple).
  A click on the count lists each call: `✓ Bash npm test · 1.2s`.
- **Spinner:** drawn whole by prettier, a purple animated `⠋` and Claude Code's word, or the tool
  running now: `⠋ ▸ running Bash…`.

### Opening folded rows

Everything compact toggles on a click: `▸` is closed, `▾` is open. **Clicks only reach mods in Claude
Code's fullscreen (alternate-screen) layout.** On the normal screen these rows stay compact, edit
diffs and errors stay whole (there would be no way to reopen them), the Copy button is hidden, and a
folded prompt or message says `ctrl+o`. `ctrl+o` is Claude Code's own transcript view: it shows tool
calls, outputs and long prompts in full; press it again to go back.

### Commands

| Command | Settings (defaults) |
| --- | --- |
| `/prettier` | lists the commands; `on`, `off`, `reset` (every setting back to its default) |
| `/prettier-prompt` | `width 70` (% of the terminal), `lines 6` (shown before folding), `time on` |
| `/prettier-response` | `width 85` (% of the terminal; also the most a code panel or red frame takes), `fold on` (fold runs of reads, searches and commands) |
| `/prettier-code` | `width 75` (% of the terminal, for diffs) |

Each command on its own lists its settings and what they do. Change one or several at once:
`/prettier-prompt width 60 lines 4`. Settings are kept across sessions. A wrong name or value says
what's allowed.

### Known limits

- Tool output and progress text that Claude Code draws itself run the full terminal width: Claude
  Code refuses a mod that puts its own drawing inside a fixed width.
- inkstyle sizes tables for the full terminal width; inside the 85% box their columns are squeezed,
  so a wide table's `│` lines may come out a little short.
- Times and tool lists only appear for prompts and replies made after the mod loaded, not for
  resumed sessions.
- The dim `● <mod>: ...` lines Claude Code prints when a mod loads, reloads or fails are Claude
  Code's own; no mod can restyle them.

More detail is in [`mods/prettier/README.md`](mods/prettier/README.md).

## Update

Pull the latest changes and copy the mods again:

```bash
cd claude-code-utilities && git pull
cp -R mods/* ~/.claude/mods/
```

On Windows, run `git pull` and repeat the `Copy-Item` line from the install section. The
environment variable only needs setting once.

## Notes

- The `types/` and `tests/` folders inside each mod are for development and aren't needed to run the mods.
- Tested on Windows. The code has nothing Windows-specific, so it should work on Linux and macOS, but I haven't verified that.
