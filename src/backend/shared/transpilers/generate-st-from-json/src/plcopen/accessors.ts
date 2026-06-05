/**
 * PLCOpen-specific accessors over @xmldom DOM elements.
 *
 * Each function mirrors a method that the Python XSD-generated class (or a
 * hand-attached helper in `plcopen/plcopen.py`) exposes. Names and return
 * shapes match Python, so future diffs map 1:1.
 *
 * Phase 1 surface (just enough to walk project → pous → pou → body → content):
 *   - getpous, getpou
 *   - getbody, getcontent, getcontentInstances, getcontentInstance
 *   - getlocalId, getrefLocalId
 *   - getname, getpouType
 *   - getrelPositionXY (returns [x, y] mirroring Python tuple)
 *
 * Deeper accessors (gettype, getvariable, getnegated, …) land in the phases
 * that consume them.
 */

import {
  childElements,
  type Element,
  findChild,
  findChildren,
  getAttr,
  getAttrInt,
} from '../xmlclass/xsdschema'
import type { ProjectTree } from './plcopen'

/* ───────────────────────── project / pou navigation ───────────────────────── */

/**
 * Return all `<pou>` elements under `<types>/<pous>` of a parsed project.
 *
 * Mirrors Python's `project.getpous(exclude=None, filter=None)`:
 *   - `exclude`: skip a pou by `@name`
 *   - `filter`: keep only pous whose `@pouType` is in the list
 *
 * Python returns lxml elements; we return DOM elements in document order.
 */
export function getpous(
  project: ProjectTree | Element,
  options: { exclude?: string; filter?: string[] } = {},
): Element[] {
  const root = isDocument(project) ? project.documentElement : project
  if (!root) return []
  const types = findChild(root, 'types')
  if (!types) return []
  const pousWrapper = findChild(types, 'pous')
  if (!pousWrapper) return []
  let pous = findChildren(pousWrapper, 'pou')

  if (options.exclude !== undefined) {
    pous = pous.filter((p) => getAttr(p, 'name') !== options.exclude)
  }
  if (options.filter && options.filter.length > 0) {
    const allowed = new Set(options.filter)
    pous = pous.filter((p) => {
      const t = getAttr(p, 'pouType')
      return t !== null && allowed.has(t)
    })
  }
  return pous
}

/**
 * Return the single `<pou>` with `@name == name`, or `null`.
 *
 * Mirrors `project.getpou(name)`: Python returns one element when exactly one
 * matches, else `None`. Multiple matches collapse to `null` here as well
 * (the XSD should make multiple matches impossible).
 */
export function getpou(project: ProjectTree | Element, name: string): Element | null {
  const matches = getpous(project).filter((p) => getAttr(p, 'name') === name)
  return matches.length === 1 ? matches[0] : null
}

/* ───────────────────────────── pou / body ─────────────────────────────────── */

/**
 * Return the `<body>` children of a `<pou>`.
 *
 * In the XSD, `body` may be unbounded, so Python returns a list. Real-world
 * POUs have exactly one body; this is preserved to match Python's call sites
 * which do `pou.getbody()[0]`.
 */
export function getbody(pou: Element): Element[] {
  return findChildren(pou, 'body')
}

/**
 * Return the **content wrapper** inside a `<body>`: one of
 * `<LD>`, `<FBD>`, `<SFC>`, `<IL>`, or `<ST>`.
 *
 * Mirrors `body.getcontent()`. The wrapper's local name is what
 * `getLocalTag()` (via `xsdschema.ts`) reports as the body type.
 */
export function getcontent(body: Element): Element | null {
  const els = childElements(body)
  return els.length > 0 ? els[0] : null
}

/**
 * For an LD / FBD / SFC body, return the graphical instance children
 * (contacts, coils, blocks, variables, power rails, …).
 *
 * Mirrors `body.getcontentInstances()` in the Python codebase
 * (`plcopen.py:2294`). For non-graphical body types (IL / ST), Python raises
 * `TypeError`; we mirror that with an error.
 */
