# dsh-claude-marketplace

Claude Code compatibility layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): load Claude Code skills, commands and agents — from a project's `.claude` directory or from Claude Code **marketplaces** — as native dsh skills.

This is the ecosystem bridge: install any Claude Code plugin once and its components become callable dsh skills (prefixed `cc-`), reusing the huge Claude Code plugin/skills ecosystem inside DeepSeek Harness.

## Install

```sh
dsh plugin --profile <name> add dsh-claude-marketplace
```

## Usage

Ask the model to use the `cc_*` tools, or drive them directly:

| Tool | Purpose |
|---|---|
| `cc_scan` | Scan `<project>/.claude` + installed plugins; register every component as a dsh skill |
| `cc_marketplace_add` | Register a marketplace (local path, `owner/repo[#ref]`, or git URL) |
| `cc_marketplace_list` | List registered marketplaces and their plugins |
| `cc_plugin_install` | Install a plugin and register its skills/commands/agents |
| `cc_plugin_list` | List installed plugins |

Example flow:

```
cc_marketplace_add("anthropics/claude-code")
cc_marketplace_list()
cc_plugin_install(plugin="commit-commands", marketplace="claude-code-plugins")
cc_scan()
```

Imported components are named `cc-<plugin>-<component>` (kebab-case, matching dsh's skill name contract), so they can never collide with native dsh skills. Original names are preserved in the `label` field (`my-plugin:review`).

## What is supported (v0.1)

- **Skills** — `skills/<name>/SKILL.md`, plugin-root `SKILL.md`
- **Commands** — `commands/*.md` (flat, loaded as skills)
- **Agents** — `agents/**/*.md` (loaded as skills with a delegation header)
- **Marketplaces** — `.claude-plugin/marketplace.json` with sources: relative path, `github`, `url`, `git-subdir`, `npm`, `archive`
- **Local `.claude`** — project-level skills/commands/agents (project trust)

### Not yet (v0.2+)

- **Hooks** — parsed but not executed (security: hooks are arbitrary code; an opt-in policy is planned)
- **MCP / LSP servers** — use dsh's native MCP client instead
- **Themes / monitors / workflows / output styles**
- `allowed-tools`, `model`, `effort` frontmatter semantics (documented, ignored for now)
- Auto-refresh of the skill catalog on file changes (run `cc_scan` manually)

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `cacheDir` | `~/.dsh/claude-plugins` | Cache root for marketplaces and installed plugins |
| `skillPrefix` | `cc` | Prefix for imported dsh skill names |

## Security

Installed plugins are copied into the cache (never referenced in place). Hooks are **not** executed in v0.1. Path traversal in marketplace relative sources is rejected. Review plugin sources before installing, exactly as you would for Claude Code itself.

## License

MIT
