import type { Element } from '@xmldom/xmldom'

export type { Element }

/**
 * Type predicate narrowing `unknown` to a @xmldom `Element`. Element nodes
 * have `nodeType === 1` per the DOM spec; this guard is the canonical place
 * we encode that fact, so the rest of the module never has to repeat the
 * runtime check or fall back to a cast.
 *
 * Accepts `unknown` (not just `Node`) so it's usable as a JSON-rehydration
 * narrower as well as a DOM-walk narrower. The runtime cost is one nullish
 * + typeof check, negligible inside traversal loops.
 */
export function isElement(value: unknown): value is Element {
  return (
    value !== null &&
    typeof value === 'object' &&
    'nodeType' in value &&
    value.nodeType === 1
  )
}

/**
 * Generic DOM navigation helpers that stand in for the methods the Python
 * XSD codegen attaches to every element class.
 *
 * The Python `PLCOpenParser` (built by `GenerateParserFromXSD`) wraps each
 * lxml element in a dynamically-generated class with `getXxxx()` / `setXxxx()`
 * accessors derived from the XSD. The TS port replaces that machinery with
 * hand-written helpers that walk plain @xmldom DOM nodes.
 *
 * This module holds only the **content-agnostic** primitives. PLCOpen-specific
 * accessors (getpous, getbody, …) live in `plcopen/accessors.ts`.
 */

/**
 * Return the element's local name (the part of the qualified name after the
 * namespace prefix). Mirrors `etree.QName(elem).localname` which is what the
 * Python `getLocalTag()` method ultimately exposes.
 */
export function getLocalTag(el: Element | null | undefined): string {
  if (!el) throw new Error('getLocalTag: element is null/undefined')
  if (el.localName == null) {
    throw new Error(`getLocalTag: element <${el.nodeName}> has no localName`)
  }
  return el.localName
}

/**
 * Iterate immediate child elements with the given local name (any namespace).
 * Returns a plain array so callers can index, sort, or store it freely.
 */
export function findChildren(el: Element, localName: string): Element[] {
  const out: Element[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i)
    if (node && isElement(node) && node.localName === localName) {
      out.push(node)
    }
  }
  return out
}

/**
 * Return the **first** immediate child with the given local name, or `null`.
 *
 * Python's XSD accessor for a `minOccurs=1` element raises if missing; for a
 * `minOccurs=0` element returns `None`. We choose `null` uniformly and let
 * callers assert on it where appropriate.
 */
export function findChild(el: Element, localName: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i)
    if (node && isElement(node) && node.localName === localName) {
      return node
    }
  }
  return null
}

/**
 * All immediate element children (in document order). Useful when iterating
 * a content container whose children may be of mixed types (e.g. a `<body>`
 * has exactly one content element, an LD/FBD body has many instance children).
 */
export function childElements(el: Element): Element[] {
  const out: Element[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i)
    if (node && isElement(node)) out.push(node)
  }
  return out
}

/**
 * Recursively gather all descendant elements with the given local name in
 * document order.
 */
export function findDescendants(el: Element, localName: string): Element[] {
  const out: Element[] = []
  const stack: Element[] = [el]
  while (stack.length > 0) {
    const cur = stack.pop()!
    // Push children in reverse so traversal stays in document order.
    const kids = childElements(cur)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
    if (cur !== el && cur.localName === localName) out.push(cur)
  }
  return out
}

/**
 * Return an attribute as a string, or `null` if absent.
 * Mirrors lxml's `element.get(name)` (which returns `None` when missing).
 */
export function getAttr(el: Element, name: string): string | null {
  if (!el.hasAttribute(name)) return null
  return el.getAttribute(name)
}

/**
 * Return an attribute parsed as an integer.
 *
 * XSD-typed attributes (e.g. `localId: xsd:unsignedLong`) become Python ints
 * after parsing. Callers that know the attribute's XSD type should reach for
 * this helper instead of `getAttr` so the JS-side number type matches.
 *
 * Returns `null` when the attribute is absent. Throws when present but
 * unparseable (matches Python's lxml/xmlschema behavior on bad input).
 */
export function getAttrInt(el: Element, name: string): number | null {
  const raw = getAttr(el, name)
  if (raw === null) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`getAttrInt(${name}): "${raw}" is not an integer`)
  }
  return n
}