export function getcontentInstances(body: Element): Element[] {
  const content = getcontent(body)
  if (!content) return []
  const tag = content.localName
  if (tag !== 'LD' && tag !== 'FBD' && tag !== 'SFC') {
    throw new TypeError(`${tag} body don't have instances!`)
  }
  return childElements(content)
}

/**
 * Return the single graphical instance with `@localId == localId`, or `null`.
 * Mirrors `body.getcontentInstance(local_id)`.
 */
export function getcontentInstance(body: Element, localId: number): Element | null {
  const content = getcontent(body)
  if (!content) return null
  const tag = content.localName
  if (tag !== 'LD' && tag !== 'FBD' && tag !== 'SFC') {
    throw new TypeError(`${tag} body don't have instances!`)
  }
  for (const child of childElements(content)) {
    if (getAttrInt(child, 'localId') === localId) return child
  }
  return null
}

/* ─────────────────────────── leaf attribute getters ────────────────────────── */

/**
 * `@name` of any element that carries one.
 *
 * **Special case** — for `<project>` itself, the Python XSD codegen installs
 * a custom override (plcopen.py at the project-class setup) that returns
 * `self.contentHeader.getname()` instead of `@name` (which `<project>`
 * doesn't carry). We mirror that here so the accessor works uniformly when
 * called on the document root.
 */
export function getname(el: Element): string | null {
  if (el.localName === 'project') {
    const ch = findChild(el, 'contentHeader')
    return ch ? getAttr(ch, 'name') : null
  }
  return getAttr(el, 'name')
}

/** `@pouType` of a `<pou>` ("program" / "function" / "functionBlock"). */
export function getpouType(pou: Element): string | null {
  return getAttr(pou, 'pouType')
}

/** `@localId` of a graphical instance, parsed as a number. */
export function getlocalId(el: Element): number | null {
  return getAttrInt(el, 'localId')
}

/**
 * `@refLocalId` of a `<connection>`. In LD/FBD wiring, the refLocalId is the
 * `localId` of the instance whose output feeds this input.
 */
export function getrefLocalId(el: Element): number | null {
  return getAttrInt(el, 'refLocalId')
}

/**
 * `(x, y)` of an instance's `<relPosition>` child (falling back to `<position>`).
 * Mirrors Python's `getrelPositionXY()`, which returns a 2-tuple of floats.
 * The XSD types these as `xsd:decimal`, so we use `parseFloat`.
 */
export function getrelPositionXY(el: Element): [number, number] | null {
  const pos = findChild(el, 'relPosition') ?? findChild(el, 'position')
  if (!pos) return null
  const x = getAttr(pos, 'x')
  const y = getAttr(pos, 'y')
  if (x === null || y === null) return null
  return [Number.parseFloat(x), Number.parseFloat(y)]
}

/* ─────────────────────────── connection-point access ──────────────────────── */

/**
 * Point on a 2D canvas, mirroring the Python `position` object's `.x` / `.y`.
 */
export interface Point {
  x: number
  y: number
}

/**
 * Read a `<position x=".." y=".."/>` element into a `Point`.
 * Returns `null` if either attribute is missing — matches Python which would
 * raise on missing attributes, but we soften it so callers stay non-nullable.
 */
function readPosition(pos: Element): Point | null {
  const x = getAttr(pos, 'x')
  const y = getAttr(pos, 'y')
  if (x === null || y === null) return null
  return { x: Number.parseFloat(x), y: Number.parseFloat(y) }
}

/**
 * Single `<position>` child of an instance. Mirrors `instance.getposition()`
 * for non-connection elements (blocks, contacts, coils, variables, power
 * rails, …) where Python returns a single Position object with `.x` / `.y`.
 */
export function getposition(el: Element): Point | null {
  const pos = findChild(el, 'position')
  if (!pos) return null
  return readPosition(pos)
}

