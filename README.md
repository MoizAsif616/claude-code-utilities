# claude-code-utilities

Mods for Claude Code. Each mod has one job and works on its own: none imports, reads or calls
another. They are sorted by where they run:

| Folder | What goes there |
| --- | --- |
| `mods/cli` | Mods for the Claude Code CLI (the terminal) only |
| `mods/desktop` | Mods for the Claude Code desktop app only (none yet) |
| `mods/both` | Mods that work in both, with a behaviour for each |

| Mod | Runs in | Its job |
| --- | --- | --- |
| `mods/both/statusdeck` | CLI and desktop | Live stats: a status row under the prompt in the CLI, a status band above the prompt in the desktop app |
| `mods/cli/prettier` | CLI | The layout and colours of the whole chat: prompts, replies, code, tool rows, the spinner |
| `mods/cli/hark` | CLI | Voice input: speak your prompt, transcribed on your own computer |

The two kinds load differently:

- **CLI mods** are copied into `~/.claude/mods` and named in the `CLAUDE_CODE_PLUGIN_DIRS`
  environment variable, set in your shell's profile. Only a `claude` started from that shell sees it,
  so the desktop app never loads them.
- **Mods for both (and for the desktop)** are installed as plugins: the desktop app doesn't read your
  shell's profile, so `CLAUDE_CODE_PLUGIN_DIRS` can't reach it. `mods/both` is a plugin marketplace;
  install from it once and the mod loads in the CLI and the desktop app alike.

Restart Claude Code (and the desktop app) after installing.

## Install

### Windows (PowerShell)

```powershell
git clone https://github.com/MoizAsif616/claude-code-utilities.git
# CLI mods: copied to ~/.claude/mods and named in your PowerShell profile (terminal only)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\mods" | Out-Null
Copy-Item -Recurse -Force .\claude-code-utilities\mods\cli\* "$env:USERPROFILE\.claude\mods\"
Add-Content $PROFILE '$env:CLAUDE_CODE_PLUGIN_DIRS = "$env:USERPROFILE\.claude\mods\prettier;$env:USERPROFILE\.claude\mods\hark"'
# Mods for both: installed as plugins from the mods/both marketplace
claude plugin marketplace add .\claude-code-utilities\mods\both
claude plugin install statusdeck@claude-code-utilities --scope user
```

Open a new PowerShell window before starting `claude`, and check the variable:

```powershell
echo $env:CLAUDE_CODE_PLUGIN_DIRS   # must start with ...\mods\prettier
```

Don't set `CLAUDE_CODE_PLUGIN_DIRS` as a Windows user environment variable: every program sees
those, the desktop app included, so the CLI mods would load there too.

### Linux (Ubuntu)

```bash
git clone https://github.com/MoizAsif616/claude-code-utilities.git
mkdir -p ~/.claude/mods
cp -r claude-code-utilities/mods/cli/* ~/.claude/mods/
echo 'export CLAUDE_CODE_PLUGIN_DIRS="$HOME/.claude/mods/prettier:$HOME/.claude/mods/hark"' >> ~/.bashrc
claude plugin marketplace add ./claude-code-utilities/mods/both
claude plugin install statusdeck@claude-code-utilities --scope user
```

Open a new shell (or `source ~/.bashrc`) before starting `claude`.

### macOS

```bash
git clone https://github.com/MoizAsif616/claude-code-utilities.git
mkdir -p ~/.claude/mods
cp -R claude-code-utilities/mods/cli/* ~/.claude/mods/
echo 'export CLAUDE_CODE_PLUGIN_DIRS="$HOME/.claude/mods/prettier:$HOME/.claude/mods/hark"' >> ~/.zshrc
claude plugin marketplace add ./claude-code-utilities/mods/both
claude plugin install statusdeck@claude-code-utilities --scope user
```

Open a new shell (or `source ~/.zshrc`) before starting `claude`.

A plugin installed from a folder is read from that folder: keep the clone where it is, and an edit
there reaches Claude Code after `/reload-plugins`.

## Load order

The three mods never draw the same thing, so their order doesn't matter (`;`-separated on Windows,
`:` on Linux and macOS in `CLAUDE_CODE_PLUGIN_DIRS`). The install commands list prettier first.

The one row hark shares is the one above the prompt: statusdeck draws its panes chips there in the
CLI (only with the panes mod), and whichever of the two loads first shows when both have something
to draw. hark also doesn't affect prettier's times: it keeps each prompt as it was finally sent, so
the time under a prompt you sent while recording is right.

## statusdeck

