/**
 * References between a project's HMI elements, for renames: navigation to a screen (`HMI_SCREEN#Name`) and HMI
 * Settings for screens, type uses for widget blocks. Comments and string literals never count.
 */
import type { ReferenceImpactAnalysis } from '../../../../frontend/utils/variable-references/types'
import type { ProjectHmi } from './project-files'

export type HmiElementKind = 'screen' | 'widget'

/** Where a reference is: a screen, a widget block or HMI Settings, and its line in the file. */
export interface HmiReferenceLocation {
  element: string
  kind: 'screen' | 'widget' | 'settings'
  line?: number
}

export const HMI_SETTINGS_ELEMENT = 'HMI Settings'

/** The source with comments and string literals replaced by spaces, newlines kept, so offsets and lines still hold. */
export function maskStComments(source: string): string {
  const out = source.split('')
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '(*') {
      const end = source.indexOf('*)', i + 2)
      const stop = end < 0 ? source.length : end + 2
      blank(i, stop)
      i = stop
    } else if (two === '//') {
      const end = source.indexOf('\n', i)
      const stop = end < 0 ? source.length : end
      blank(i, stop)
      i = stop
    } else if (source[i] === "'" || source[i] === '"') {
      const quote = source[i]
      let j = i + 1
      while (j < source.length && source[j] !== quote) j += source[j] === '$' ? 2 : 1
      const stop = Math.min(j + 1, source.length)
      blank(i, stop)
      i = stop
    } else {
      i++
    }
  }
  return out.join('')
}

const escape = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '')

/** Matches of `name` as a reference of the given kind; group 1 is everything before the name. */
function referencePattern(kind: HmiElementKind, name: string): RegExp {
  const n = escape(name)
  return kind === 'screen'
    ? new RegExp(`(\\bHMI_SCREEN\\s*#\\s*)(${n})\\b`, 'gi')
    : new RegExp(`(:\\s*|\\b(?:OF|TO|EXTENDS)\\s+)(${n})\\b`, 'gi')
}

/** Offsets of the referenced name in a source. */
function referenceOffsets(source: string, kind: HmiElementKind, name: string): number[] {
  const masked = maskStComments(source)
  return [...masked.matchAll(referencePattern(kind, name))].map((m) => (m.index ?? 0) + m[1].length)
}

const lineAt = (source: string, offset: number): number => source.slice(0, offset).split('\n').length

/** Replaces every reference at the given offsets. */
function replaceAt(source: string, offsets: readonly number[], length: number, replacement: string): string {
  let out = source
  for (const offset of [...offsets].sort((a, b) => b - a))
    out = out.slice(0, offset) + replacement + out.slice(offset + length)
  return out
}

/** The source with its own `FUNCTION_BLOCK <oldName>` header renamed. */
export function renameBlockHeader(source: string, oldName: string, newName: string): string {
  const match = new RegExp(`(\\bFUNCTION_BLOCK\\s+(?:(?:ABSTRACT|FINAL)\\s+)?)(${escape(oldName)})\\b`, 'i').exec(
    maskStComments(source),
  )
  if (!match) return source
  const offset = match.index + match[1].length
  return source.slice(0, offset) + newName + source.slice(offset + match[2].length)
}

function sameName(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase()
}

/** References to a screen or widget block elsewhere in the HMI; its own file does not count. */
export function findHmiReferences(
  kind: HmiElementKind,
  name: string,
  hmi: ProjectHmi | undefined,
): ReferenceImpactAnalysis<HmiReferenceLocation> {
  const references: HmiReferenceLocation[] = []
  const files = [
    ...(hmi?.screens ?? []).map((f) => ({ ...f, kind: 'screen' as const })),
    ...(hmi?.widgets ?? []).map((f) => ({ ...f, kind: 'widget' as const })),
  ]
  for (const file of files) {
    if (file.kind === kind && sameName(file.name, name)) continue
    for (const offset of referenceOffsets(file.source, kind, name))
      references.push({ element: file.name, kind: file.kind, line: lineAt(file.source, offset) })
  }
  if (hmi && kind === 'screen' && hmi.unparsedSettings === undefined) {
    if (sameName(hmi.settings.startScreen, name)) references.push({ element: HMI_SETTINGS_ELEMENT, kind: 'settings' })
    if (Object.keys(hmi.settings.roles).some((k) => sameName(k, name)))
      references.push({ element: HMI_SETTINGS_ELEMENT, kind: 'settings' })
  }
  const byPou = new Map<string, number>()
  const byEditorType = new Map<string, number>()
  const label = { screen: 'HMI screen', widget: 'HMI widget', settings: 'HMI Settings' } as const
  for (const r of references) {
    byPou.set(r.element, (byPou.get(r.element) ?? 0) + 1)
    byEditorType.set(label[r.kind], (byEditorType.get(label[r.kind]) ?? 0) + 1)
  }
  return { totalReferences: references.length, byPou, byEditorType, references }
}

/** The HMI with every reference to a screen or widget block renamed; the element itself is left to the caller. */
export function renameHmiReferences(
  kind: HmiElementKind,
  oldName: string,
  newName: string,
  hmi: ProjectHmi,
): ProjectHmi {
  const rename = <T extends { name: string; source: string }>(file: T, fileKind: HmiElementKind): T => {
    if (fileKind === kind && sameName(file.name, oldName)) return file
    const offsets = referenceOffsets(file.source, kind, oldName)
    return offsets.length === 0 ? file : { ...file, source: replaceAt(file.source, offsets, oldName.length, newName) }
  }
  const next: ProjectHmi = {
    ...hmi,
    screens: hmi.screens.map((f) => rename(f, 'screen')),
    widgets: hmi.widgets.map((f) => rename(f, 'widget')),
  }
  if (kind === 'screen' && hmi.unparsedSettings === undefined) {
    const roles = Object.fromEntries(
      Object.entries(hmi.settings.roles).map(([k, grant]) => [sameName(k, oldName) ? newName : k, grant]),
    )
    const startScreen = sameName(hmi.settings.startScreen, oldName) ? newName : hmi.settings.startScreen
    next.settings = { ...hmi.settings, roles, startScreen }
  }
  return next
}
