# claude-code-utilities

Mods for Claude Code.

| Mod | What it does |
| --- | --- |
| `mods/statusdeck` | Status row under the prompt (mode, model, effort, 5h / 7d / context usage, cache warmth) plus a purple progress bar while working |
| `mods/inkstyle` | Reply styling: orange emphasis, purple structure |
| `mods/prettier` | Chat layout: your prompts in a purple pill on the right, replies and tool output held to the left 85%, diffs to 75%, folded rows that open on a click |

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

**prettier must be listed before every other mod** in `CLAUDE_CODE_PLUGIN_DIRS` (`;`-separated on
Windows, `:` on Linux and macOS), as the install commands above do.

Mods hook the same drawing in a chain: the first one loaded is the outermost, and it reaches the
ones under it by handing the drawing on. prettier only *wraps* what is under it:

- **Replies and tool rows:** inkstyle draws every reply and tool row itself (to colour them) and
  hands nothing on. A mod loaded after inkstyle is never reached for those, so prettier's 85% width
  would never apply. Loaded first, prettier holds inkstyle's coloured rows to 85%.
- **Spinner:** statusdeck draws the spinner from the words it is handed. prettier changes those to
  `▸ running Bash…` and hands them on, so it has to sit above statusdeck.

The mods don't import or read each other: each works on its own, and only the order connects them.
In the wrong order nothing breaks; replies go back to full width and the spinner to its usual words.

Claude Code doesn't document the order mods load in; listing prettier first in this variable is what
works here. To check: ask Claude something with a long answer. If the reply wraps at about 85% of the
terminal, the order is right; if it runs the full width, prettier is not first.

## prettier

What it changes in the terminal transcript:

- **Your prompts:** a pill with a rounded purple border on the right, one space of padding on the
  left, at most 70% of the terminal wide, with the time you sent it under it. A long prompt shows
  its first 6 lines, then `▸ 14 more lines`.
- **Replies and tool output:** held to the left 85% of the terminal.
- **Edit diffs:** held to 75%. While a reply is being written each diff shows whole; once it is done,
  each edited or created file is one row, `▸ Edit hooks/app.ts +12 −3` (file name in purple, `+n`
  green, `−n` red), that opens to its diff on a click.
- **Reads and searches:** a run of them folds to one row, `▸ Read 3 files, searched 2 patterns · 1.2s`,
  that opens to each call on a click.
- **Failures:** a failed tool's error in a red frame, `✗ Bash failed`. Declining a permission prompt
  is not a failure and keeps Claude Code's own drawing.
- **Rows you didn't type:** background tasks finishing and messages from other agents, sessions or
  channels show as a quiet card on the left (`⚙ Background task · completed · 2m 2s`), not as your
  pill.
- **End of a reply:** `39s · ▸ 2 tools`, how long it took (dim) and how many tools it used (purple).
  A click on the count lists each call: `✓ Bash npm test · 1.2s`.
- **Spinner:** names the running tool, `▸ running Bash…`.

### Opening folded rows

Everything compact toggles on a click: `▸` is closed, `▾` is open. **Clicks only reach mods in Claude
Code's fullscreen (alternate-screen) layout.** On the normal screen these rows stay compact, edit
diffs stay whole (there would be no way to reopen them), and a folded prompt or message says
`ctrl+o`. `ctrl+o` is Claude Code's own transcript view: it shows tool calls, outputs and long
prompts in full; press it again to go back. Long Bash and Read output is folded by Claude Code
itself (`… +42 lines (ctrl+o to expand)`), and prettier leaves that alone.

### Commands

| Command | Settings (defaults) |
| --- | --- |
| `/prettier` | lists the commands; `on`, `off`, `reset` (every setting back to its default) |
| `/prettier-prompt` | `width 70` (% of the terminal), `lines 6` (shown before folding), `time on` |
| `/prettier-response` | `width 85` (% of the terminal), `fold on` (fold runs of reads and searches) |
| `/prettier-code` | `width 75` (% of the terminal, for diffs) |

Each command on its own lists its settings and what they do. Change one or several at once:
`/prettier-prompt width 60 lines 4`. Settings are kept across sessions. A wrong name or value says
what's allowed.

### Known limits

- inkstyle sizes tables for the full terminal width; inside the 85% box their columns are squeezed,
  so a wide table's `│` lines may come out a little short.
- Times and tool lists only appear for prompts and replies made after the mod loaded, not for
  resumed sessions.
- Folding covers runs of reads and searches, which Claude Code groups itself; each command or edit
  is its own row.
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