One mod with two looks: a status row under the prompt in the CLI, and a status band above the prompt
in the desktop app. Each draws only where it belongs.

### In the CLI

The row under the prompt, with every colour in it:

- **Mode, model and effort** at the left. A click on the model or the effort opens Claude Code's
  picker for it.
- **Usage pills** at the right: the 5-hour and 7-day rate-limit windows and the context fill, each
  coloured from blue (little used) through green and amber to red (nearly full), with the time
  until a window resets.
- **Cache warmth:** `⚡` and a countdown while the prompt cache is warm, `❄` once it has gone cold.
- **While Claude works:** the turn's running time and live output tokens after the effort.
- **Always one line:** when the terminal is too narrow, pills drop in this order: 7d, ctx, 5h, then
  the cache. They come back as room returns.
- **Pane chips** above the prompt when the panes mod is installed.

### In the desktop app

A band right above the prompt, in the app's theme colours, so it reads in light and dark mode. The
bar under the prompt is left to the app: it draws a mod's content there only as plain text.

- **Clawd:** a small pixel mascot showing what the session is doing: idle, working, done (for 5 s),
  needs you, stopped, or asleep after 5 minutes idle.
- **Turn pill:** the elapsed time and output tokens while a turn runs.
- **Git pill:** the branch and the changed-file count, inside a git repository only.
- **Context gauge:** a small disc that fills in 10% steps, its colour changing at each step. Hover it
  for the tokens used out of the window size.
- **Cache timer:** how long the prompt cache stays warm, from green to red; a red `❄` when cold.
- **Context panel** (the `☰` at the right end, or `/statusdeck-context`): check or uncheck skills and
  MCP tools. After **Apply**, whatever is unchecked is hidden from Claude and refused if Claude calls
  it anyway. The desktop app's own `ccd_*` tools can't be turned off. Pending changes apply on their
  own at the next `/clear` or `/compact`.
- The time and tokens line under each answer is hidden: the turn pill shows the same.

The desktop band is adapted from the deskdeck mod; the 5-hour and 7-day pills are left out of it.

### Option

The cache lifetime (`1h` on a Claude subscription, `5m` with an API key) is a plugin option:
`/plugin configure statusdeck@claude-code-utilities` in a terminal session.

statusdeck doesn't draw the spinner; prettier does.

## prettier

The layout and colours of the chat. What it changes:

- **Your prompts:** a pill with a rounded purple border on the right, one space of padding on each
  side, at most 70% of the terminal wide, with the time you sent it under it. A long prompt shows
  its first 6 lines, then `▸ 14 more lines`. Beside the time, `14:32  ⧉` (same grey): a click on
  `⧉` copies that prompt's text and nothing else, and it reads a green `✓` for 3.5 seconds.
- **Replies and tool-call rows:** held to the left 85% of the terminal.
- **Colours in replies:** orange headings and bold, lavender links, purple list and quote markers,
  and tables framed in light orange lines, with orange headers, striped rows, a little padding in
  each cell, column lines that run the full height of a wrapped row, and no column wider than 30%
  of the reply.
- **Colours on tool-call rows:** a status dot (purple when done, light purple while running, red
  when it failed, grey when interrupted), the tool's name in purple and what it worked on in grey.
  The command or path is shown whole, never cut.
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
diffs and errors stay whole (there would be no way to reopen them), the Copy buttons are hidden, and a
folded prompt or message says `ctrl+o`. `ctrl+o` is Claude Code's own transcript view: it shows tool
calls, outputs and long prompts in full; press it again to go back.

### Commands

| Command | Settings (defaults) |
| --- | --- |
| `/prettier` | lists the commands; `on`, `off` (layout and colours together), `reset` (every setting back to its default) |
| `/prettier-prompt` | `width 70` (% of the terminal), `lines 6` (shown before folding), `time on` |
| `/prettier-response` | `width 85` (% of the terminal; also the most a code panel or red frame takes), `fold on` (fold runs of reads, searches and commands) |
| `/prettier-code` | `width 75` (% of the terminal, for diffs) |

Each command on its own lists its settings and what they do. Change one or several at once:
`/prettier-prompt width 60 lines 4`. Settings are kept across sessions. A wrong name or value says
what's allowed.

### Known limits

- Tool output and progress text that Claude Code draws itself run the full terminal width: Claude
  Code refuses a mod that puts its own drawing inside a fixed width.
- Times and tool lists only appear for prompts and replies made after the mod loaded, not for
  resumed sessions.
