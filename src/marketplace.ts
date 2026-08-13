/**
 * Claude Code marketplace support: parse `.claude-plugin/marketplace.json`,
 * resolve plugin sources (relative path / github / url / git-subdir / npm /
 * archive), and stage plugins into a local cache directory.
 *
 * See docs/claude-code-plugin-spec.md §2 for the full format. This module
 * deliberately mirrors Claude Code's own layout:
 *
 *   <cacheDir>/marketplaces/<name>/          — marketplace repo copies
 *   <cacheDir>/plugins/<marketplace>/<plugin>/ — staged plugin copies
 *
 * v0.1 scope: relative-path, github, url and git-subdir sources are fully
 * supported; npm and archive sources are supported via external commands
 * (npm pack / unzip). Hooks are parsed but not executed.
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, cp } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** marketplace.json — see spec §2.2. */
export interface MarketplaceManifest {
  name: string
  owner?: { name?: string; email?: string; url?: string }
  plugins: PluginEntry[]
  metadata?: { description?: string; version?: string; pluginRoot?: string }
  description?: string
}

/** One plugin entry — see spec §2.3. */
export interface PluginEntry {
  name: string
  source: string | Record<string, unknown>
  displayName?: string
  description?: string
  strict?: boolean
  version?: string
  defaultEnabled?: boolean
}

export interface ResolvedPlugin {
  /** Marketplace name. */
  marketplace: string
  /** Plugin entry name. */
  plugin: string
  /** Absolute path of the staged plugin directory (has .claude-plugin/plugin.json or convention layout). */
  root: string
  /** Resolved version string. */
  version: string
}

export class MarketplaceError extends Error {}

function fail(message: string): never {
  throw new MarketplaceError(message)
}

/** Assert a relative plugin path stays inside the marketplace (no `..`). */
function assertSafeRelative(source: string): void {
  if (!source.startsWith('./')) {
    fail(`unsafe relative plugin source "${source}": must start with "./"`)
  }
  const parts = source.split(/[/\\]+/)
  if (parts.includes('..')) {
    fail(`unsafe relative plugin source "${source}": ".." is not allowed`)
  }
}

async function cloneRepo(url: string, ref: string | undefined, dest: string): Promise<void> {
  const args = ['clone', '--depth', '1']
  if (ref) args.push('--branch', ref)
  args.push(url, dest)
  try {
    await execFileAsync('git', args, { timeout: 120_000 })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    fail(`git clone failed for ${url}: ${detail}`)
  }
}

