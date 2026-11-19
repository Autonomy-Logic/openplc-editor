/**
 * Library kinds, the `openplc` metadata a library archive carries, and the openplc-hmi-widgets release manifest. A
 * library of kind `hmi` is a widget library: the HMI designer and build use it and the PLC build leaves it out. A
 * library of kind `plc`, or one with no metadata, is a PLC library.
 */
import { z } from 'zod'

import type { HmiWidgetCatalog, HmiWidgetInfo } from '../../ports/hmi-preview-types'

/**
 * API version of the HMI C core (`resources/sources/hmi/core/hmi_core.h`) that widget libraries call. Raise it with any
 * change a compiled widget library could break on; libraries built for another version are refused.
 */
export const HMI_CORE_API_VERSION = 1

/** Format version of an archive's `openplc` metadata that this build reads. */
export const LIBRARY_METADATA_FORMAT = 1

/** Format version of the openplc-hmi-widgets release manifest that this build reads. */
export const WIDGETS_RELEASE_FORMAT = 1

/** File name of the release manifest among a release's assets. */
export const WIDGETS_RELEASE_MANIFEST = 'openplc-hmi-widgets.json'

export type LibraryKind = 'hmi' | 'plc'

const propertySchema = z.object({
  name: z.string(),
  type: z.string(),
  kind: z.enum(['bool', 'number', 'string', 'color', 'enum', 'elementRef', 'other']),
  group: z.enum(['data', 'display', 'layout']),
  defaultValue: z.string().optional(),
  enabledBy: z.string().optional(),
  previewValue: z.string().optional(),
  maxLength: z.number().optional(),
  enumMembers: z.array(z.string()).optional(),
  declaredBy: z.string(),
})

const widgetSchema = z.object({
  name: z.string(),
  library: z.string(),
  extends: z.string(),
  palette: z.string().optional(),
  properties: z.array(propertySchema),
  outputs: z.array(z.object({ name: z.string(), type: z.string() })),
  main: z.object({ name: z.string(), direction: z.enum(['input', 'output']), type: z.string() }).optional(),
  twoWay: z
    .object({
      value: z.string(),
      changed: z.string(),
      newValue: z.string(),
      range: z.string().optional(),
      maxLength: z.string().optional(),
    })
    .optional(),
  momentary: z.object({ value: z.string(), changed: z.string() }).optional(),
  events: z.array(z.string()),
  series: z.object({ count: z.string(), values: z.array(z.string()), colors: z.array(z.string()) }).optional(),
  typeDefaults: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  requires: z.string().optional(),
  sources: z.array(z.object({ name: z.string(), type: z.string(), slot: z.number() })).optional(),
})

const catalogSchema = z.object({ widgets: z.array(widgetSchema), colors: z.array(z.string()) })

const plcMetadataSchema = z.object({ formatVersion: z.number(), kind: z.literal('plc'), license: z.string() })

const hmiMetadataSchema = z.object({
  formatVersion: z.number(),
  kind: z.literal('hmi'),
  license: z.string(),
  hmiCoreApi: z.number().int(),
  catalog: catalogSchema,
})

const metadataSchema = z.discriminatedUnion('kind', [plcMetadataSchema, hmiMetadataSchema])

export type HmiLibraryMetadata = z.infer<typeof hmiMetadataSchema>
export type LibraryMetadata = z.infer<typeof metadataSchema>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The archive's manifest name, or `?` when it has none. */
export function libraryArchiveName(archive: unknown): string {
  const manifest = isRecord(archive) ? archive.manifest : undefined
  return isRecord(manifest) && typeof manifest.name === 'string' ? manifest.name : '?'
}

/** The kind an archive declares; an archive without `openplc` metadata is a PLC library. */
export function libraryKind(archive: unknown): LibraryKind {
  const metadata = isRecord(archive) ? archive.openplc : undefined
  return isRecord(metadata) && metadata.kind === 'hmi' ? 'hmi' : 'plc'
}

/** PLC libraries and widget libraries of a list of archives, in their order. */
export function partitionLibraryArchives<T>(archives: readonly T[]): { plc: T[]; hmi: T[] } {
  const plc: T[] = []
  const hmi: T[] = []
  for (const archive of archives) (libraryKind(archive) === 'hmi' ? hmi : plc).push(archive)
  return { plc, hmi }
}

export type LibraryMetadataResult = { ok: true; metadata: LibraryMetadata | null } | { ok: false; error: string }

/** The archive's `openplc` metadata, checked; null when it has none. */
export function readLibraryMetadata(archive: unknown): LibraryMetadataResult {
  const raw = isRecord(archive) ? archive.openplc : undefined
  if (raw === undefined) return { ok: true, metadata: null }
  const name = libraryArchiveName(archive)
  if (isRecord(raw) && typeof raw.formatVersion === 'number' && raw.formatVersion !== LIBRARY_METADATA_FORMAT)
    return {
      ok: false,
      error:
        `The library "${name}" uses library metadata format ${raw.formatVersion}, which this version of the editor ` +
        `does not read (it reads format ${LIBRARY_METADATA_FORMAT}). Update the editor or install a matching build.`,
    }
  const parsed = metadataSchema.safeParse(raw)
  if (!parsed.success)
    return {
      ok: false,
      error: `The library "${name}" carries invalid OpenPLC metadata: ${parsed.error.issues[0]?.message}`,
    }
  return { ok: true, metadata: parsed.data }
}

