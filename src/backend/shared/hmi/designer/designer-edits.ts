/**
 * The designer's edits of a screen or widget block. Each one changes only the declarations, properties and
 * statements it is about, as text patches on the source, and leaves every other character as it was.
 */
import type { DesignerElement, DesignerModel, DesignerSpan } from './designer-model'

export type DesignerEdit = { ok: true; source: string } | { ok: false; message: string }

interface Patch {
  start: number
  end: number
  text: string
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const PARENT = 'Parent'

/** Applies non-overlapping patches; at one offset a replacement goes before an insertion. */
function applyPatches(source: string, patches: readonly Patch[]): string {
  let out = source
  for (const p of [...patches].sort((a, b) => b.start - a.start || b.end - a.end))
    out = out.slice(0, p.start) + p.text + out.slice(p.end)
  return out
}

/** `region` of the source with the patches that fall inside it applied. */
function patchWithin(source: string, region: DesignerSpan, patches: readonly Patch[]): string {
  const local = patches.map((p) => ({ start: p.start - region.start, end: p.end - region.start, text: p.text }))
  return applyPatches(source.slice(region.start, region.end), local)
}

const ok = (source: string): DesignerEdit => ({ ok: true, source })
const refuse = (message: string): DesignerEdit => ({ ok: false, message })

/** An ST string literal holding `text`. */
export function stString(text: string): string {
  return `'${text.replace(/\$/g, '$$$$').replace(/'/g, "$$'")}'`
}

const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

function findElement(model: DesignerModel, name: string): DesignerElement | undefined {
  return model.elements.find((e) => same(e.name, name))
}

function editable(model: DesignerModel, name: string): DesignerElement | string {
  const element = findElement(model, name)
  if (!element) return `${name} is not an element of ${model.name}`
  if (element.locked) return `${element.name} is edited in the code view: ${element.locked}`
  return element
}

/** Patches that set one property of an element. */
function propertyPatches(element: DesignerElement, property: string, value: string): Patch[] {
  const existing = element.props.find((p) => same(p.name, property))
  if (existing) return [{ ...existing.valueSpan, text: value }]
  if (!element.initializer)
    return [{ start: element.typeEnd, end: element.typeEnd, text: ` := (${property} := ${value})` }]
  const last = element.props.at(-1)
  if (!last) return [{ ...element.initializer, text: `(${property} := ${value})` }]
  return [{ start: last.span.end, end: last.span.end, text: `, ${property} := ${value}` }]
}

/** Patches that remove one property of an element; none when it is not set. */
function removalPatches(element: DesignerElement, property: string): Patch[] {
  const index = element.props.findIndex((p) => same(p.name, property))
  if (index < 0) return []
  if (element.props.length === 1 && element.initializer)
    return [{ start: element.typeEnd, end: element.initializer.end, text: '' }]
  const prop = element.props[index]
  const next = element.props[index + 1]
  if (next) return [{ start: prop.span.start, end: next.span.start, text: '' }]
  return [{ start: element.props[index - 1].span.end, end: prop.span.end, text: '' }]
}

/** Sets a property to an ST value, adding it when the element does not set it yet. */
export function setProperty(
  source: string,
  model: DesignerModel,
  element: string,
  property: string,
  value: string,
): DesignerEdit {
  const target = editable(model, element)
  if (typeof target === 'string') return refuse(target)
  return ok(applyPatches(source, propertyPatches(target, property, value)))
}

/** Removes a property, so the element takes its default. */
export function removeProperty(source: string, model: DesignerModel, element: string, property: string): DesignerEdit {
  const target = editable(model, element)
  if (typeof target === 'string') return refuse(target)
  return ok(applyPatches(source, removalPatches(target, property)))
}

/** The first free name `base1`, `base2`, ... among the block's members. */
export function nextElementName(model: DesignerModel, base: string): string {
  const stem = base.replace(/[^A-Za-z0-9_]/g, '') || 'Element'
  for (let n = 1; ; n++) {
    const candidate = `${stem}${n}`
    if (!model.members.has(candidate.toUpperCase())) return candidate
  }
}

/** Why `name` cannot name a new element of the block, or null. */
export function elementNameProblem(model: DesignerModel, name: string): string | null {
  if (!IDENTIFIER.test(name)) return `${name} is not a valid name`
  if (model.members.has(name.toUpperCase())) return `${model.name} already has a member named ${name}`
  return null
}

/** The elements under `name` (its children, theirs, ...), in declaration order. */
export function descendants(model: DesignerModel, name: string): DesignerElement[] {
  const found = new Set([name.toUpperCase()])
  let grew = true
  while (grew) {
    grew = false
    for (const e of model.elements) {
      if (e.parent !== null && found.has(e.parent.toUpperCase()) && !found.has(e.name.toUpperCase())) {
        found.add(e.name.toUpperCase())
        grew = true
      }
    }
  }
  return model.elements.filter((e) => found.has(e.name.toUpperCase()) && !same(e.name, name))
}

/**
 * Where an element placed under `parent` before `before` (or last) is declared: before that sibling, or after the
 * last element of the parent's subtree, or after every declaration when the parent is the screen.
 */
function placement(model: DesignerModel, parent: string | null, before: string | null, ignore?: string): number {
  if (before !== null) {
    const sibling = findElement(model, before)
    if (sibling) return sibling.lines.start
  }
  const subtree =
    parent === null
      ? model.elements
      : [...model.elements.filter((e) => same(e.name, parent)), ...descendants(model, parent)]
  const last = subtree.filter((e) => ignore === undefined || !same(e.name, ignore)).at(-1)
  return last ? last.lines.end : model.declarationAt
}

export interface NewElement {
  type: string
  /** A free name is chosen from the type when absent. */
  name?: string
  /** Properties other than Parent, as ST values. */
  props?: ReadonlyArray<[string, string]>
  parent: string | null
  /** The sibling it goes before; last when null. */
  before?: string | null
}

/** The declaration text of a new element, one line with its indentation. */
function declarationText(model: DesignerModel, name: string, spec: NewElement): string {
  const props = [...(spec.parent !== null ? [[PARENT, stString(spec.parent)]] : []), ...(spec.props ?? [])]
  const init = props.length > 0 ? ` := (${props.map(([k, v]) => `${k} := ${v}`).join(', ')})` : ''
  return `${model.declarationIndent}${name} : ${spec.type}${init};\n`
}

/** Declares a new element; returns the source and the name it got. */
export function addElement(source: string, model: DesignerModel, spec: NewElement): DesignerEdit & { name?: string } {
  const name = spec.name ?? nextElementName(model, spec.type.replace(/^Hmi/i, ''))
  const problem = elementNameProblem(model, name)
  if (problem) return refuse(problem)
  if (spec.parent !== null && !findElement(model, spec.parent))
    return refuse(`${spec.parent} is not an element of ${model.name}`)
  const text = declarationText(model, name, spec)
  const at = placement(model, spec.parent, spec.before ?? null)
  const block = model.needsVarBlock
    ? `${model.declarationIndent}VAR\n${model.declarationIndent}${text}${model.declarationIndent}END_VAR\n`
    : text
  return { ...ok(applyPatches(source, [{ start: at, end: at, text: block }])), name }
}

/** Deletes elements with everything under them, and their bindings and event handlers. */
export function deleteElements(source: string, model: DesignerModel, names: readonly string[]): DesignerEdit {
  const doomed = new Map<string, DesignerElement>()
  for (const name of names) {
    const target = editable(model, name)
    if (typeof target === 'string') return refuse(target)
    for (const e of [target, ...descendants(model, name)]) {
      if (e.locked) return refuse(`${e.name} is edited in the code view: ${e.locked}`)
      doomed.set(e.name.toUpperCase(), e)
    }
  }
  const gone = (element: string): boolean => doomed.has(element.toUpperCase())
  const patches: Patch[] = [
    ...[...doomed.values()].map((e) => ({ ...e.lines, text: '' })),
    ...model.bindings.filter((b) => gone(b.element)).map((b) => ({ ...b.lines, text: '' })),
    ...model.events.filter((e) => gone(e.element)).map((e) => ({ ...e.lines, text: '' })),
  ]
  return ok(applyPatches(source, patches))
}

/** Moves an element under another parent (null: the screen), before a sibling or last. */
export function moveElement(
  source: string,
  model: DesignerModel,
  name: string,
  parent: string | null,
  before: string | null,
): DesignerEdit {
  const target = editable(model, name)
  if (typeof target === 'string') return refuse(target)
  if (parent !== null) {
    if (same(parent, name) || descendants(model, name).some((e) => same(e.name, parent)))
      return refuse(`${target.name} cannot go inside itself`)
    if (!findElement(model, parent)) return refuse(`${parent} is not an element of ${model.name}`)
  }
  if (before !== null && same(before, name)) return ok(source)
  const parentPatches =
    parent === null ? removalPatches(target, PARENT) : propertyPatches(target, PARENT, stString(parent))
  const moved = patchWithin(source, target.lines, parentPatches)
  const at = placement(model, parent, before, name)
  if (at > target.lines.start && at < target.lines.end)
    return ok(applyPatches(source, [{ ...target.lines, text: moved }]))
  return ok(
    applyPatches(source, [
      { ...target.lines, text: '' },
      { start: at, end: at, text: moved },
    ]),
  )
}

export interface RenameOptions {
  /** Whether a property of a type holds an element name (Parent always does). */
  refersToElement?: (type: string, property: string) => boolean
}

/** Renames an element: its declaration, the properties that name it and every use in the code. */
export function renameElement(
  source: string,
  model: DesignerModel,
  name: string,
  newName: string,
  options: RenameOptions = {},
): DesignerEdit {
  const target = editable(model, name)
  if (typeof target === 'string') return refuse(target)
  if (same(name, newName)) return ok(applyPatches(source, [{ ...target.nameSpan, text: newName }]))
  const problem = elementNameProblem(model, newName)
  if (problem) return refuse(problem)
  const refers = (type: string, property: string): boolean =>
    same(property, PARENT) || (options.refersToElement?.(type, property) ?? false)
  const patches: Patch[] = [{ ...target.nameSpan, text: newName }]
  for (const e of model.elements) {
    for (const p of e.props) {
      if (!refers(e.type, p.name)) continue
      const value = /^'((?:[^'$]|\$.)*)'$/s.exec(p.value.trim())?.[1]
      if (value !== undefined && same(value, name)) patches.push({ ...p.valueSpan, text: stString(newName) })
    }
  }
  for (const use of model.uses) if (use.name === name.toUpperCase()) patches.push({ ...use.span, text: newName })
  return ok(applyPatches(source, patches))
}

