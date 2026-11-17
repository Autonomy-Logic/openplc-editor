/**
 * The rules a screen or widget block follows beyond the ST compiler's: name and base, theme pragma, Parent tree,
 * capacities, pipe ends and element properties. Reported by the build and marked in the code view.
 */
import type { HmiWidgetCatalog } from '../../ports/hmi-preview-types'
import { widgetIsA } from './designer/designer-canvas'
import { type HmiSettings, hmiThemeId } from './settings'

export interface HmiCheckSpan {
  start: number
  end: number
}

export interface HmiCheckProperty {
  /** Name as written. */
  name: string
  /** Value as ST text. */
  value: string
  span?: HmiCheckSpan
  valueSpan?: HmiCheckSpan
}

export interface HmiCheckElement {
  /** Name as written. */
  name: string
  /** Type as written. */
  type: string
  props: readonly HmiCheckProperty[]
  nameSpan?: HmiCheckSpan
}

/** What the checks read from a screen or widget block. */
export interface HmiCheckBlock {
  /** Name as written. */
  name: string
  /** Base block as written; empty when there is none. */
  extends: string
  /** `{attribute 'hmi_theme' := '<Name>'}` on the block, or null. */
  theme: string | null
  /** Upper-case method names. */
  methods: ReadonlySet<string>
  elements: readonly HmiCheckElement[]
  /** The block's name after FUNCTION_BLOCK. */
  nameSpan?: HmiCheckSpan
  themeSpan?: HmiCheckSpan
}

export interface HmiCheckContext {
  kind: 'screen' | 'widget'
  /** The screen or widget block the file must declare. */
  fileName: string
  catalog: HmiWidgetCatalog
  settings: HmiSettings
  /** Upper-case members of HmiScreen, which elements may not reuse. */
  screenMembers: ReadonlySet<string>
}

export interface HmiCheckFinding {
  message: string
  span?: HmiCheckSpan
}

export const HMI_SCREEN_CAPACITY = 256
export const HMI_STACK_CAPACITY = 64
export const HMI_DIAGRAM_CAPACITY = 256

/** Methods the HMI build adds to every screen. */
const GENERATED_METHODS = [
  ['BUILD', 'Build'],
  ['WRITEBACK', 'WriteBack'],
] as const

/** A plain ST text literal's content, or undefined. */
export function hmiTextLiteral(text: string | undefined): string | undefined {
  const m = text === undefined ? null : /^'([^'$]*)'$/.exec(text.trim())
  return m ? m[1] : undefined
}

const propOf = (e: HmiCheckElement, name: string): HmiCheckProperty | undefined =>
  e.props.find((p) => p.name.toUpperCase() === name)

/** The span of a property's name, from the start of `Name := value`. */
const propNameSpan = (p: HmiCheckProperty): HmiCheckSpan | undefined =>
  p.span ? { start: p.span.start, end: p.span.start + p.name.length } : undefined

/** The block's name, base, generated methods and theme. */
export function checkHmiBlockHeader(block: HmiCheckBlock, ctx: HmiCheckContext): HmiCheckFinding[] {
  const out: HmiCheckFinding[] = []
  const at = (message: string, span: HmiCheckSpan | undefined) => out.push(span ? { message, span } : { message })
  if (block.name.toUpperCase() !== ctx.fileName.toUpperCase())
    at(`the file declares ${block.name}; it must declare FUNCTION_BLOCK ${ctx.fileName}`, block.nameSpan)
  if (ctx.kind === 'widget') return out
  if (block.extends.toUpperCase() !== 'HMISCREEN') at(`${ctx.fileName} must extend HmiScreen`, block.nameSpan)
  for (const [upper, written] of GENERATED_METHODS)
    if (block.methods.has(upper)) at(`the HMI build generates ${written}; remove it`, block.nameSpan)
  const theme = block.theme ?? ctx.settings.defaultTheme
  if (hmiThemeId(ctx.settings, theme) < 0)
    at(`unknown theme '${theme}'`, block.theme === null ? undefined : block.themeSpan)
  return out
}

