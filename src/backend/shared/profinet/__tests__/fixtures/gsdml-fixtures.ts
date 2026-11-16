import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import type { GsdmlCatalog, GsdmlParseResult } from '@root/middleware/shared/ports/gsdml-types'

/** A device access point of the catalog. */
export type CatalogDap = GsdmlCatalog['deviceAccessPoints'][number]

/** A slot or subslot set of the catalog. */
export type SlotSet = CatalogDap['physicalSlots']

/** A notice of the catalog. */
export type CatalogNotice = GsdmlCatalog['notices'][number]

/** Any submodule kind the catalog holds. */
export type AnySubmodule =
  | CatalogDap['virtualSubmodules'][number]
  | CatalogDap['systemDefinedSubmodules'][number]
  | GsdmlCatalog['submodules'][number]

/** The GSDML elements whose occurrences the catalog exposes one for one. */
export const COUNTED_ELEMENTS = [
  'DeviceAccessPointItem',
  'ModuleItem',
  'SubmoduleItem',
  'VirtualSubmoduleItem',
  'InterfaceSubmoduleItem',
  'PortSubmoduleItem',
  'ParameterRecordDataItem',
  'ChannelDiagItem',
  'UnitDiagTypeItem',
  'LogBookEntryItem',
] as const

/** One of the counted GSDML element names. */
export type CountedElement = (typeof COUNTED_ELEMENTS)[number]

/** Absolute path of a file under this fixture folder. */
export function gsdmlFixturePath(...segments: string[]): string {
  return join(__dirname, ...segments)
}

/** Reads a fixture under this folder as UTF-8 text; a leading byte order mark is kept. */
export function readGsdmlFixture(...segments: string[]): string {
  return readFileSync(gsdmlFixturePath(...segments), 'utf-8')
}

/** Returns the catalog of a successful parse; throws with the parse error otherwise. */
export function expectCatalog(result: GsdmlParseResult): GsdmlCatalog {
  if (!result.success) throw new Error(`Expected a catalog, got the error: ${result.error}`)
  return result.catalog
}

/** Returns the error of a failed parse; throws when the parse succeeded. */
export function expectError(result: GsdmlParseResult): string {
  if (result.success) throw new Error('Expected a parse error, got a catalog')
  return result.error
}

/** Replaces the only occurrence of `search` in `text`; throws when it occurs zero or several times. */
export function replaceOnce(text: string, search: string, replacement: string): string {
  const first = text.indexOf(search)
  if (first === -1 || text.indexOf(search, first + 1) !== -1) {
    throw new Error(`Expected exactly one occurrence of ${search} in the fixture`)
  }
  return text.slice(0, first) + replacement + text.slice(first + search.length)
}

/** The sorted, distinct numbers a slot or subslot set covers. */
export function slotNumbers(set: SlotSet): number[] {
  const numbers = new Set<number>()
  for (const range of set) {
    for (let n = range.first; n <= range.last; n += 1) numbers.add(n)
  }
  return [...numbers].sort((a, b) => a - b)
}

/** The consecutive integers from `first` to `last`, both included. */
export function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

/** The item with the given `id`; throws when no item has it. */
export function byId<T extends { readonly id: string }>(items: readonly T[], id: string): T {
  const found = items.find((item) => item.id === id)
  if (found === undefined) throw new Error(`No item with id ${id}`)
  return found
}

/** The notices of one kind. */
export function noticesOf(catalog: GsdmlCatalog, kind: CatalogNotice['kind']): CatalogNotice[] {
  return catalog.notices.filter((notice) => notice.kind === kind)
}

/** Every submodule of a catalog: virtual and system-defined ones of DAPs, virtual ones of modules, the SubmoduleList. */
export function allSubmodules(catalog: GsdmlCatalog): AnySubmodule[] {
  return [
    ...catalog.deviceAccessPoints.flatMap((dap) => [...dap.virtualSubmodules, ...dap.systemDefinedSubmodules]),
    ...catalog.modules.flatMap((mod) => mod.virtualSubmodules),
    ...catalog.submodules,
  ]
}