- The dim `● <mod>: ...` lines Claude Code prints when a mod loads, reloads or fails are Claude
  Code's own; no mod can restyle them.

More detail is in [`mods/cli/prettier/README.md`](mods/cli/prettier/README.md).

## hark

Voice input for the prompt. You speak, and the words appear in the input box as you talk. Speech
is turned into text by a model running on your own computer: no account, no API key, and your
voice never leaves the machine. The only network use is downloading a model once.

- **The row above the input:** while voice input is on, the model's name on the left and a red
  `● Record` button on the right. While recording: a `■ Stop` button, a timer and level bars that
  move with your voice and stay flat in silence.
- **Recording:** click `● Record` and talk; the text fills the input live, after anything you had
  already typed. Click `■ Stop` to keep the text and edit it, or press **Enter** to stop and send in
  one go. With nothing said, the input is left as it was.
- **Clean text:** "uh", "um", "er" and "hmm" are dropped; punctuation and capitals are kept.
- **Speech detection:** a small detector (Silero, 640 KB) tells your voice from silence and room
  noise, so background sound isn't transcribed. If it can't be loaded, hark goes by loudness.
- **Remembers on/off:** if voice input was on when you closed Claude Code, it loads again in the
  next session.
- **Nothing left running:** turning it off or closing Claude Code unloads the model from memory,
  and on Linux and macOS so does Claude Code crashing.

### Models

`/hark-models` opens a list of speech models with their languages, download size, RAM, speed and
accuracy. Pick one, confirm, and it downloads (in the background if you like, with a red `✕` to
cancel). Voice input switches to it as soon as it has loaded.

- **Only one model is kept on disk.** Once a new model has loaded, the previous one is deleted to
  free the space. A green `✓` marks the model in use.
- **Speed** shows the catalog's estimate until you have used a model, then the wait measured on
  your computer from `■ Stop` to the text appearing, for example `0.4 s`.
- All of them run on a CPU; no graphics card is needed:

| Model | Languages | Download | Notes |
| --- | --- | --- | --- |
| Moonshine Tiny / Base | English | 30 / 111 MB | Smallest and quickest; Base is a good first choice |
| Kroko Live | English | 57 MB | Words appear as you say them; no punctuation |
| Parakeet 110M | English | 108 MB | Very accurate for its size |
| Parakeet 0.6B v2 / v3 | English / 25 European | about 485 MB | Best accuracy that is still fast on a CPU |
| SenseVoice Small | Chinese, Cantonese, English, Japanese, Korean | 163 MB | For East Asian languages |
| Whisper Small, Large v3, Large v3 Turbo | 99 | 0.5 to 3 GB | Most languages; the large ones are slow on a CPU |
| Distil-Whisper Large | English | 1.5 GB | Near large-model accuracy, faster |

### Commands

| Command | What it does |
| --- | --- |
| `/hark` | Turns voice input on or off; `/hark on` and `/hark off` also work. With no model yet, it opens the list |
| `/hark-models` | Choose, download, switch or delete a speech model |

### What it needs

- **Python 3.9 or newer** on your `PATH` (`python3`, `python` or `py`). hark makes its own Python
  environment in `~/.claude/hark` and installs what it needs there, nothing system-wide. It uses
  [uv](https://docs.astral.sh/uv/) when installed; otherwise Python's own `venv`, which on
  Ubuntu/Debian needs `sudo apt install python3-venv`.
- **A microphone.** On Linux also PortAudio: `sudo apt install libportaudio2` (Fedora:
  `sudo dnf install portaudio`, Arch: `sudo pacman -S portaudio`). Windows and macOS have it built in.
- **Disk:** about 450 MB for the environment, plus the model you pick.

Everything hark downloads lives in `~/.claude/hark`. Delete that folder to remove it all.

## Update

Pull the latest changes, then copy the CLI mods again and update statusdeck:

```bash
cd claude-code-utilities && git pull
cp -R mods/cli/* ~/.claude/mods/
claude plugin update statusdeck@claude-code-utilities
```

On Windows, run `git pull` and repeat the `Copy-Item` line from the install section. The profile
line only needs adding once. In a running session, `/reload-plugins` picks up the new statusdeck.

## Notes

- The `types/` and `tests/` folders inside each mod are for development and aren't needed to run the mods.
- statusdeck (CLI and desktop app) and prettier are tested on Windows. The code has nothing Windows-specific, so they should work on Linux and macOS, but I haven't verified that.
- hark is tested on Linux (Ubuntu). Its code handles Windows and macOS paths, but it hasn't been tried there.