/**
 * All `<position>` children of a `<connection>` (the polyline vertices).
 *
 * Python overloads `getposition()` to return either a Position or a list
 * depending on the parent element type. We split it into two TS functions so
 * the return type is unambiguous; callers reach for `getpositions` when
 * handling `<connection>` elements, `getposition` everywhere else. This
 * divergence is intentional and recorded in INVENTORY.md.
 */
export function getpositions(el: Element): Point[] {
  const out: Point[] = []
  for (const pos of findChildren(el, 'position')) {
    const p = readPosition(pos)
    if (p) out.push(p)
  }
  return out
}

/**
 * `@formalParameter` attribute. Present on `<variable>` (block I/O) and on
 * `<connection>` elements that disambiguate which output of a multi-output
 * block they connect to.
 */
export function getformalParameter(el: Element): string | null {
  return getAttr(el, 'formalParameter')
}

/** `@typeName` of a `<block>` (its function-block library type). */
export function gettypeName(block: Element): string | null {
  return getAttr(block, 'typeName')
}

/**
 * Direct `<connectionPointIn>` child of an instance. Mirrors Python's
 * attribute-style access `instance.connectionPointIn`. Returns `null` if the
 * instance type has no single inbound connection point (e.g. `<block>`,
 * which uses per-variable `<connectionPointIn>` instead).
 */
export function getconnectionPointIn(el: Element): Element | null {
  return findChild(el, 'connectionPointIn')
}

/**
 * Direct `<connectionPointOut>` child. Mirrors `instance.connectionPointOut`.
 *
 * `<leftPowerRail>` has *multiple* `<connectionPointOut>` children; use
 * `getconnectionPointOutAll` for that case. The Python `getconnectionPointOut`
 * accessor is itself plural for power rails (returns a list) and singular
 * elsewhere — we split it the same way we split `getposition`.
 */
export function getconnectionPointOut(el: Element): Element | null {
  return findChild(el, 'connectionPointOut')
}

/** All `<connectionPointOut>` children — power-rail variant. */
export function getconnectionPointOutAll(el: Element): Element[] {
  return findChildren(el, 'connectionPointOut')
}

/** All `<connectionPointIn>` children — power-rail variant. */
export function getconnectionPointInAll(el: Element): Element[] {
  return findChildren(el, 'connectionPointIn')
}

/**
 * `<connection>` children of a connection point (i.e. the links that wire
 * this point to another instance's output). Mirrors
 * `connector.getconnections()`.
 */
export function getconnections(connectionPoint: Element): Element[] {
  return findChildren(connectionPoint, 'connection')
}

/**
 * `<inputVariables>` wrapper of a `<block>`, or `null` if absent.
 * The wrapper contains the per-input `<variable>` elements.
 */
export function getinputVariables(block: Element): Element | null {
  return findChild(block, 'inputVariables')
}

/** `<outputVariables>` wrapper of a `<block>`. */
export function getoutputVariables(block: Element): Element | null {
  return findChild(block, 'outputVariables')
}

/** `<inOutVariables>` wrapper of a `<block>`. */
export function getinOutVariables(block: Element): Element | null {
  return findChild(block, 'inOutVariables')
}

/**
 * `<variable>` children of an inputVariables / outputVariables / inOutVariables
 * wrapper. Mirrors `wrapper.getvariable()` (the XSD-generated accessor returns
 * a list).
 */
export function getvariable(wrapper: Element): Element[] {
  return findChildren(wrapper, 'variable')
}

/* ───────────────────────── pou interface accessors ───────────────────────── */

/** `<interface>` child of a `<pou>`, or `null` if the POU has no interface. */
export function getinterface(pou: Element): Element | null {
  return findChild(pou, 'interface')
}

