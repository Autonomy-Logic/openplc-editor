/**
 * Completions the ST language service cannot give for HMI code: initializer properties, enum, color and BOOL values,
 * element names for Parent, Source and Target, and theme names. Works while the code does not parse.
 */
import type { HmiWidgetCatalog, HmiWidgetInfo, HmiWidgetProperty } from '../../ports/hmi-preview-types'
import { widgetIsA } from './designer/designer-canvas'
import { maskStComments } from './references'
import { HMI_BUILTIN_THEMES, type HmiSettings } from './settings'

export interface HmiAssistItem {
  label: string
  insertText: string
  kind: 'property' | 'value' | 'element' | 'theme'
  detail?: string
  documentation?: string
}

/** The element whose initializer holds an offset, with the text of that initializer up to the offset. */
interface InitializerAt {
  element: string
  info: HmiWidgetInfo
  /** Initializer text after `(`, comments and strings blanked. */
  inside: string
}

const ELEMENT_DECLARATION = /([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*:=\s*$/
const DECLARATION = /^[ \t]*([A-Za-z_]\w*)[ \t]*:[ \t]*([A-Za-z_]\w*)/gm
const THEME_PRAGMA = /\{attribute\s+'hmi_theme'\s*:=\s*'([^']*)$/i
const NAME_VALUE = /\b(Parent|Source|Target)\s*:=\s*'([^'\n]*)$/i

function initializerAt(text: string, offset: number, catalog: HmiWidgetCatalog): InitializerAt | null {
  const masked = maskStComments(text.slice(0, offset))
  let depth = 0
  for (let i = masked.length - 1; i >= 0; i--) {
    const c = masked[i]
    if (c === ')') depth++
    else if (c === '(') {
      if (depth > 0) {
        depth--
        continue
      }
      const declared = ELEMENT_DECLARATION.exec(masked.slice(0, i))
      const info = declared ? catalog.widgets.get(declared[2].toUpperCase()) : undefined
      return declared && info ? { element: declared[1], info, inside: masked.slice(i + 1) } : null
    } else if (c === ';') return null
  }
  return null
}

/** The initializer's entries at its own level, the last one being where the cursor is. */
function entries(inside: string): string[] {
  const out = ['']
  let depth = 0
  for (const c of inside) {
    if (c === '(') depth++
    else if (c === ')') depth--
    if (c === ',' && depth === 0) out.push('')
    else out[out.length - 1] += c
  }
  return out
}

const propertyDetail = (p: HmiWidgetProperty): string => `${p.type}${p.defaultValue ? ` := ${p.defaultValue}` : ''}`

function valueItems(property: HmiWidgetProperty, catalog: HmiWidgetCatalog): HmiAssistItem[] {
  switch (property.kind) {
    case 'bool':
      return ['TRUE', 'FALSE'].map((v) => ({ label: v, insertText: v, kind: 'value' }))
    case 'enum':
      return (property.enumMembers ?? []).map((m) => ({
        label: `${property.type}#${m}`,
        insertText: `${property.type}#${m}`,
        kind: 'value',
      }))
    case 'color':
      return catalog.colors.map((c) => ({ label: `COLOR.${c}`, insertText: `COLOR.${c}`, kind: 'value' }))
    default:
      return []
  }
}

/** Elements declared in the block, by the catalog's widget types. */
function declaredElements(text: string, catalog: HmiWidgetCatalog): Array<{ name: string; info: HmiWidgetInfo }> {
  const out: Array<{ name: string; info: HmiWidgetInfo }> = []
  for (const m of maskStComments(text).matchAll(DECLARATION)) {
    const info = catalog.widgets.get(m[2].toUpperCase())
    if (info) out.push({ name: m[1], info })
  }
  return out
}

/** What to offer at `offset`, or null where the ST language service answers alone. */
export function hmiCompletions(
  text: string,
  offset: number,
  catalog: HmiWidgetCatalog,
  settings: HmiSettings,
): HmiAssistItem[] | null {
  const line = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset)
  if (THEME_PRAGMA.test(line))
    return [...HMI_BUILTIN_THEMES, ...settings.themes.map((t) => t.name)].map((t) => ({
      label: t,
      insertText: t,
      kind: 'theme',
    }))

  const named = NAME_VALUE.exec(line)
  if (named) {
    const quote = offset - named[2].length - 1
    const owner = initializerAt(text, quote, catalog)
    if (!owner) return null
    const containersOnly = named[1].toUpperCase() === 'PARENT'
    return declaredElements(text, catalog)
      .filter((e) => e.name.toUpperCase() !== owner.element.toUpperCase())
      .filter((e) => !containersOnly || widgetIsA(catalog, e.info.name, 'HMISTACK'))
      .map((e) => ({ label: e.name, insertText: e.name, kind: 'element', detail: e.info.name }))
  }

  const at = initializerAt(text, offset, catalog)
  if (!at) return null
  const parts = entries(at.inside)
  const current = parts[parts.length - 1]
  const assign = /^\s*([A-Za-z_]\w*)\s*:=\s*([\s\S]*)$/.exec(current)
  if (assign) {
    if (/\S/.test(assign[2]) && !/^[A-Za-z_][\w#.]*$/.test(assign[2].trim())) return null
    const property = at.info.properties.find((p) => p.name.toUpperCase() === assign[1].toUpperCase())
    return property ? valueItems(property, catalog) : null
  }
  if (!/^\s*[A-Za-z_]?\w*$/.test(current)) return null
  const written = new Set(
    parts.slice(0, -1).flatMap((p) => {
      const m = /^\s*([A-Za-z_]\w*)\s*:=/.exec(p)
      return m ? [m[1].toUpperCase()] : []
    }),
  )
  return at.info.properties
    .filter((p) => !written.has(p.name.toUpperCase()))
    .map((p) => ({
      label: p.name,
      insertText: `${p.name} := `,
      kind: 'property',
      detail: propertyDetail(p),
      documentation: `${p.group} property of ${p.declaredBy}`,
    }))
}
