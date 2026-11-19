/**
 * Widget catalogue read from STruC++ library manifests, for a project's widget blocks (whose bases may come from the
 * installed widget libraries, which carry their own catalogue); see `buildWidgetCatalog` for the pragmas that drive it.
 * The openplc-hmi-widgets build generates its libraries' catalogues the same way.
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
  HmiWidgetSource,
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
  HmiWidgetSource,
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

/** `Name := Value` pairs of an hmi_default attribute, comma separated; values are literals without commas. */
function defaultsOf(entry: { attributes?: LibraryFBEntry['attributes'] }): Array<{ name: string; value: string }> {
  const text = attribute(entry, 'hmi_default')?.value ?? ''
  return text.split(',').flatMap((part) => {
    const m = /^\s*([A-Za-z_]\w*)\s*:=\s*(\S(?:.*\S)?)\s*$/.exec(part)
    return m ? [{ name: m[1], value: m[2] }] : []
  })
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
  const enabledBy = attribute(v, 'hmi_enabled_by')?.value
  if (enabledBy) property.enabledBy = enabledBy
  const previewValue = attribute(v, 'hmi_preview')?.value
  if (previewValue) property.previewValue = previewValue
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
  const typeDefaults = new Map<string, { name: string; value: string }>()
  for (const c of chain.slice(1))
    for (const d of defaultsOf(c.fb)) {
      const input = inputs.find((i) => i.v.name.toUpperCase() === d.name.toUpperCase())
      if (input) typeDefaults.set(d.name.toUpperCase(), { name: written(input.v), value: d.value })
    }
  const properties = inputs.map((i) => {
    const property = propertyOf(i.v, i.by, types, marked?.v === i.v)
    const own = typeDefaults.get(i.v.name.toUpperCase())
    return own ? { ...property, defaultValue: own.value } : property
  })
  const widget: HmiWidgetInfo = {
    name: written(located.fb),
    library: located.library,
    extends: located.fb.extends ?? '',
    properties,
    outputs: outputs.map((o) => ({ name: written(o), type: o.type })),
    events: outputs
      .filter((o) => o.type.toUpperCase() === 'BOOL' && o !== changed && o !== newValue && o !== marked?.v)
      .map(written),
  }
  const palette = attribute(located.fb, 'hmi_palette')?.value
  if (palette) widget.palette = palette
  if (main) widget.main = main
  if (main?.direction === 'input' && changed && newValue) {
    widget.twoWay = { value: main.name, changed: written(changed), newValue: written(newValue) }
    const range = attribute(newValue, 'hmi_range')?.value
    if (range) widget.twoWay.range = range
    const maxLength = attribute(newValue, 'hmi_max_length')?.value
    if (maxLength) widget.twoWay.maxLength = maxLength
  }
  if (main?.direction === 'output' && main.type.toUpperCase() === 'BOOL' && changed)
    widget.momentary = { value: main.name, changed: written(changed) }
  const seriesOf = (role: string) =>
    inputs.filter((i) => attribute(i.v, 'hmi_series')?.value === role).map((i) => written(i.v))
  const [count] = seriesOf('count')
  const values = seriesOf('value')
  const colors = seriesOf('color')
  if (count !== undefined && values.length > 0 && values.length === colors.length)
    widget.series = { count, values, colors }
  if (typeDefaults.size > 0) widget.typeDefaults = [...typeDefaults.values()]
  const requires = attribute(located.fb, 'hmi_requires')?.value
  if (requires) widget.requires = requires
  const sources = inputs.flatMap((i) => {
    const type = attribute(i.v, 'hmi_source')?.value
    return type ? [{ name: written(i.v), type: type.replace(/\s+/g, ' ').trim().toUpperCase() }] : []
  })
  if (sources.length > 0) widget.sources = sources.map((source, slot) => ({ ...source, slot }))
  return widget
}

/**
 * Catalogue of every widget the manifests declare; a block's base may come from another manifest. A widget is a
 * function block that is not abstract and extends HmiElement. Attribute pragmas in the ST source drive it:
 * - `hmi_palette` on a block: its palette group;
 * - `hmi_main` on an input or output: what a dropped variable is wired to;
 * - `hmi_group` on an input: its inspector group (`data`, `display` or `layout`);
 * - `hmi_color` on an input: a color; `hmi_element_ref` on an input: the name of another element;
 * - `hmi_series` on inputs: `value` and `color` per data series, in order, and `count` for how many show;
 * - `hmi_default` on a block: `Name := Value, ...` the block's own start values for inherited inputs, which the build
 *   sets on elements that leave them out (a derived block cannot redeclare an input);
 * - `hmi_enabled_by` on an input: the BOOL input that must be TRUE for it to take effect;
 * - `hmi_preview` on the main input: the value previews and palette thumbnails show, for one a test value misleads;
 * - `hmi_requires` on a block: the target capability it needs, which the palette and the build check;
 * - `hmi_source` on a STRING input: the kind of PLC data its literal value names, which the build feeds the widget.
 * A main input with `Changed` and `NewValue` outputs is two-way; a main BOOL output with `Changed` is momentary; other
 * BOOL outputs are events.
 */
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