/**
 * Variable-list children of an `<interface>`: `<localVars>`, `<inputVars>`,
 * `<outputVars>`, `<inOutVars>`, `<externalVars>`, `<globalVars>`, `<tempVars>`,
 * `<accessVars>`. Returned in document order.
 *
 * The Python pipeline iterates these via `interface.getcontent()`, which on a
 * `<body>` element returns a single element but on `<interface>` returns a
 * list. We split the names so the return type is unambiguous.
 */
export function getinterfaceVarLists(iface: Element): Element[] {
  return childElements(iface).filter((c) => c.localName !== 'documentation' && c.localName !== 'returnType')
}

/**
 * Inner type element of a `<returnType>` (FUNCTION POUs only). Returns the
 * element under `<returnType>` (e.g. `<BOOL/>` or `<derived/>`), or `null`
 * when the interface has no `<returnType>`.
 *
 * Python overloads `getreturnType()` to act both as the wrapper and as a
 * subscriptable list returning the inner element at index `[0]`. We return
 * the inner element directly.
 */
export function getreturnType(iface: Element): Element | null {
  const wrapper = findChild(iface, 'returnType')
  if (!wrapper) return null
  const inner = childElements(wrapper)
  return inner.length > 0 ? inner[0] : null
}

/** `<type>` child of a `<variable>`. */
export function gettype(variable: Element): Element | null {
  return findChild(variable, 'type')
}

/**
 * For an element whose only meaningful child is a single wrapped type
 * (e.g. `<type>`, `<returnType>`, `<baseType>`), return the inner element.
 * Mirrors `wrapper.getcontent()` in the XSD-generated codebase.
 */
export function getcontentOfType(typeWrapper: Element): Element | null {
  const inner = childElements(typeWrapper)
  return inner.length > 0 ? inner[0] : null
}

/** `<initialValue>` of a `<variable>`, or `null`. */
export function getinitialValue(variable: Element): Element | null {
  return findChild(variable, 'initialValue')
}

/**
 * Text value held by a `<simpleValue value="…"/>` (or similar). Python's
 * `initial.getvalue()` walks one level into the initialValue wrapper and
 * reads the `@value` attribute of its single content child.
 */
export function getvalue(initialValue: Element): string | null {
  const inner = getcontentOfType(initialValue)
  if (!inner) return null
  return getAttr(inner, 'value')
}

/** `@address` of a `<variable>` (e.g. `%QX0.0`), or `null`. */
export function getaddress(variable: Element): string | null {
  return getAttr(variable, 'address')
}

/**
 * Boolean varlist attributes. Python returns `True`/`False`; we return `true`/
 * `false`. PLCOpen serializes them as `"true"`/`"false"` strings or omits the
 * attribute for `false`.
 */
function attrBool(el: Element, name: string): boolean {
  const v = getAttr(el, name)
  return v === 'true'
}
export function getconstant(varlist: Element): boolean {
  return attrBool(varlist, 'constant')
}
export function getretain(varlist: Element): boolean {
  return attrBool(varlist, 'retain')
}
export function getnonretain(varlist: Element): boolean {
  return attrBool(varlist, 'nonretain')
}

/* ───────────────────────── array type accessors ──────────────────────────── */

/** `<dimension>` children of an `<array>` type. */
export function getdimension(arrayType: Element): Element[] {
  return findChildren(arrayType, 'dimension')
}

/** `@lower` of a `<dimension>`. Stored as a string in PLCOpen XML. */
export function getlower(dim: Element): string | null {
  return getAttr(dim, 'lower')
}

/** `@upper` of a `<dimension>`. */
export function getupper(dim: Element): string | null {
  return getAttr(dim, 'upper')
}

/** `<baseType>` child of an `<array>` (one level above the actual base type). */
export function getbaseType(arrayType: Element): Element | null {
  return findChild(arrayType, 'baseType')
}

/* ───────────────────── pou-level description / documentation ────────────── */

