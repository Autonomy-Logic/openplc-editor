/**
 * Build a PLCOpen `Document` directly from the IR — no XML string
 * round-trip.  Replaces the Phase 0 `irToPlcOpenXml` (xmlbuilder2
 * serialise) + `LoadProjectXML` (xmldom parse) pair with one
 * DOM-construction pass using `xmldom`'s `DOMImplementation`.
 *
 * Only used when the project contains graphical POUs (LD / FBD /
 * SFC) — purely textual projects skip DOM construction entirely via
 * the IR-native emitters in `ir-emit/`.  The DOM produced here gets
 * walked by the existing accessors in `src/plcopen/accessors.ts`,
 * which expect the standard PLCOpen tag shape this builder emits.
 *
 * The IR's graphical bodies carry `xmlBody` — an xmlbuilder2 plain
 * object (`{ body: { LD: {…} } }` etc.) the adapters built via
 * `ladderToXml` / `fbdToXml`.  `objectToDom` walks that object and
 * materialises matching DOM elements; the xmlbuilder2 conventions
 * (`'@attr'` for attributes, `'$'` for CDATA-style text, arrays for
 * repeated children) map straight to DOM API calls.
 */

import type { Document, Element } from '@xmldom/xmldom'
import { DOMImplementation } from '@xmldom/xmldom'

import type {
  TranspileBody,
  TranspileDataType,
  TranspilePou,
  TranspilePouKind,
  TranspileProject,
  TranspileTask,
  TranspileVariable,
  TranspileVariableType,
} from './types'

/* ─────────────────────────── namespaces / constants ─────────────────────── */

const TC6_NS = 'http://www.plcopen.org/xml/tc6_0201'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

const BASE_PLC_TYPES: ReadonlySet<string> = new Set([
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'WSTRING',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
])

/* ─────────────────────────── public entry ───────────────────────────────── */

export function irToPlcOpenDom(project: TranspileProject): Document {
  const doc = new DOMImplementation().createDocument(TC6_NS, 'project', null)
  const root = doc.documentElement
  if (!root) throw new Error('irToPlcOpenDom: DOMImplementation returned a document with no root element')

  root.setAttribute('xmlns:xsd', 'http://www.w3.org/2001/XMLSchema-instance')
  root.setAttribute('xmlns:xhtml', XHTML_NS)
  root.setAttribute('xmlns:ns1', TC6_NS)

  const now = new Date().toISOString()
  appendChildEl(doc, root, 'fileHeader', {
    companyName: 'Unknown',
    productName: 'Unnamed',
    productVersion: '1',
    creationDateTime: now,
  })
  const contentHeader = appendChildEl(doc, root, 'contentHeader', {
    name: 'Unnamed',
    modificationDateTime: now,
  })
  const coordinateInfo = appendChildEl(doc, contentHeader, 'coordinateInfo')
  for (const lang of ['fbd', 'ld', 'sfc']) {
    const langEl = appendChildEl(doc, coordinateInfo, lang)
    appendChildEl(doc, langEl, 'scaling', { x: '16', y: '16' })
  }

  // <types><dataTypes>…</dataTypes><pous>…</pous></types>
  const types = appendChildEl(doc, root, 'types')
  const dataTypesEl = appendChildEl(doc, types, 'dataTypes')
  for (const dt of project.dataTypes) {
    appendDataType(doc, dataTypesEl, dt)
  }
  const pousEl = appendChildEl(doc, types, 'pous')
  for (const pou of project.pous) {
    appendPou(doc, pousEl, pou)
  }

  // <instances><configurations><configuration>…</configuration></configurations></instances>
  const instances = appendChildEl(doc, root, 'instances')
  const configurations = appendChildEl(doc, instances, 'configurations')
  const configuration = appendChildEl(doc, configurations, 'configuration', { name: 'Config0' })
  const resource = appendChildEl(doc, configuration, 'resource', { name: 'Res0' })
  for (const task of project.configuration.tasks) {
    appendTask(doc, resource, task, project.configuration.instances)
  }
  if (project.configuration.globalVariables.length > 0) {
    const globalVars = appendChildEl(doc, configuration, 'globalVars')
    for (const v of project.configuration.globalVariables) {
      appendVariable(doc, globalVars, v)
    }
  }

  return doc
}

