/**
 * Where a project keeps its HMI and how the files map to the project model: `hmi/<Name>.st` per screen,
 * `hmi/widgets/<Name>.st` per widget block and `hmi/settings.json`. Every platform reads and writes these paths
 * through the functions here.
 */
import { type HmiSettings, hmiSettingsSchema, parseHmiSettings } from './settings'

export const HMI_DIRECTORY = 'hmi'
export const HMI_WIDGETS_DIRECTORY = 'hmi/widgets'
export const HMI_SETTINGS_PATH = 'hmi/settings.json'
/** Extensions of HMI files; a platform reads the `hmi` folder, subfolders included, for these. */
export const HMI_FILE_EXTENSIONS = ['.st', '.json'] as const

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A screen or widget block: its name and its ST source. */
export interface HmiSourceFile {
  name: string
  source: string
}

/** The HMI of a project. */
export interface ProjectHmi {
  /** In project order (see sortHmiFiles), which is the order of page numbers. */
  screens: HmiSourceFile[]
  widgets: HmiSourceFile[]
  settings: HmiSettings
  /** settings.json as read when it did not validate; written back unchanged until settings are edited. */
  unparsedSettings?: string
}

/** A file relative to the project root. */
export interface HmiProjectFile {
  relativePath: string
  content: string
}

export type HmiPathKind = { kind: 'screen'; name: string } | { kind: 'widget'; name: string } | { kind: 'settings' }

export const hmiScreenPath = (name: string): string => `${HMI_DIRECTORY}/${name}.st`
export const hmiWidgetPath = (name: string): string => `${HMI_WIDGETS_DIRECTORY}/${name}.st`

/** What an HMI path holds; undefined for any other path, or a file name that is not an identifier. */
export function classifyHmiPath(relativePath: string): HmiPathKind | undefined {
  const path = relativePath.replace(/\\/g, '/')
  if (path === HMI_SETTINGS_PATH) return { kind: 'settings' }
  const widget = /^hmi\/widgets\/([^/]+)\.st$/.exec(path)
  if (widget) return IDENTIFIER.test(widget[1]) ? { kind: 'widget', name: widget[1] } : undefined
  const screen = /^hmi\/([^/]+)\.st$/.exec(path)
  if (screen) return IDENTIFIER.test(screen[1]) ? { kind: 'screen', name: screen[1] } : undefined
  return undefined
}

/** Screens in project order: by name, ignoring case, as the project tree lists them. */
export function sortHmiFiles<T extends { name: string }>(files: readonly T[]): T[] {
  const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  return [...files].sort(
    (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || byCodePoint(a.name, b.name),
  )
}

/**
 * The project's HMI from its files, or undefined when it has none. A settings file that does not validate is kept as
 * read and reported; the defaults stand in for it.
 */
export function readHmiFiles(files: readonly HmiProjectFile[]): { hmi?: ProjectHmi; warnings: string[] } {
  const warnings: string[] = []
  const screens: HmiSourceFile[] = []
  const widgets: HmiSourceFile[] = []
  let settingsText: string | undefined
  for (const file of files) {
    const kind = classifyHmiPath(file.relativePath)
    if (!kind) {
      warnings.push(`${file.relativePath}: not an HMI file; it is left as it is`)
      continue
    }
    if (kind.kind === 'settings') settingsText = file.content
    else (kind.kind === 'screen' ? screens : widgets).push({ name: kind.name, source: file.content })
  }
  if (screens.length === 0 && widgets.length === 0 && settingsText === undefined) return { warnings }
  let settings = hmiSettingsSchema.parse({})
  let unparsedSettings: string | undefined
  if (settingsText !== undefined) {
    let value: unknown
    try {
      value = JSON.parse(settingsText)
    } catch {
      value = undefined
    }
    const parsed = value === undefined ? undefined : parseHmiSettings(value)
    if (parsed?.ok) settings = parsed.settings
    else {
      unparsedSettings = settingsText
      const reason = parsed === undefined ? 'it is not JSON' : parsed.errors.join('; ')
      warnings.push(`${HMI_SETTINGS_PATH}: ${reason}. It is kept as it is until HMI Settings are edited.`)
    }
  }
  const hmi: ProjectHmi = { screens: sortHmiFiles(screens), widgets: sortHmiFiles(widgets), settings }
  if (unparsedSettings !== undefined) hmi.unparsedSettings = unparsedSettings
  return { hmi, warnings }
}

/** settings.json content. */
export function serializeHmiSettings(settings: HmiSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`
}

/** Files of a project's HMI; none when it has no HMI. */
export function writeHmiFiles(hmi: ProjectHmi | undefined): HmiProjectFile[] {
  if (!hmi) return []
  return [
    ...hmi.screens.map((s) => ({ relativePath: hmiScreenPath(s.name), content: s.source })),
    ...hmi.widgets.map((w) => ({ relativePath: hmiWidgetPath(w.name), content: w.source })),
    { relativePath: HMI_SETTINGS_PATH, content: hmi.unparsedSettings ?? serializeHmiSettings(hmi.settings) },
  ]
}

/** Source of a new screen. */
export function newHmiScreenSource(name: string): string {
  return [
    `FUNCTION_BLOCK ${name} EXTENDS HmiScreen`,
    '  VAR',
    `    Title : HmiLabel := (Text := '${name}', Size := 20, Font := HMI_FONT#Bold);`,
    '  END_VAR',
    'END_FUNCTION_BLOCK',
    '',
  ].join('\n')
}

/** Source of a new widget block. */
export function newHmiWidgetSource(name: string): string {
  return [
    `FUNCTION_BLOCK ${name} EXTENDS HmiElement`,
    '  VAR_INPUT',
    "    {attribute 'hmi_main'}",
    '    Value : BOOL;',
    '  END_VAR',
    '  METHOD PROTECTED OVERRIDE NaturalWidth : DINT',
    '    NaturalWidth := 48;',
    '  END_METHOD',
    '  METHOD PROTECTED OVERRIDE NaturalHeight : DINT',
    '    NaturalHeight := 48;',
    '  END_METHOD',
    '  METHOD PROTECTED OVERRIDE Draw : BOOL',
    '    HMI_FillCircle(CenterX(), CenterY(), MIN(Width, Height) / 2, SEL(Value, COLOR.Border, COLOR.Success));',
    '    Draw := TRUE;',
    '  END_METHOD',
    'END_FUNCTION_BLOCK',
    '',
  ].join('\n')
}