/**
 * Text body of a `<pou>`'s `<documentation>` child. Returns `""` when the pou
 * has no documentation. Mirrors `pou.getdescription()` (plcopen.py:1527).
 *
 * PLCOpen always wraps the description text inside an `<xhtml:p>` element.
 * Python's `getanyText()` walks down to that `<p>` and returns `lxml.tree.text`
 * — the direct text content (CDATA stays as text). We mirror by finding the
 * `<p>` child and reading its `textContent`; the whitespace between the
 * outer `<documentation>` open tag and the inner `<p>` is not part of the
 * description.
 */
export function getdescription(pou: Element): string {
  const doc = findChild(pou, 'documentation')
  if (!doc) return ''
  const p = findChild(doc, 'p')
  if (!p) return ''
  return p.textContent ?? ''
}

/**
 * `@instanceName` of a `<block>` element. Mirrors `instance.getinstanceName()`.
 * Function-block instances always have this attribute; functions never do.
 */
export function getinstanceName(block: Element): string | null {
  return getAttr(block, 'instanceName')
}

/* ───────────────────── dataType definitions (project-level) ─────────────── */

/**
 * Return every `<dataType>` under `<types>/<dataTypes>` of a project, in
 * document order. Mirrors `project.getdataTypes()` — used by the
 * project-level `TYPE … END_TYPE` emission loop (PLCGenerator.py:634).
 */
export function getdataTypes(project: ProjectTree | Element): Element[] {
  const root = isDocument(project) ? project.documentElement : project
  if (!root) return []
  const types = findChild(root, 'types')
  if (!types) return []
  const wrapper = findChild(types, 'dataTypes')
  if (!wrapper) return []
  return findChildren(wrapper, 'dataType')
}

/**
 * Locate a `<dataType name="X">` under `<types>/<dataTypes>` of a project.
 * Mirrors `project.getdataType(name)` (plcopen.py:525, attached via
 * `gettypeElementFunc("dataType")`).
 */
export function getdataType(
  project: ProjectTree | Element,
  name: string,
): Element | null {
  const root = (project as ProjectTree).documentElement ?? (project as Element)
  if (!root) return null
  const types = findChild(root, 'types')
  if (!types) return null
  const wrapper = findChild(types, 'dataTypes')
  if (!wrapper) return null
  for (const dt of findChildren(wrapper, 'dataType')) {
    if (getAttr(dt, 'name') === name) return dt
  }
  return null
}

/**
 * `<baseType>` child of a `<dataType>` or `<array>` wrapper, returned as
 * a one-level wrapper that callers `getcontentOfType` into to get the
 * actual type element.
 */
export function getdataTypeBaseType(dt: Element): Element | null {
  return findChild(dt, 'baseType')
}

/**
 * `<range>` child of a `<subrangeSigned>` / `<subrangeUnsigned>` content.
 * Carries `@lower` / `@upper` attributes (mirrors `basetype_content.range`).
 */
export function getsubrangeRange(subrangeContent: Element): Element | null {
  return findChild(subrangeContent, 'range')
}

/**
 * `<value>` children of an `<enum>/<values>` wrapper. Returns the list in
 * document order. Each `<value>` has `@name`.
 */
export function getenumValues(enumContent: Element): Element[] {
  const wrap = findChild(enumContent, 'values')
  if (!wrap) return []
  return findChildren(wrap, 'value')
}

/**
 * `<variable>` children of a `<struct>` content. Mirrors
 * `struct_content.getvariable()`. Each variable has `@name`, `<type>` and
 * optionally `<initialValue>`.
 */
export function getstructVariables(structContent: Element): Element[] {
  return findChildren(structContent, 'variable')
}

/* ─────────────────── SFC element attribute accessors ────────────────────── */

/** `@initialStep` on a `<step>` element. Default `false` per XSD. */
export function getinitialStep(step: Element): boolean {
  return getAttr(step, 'initialStep') === 'true'
}

/** `@targetName` on a `<jumpStep>` (the step name to jump to). */
export function gettargetName(jumpStep: Element): string | null {
  return getAttr(jumpStep, 'targetName')
}

