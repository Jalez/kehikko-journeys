import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { skillPath, skillTextIssue, type ModuleSkill } from 'kehikot-module-protocol'
import { originFor, preferred } from 'kehikot-module-protocol/serve'

import { PREFERRED_PORT } from './manifest.ts'

/**
 * The Claude Code skill this module offers (protocol 2.5.0, `declares.skills`): `/journey`, which
 * designs a journey as a tree of steps with the person and writes it here.
 *
 * Kept as ONE file, `plugin/skills/journey/SKILL.md`, a template: `{{origin}}` becomes the origin
 * this process really serves on (`serveFrom`, from the port Vite bound) and `{{version}}` the
 * skill's version. A host shows the text and installs it on a person's press; this module installs
 * nothing. The version is the first twelve hex digits of the sha256 of the text with the origin
 * filled in and `{{version}}` not, so a changed template or a moved port makes an installed copy
 * outdated. The same scheme as the Claude and Factory modules.
 */

export const PLUGIN_DIR = join(import.meta.dirname, 'plugin')
export const ORIGIN_SLOT = '{{origin}}'
export const VERSION_SLOT = '{{version}}'

const OFFERED = [
  {
    name: 'journey',
    summary:
      'Type /journey to design a journey as a tree of small ordered steps, with clear questions only where they change it, then write its steps, parts and issues.',
  },
] as const

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

let served = originFor(preferred(PREFERRED_PORT))

/** Say the origin this process is really on (`http://127.0.0.1:<port>`). Refuses anything else. */
export function serveFrom(origin: string): void {
  if (!LOOPBACK_ORIGIN.test(origin)) throw new Error(`not a loopback origin: ${JSON.stringify(origin)}`)
  served = origin
}

export const servedOrigin = (): string => served

/** A skill's SKILL.md as kept here, unfilled. */
export function skillTemplate(name: string): string | null {
  if (!OFFERED.some((one) => one.name === name)) return null
  return readFileSync(join(PLUGIN_DIR, 'skills', name, 'SKILL.md'), 'utf8')
}

const sha12 = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** A template filled in for one origin: the text as served, and its version. */
export function fill(template: string, origin: string): { text: string; version: string } {
  const placed = template.replaceAll(ORIGIN_SLOT, origin)
  const version = sha12(placed)
  return { text: placed.replaceAll(VERSION_SLOT, version), version }
}

/** A skill's SKILL.md as served, for `origin` (the one this process is on, by default). */
export function skillText(name: string, origin = served): string | null {
  const template = skillTemplate(name)
  return template === null ? null : fill(template, origin).text
}

/** What the manifest declares: name, summary and version of each, for `origin`. */
export function skillDeclarations(origin = served): ModuleSkill[] {
  return OFFERED.map((one) => ({ name: one.name, summary: one.summary, version: fill(skillTemplate(one.name)!, origin).version }))
}

/** The skill a path asks for (`skillPath(name)`), or null for a path that is not one, or text that would not pass. */
export function skillAt(path: string): { name: string; text: string } | null {
  for (const one of OFFERED) {
    if (skillPath(one.name) !== path) continue
    const text = skillText(one.name)
    if (text === null || skillTextIssue(text, one.name)) return null
    return { name: one.name, text }
  }
  return null
}

/** Whether a path is one this module serves a skill on: what `doors()` hands to `answer`. */
export const isSkillPath = (path: string): boolean => OFFERED.some((one) => skillPath(one.name) === path)