/** Binds a property to a PLC variable (`POU.Name` / `GVL.Name`), or removes the binding when variable is null. */
export function setBinding(
  source: string,
  model: DesignerModel,
  element: string,
  property: string,
  variable: string | null,
): DesignerEdit {
  const target = editable(model, element)
  if (typeof target === 'string') return refuse(target)
  if (variable !== null && !/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(variable))
    return refuse(`${variable} is not a PLC variable`)
  const existing = model.bindings.find((b) => same(b.element, element) && same(b.property, property))
  const line = variable === null ? '' : bindingStatement(model, target.name, property, variable)
  if (existing) return ok(applyPatches(source, [{ ...existing.lines, text: line }]))
  if (variable === null) return ok(source)
  return ok(applyPatches(source, [{ start: model.statementAt, end: model.statementAt, text: line }]))
}

/** `Element.Property := Variable;` as a body line. */
export function bindingStatement(model: DesignerModel, element: string, property: string, variable: string): string {
  return `${model.statementIndent}${element}.${property} := ${variable};\n`
}

/** `IF Element.Event THEN code END_IF;` as body lines; empty for no code. */
export function eventStatement(model: DesignerModel, element: string, event: string, code: string): string {
  const indent = model.statementIndent
  const lines = code
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return ''
  return `${indent}IF ${element}.${event} THEN\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}END_IF;\n`
}