/** How many of each counted element the catalog exposes. */
export function countCatalogElements(catalog: GsdmlCatalog): Record<CountedElement, number> {
  const submodules = allSubmodules(catalog)
  const kindCount = (kind: AnySubmodule['kind']): number => submodules.filter((sub) => sub.kind === kind).length
  return {
    DeviceAccessPointItem: catalog.deviceAccessPoints.length,
    ModuleItem: catalog.modules.length,
    SubmoduleItem: kindCount('submodule'),
    VirtualSubmoduleItem: kindCount('virtual'),
    InterfaceSubmoduleItem: kindCount('interface'),
    PortSubmoduleItem: kindCount('port'),
    ParameterRecordDataItem: submodules.reduce((sum, sub) => sum + sub.parameterRecords.length, 0),
    ChannelDiagItem: catalog.channelDiagnostics.length,
    UnitDiagTypeItem: catalog.unitDiagnosticTypes.length,
    LogBookEntryItem: catalog.logBookEntries.length,
  }
}

/** How many start tags of each counted element the raw text holds, comments left out. */
export function countRawElements(xml: string): Record<CountedElement, number> {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '')
  const count = (element: CountedElement): number => (text.match(new RegExp(`<${element}[\\s/>]`, 'g')) ?? []).length
  return {
    DeviceAccessPointItem: count('DeviceAccessPointItem'),
    ModuleItem: count('ModuleItem'),
    SubmoduleItem: count('SubmoduleItem'),
    VirtualSubmoduleItem: count('VirtualSubmoduleItem'),
    InterfaceSubmoduleItem: count('InterfaceSubmoduleItem'),
    PortSubmoduleItem: count('PortSubmoduleItem'),
    ParameterRecordDataItem: count('ParameterRecordDataItem'),
    ChannelDiagItem: count('ChannelDiagItem'),
    UnitDiagTypeItem: count('UnitDiagTypeItem'),
    LogBookEntryItem: count('LogBookEntryItem'),
  }
}

/** Paths under `value` holding anything but primitives, plain objects and arrays, such as a Map or a function. */
export function nonPlainDataPaths(value: unknown, path = '$'): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return []
  if (typeof value !== 'object') return [path]
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index: number) => nonPlainDataPaths(item, `${path}[${index}]`))
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return [path]
  return Object.entries(value).flatMap(([key, item]: [string, unknown]) => nonPlainDataPaths(item, `${path}.${key}`))
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const

/** Runs `run` with the console replaced by a recorder; returns its result and every console call made. */
export function withConsoleRecorded<T>(run: () => T): { result: T; calls: string[] } {
  const calls: string[] = []
  const saved = CONSOLE_METHODS.map((method) => ({ method, original: console[method] }))
  for (const method of CONSOLE_METHODS) {
    console[method] = (...args: unknown[]): void => {
      calls.push(`${method}: ${args.map((arg) => String(arg)).join(' ')}`)
    }
  }
  try {
    return { result: run(), calls }
  } finally {
    for (const { method, original } of saved) console[method] = original
  }
}

/** The outcome of a call that may throw, with the time it took. */
export type TimedOutcome<T> = { ms: number } & ({ threw: false; value: T } | { threw: true; error: unknown })

/** Runs `run`, catching what it throws, and measures how long it took. */
export function timed<T>(run: () => T): TimedOutcome<T> {
  const start = performance.now()
  try {
    const value = run()
    return { ms: performance.now() - start, threw: false, value }
  } catch (error: unknown) {
    return { ms: performance.now() - start, threw: true, error }
  }
}

/** Narrows a submodule to the interface kind; throws for any other kind. */
export function asInterfaceSubmodule(sub: AnySubmodule): Extract<AnySubmodule, { kind: 'interface' }> {
  if (sub.kind !== 'interface') throw new Error(`Submodule ${sub.id} is ${sub.kind}, not interface`)
  return sub
}

/** Narrows a submodule to the port kind; throws for any other kind. */
export function asPortSubmodule(sub: AnySubmodule): Extract<AnySubmodule, { kind: 'port' }> {
  if (sub.kind !== 'port') throw new Error(`Submodule ${sub.id} is ${sub.kind}, not port`)
  return sub
}
