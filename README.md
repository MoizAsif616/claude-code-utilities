# claude-code-utilities

Mods for Claude Code.

| Mod | What it does |
| --- | --- |
| `mods/statusdeck` | Status row under the prompt (mode, model, effort, 5h / 7d / context usage, cache warmth) plus a purple progress bar while working |
| `mods/inkstyle` | Reply styling: orange emphasis, purple structure |

Mods load from the `mods` folder inside your Claude Code config directory (`~/.claude/mods`). Restart Claude Code after installing.

## Install

### Windows (PowerShell)

```powershell
git clone https://github.com/MoizAsif616/claude-code-utilities.git
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\mods" | Out-Null
Copy-Item -Recurse -Force .\claude-code-utilities\mods\* "$env:USERPROFILE\.claude\mods\"
```

### Linux (Ubuntu)

```bash
git clone https://github.com/MoizAsif616/claude-code-utilities.git
mkdir -p ~/.claude/mods
cp -r claude-code-utilities/mods/* ~/.claude/mods/
```

### macOS

```bash
git clone https://github.com/MoizAsif616/claude-code-utilities.git
mkdir -p ~/.claude/mods
cp -R claude-code-utilities/mods/* ~/.claude/mods/
```

## Update

Pull the latest changes and copy the mods again:

```bash
cd claude-code-utilities && git pull
cp -R mods/* ~/.claude/mods/
```

On Windows, run `git pull` and repeat the `Copy-Item` line from the install section.

## Notes

- The `types/` and `tests/` folders inside each mod are for development and aren't needed to run the mods.
- Tested on Windows. The code has nothing Windows-specific, so it should work on Linux and macOS, but I haven't verified that.
