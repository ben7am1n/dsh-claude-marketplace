/**
 * Name handling for imported Claude Code components.
 *
 * dsh skill names must be kebab-case (`[a-z0-9]+(?:-[a-z0-9]+)*`), while
 * Claude Code names components as `<plugin>:<component>` (e.g. `my-plugin:review`)
 * or with nested paths (`agents/review/security.md` → `my-plugin:review:security`).
 * We convert to a kebab-case dsh name with a configurable prefix to avoid
 * collisions with native dsh skills.
 */

/** Collapse any non-alphanumeric run to a single hyphen, lowercase. */
export function toKebab(value: string): string {
  const kebab = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return kebab || 'unnamed'
}

/**
 * Build the dsh skill name for an imported component.
 * `<plugin>:<component>` → `<prefix>-<plugin>-<component>`.
 */
export function dshSkillName(prefix: string, plugin: string, component: string): string {
  return toKebab(`${prefix}-${plugin}-${component}`)
}

/** Human label shown in tool output (keeps the original names). */
export function ccLabel(plugin: string, component: string): string {
  return `${plugin}:${component}`
}