/** Element names, properties, the Parent tree, capacities and pipe ends. */
export function checkHmiBlockElements(block: HmiCheckBlock, ctx: HmiCheckContext): HmiCheckFinding[] {
  const out: HmiCheckFinding[] = []
  const at = (message: string, span: HmiCheckSpan | undefined) => out.push(span ? { message, span } : { message })
  const { catalog } = ctx
  if (ctx.kind === 'screen')
    for (const e of block.elements)
      if (ctx.screenMembers.has(e.name.toUpperCase()))
        at(`${e.name}: an element may not be named like a member of HmiScreen`, e.nameSpan)
  for (const e of block.elements) {
    const info = catalog.widgets.get(e.type.toUpperCase())
    if (!info) continue
    const known = new Set(info.properties.map((p) => p.name.toUpperCase()))
    for (const p of e.props)
      if (!known.has(p.name.toUpperCase()))
        at(`${e.name}: ${p.name} is not a property of ${info.name}`, propNameSpan(p))
  }

  const byName = new Map(block.elements.map((e) => [e.name.toUpperCase(), e]))
  const parentOf = new Map<HmiCheckElement, HmiCheckElement>()
  for (const e of block.elements) {
    const prop = propOf(e, 'PARENT')
    if (prop === undefined) continue
    const name = hmiTextLiteral(prop.value)
    if (name === undefined) {
      at(`${e.name}: Parent must be a text literal naming a container`, prop.valueSpan)
      continue
    }
    if (name === '') continue
    const parent = byName.get(name.toUpperCase())
    if (!parent) at(`${e.name}: Parent '${name}' is not an element of this screen`, prop.valueSpan)
    else if (!widgetIsA(catalog, parent.type, 'HMISTACK'))
      at(`${e.name}: Parent '${name}' is not a container`, prop.valueSpan)
    else parentOf.set(e, parent)
  }
  for (const e of block.elements) {
    const seen = new Set<HmiCheckElement>([e])
    let p = parentOf.get(e)
    while (p && !seen.has(p)) {
      seen.add(p)
      p = parentOf.get(p)
    }
    if (p) at(`${e.name}: its Parent chain is a cycle`, e.nameSpan)
  }
  if (block.elements.length > HMI_SCREEN_CAPACITY)
    at(`${block.elements.length} elements; a screen holds at most ${HMI_SCREEN_CAPACITY}`, block.nameSpan)
  const held = new Map<HmiCheckElement, number>()
  for (const parent of parentOf.values()) held.set(parent, (held.get(parent) ?? 0) + 1)
  for (const [container, n] of held) {
    const cap = widgetIsA(catalog, container.type, 'HMIDIAGRAM') ? HMI_DIAGRAM_CAPACITY : HMI_STACK_CAPACITY
    if (n > cap) at(`${container.name} holds ${n} elements; at most ${cap}`, container.nameSpan)
  }
  for (const e of block.elements) {
    if (!widgetIsA(catalog, e.type, 'HMIPIPE')) continue
    for (const [upper, written] of [
      ['SOURCE', 'Source'],
      ['TARGET', 'Target'],
    ] as const) {
      const prop = propOf(e, upper)
      const name = hmiTextLiteral(prop?.value)
      if (name === undefined || !byName.has(name.toUpperCase()))
        at(`${e.name}: ${written} must name an element of this screen`, prop?.valueSpan ?? e.nameSpan)
    }
  }
  return out
}

/** Every rule, header first, as the code view marks them. */
export function checkHmiBlock(block: HmiCheckBlock, ctx: HmiCheckContext): HmiCheckFinding[] {
  return [...checkHmiBlockHeader(block, ctx), ...checkHmiBlockElements(block, ctx)]
}
