# claude-code-utilities

Mods for Claude Code.

- `mods/statusdeck` - status row under the prompt (mode, model, effort, 5h/7d/context usage, cache warmth) plus a purple progress bar
- `mods/inkstyle` - reply styling: orange emphasis, purple structure

## Install (Windows or Ubuntu)

```bash
mkdir -p ~/.claude/mods
cp -r mods/* ~/.claude/mods/
```

Restart Claude Code afterwards. On Windows the target is `%USERPROFILE%\.claude\mods\`.
