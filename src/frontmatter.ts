/**
 * Minimal YAML frontmatter parsing for SKILL.md / command / agent files.
 * Uses js-yaml for the frontmatter block; unknown YAML features degrade to
 * the raw block text.
 */

import { load as parseYaml } from 'js-yaml'

export interface Frontmatter {
  /** Parsed metadata object (plain record) or undefined when absent. */
  metadata: Record<string, unknown> | undefined
  /** Body after the frontmatter block, trimmed of surrounding blank lines. */
  body: string
}

const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/** Split a markdown file into frontmatter metadata and body. */
export function parseFrontmatter(raw: string): Frontmatter {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return { metadata: undefined, body: raw.trim() }
  const [, yamlBlock, body] = match
  let metadata: Record<string, unknown> | undefined
  try {
    const parsed = parseYaml(yamlBlock ?? '')
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>
    } else {
      metadata = undefined
    }
  } catch {
    metadata = undefined
  }
  return { metadata, body: (body ?? '').trim() }
}

/** Read a string frontmatter field (accepts booleans/numbers as strings). */
export function fieldString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  return String(value)
}

/** Read a boolean-ish frontmatter field (true/false/yes/no/on/off/1/0). */
export function fieldBool(meta: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = meta?.[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(normalized)) return true
  if (['false', 'no', 'off', '0'].includes(normalized)) return false
  return undefined
}
