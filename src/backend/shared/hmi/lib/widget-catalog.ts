/**
 * Widget catalogue for the designer and the HMI build, read from STruC++ library manifests: the StandardWidgets
 * archive and any archive of project widget blocks. A widget is a function block that is not abstract and extends
 * HmiElement. Attribute pragmas in the ST source drive the catalogue:
 * - `hmi_palette` on a block: its palette group;
 * - `hmi_main` on an input or output: what a dropped variable is wired to;
 * - `hmi_group` on an input: its inspector group (`data`, `display` or `layout`);
 * - `hmi_color` on an input: a color; `hmi_element_ref` on an input: the name of another element.
 * A main input with `Changed` and `NewValue` outputs is two-way; other BOOL outputs are events.
 */
import type { LibraryFBEntry, LibraryManifest, LibraryTypeEntry } from 'strucpp'

import type {
  HmiPropertyGroup,
  HmiPropertyKind,
  HmiWidgetBinding,
  HmiWidgetCatalog,
  HmiWidgetInfo,
  HmiWidgetOutput,
  HmiWidgetProperty,
} from '../../../../middleware/shared/ports/hmi-preview-types'

type ManifestVar = LibraryFBEntry['inputs'][number]

export type {
  HmiPropertyGroup,
  HmiPropertyKind,
  HmiWidgetBinding,
  HmiWidgetCatalog,
  HmiWidgetInfo,
  HmiWidgetOutput,
  HmiWidgetProperty,
}

const BASE_ELEMENT = 'HMIELEMENT'
const CHANGED = 'CHANGED'
const NEW_VALUE = 'NEWVALUE'
const COLOR_CONSTANT = 'COLOR'
const NUMERIC_TYPES = new Set([
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'REAL',
  'LREAL',
])
const STRING_TYPES = new Set(['STRING', 'WSTRING'])
const GROUPS: readonly HmiPropertyGroup[] = ['data', 'display', 'layout']

interface Located {
  fb: LibraryFBEntry
  library: string
}

const written = (entry: { name: string; displayName?: string }): string => entry.displayName ?? entry.name

function attribute(entry: { attributes?: LibraryFBEntry['attributes'] }, name: string): { value?: string } | undefined {
  return entry.attributes?.find((a) => a.name.toLowerCase() === name)
}

function isGroup(value: string | undefined): value is HmiPropertyGroup {
  return GROUPS.some((g) => g === value)
}

/** Blocks from the base down to `fb`; empty when a base is missing or the chain loops. */
function lineage(fb: Located, blocks: ReadonlyMap<string, Located>): Located[] {
  const chain: Located[] = [fb]
  const seen = new Set([fb.fb.name.toUpperCase()])
  let current = fb
  while (current.fb.extends) {
    const key = current.fb.extends.toUpperCase()
    const base = blocks.get(key)
    if (!base || seen.has(key)) return []
    seen.add(key)
    chain.unshift(base)
    current = base
  }
  return chain
}

function propertyOf(
  v: ManifestVar,
  declaredBy: string,
  types: ReadonlyMap<string, LibraryTypeEntry>,
  main: boolean,
): HmiWidgetProperty {
  const typeKey = v.type.toUpperCase()
  const typeEntry = types.get(typeKey)
  const enumMembers = typeEntry?.kind === 'enum' ? (typeEntry.members ?? []).map(written) : undefined
  let kind: HmiPropertyKind = 'other'
  if (attribute(v, 'hmi_color')) kind = 'color'
  else if (attribute(v, 'hmi_element_ref')) kind = 'elementRef'
  else if (enumMembers) kind = 'enum'
  else if (typeKey === 'BOOL') kind = 'bool'
  else if (NUMERIC_TYPES.has(typeKey)) kind = 'number'
  else if (STRING_TYPES.has(typeKey)) kind = 'string'
  const groupAttr = attribute(v, 'hmi_group')?.value
  const property: HmiWidgetProperty = {
    name: written(v),
    type: typeEntry ? written(typeEntry) : v.type,
    kind,
    group: isGroup(groupAttr) ? groupAttr : main ? 'data' : 'display',
    declaredBy,
  }
  if (v.initialValue !== undefined) property.defaultValue = v.initialValue
  if (typeof v.maxLength === 'number') property.maxLength = v.maxLength
  if (enumMembers) property.enumMembers = enumMembers
  return property
}

function widgetOf(
  located: Located,
  chain: readonly Located[],
  types: ReadonlyMap<string, LibraryTypeEntry>,
): HmiWidgetInfo {
  const inputs = chain.flatMap((c) => c.fb.inputs.map((v) => ({ v, by: written(c.fb) })))
  const outputs = chain.flatMap((c) => c.fb.outputs)
  const marked = [
    ...inputs.map((i) => ({ v: i.v, direction: 'input' as const })),
    ...outputs.map((v) => ({ v, direction: 'output' as const })),
  ]
    .filter((m) => attribute(m.v, 'hmi_main'))
    .pop()
  const main: HmiWidgetBinding | undefined = marked
    ? { name: written(marked.v), direction: marked.direction, type: marked.v.type }
    : undefined
  const output = (key: string): ManifestVar | undefined => outputs.find((o) => o.name.toUpperCase() === key)
  const changed = output(CHANGED)
  const newValue = output(NEW_VALUE)
  const widget: HmiWidgetInfo = {
    name: written(located.fb),
    library: located.library,
    extends: located.fb.extends ?? '',
    properties: inputs.map((i) => propertyOf(i.v, i.by, types, marked?.v === i.v)),
    outputs: outputs.map((o) => ({ name: written(o), type: o.type })),
    events: outputs
      .filter((o) => o.type.toUpperCase() === 'BOOL' && o !== changed && o !== newValue && o !== marked?.v)
      .map(written),
  }
  const palette = attribute(located.fb, 'hmi_palette')?.value
  if (palette) widget.palette = palette
  if (main) widget.main = main
  if (main?.direction === 'input' && changed && newValue)
    widget.twoWay = { value: main.name, changed: written(changed), newValue: written(newValue) }
  return widget
}

/** Catalogue of every widget the manifests declare; a block's base may come from another manifest. */
export function buildWidgetCatalog(manifests: readonly LibraryManifest[]): HmiWidgetCatalog {
  const blocks = new Map<string, Located>()
  const types = new Map<string, LibraryTypeEntry>()
  let colors: string[] = []
  for (const manifest of manifests) {
    for (const fb of manifest.functionBlocks) blocks.set(fb.name.toUpperCase(), { fb, library: manifest.name })
    for (const t of manifest.types) types.set(t.name.toUpperCase(), t)
  }
  for (const manifest of manifests) {
    const color = manifest.globals?.find((g) => g.name.toUpperCase() === COLOR_CONSTANT && g.constant)
    const struct = color ? types.get(color.type.toUpperCase()) : undefined
    if (struct?.kind === 'struct') colors = (struct.fields ?? []).map(written)
  }
  const widgets = new Map<string, HmiWidgetInfo>()
  for (const [key, located] of blocks) {
    if (located.fb.isAbstract) continue
    const chain = lineage(located, blocks)
    if (chain.length < 2 || chain[0].fb.name.toUpperCase() !== BASE_ELEMENT) continue
    widgets.set(key, widgetOf(located, chain, types))
  }
  return { widgets, colors }
}