/* ─────────────────────────── POU emission ───────────────────────────────── */

function appendPou(doc: Document, parent: Element, pou: TranspilePou): void {
  const pouEl = appendChildEl(doc, parent, 'pou', {
    name: pou.name,
    pouType: pouTypeToXml(pou.pouType),
  })
  appendInterface(doc, pouEl, pou)
  appendBody(doc, pouEl, pou.body)
  const documentation = appendChildEl(doc, pouEl, 'documentation')
  appendXhtmlP(doc, documentation, pou.documentation || ' ')
}

function pouTypeToXml(pouType: TranspilePouKind): string {
  return pouType === 'function-block' ? 'functionBlock' : pouType
}

function appendInterface(doc: Document, parent: Element, pou: TranspilePou): void {
  const variables = pou.interface?.variables ?? []
  const returnType = pou.pouType === 'function' ? pou.interface?.returnType : undefined
  if (variables.length === 0 && !returnType) return

  const interfaceEl = appendChildEl(doc, parent, 'interface')
  if (returnType) {
    const returnEl = appendChildEl(doc, interfaceEl, 'returnType')
    appendTypeLeaf(doc, returnEl, returnType)
  }

  const classToTag: Record<string, string> = {
    input: 'inputVars',
    output: 'outputVars',
    inOut: 'inOutVars',
    external: 'externalVars',
    local: 'localVars',
    temp: 'tempVars',
  }
  const groups = new Map<string, TranspileVariable[]>()
  for (const v of variables) {
    const tag = classToTag[v.class ?? 'local']
    if (!tag) continue
    const bucket = groups.get(tag) ?? []
    bucket.push(v)
    groups.set(tag, bucket)
  }
  for (const [tag, bucket] of groups) {
    const groupEl = appendChildEl(doc, interfaceEl, tag)
    for (const v of bucket) {
      appendVariable(doc, groupEl, v)
    }
  }
}

function appendBody(doc: Document, parent: Element, body: TranspileBody): void {
  switch (body.language) {
    case 'st':
    case 'python':
    case 'cpp': {
      const bodyEl = appendChildEl(doc, parent, 'body')
      const stEl = appendChildEl(doc, bodyEl, 'ST')
      appendXhtmlP(doc, stEl, body.value)
      return
    }
    case 'il': {
      const bodyEl = appendChildEl(doc, parent, 'body')
      const ilEl = appendChildEl(doc, bodyEl, 'IL')
      appendXhtmlP(doc, ilEl, body.value)
      return
    }
    case 'ld':
    case 'fbd':
    case 'sfc':
      // Graphical body: the adapter pre-rendered the
      // `{ body: { LD|FBD|SFC: {…} } }` xmlbuilder2 plain object.
      // Materialise it into DOM directly.
      objectToDom(doc, parent, body.xmlBody)
      return
  }
}

/* ─────────────────────────── variable emission ──────────────────────────── */

function appendVariable(doc: Document, parent: Element, v: TranspileVariable): void {
  const variableEl = appendChildEl(doc, parent, 'variable', { name: v.name })
  if (v.location) variableEl.setAttribute('address', v.location)

  const typeEl = appendChildEl(doc, variableEl, 'type')
  appendTypeContent(doc, typeEl, v.type)

  if (v.initialValue !== undefined && v.initialValue !== '') {
    const ivEl = appendChildEl(doc, variableEl, 'initialValue')
    appendChildEl(doc, ivEl, 'simpleValue', { value: v.initialValue })
  }

  if (v.documentation) {
    const docEl = appendChildEl(doc, variableEl, 'documentation')
    appendXhtmlP(doc, docEl, v.documentation)
  }
}