/** `@priority` on a `<transition>` (used in `selectionDivergence` ordering). */
export function getpriority(transition: Element): number | null {
  return getAttrInt(transition, 'priority')
}

/**
 * Read the `<condition>` of an SFC transition. Returns a discriminated union:
 *   - `{ kind: 'inline', value: string }` for `<inline name=".."><ST>text</ST></inline>`
 *   - `{ kind: 'reference', value: string }` for `<reference name="X"/>`
 *   - `{ kind: 'connection', value: cpIn Element }` for `<connectionPointIn>`
 *   - `null` if no `<condition>` child exists
 *
 * Mirrors Python's `getconditionContent` (plcopen/plcopen.py:2801).
 */
export type TransitionCondition =
  | { kind: 'inline'; value: string }
  | { kind: 'reference'; value: string }
  | { kind: 'connection'; value: Element }

export function getconditionContent(transition: Element): TransitionCondition | null {
  const condition = findChild(transition, 'condition')
  if (!condition) return null
  const inner = childElements(condition)
  if (inner.length === 0) return null
  const child = inner[0]
  const tag = child.localName
  if (tag === 'reference') {
    return { kind: 'reference', value: getAttr(child, 'name') ?? '' }
  }
  if (tag === 'inline') {
    // <inline name=".."><IL|ST><xhtml:p>text</xhtml:p></IL|ST></inline>
    const bodyChild = childElements(child)[0]
    if (!bodyChild) return { kind: 'inline', value: '' }
    const p = findChild(bodyChild, 'p')
    return { kind: 'inline', value: p?.textContent ?? '' }
  }
  if (tag === 'connectionPointIn') {
    return { kind: 'connection', value: child }
  }
  return null
}

/**
 * Body type of an `<action>` or `<transition>` sub-POU element.
 * Returns the inner body content's local tag (e.g. `"IL"`, `"ST"`, `"LD"`).
 */
export function getbodyType(subPou: Element): string | null {
  const body = findChild(subPou, 'body')
  if (!body) return null
  const content = childElements(body)
  return content.length > 0 ? content[0].localName : null
}

/** Look up a transition sub-POU by name. Mirrors `pou.gettransition(name)`. */
export function gettransition(pou: Element, name: string): Element | null {
  const wrapper = findChild(pou, 'transitions')
  if (!wrapper) return null
  for (const t of findChildren(wrapper, 'transition')) {
    if (getAttr(t, 'name') === name) return t
  }
  return null
}

/** Look up an action sub-POU by name. Mirrors `pou.getaction(name)`. */
export function getaction(pou: Element, name: string): Element | null {
  const wrapper = findChild(pou, 'actions')
  if (!wrapper) return null
  for (const a of findChildren(wrapper, 'action')) {
    if (getAttr(a, 'name') === name) return a
  }
  return null
}

/** Returns true if the POU has an SFC `<step name="X">` in its body. */
export function hasstep(pou: Element, name: string): boolean {
  const bodies = findChildren(pou, 'body')
  if (bodies.length === 0) return false
  const content = childElements(bodies[0])
  if (content.length === 0) return false
  for (const step of findChildren(content[0], 'step')) {
    if (getAttr(step, 'name') === name) return true
  }
  return false
}

/** Normalized form of an `<action>` inside an `<actionBlock>`. */
export interface ActionBlockEntry {
  qualifier: string
  type: 'reference' | 'inline'
  value: string
  duration?: string
  indicator?: string
}

export function getactions(actionBlock: Element): ActionBlockEntry[] {
  const out: ActionBlockEntry[] = []
  for (const action of findChildren(actionBlock, 'action')) {
    const qualifier = getAttr(action, 'qualifier') ?? 'N'
    const ref = findChild(action, 'reference')
    const inline = findChild(action, 'inline')
    let type: 'reference' | 'inline'
    let value: string
    if (ref) {
      type = 'reference'
      value = getAttr(ref, 'name') ?? ''
    } else if (inline) {
      const bodyChild = childElements(inline)[0]
      const p = bodyChild ? findChild(bodyChild, 'p') : null
      value = p?.textContent ?? ''
      type = 'inline'
    } else {
      continue
    }
    const entry: ActionBlockEntry = { qualifier, type, value }
    const duration = getAttr(action, 'duration')
    if (duration !== null) entry.duration = duration
    const indicator = getAttr(action, 'indicator')
    if (indicator !== null) entry.indicator = indicator
    out.push(entry)
  }
  return out
}