/** Why an archive cannot be used, or null when it can: invalid metadata, or a widget library for another core API. */
export function libraryArchiveProblem(archive: unknown): string | null {
  const read = readLibraryMetadata(archive)
  if (!read.ok) return read.error
  const { metadata } = read
  if (metadata?.kind === 'hmi' && metadata.hmiCoreApi !== HMI_CORE_API_VERSION)
    return (
      `The widget library "${libraryArchiveName(archive)}" is built for HMI core API ${metadata.hmiCoreApi}, but this ` +
      `editor provides HMI core API ${HMI_CORE_API_VERSION}. Install a build of the library for HMI core API ` +
      `${HMI_CORE_API_VERSION}.`
    )
  return null
}

/** A widget library's catalogue as the designer reads it, or null when the archive is not a usable widget library. */
export function hmiLibraryCatalog(archive: unknown): HmiWidgetCatalog | null {
  if (libraryArchiveProblem(archive) !== null) return null
  const read = readLibraryMetadata(archive)
  if (!read.ok || read.metadata?.kind !== 'hmi') return null
  const widgets = new Map<string, HmiWidgetInfo>()
  for (const widget of read.metadata.catalog.widgets) widgets.set(widget.name.toUpperCase(), widget)
  return { widgets, colors: read.metadata.catalog.colors }
}

const releaseArchiveBase = {
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string(),
  version: z.string(),
  file: z.string().regex(/^[a-z][a-z0-9-]*\.stlib$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  strucppVersion: z.string(),
  headers: z.array(z.string()),
  license: z.string(),
}

const releaseSchema = z.object({
  formatVersion: z.number(),
  name: z.literal('openplc-hmi-widgets'),
  version: z.string(),
  strucppVersion: z.string(),
  archives: z.array(
    z.discriminatedUnion('kind', [
      z.object({ ...releaseArchiveBase, kind: z.literal('plc') }),
      z.object({ ...releaseArchiveBase, kind: z.literal('hmi'), hmiCoreApi: z.number().int(), catalog: catalogSchema }),
    ]),
  ),
})

export type WidgetsRelease = z.infer<typeof releaseSchema>

/** Parses an openplc-hmi-widgets release manifest; throws with the reason when it is not one this build reads. */
export function parseWidgetsRelease(text: string): WidgetsRelease {
  const raw: unknown = JSON.parse(text)
  if (isRecord(raw) && typeof raw.formatVersion === 'number' && raw.formatVersion !== WIDGETS_RELEASE_FORMAT)
    throw new Error(
      `The HMI widget release manifest is format ${raw.formatVersion}; this build reads format ${WIDGETS_RELEASE_FORMAT}`,
    )
  const parsed = releaseSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`The HMI widget release manifest is invalid at ${issue?.path.join('.')}: ${issue?.message}`)
  }
  return parsed.data
}

/** One archive of a release as read from disk, with the SHA-256 of its bytes. */
export interface WidgetsReleaseFile {
  file: string
  sha256: string
  text: string
}

/**
 * What is wrong with a release's archives: a missing file, a hash that differs from the manifest, metadata that
 * contradicts it, or a widget library for another HMI core API. Empty when the release can be installed.
 */
export function widgetsReleaseProblems(release: WidgetsRelease, files: readonly WidgetsReleaseFile[]): string[] {
  const problems: string[] = []
  const byFile = new Map(files.map((f) => [f.file, f]))
  for (const entry of release.archives) {
    const found = byFile.get(entry.file)
    if (!found) {
      problems.push(`${entry.file} is missing`)
      continue
    }
    if (found.sha256 !== entry.sha256) {
      problems.push(`${entry.file} has SHA-256 ${found.sha256}, the manifest says ${entry.sha256}`)
      continue
    }
    let archive: unknown
    try {
      archive = JSON.parse(found.text)
    } catch {
      problems.push(`${entry.file} is not JSON`)
      continue
    }
    if (libraryArchiveName(archive) !== entry.name) problems.push(`${entry.file} is not the library ${entry.name}`)
    if (libraryKind(archive) !== entry.kind) problems.push(`${entry.file} is not of kind ${entry.kind}`)
    const problem = libraryArchiveProblem(archive)
    if (problem) problems.push(problem)
  }
  return problems
}

/** Names of the pre-installed PLC libraries among library manager rows: always on for PLC code, unlike widget ones. */
export function bundledPlcLibraryNames(
  rows: ReadonlyArray<{ name: string; bundled: boolean; kind?: LibraryKind }>,
): string[] {
  return rows.filter((row) => row.bundled && row.kind !== 'hmi').map((row) => row.name)
}