function appendTypeContent(doc: Document, parent: Element, type: TranspileVariableType): void {
  if (type.definition === 'array') {
    const arrayEl = appendChildEl(doc, parent, 'array')
    for (const d of type.data.dimensions) {
      const [lower, upper] = d.dimension.split('..')
      appendChildEl(doc, arrayEl, 'dimension', { lower, upper })
    }
    const baseTypeEl = appendChildEl(doc, arrayEl, 'baseType')
    const baseName = typeof type.data.baseType === 'string' ? type.data.baseType : type.data.baseType.value
    appendTypeLeaf(doc, baseTypeEl, baseName)
    return
  }
  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    appendChildEl(doc, parent, 'derived', { name: type.value })
    return
  }
  // base-type
  appendTypeLeaf(doc, parent, type.value)
}

/**
 * Emit a single elementary IEC type element (`<BOOL/>`, `<INT/>`,
 * `<string/>` lower-cased, …) or a `<derived name="X"/>` wrapper
 * when the typename isn't elementary.
 */
function appendTypeLeaf(doc: Document, parent: Element, typeName: string): void {
  const normalized = typeName.trim()
  const upper = normalized.toUpperCase()
  if (BASE_PLC_TYPES.has(upper)) {
    const tag = upper === 'STRING' ? 'string' : upper === 'WSTRING' ? 'wstring' : upper
    appendChildEl(doc, parent, tag)
    return
  }
  appendChildEl(doc, parent, 'derived', { name: normalized })
}

/* ─────────────────────────── data-type emission ─────────────────────────── */

function appendDataType(doc: Document, parent: Element, dt: TranspileDataType): void {
  const dtEl = appendChildEl(doc, parent, 'dataType', { name: dt.name })

  if (dt.derivation === 'array') {
    const baseTypeEl = appendChildEl(doc, dtEl, 'baseType')
    const arrayEl = appendChildEl(doc, baseTypeEl, 'array')
    for (const d of dt.dimensions) {
      const [lower, upper] = d.dimension.split('..')
      appendChildEl(doc, arrayEl, 'dimension', { lower, upper })
    }
    const innerBaseEl = appendChildEl(doc, arrayEl, 'baseType')
    appendTypeLeaf(doc, innerBaseEl, typeof dt.baseType === 'string' ? dt.baseType : dt.baseType.value)
    if (dt.initialValue) {
      const ivEl = appendChildEl(doc, dtEl, 'initialValue')
      appendChildEl(doc, ivEl, 'simpleValue', { value: dt.initialValue })
    }
    return
  }
  if (dt.derivation === 'enumerated') {
    const baseTypeEl = appendChildEl(doc, dtEl, 'baseType')
    const enumEl = appendChildEl(doc, baseTypeEl, 'enum')
    const valuesEl = appendChildEl(doc, enumEl, 'values')
    for (const v of dt.values) {
      appendChildEl(doc, valuesEl, 'value', { name: v.description })
    }
    if (dt.initialValue) {
      const ivEl = appendChildEl(doc, dtEl, 'initialValue')
      appendChildEl(doc, ivEl, 'simpleValue', { value: dt.initialValue })
    }
    return
  }
  if (dt.derivation === 'structure') {
    const baseTypeEl = appendChildEl(doc, dtEl, 'baseType')
    const structEl = appendChildEl(doc, baseTypeEl, 'struct')
    for (const v of dt.variable) {
      const fieldEl = appendChildEl(doc, structEl, 'variable', { name: v.name })
      const typeEl = appendChildEl(doc, fieldEl, 'type')
      appendTypeContent(doc, typeEl, v.type)
      if (v.initialValue !== undefined && v.initialValue !== '') {
        const ivEl = appendChildEl(doc, fieldEl, 'initialValue')
        appendChildEl(doc, ivEl, 'simpleValue', { value: v.initialValue })
      }
    }
    return
  }
  // directly-derived
  const baseTypeEl = appendChildEl(doc, dtEl, 'baseType')
  appendTypeLeaf(doc, baseTypeEl, dt.baseType)
  if (dt.initialValue) {
    const ivEl = appendChildEl(doc, dtEl, 'initialValue')
    appendChildEl(doc, ivEl, 'simpleValue', { value: dt.initialValue })
  }
}