/** Sets what happens on an element's event (`IF E.Event THEN code END_IF;`), or removes it when code is null. */
export function setEvent(
  source: string,
  model: DesignerModel,
  element: string,
  event: string,
  code: string | null,
): DesignerEdit {
  const target = editable(model, element)
  if (typeof target === 'string') return refuse(target)
  const body = code === null ? '' : eventStatement(model, target.name, event, code)
  const existing = model.events.find((e) => same(e.element, element) && same(e.event, event))
  if (existing) return ok(applyPatches(source, [{ ...existing.lines, text: body }]))
  if (body === '') return ok(source)
  return ok(applyPatches(source, [{ start: model.statementAt, end: model.statementAt, text: body }]))
}

/** Sets the block's theme pragma, or removes it when theme is null (the project's default theme). */
export function setTheme(source: string, model: DesignerModel, theme: string | null): DesignerEdit {
  const line = theme === null ? '' : `{attribute 'hmi_theme' := ${stString(theme)}}\n`
  if (model.themeLines) return ok(applyPatches(source, [{ ...model.themeLines, text: line }]))
  if (theme === null) return ok(source)
  return ok(applyPatches(source, [{ start: model.headerStart, end: model.headerStart, text: line }]))
}

/** An element a paste declares: its final name, and its parent among the pasted ones or the paste's target. */
export interface PastedElement {
  name: string
  type: string
  parent: string | null
  props: ReadonlyArray<[string, string]>
}

/**
 * Declares pasted elements in order under `parent` (null: the screen), before a sibling or last, and appends their
 * body statements. Names must already be free.
 */
export function pasteDeclarations(
  source: string,
  model: DesignerModel,
  elements: readonly PastedElement[],
  parent: string | null,
  before: string | null,
  statements: readonly string[],
): DesignerEdit {
  if (parent !== null && !findElement(model, parent)) return refuse(`${parent} is not an element of ${model.name}`)
  for (const e of elements) {
    if (!IDENTIFIER.test(e.name)) return refuse(`${e.name} is not a valid name`)
    if (model.members.has(e.name.toUpperCase())) return refuse(`${model.name} already has a member named ${e.name}`)
  }
  const declarations = elements
    .map((e) => declarationText(model, e.name, { type: e.type, parent: e.parent, props: e.props }))
    .join('')
  const at = placement(model, parent, before)
  const block = model.needsVarBlock
    ? `${model.declarationIndent}VAR\n${declarations.replace(/^/gm, model.declarationIndent).replace(new RegExp(`${model.declarationIndent}$`), '')}${model.declarationIndent}END_VAR\n`
    : declarations
  const body = statements.join('')
  const patches: Patch[] = [{ start: at, end: at, text: block }]
  if (body !== '') patches.push({ start: model.statementAt, end: model.statementAt, text: body })
  return ok(applyPatches(source, patches))
}