/* ───────────────────── SFC sub-pou access (actions, transitions) ────────── */

/**
 * `<action>` children of a POU's `<actions>` wrapper. Mirrors
 * `pou.getactionList()` (plcopen.py): returns `[]` when the pou has no
 * `<actions>` element (i.e. non-SFC POUs).
 *
 * Each returned `<action>` element behaves like a mini-POU — it has its own
 * `<body>` (LD / FBD / ST / IL) and its own `@name`. `getbody(action)`
 * returns its body list just like for a regular POU.
 */
export function getactionList(pou: Element): Element[] {
  const wrapper = findChild(pou, 'actions')
  if (!wrapper) return []
  return findChildren(wrapper, 'action')
}

/**
 * `<transition>` children of a POU's `<transitions>` wrapper. Mirrors
 * `pou.gettransitionList()`. Same shape as `getactionList`: each transition
 * is a mini-POU with its own body.
 *
 * Note: this is **distinct** from the `<transition>` instances inside an
 * SFC body (the diamond shapes between steps). Those are graphical
 * `<transition>` elements; here we collect the named transition sub-POUs
 * the SFC body references.
 */
export function gettransitionList(pou: Element): Element[] {
  const wrapper = findChild(pou, 'transitions')
  if (!wrapper) return []
  return findChildren(wrapper, 'transition')
}

/* ─────────────────── modifier attributes (contact, coil, variable) ──────── */

/**
 * `@negated` attribute on a `<contact>`, `<coil>`, or `<variable>` element.
 * PLCOpen XSD defaults to `"false"` when absent; we mirror by returning
 * `false` for missing.
 */
export function getnegated(el: Element): boolean {
  return getAttr(el, 'negated') === 'true'
}

/**
 * `@storage` modifier on a coil or variable. One of `"none"`, `"set"`,
 * `"reset"` per the XSD's `storageModifierType`. Default `"none"` when
 * absent.
 */
export function getstorage(el: Element): string {
  return getAttr(el, 'storage') ?? 'none'
}

/**
 * `@edge` modifier. One of `"none"`, `"rising"`, `"falling"` per the XSD's
 * `edgeModifierType`. Default `"none"`.
 */
export function getedge(el: Element): string {
  return getAttr(el, 'edge') ?? 'none'
}

/**
 * `@executionOrderId` attribute (FBD/LD execution-order key).
 * Returns `null` when absent — Python's XSD getter returns `None`; the
 * **caller** is responsible for the `or 0` default (mirrors
 * PLCGenerator.py:1329 `instance.getexecutionOrderId() or 0`).
 */
export function getexecutionOrderId(el: Element): number | null {
  return getAttrInt(el, 'executionOrderId')
}

/**
 * Text content of the `<variable>` child element of a `<contact>` or
 * `<coil>` (the variable reference, e.g. `"my_var"` or `"arr[3]"`).
 *
 * Distinct from `getvariable(wrapper)` which returns the LIST of
 * `<variable>` *children* of a block I/O wrapper. The Python XSD codegen
 * produces a single `getvariable` accessor whose return shape depends on
 * which class owns it; TS splits them so the return type is unambiguous.
 */
export function getvariableText(el: Element): string {
  const child = findChild(el, 'variable')
  if (!child) return ''
  return child.textContent ?? ''
}

/* ─────────────────── graphical-instance variable expression ──────────────── */

