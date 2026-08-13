/**
 * dsh-claude-marketplace
 *
 * Claude Code compatibility layer for DeepSeek Harness. Registers `cc_*`
 * tools that load Claude Code components (skills, commands, agents) and
 * install plugins from Claude Code marketplaces as native dsh skills:
 *
 * - `cc_scan` — scan the project's `.claude` directory and installed plugins,
 *   registering every component as a dsh skill (prefix `cc-` by default).
 * - `cc_marketplace_add` / `cc_marketplace_list` — manage marketplaces.
 * - `cc_plugin_install` / `cc_plugin_list` — install plugins and register
 *   their components.
 *
 * v0.1 loads skills/commands/agents only. Hooks are parsed but never
 * executed; MCP/LSP servers and monitors are not loaded yet (see README).
 *
 * @module dsh-claude-marketplace
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SkillResourceBase } from '@deepseek-ai/dsh-skill'
// Type-only: makes exec.agent (and its session/cwd) visible.
import type {} from '@deepseek-ai/dsh-agent'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { scanComponents, scanProjectClaude, type SkillInput } from './skills.ts'
import { MarketplaceStore } from './marketplace.ts'

export const name = 'claude-marketplace'
export const inject = ['tools', 'skills']

/** Plugin configuration. */
export interface Config {
  /** Cache root for marketplaces and installed plugins (default ~/.dsh/claude-plugins). */
  cacheDir?: string
  /** Kebab-case prefix for imported skill names (default `cc`). */
  skillPrefix?: string
}

export const Config: Schema<Config> = Schema.object({
  cacheDir: Schema.string(),
  skillPrefix: Schema.string().default('cc'),
})

function defaultCacheDir(): string {
  return join(homedir(), '.dsh', 'claude-plugins')
}

/** Register a set of imported components as dsh skills. */
function registerSkills(ctx: Context, prefix: string, inputs: SkillInput[]): Array<{ name: string; label: string }> {
  const registered: Array<{ name: string; label: string }> = []
  for (const input of inputs) {
    const resourceBase: SkillResourceBase = { kind: 'directory', path: dirname(input.resourcePath) }
    ctx.effect(() => ctx.skills.register({
      name: input.name,
      description: input.description,
      whenToUse: input.whenToUse,
      content: input.content,
      source: 'custom',
      resourceBase,
    }), `claude-marketplace: skill ${input.name}`)
    registered.push({ name: input.name, label: input.label })
  }
  return registered
}

export function apply(ctx: Context, config: Config) {
  const cacheDir = config.cacheDir ? resolveHome(config.cacheDir) : defaultCacheDir()
  const prefix = config.skillPrefix || 'cc'
  const store = new MarketplaceStore(cacheDir, join(cacheDir, 'known-marketplaces.json'))

  ctx.tools.register(defineTool({
    name: 'cc_scan',
    description: `Scan the project's .claude directory (skills/, commands/, agents/) plus every installed Claude Code plugin, and register each component as a dsh skill named "${prefix}-<plugin>-<component>". Returns the list of registered skills. Run after adding components or installing plugins to refresh the catalog.`,
    parameters: {
      path: { type: 'string', description: 'Project root to scan for .claude (defaults to the calling agent workspace)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          registered: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
          total: { type: 'number' },
          scannedRoots: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
      const projectRoot = args.path ? resolveHome(args.path) : cwd
      const inputs: SkillInput[] = []
      const scannedRoots: string[] = []

      // Project-local .claude directory.
      inputs.push(...await scanProjectClaude(prefix, projectRoot))
      scannedRoots.push(join(projectRoot, '.claude'))

      // Installed plugins.
      for (const mp of await store.listMarketplaces()) {
        for (const plugin of await store.listPlugins(mp.name)) {
          const root = await store.pluginRoot(mp.name, plugin.name)
          inputs.push(...await scanComponents(prefix, plugin.name, root))
          scannedRoots.push(root)
        }
      }

      const registered = registerSkills(ctx, prefix, inputs)
      return { registered, total: registered.length, scannedRoots }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cc_marketplace_add',
    description: `Register a Claude Code plugin marketplace. Accepts: a local directory path containing .claude-plugin/marketplace.json, a path to a marketplace.json file, GitHub shorthand "owner/repo" or "owner/repo#ref", or any git clone URL. Returns the marketplace name and its plugins.`,
    parameters: {
      source: { type: 'string', required: true, description: 'Local path, GitHub owner/repo[#ref], or git URL' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          plugins: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const manifest = await store.addMarketplace(args.source)
      return {
        name: manifest.name,
        plugins: manifest.plugins.map((p) => p.name),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cc_marketplace_list',
    description: 'List registered Claude Code marketplaces and the plugins each offers.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          marketplaces: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                plugins: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const marketplaces = []
      for (const mp of await store.listMarketplaces()) {
        const plugins = await store.listPlugins(mp.name)
        marketplaces.push({ name: mp.name, plugins: plugins.map((p) => p.name) })
      }
      return { marketplaces }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cc_plugin_install',
    description: `Install a plugin from a registered marketplace into the local cache and register its skills/commands/agents as dsh skills. Returns the installed components. Then run cc_scan if other installed plugins should be re-scanned.`,
    parameters: {
      plugin: { type: 'string', required: true, description: 'Plugin name as listed by the marketplace' },
      marketplace: { type: 'string', required: true, description: 'Marketplace name (see cc_marketplace_list)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          plugin: { type: 'string' },
          marketplace: { type: 'string' },
          version: { type: 'string' },
          root: { type: 'string' },
          registered: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const resolved = await store.installPlugin(args.marketplace, args.plugin)
      const inputs = await scanComponents(prefix, resolved.plugin, resolved.root)
      const registered = registerSkills(ctx, prefix, inputs)
      return {
        plugin: resolved.plugin,
        marketplace: resolved.marketplace,
        version: resolved.version,
        root: resolved.root,
        registered,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cc_plugin_list',
    description: 'List installed Claude Code plugins and their registered components.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          plugins: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                marketplace: { type: 'string' },
                plugin: { type: 'string' },
                root: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const plugins = []
      for (const mp of await store.listMarketplaces()) {
        for (const plugin of await store.listPlugins(mp.name)) {
          plugins.push({
            marketplace: mp.name,
            plugin: plugin.name,
            root: await store.pluginRoot(mp.name, plugin.name),
          })
        }
      }
      return { plugins }
    },
  }))
}

/** Expand a leading `~` to the home directory. */
function resolveHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}