/* ─────────────────────────── configuration emission ─────────────────────── */

function appendTask(
  doc: Document,
  parent: Element,
  task: TranspileTask,
  allInstances: TranspileProject['configuration']['instances'],
): void {
  const attrs: Record<string, string> = {
    name: task.name,
    priority: String(task.priority),
  }
  if (task.triggering === 'Cyclic') {
    attrs.interval = task.interval ?? ''
  } else {
    attrs.single = task.single ?? ''
  }
  const taskEl = appendChildEl(doc, parent, 'task', attrs)
  for (const inst of allInstances) {
    if (inst.task !== task.name) continue
    appendChildEl(doc, taskEl, 'pouInstance', { name: inst.name, typeName: inst.program })
  }
}

/* ─────────────────────────── generic object→DOM ─────────────────────────── */

/**
 * Walk an xmlbuilder2 plain object and materialise matching DOM
 * elements under `parent`.  Conventions mirrored:
 *
 *   - Key prefixed `'@'` → attribute on `parent`.
 *   - Key `'$'` → text content on `parent` (used by xmlbuilder2 to
 *     emit CDATA-like body strings).
 *   - Key with array value → emit one child element per array entry,
 *     all named after the key.
 *   - Key with object value → emit one child element named after the
 *     key and recurse into its content.
 *   - Key with `xhtml:` namespace prefix → element placed under the
 *     XHTML namespace.
 *   - Anything else (string, number, boolean) → emit a child element
 *     with `textContent = String(value)`.
 *
 * Handles every shape `ladderToXml` and `fbdToXml` produce.
 */
function objectToDom(doc: Document, parent: Element, obj: unknown): void {
  if (obj === null || typeof obj !== 'object') return
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.startsWith('@')) {
      parent.setAttribute(key.slice(1), String(value))
      continue
    }
    if (key === '$' || key === '#text') {
      parent.appendChild(doc.createTextNode(String(value)))
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = createNamedElement(doc, key)
        if (item !== null && typeof item === 'object') {
          objectToDom(doc, child, item)
        } else if (item !== undefined) {
          child.appendChild(doc.createTextNode(String(item)))
        }
        parent.appendChild(child)
      }
      continue
    }
    const child = createNamedElement(doc, key)
    if (value !== null && typeof value === 'object') {
      objectToDom(doc, child, value)
    } else if (value !== undefined && value !== '') {
      child.appendChild(doc.createTextNode(String(value)))
    }
    parent.appendChild(child)
  }
}

function createNamedElement(doc: Document, key: string): Element {
  // xhtml:p → XHTML namespace; otherwise TC6.
  if (key.startsWith('xhtml:')) return doc.createElementNS(XHTML_NS, key)
  return doc.createElementNS(TC6_NS, key)
}

/* ─────────────────────────── helpers ────────────────────────────────────── */

function appendChildEl(doc: Document, parent: Element, name: string, attrs?: Record<string, string>): Element {
  const el = doc.createElementNS(TC6_NS, name)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  }
  parent.appendChild(el)
  return el
}

function appendXhtmlP(doc: Document, parent: Element, text: string): void {
  const p = doc.createElementNS(XHTML_NS, 'xhtml:p')
  // The DOM walker reads textContent off `<xhtml:p>`; CDATA vs text
  // node makes no observable difference for the consumer.
  p.appendChild(doc.createTextNode(text))
  parent.appendChild(p)
}
