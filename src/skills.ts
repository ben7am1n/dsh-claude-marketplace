/**
 * Scanning and registration of Claude Code components (skills, commands,
 * agents) as native dsh skills.
 *
 * Sources:
 * - project local: `<project>/.claude/skills/<name>/SKILL.md`,
 *   `.claude/commands/<name>.md`, `.claude/agents` (recursive .md files)
 * - installed plugin: `<pluginDir>/skills/<name>/SKILL.md` (or a root
 *   SKILL.md), `<pluginDir>/commands/*.md`, `<pluginDir>/agents` (recursive)
 *
 * Every component becomes a dsh skill named `<prefix>-<plugin>-<component>`
 * (kebab-case, per dsh's skill name contract) so imported components can
 * never collide with native dsh skills.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseFrontmatter, fieldString } from './frontmatter.ts'
import { dshSkillName } from './names.ts'

/** One component ready to be registered as a dsh skill. */
export interface SkillInput {
  /** Kebab-case dsh skill name. */
  name: string
  /** Short routing description. */
  description: string
  /** Optional trigger guidance. */
  whenToUse?: string
  /** Skill instruction body. */
  content: string
  /** Absolute path for relative resource resolution. */
  resourcePath: string
  /** Human label, e.g. `my-plugin:review`. */
  label: string
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Recursively collect `.md` files under a directory (bounded depth). */
async function collectMarkdown(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  if (!(await isDirectory(dir))) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...await collectMarkdown(join(dir, entry.name), depth + 1))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

/** Build a SkillInput from a component markdown file. */
export async function buildSkill(
  prefix: string,
  plugin: string,
  component: string,
  filePath: string,
  kind: 'skill' | 'command' | 'agent',
): Promise<SkillInput> {
  const raw = await readFile(filePath, 'utf8')
  const { metadata, body } = parseFrontmatter(raw)
  const displayName = fieldString(metadata, 'name') ?? component
  const description = fieldString(metadata, 'description')
    ?? (kind === 'command' ? `Claude Code command "${displayName}" (from plugin ${plugin})` : `Claude Code ${kind} "${displayName}" (from plugin ${plugin})`)
  const whenToUse = fieldString(metadata, 'when_to_use')
  const header = kind === 'agent'
    ? `# Agent: ${displayName}\n\nThis is a Claude Code subagent definition. Delegate specialized work to a subagent using this prompt when the task matches its description.\n\n`
    : ''
  const content = `${header}${body}`
  return {
    name: dshSkillName(prefix, plugin, component),
    description,
    whenToUse,
    content,
    resourcePath: filePath,
    label: `${plugin}:${component}`,
  }
}

/** Scan a plugin directory (or project `.claude` dir) for components. */
export async function scanComponents(
  prefix: string,
  plugin: string,
  root: string,
): Promise<SkillInput[]> {
  const results: SkillInput[] = []

  // skills/ — <name>/SKILL.md (or root SKILL.md)
  const skillsDir = join(root, 'skills')
  if (await isDirectory(skillsDir)) {
    for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillFile = join(skillsDir, entry.name, 'SKILL.md')
        if (await fileExists(skillFile)) {
          results.push(await buildSkill(prefix, plugin, entry.name, skillFile, 'skill'))
        }
      }
    }
  }
  const rootSkill = join(root, 'SKILL.md')
  if (await fileExists(rootSkill)) {
    results.push(await buildSkill(prefix, plugin, 'skill', rootSkill, 'skill'))
  }

  // commands/ — flat *.md
  const commandsDir = join(root, 'commands')
  if (await isDirectory(commandsDir)) {
    for (const file of await collectMarkdown(commandsDir, 1)) {
      const name = file.slice(0, -3).split('/').pop() ?? 'command'
      results.push(await buildSkill(prefix, plugin, name, file, 'command'))
    }
  }

  // agents/ — **/*.md
  const agentsDir = join(root, 'agents')
  if (await isDirectory(agentsDir)) {
    for (const file of await collectMarkdown(agentsDir)) {
      const rel = relative(agentsDir, file).replace(/\.md$/, '')
      const name = rel.replace(/[\\/]+/g, ':')
      results.push(await buildSkill(prefix, plugin, name, file, 'agent'))
    }
  }

  return results
}

/** Scan a project's local `.claude` directory (no plugin context). */
export async function scanProjectClaude(prefix: string, projectRoot: string): Promise<SkillInput[]> {
  const results: SkillInput[] = []
  const claudeDir = join(projectRoot, '.claude')

  const skillsDir = join(claudeDir, 'skills')
  if (await isDirectory(skillsDir)) {
    for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillFile = join(skillsDir, entry.name, 'SKILL.md')
        if (await fileExists(skillFile)) {
          results.push(await buildSkill(prefix, 'local', entry.name, skillFile, 'skill'))
        }
      }
    }
  }

  const commandsDir = join(claudeDir, 'commands')
  if (await isDirectory(commandsDir)) {
    for (const file of await collectMarkdown(commandsDir, 1)) {
      const name = file.slice(0, -3).split('/').pop() ?? 'command'
      results.push(await buildSkill(prefix, 'local', name, file, 'command'))
    }
  }

  const agentsDir = join(claudeDir, 'agents')
  if (await isDirectory(agentsDir)) {
    for (const file of await collectMarkdown(agentsDir)) {
      const rel = relative(agentsDir, file).replace(/\.md$/, '')
      const name = rel.replace(/[\\/]+/g, ':')
      results.push(await buildSkill(prefix, 'local', name, file, 'agent'))
    }
  }

  return results
}