/**
 * Text inside the `<expression>` child of an `<inVariable>` /
 * `<outVariable>` / `<inOutVariable>`. Returns the empty string if the
 * element is present but empty; `null` if absent.
 */
export function getexpression(instanceVar: Element): string | null {
  const expr = findChild(instanceVar, 'expression')
  if (!expr) return null
  return expr.textContent ?? ''
}

/**
 * Text inside the `<xhtml:p>` of an `<IL>` or `<ST>` body wrapper, or of a
 * `<condition>/<inline>` element. Mirrors the Python XSD `getanyText`
 * extractor (xmlclass/xmlclass.py:580-608): finds the `<p>` child and
 * returns its direct text — same semantics as `getdescription`.
 *
 * Returns `""` when no `<p>` is present (matches Python's behavior of
 * an unset `text` field — distinct from the recurse-everything semantics
 * of DOM `textContent`).
 */
export function getanyText(wrapper: Element): string {
  const p = findChild(wrapper, 'p')
  if (!p) return ''
  return p.textContent ?? ''
}

/* ───────────────────────── instance-kind identification ───────────────────── */

/**
 * Local-tag identifiers for graphical instance elements. Python distinguishes
 * these via XSD-generated classes (`ContactClass`, `InVariableClass`, …); we
 * dispatch on `element.localName`.
 *
 * Add new tags here as later sub-phases need them; centralizing the strings
 * avoids stringly-typed checks scattered through the codebase.
 */
export const InstanceTag = {
  InVariable: 'inVariable',
  OutVariable: 'outVariable',
  InOutVariable: 'inOutVariable',
  Contact: 'contact',
  Coil: 'coil',
  LeftPowerRail: 'leftPowerRail',
  RightPowerRail: 'rightPowerRail',
  Block: 'block',
  Continuation: 'continuation',
  Connector: 'connector',
  Transition: 'transition',
  Jump: 'jumpStep',
  Step: 'step',
} as const

export type InstanceTagValue = (typeof InstanceTag)[keyof typeof InstanceTag]

/* ───────────────────── configuration / resource accessors ────────────────── */

/**
 * Return all `<configuration>` elements under `<instances>/<configurations>`
 * of a parsed project. Mirrors Python's `project.getconfigurations()`.
 */
export function getconfigurations(project: ProjectTree | Element): Element[] {
  const root = isDocument(project) ? project.documentElement : project
  if (!root) return []
  const instances = findChild(root, 'instances')
  if (!instances) return []
  const wrapper = findChild(instances, 'configurations')
  if (!wrapper) return []
  return findChildren(wrapper, 'configuration')
}

/** `<resource>` children of a `<configuration>`. */
export function getresource(configuration: Element): Element[] {
  return findChildren(configuration, 'resource')
}

/** `<globalVars>` children of a `<configuration>` or `<resource>`. */
export function getglobalVars(parent: Element): Element[] {
  return findChildren(parent, 'globalVars')
}

/** `<task>` children of a `<resource>`. */
export function gettask(resource: Element): Element[] {
  return findChildren(resource, 'task')
}

/** `<pouInstance>` children of a `<task>` or `<resource>`. */
export function getpouInstance(parent: Element): Element[] {
  return findChildren(parent, 'pouInstance')
}

/**
 * `@single` of a `<task>`. Python's XSD-generated accessor returns `None` when
 * the attribute is absent, an empty string when present with no value, or the
 * source-signal expression otherwise. We preserve all three signals.
 */
export function getsingle(task: Element): string | null {
  return getAttr(task, 'single')
}

/**
 * `@interval` of a `<task>` (an IEC time-duration literal like `T#20ms`).
 * Returns `null` when absent. Cyclic tasks have this; SINGLE tasks don't.
 */
export function getinterval(task: Element): string | null {
  return getAttr(task, 'interval')
}

/* ──────────────────────────────── helpers ─────────────────────────────────── */

function isDocument(v: ProjectTree | Element): v is ProjectTree {
  return 'documentElement' in v
}