/** Resolve the marketplace manifest at a staged marketplace root. */
export async function loadMarketplace(root: string): Promise<MarketplaceManifest> {
  const manifestPath = join(root, '.claude-plugin', 'marketplace.json')
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch {
    fail(`no marketplace.json found at ${manifestPath}`)
  }
  try {
    return JSON.parse(raw) as MarketplaceManifest
  } catch (err) {
    fail(`marketplace.json at ${manifestPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export class MarketplaceStore {
  constructor(
    private readonly cacheDir: string,
    private readonly knownMarketplacesFile: string,
  ) {}

  private marketplaceDir(name: string): string {
    return join(this.cacheDir, 'marketplaces', name)
  }

  private pluginDir(marketplace: string, plugin: string): string {
    return join(this.cacheDir, 'plugins', marketplace, plugin)
  }

  /** Add a marketplace from a local path, GitHub `owner/repo[#ref]`, git URL, or a marketplace.json file path. */
  async addMarketplace(source: string, nameHint?: string): Promise<MarketplaceManifest> {
    let name = nameHint
    let manifest: MarketplaceManifest | undefined

    // Case: direct path to a marketplace.json file.
    if (source.endsWith('.json') && (isAbsolute(source) || source.startsWith('.'))) {
      const absolute = resolve(source)
      manifest = JSON.parse(await readFile(absolute, 'utf8')) as MarketplaceManifest
      name = manifest.name
      const target = this.marketplaceDir(name)
      await rm(target, { recursive: true, force: true })
      await mkdir(join(target, '.claude-plugin'), { recursive: true })
      await cp(absolute, join(target, '.claude-plugin', 'marketplace.json'))
      return manifest
    }

    // Case: local directory containing .claude-plugin/marketplace.json.
    if (isAbsolute(source) || source.startsWith('.')) {
      const absolute = resolve(source)
      manifest = await loadMarketplace(absolute)
      name = manifest.name
      const target = this.marketplaceDir(name)
      await rm(target, { recursive: true, force: true })
      await cp(absolute, target, { recursive: true })
      return manifest
    }

    // Case: GitHub shorthand owner/repo or owner/repo#ref.
    const githubMatch = /^([\w.-]+\/[\w.-]+)(?:#(.+))?$/.exec(source)
    let gitUrl: string | undefined
    let ref: string | undefined
    if (githubMatch) {
      gitUrl = `https://github.com/${githubMatch[1]}.git`
      ref = githubMatch[2]
    } else {
      gitUrl = source
    }

    // Clone to a temp dir, read the manifest for the real name, then move.
    const tmp = join(this.cacheDir, '.tmp-marketplace')
    await rm(tmp, { recursive: true, force: true })
    await mkdir(dirname(tmp), { recursive: true })
    await cloneRepo(gitUrl, ref, tmp)
    manifest = await loadMarketplace(tmp)
    name = manifest.name
    const target = this.marketplaceDir(name)
    await rm(target, { recursive: true, force: true })
    await cp(tmp, target, { recursive: true })
    await rm(tmp, { recursive: true, force: true })

    // Record in known marketplaces.
    const known: Record<string, { source: string }> = await this.readKnown()
    known[name] = { source }
    await writeJson(this.knownMarketplacesFile, known)
    return manifest
  }

  private async readKnown(): Promise<Record<string, { source: string }>> {
    try {
      return JSON.parse(await readFile(this.knownMarketplacesFile, 'utf8')) as Record<string, { source: string }>
    } catch {
      return {}
    }
  }

  async listMarketplaces(): Promise<Array<{ name: string; pluginCount: number }>> {
    const known = await this.readKnown()
    const result: Array<{ name: string; pluginCount: number }> = []
    for (const name of Object.keys(known)) {
      try {
        const manifest = await loadMarketplace(this.marketplaceDir(name))
        result.push({ name, pluginCount: manifest.plugins.length })
      } catch {
        result.push({ name, pluginCount: 0 })
      }
    }
    return result
  }

  async getMarketplace(name: string): Promise<MarketplaceManifest> {
    return loadMarketplace(this.marketplaceDir(name))
  }

  /**
   * Stage a plugin into the cache. Returns the plugin root plus resolved
   * version; the caller then scans/registers its components.
   */
  async installPlugin(marketplaceName: string, pluginName: string): Promise<ResolvedPlugin> {
    const manifest = await this.getMarketplace(marketplaceName)
    const entry = manifest.plugins.find((p) => p.name === pluginName)
    if (!entry) {
      fail(`plugin "${pluginName}" not found in marketplace "${marketplaceName}" (available: ${manifest.plugins.map((p) => p.name).join(', ')})`)
    }

    const marketRoot = this.marketplaceDir(marketplaceName)
    const pluginRootBase = entry.source
    const pluginRoot = resolve(
      marketRoot,
      typeof pluginRootBase === 'string'
        ? (assertSafeRelative(pluginRootBase), pluginRootBase.slice(2))
        : '.',
    )

    // Determine the fetch source directory.
    let fetchedDir: string
    if (typeof pluginRootBase === 'string') {
      // Relative path inside the marketplace copy.
      fetchedDir = pluginRoot
    } else {
      const src = pluginRootBase as Record<string, unknown>
      const kind = String(src.source ?? '')
      const tmp = join(this.cacheDir, '.tmp-plugin')
      await rm(tmp, { recursive: true, force: true })
      await mkdir(dirname(tmp), { recursive: true })
      switch (kind) {
        case 'github': {
          const repo = String(src.repo ?? '')
          if (!repo.includes('/')) fail(`github source requires "owner/repo", got "${repo}"`)
          await cloneRepo(`https://github.com/${repo}.git`, src.ref ? String(src.ref) : undefined, tmp)
          fetchedDir = tmp
          break
        }
        case 'url': {
          await cloneRepo(String(src.url ?? ''), src.ref ? String(src.ref) : undefined, tmp)
          fetchedDir = tmp
          break
        }
        case 'git-subdir': {
          await cloneRepo(String(src.url ?? ''), src.ref ? String(src.ref) : undefined, tmp)
          const subdir = String(src.path ?? '')
          fetchedDir = join(tmp, subdir)
          break
        }
        case 'npm': {
          const pkg = String(src.package ?? '')
          const version = src.version ? `@${String(src.version)}` : ''
          const tarball = join(this.cacheDir, '.npm-package.tgz')
          await execFileAsync('npm', ['pack', `${pkg}${version}`, '--pack-destination', this.cacheDir], { timeout: 120_000 })
          await execFileAsync('tar', ['xzf', tarball, '-C', tmp], { timeout: 60_000 })
          // npm pack extracts a single <name>-<version>/ directory.
          fetchedDir = tmp
          break
        }
        case 'archive': {
          const url = String(src.url ?? '')
          const zipPath = join(this.cacheDir, '.plugin-archive.zip')
          const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
          if (!res.ok) fail(`archive download failed: HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          await writeFile(zipPath, buf)
          await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', tmp], { timeout: 60_000 })
          fetchedDir = tmp
          break
        }
        default:
          fail(`unsupported plugin source kind "${kind}"`)
      }
    }

    // Stage: copy the fetched plugin into the cache.
    const target = this.pluginDir(marketplaceName, pluginName)
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await cp(fetchedDir, target, { recursive: true })
    await rm(join(this.cacheDir, '.tmp-plugin'), { recursive: true, force: true })

    const version = entry.version ?? 'unknown'
    return { marketplace: marketplaceName, plugin: pluginName, root: target, version }
  }

  async listPlugins(marketplaceName: string): Promise<PluginEntry[]> {
    const manifest = await this.getMarketplace(marketplaceName)
    return manifest.plugins
  }

  async pluginRoot(marketplace: string, plugin: string): Promise<string> {
    const dir = this.pluginDir(marketplace, plugin)
    return dir
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2))
}

import { writeFile } from 'node:fs/promises'

/** Resolve a plugin.json manifest path, or the plugin dir for convention layout. */
export async function findPluginManifest(pluginRoot: string): Promise<string | undefined> {
  const path = join(pluginRoot, '.claude-plugin', 'plugin.json')
  try {
    await readFile(path, 'utf8')
    return path
  } catch {
    return undefined
  }
}

export { sep }
