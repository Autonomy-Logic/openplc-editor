/**
 * What the visual designer edits in a screen or widget block, read from the STruC++ syntax tree with the source
 * spans an edit needs: the elements with their properties, the bindings and event handlers in the body, where new
 * declarations and statements go, and every use of an identifier. Spans are offsets into the source, end exclusive.
 */
import type { FunctionBlockDeclaration, SourceSpan, Statement, VarDeclaration, VariableExpression } from 'strucpp'

import { loadStrucpp } from '../../library/strucpp-runtime'
import { SourceText } from '../unit/screen-model'

export interface DesignerSpan {
  start: number
  end: number
}

/** `Name := value` inside an element's initializer. */
export interface DesignerProperty {
  /** Name as written. */
  name: string
  /** Value as ST text. */
  value: string
  span: DesignerSpan
  valueSpan: DesignerSpan
}

export interface DesignerElement {
  /** Name as written. */
  name: string
  /** Type as written. */
  type: string
  /** The element named by its Parent property; null for one placed on the screen itself. */
  parent: string | null
  props: DesignerProperty[]
  /** The declaration's whole lines, indentation and line break included. */
  lines: DesignerSpan
  /** `(...)` after `:=`; null without an initializer. */
  initializer: DesignerSpan | null
  /** Where `:= (...)` goes when there is no initializer: right after the type. */
  typeEnd: number
  nameSpan: DesignerSpan
  indent: string
  /** Why the designer may not edit it, or null. */
  locked: string | null
}

/** `Element.Property := POU.Variable;` in the body. */
export interface DesignerBinding {
  element: string
  property: string
  variable: string
  lines: DesignerSpan
}

/** `IF Element.Event THEN ... END_IF;` in the body. */
export interface DesignerEvent {
  element: string
  event: string
  /** The statements between THEN and END_IF, as written. */
  code: string
  lines: DesignerSpan
}

/** A use of an identifier in the body, a method or a property. */
export interface DesignerUse {
  /** Upper-case name. */
  name: string
  span: DesignerSpan
}

export interface DesignerModel {
  /** Name as written. */
  name: string
  extends: string
  theme: string | null
  /** The `{attribute 'hmi_theme' := ...}` pragma's whole line; null without one. */
  themeLines: DesignerSpan | null
  /** Start of the line holding FUNCTION_BLOCK, where a pragma goes. */
  headerStart: number
  elements: DesignerElement[]
  bindings: DesignerBinding[]
  events: DesignerEvent[]
  uses: DesignerUse[]
  /** Upper-case names of the block's variables and methods, elements included. */
  members: ReadonlySet<string>
  /** Where a declaration goes after the last one: inside the last VAR block, or a new VAR block when there is none. */
  declarationAt: number
  /** Whether a new declaration needs a VAR block around it. */
  needsVarBlock: boolean
  declarationIndent: string
  /** Where a body statement goes: after the last one, before END_FUNCTION_BLOCK. */
  statementAt: number
  statementIndent: string
}

export type DesignerParse =
  | { ok: true; model: DesignerModel }
  | { ok: false; errors: Array<{ line: number; message: string }> }

const DEFAULT_INDENT = '  '

/** The whole lines a span sits on, when nothing else shares them; otherwise the span itself. */
function linesOf(text: string, span: DesignerSpan): DesignerSpan {
  let start = span.start
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--
  const ownStart = start === 0 || text[start - 1] === '\n'
  let end = span.end
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++
  const ownEnd = end >= text.length || text[end] === '\n' || text[end] === '\r'
  if (!ownStart || !ownEnd) return span
  if (text[end] === '\r') end++
  if (text[end] === '\n') end++
  return { start, end }
}

/** Leading whitespace of the line holding `offset`. */
function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? ''
}

/** The text a `'...'` literal holds, or null for anything else. */
export function stringLiteralValue(text: string): string | null {
  const match = /^'((?:[^'$]|\$.)*)'$/s.exec(text.trim())
  return match ? match[1].replace(/\$'/g, "'").replace(/\$\$/g, '$') : null
}

function isVariableExpression(node: unknown): node is VariableExpression {
  return typeof node === 'object' && node !== null && 'kind' in node && node.kind === 'VariableExpression'
}

/** Every VariableExpression under a node. */
function variableExpressions(node: unknown, out: VariableExpression[] = []): VariableExpression[] {
  if (Array.isArray(node)) {
    for (const item of node) variableExpressions(item, out)
  } else if (typeof node === 'object' && node !== null) {
    if (isVariableExpression(node)) out.push(node)
    for (const [key, value] of Object.entries(node)) if (key !== 'parent') variableExpressions(value, out)
  }
  return out
}

/** `A.B` with nothing else: no subscripts, dereference or deeper fields; as written. */
function plainField(v: VariableExpression, text: SourceText): [string, string] | null {
  if (v.subscripts.length > 0 || v.isDereference || v.fieldAccess.length !== 1) return null
  if (v.accessChain !== undefined && v.accessChain.some((step) => step.kind !== 'field')) return null
  const [a, b] = text
    .slice(v.sourceSpan)
    .split('.')
    .map((s) => s.trim())
  return b === undefined ? null : [a, b]
}

function elementsOf(
  fb: FunctionBlockDeclaration,
  text: SourceText,
  isWidgetType: (type: string) => boolean,
): DesignerElement[] {
  const span = (s: SourceSpan): DesignerSpan => ({ start: text.start(s), end: text.end(s) })
  const elements: DesignerElement[] = []
  const lock = (decl: VarDeclaration, blockType: string): string | null => {
    if (blockType !== 'VAR') return null
    if (decl.names.length > 1) return 'declared together with other names; give it a declaration of its own'
    if (decl.initialValue && decl.initialValue.kind !== 'StructInitializerExpression')
      return 'its initial value is not a list of properties'
    return null
  }
  for (const block of fb.varBlocks) {
    if (block.blockType !== 'VAR') continue
    for (const decl of block.declarations) {
      if (!isWidgetType(decl.type.name)) continue
      const declSpan = span(decl.sourceSpan)
      decl.names.forEach((_name, i) => {
        const nameSpan = decl.nameSpans?.[i] ? span(decl.nameSpans[i]) : declSpan
        const init = decl.initialValue
        const props: DesignerProperty[] =
          init?.kind === 'StructInitializerExpression'
            ? init.elements.map((e) => ({
                name: /^\s*([A-Za-z_]\w*)/.exec(text.slice(e.sourceSpan))?.[1] ?? e.name,
                value: text.slice(e.value.sourceSpan),
                span: span(e.sourceSpan),
                valueSpan: span(e.value.sourceSpan),
              }))
            : []
        const parentText = props.find((p) => p.name.toUpperCase() === 'PARENT')?.value
        elements.push({
          name: text.text.slice(nameSpan.start, nameSpan.end),
          type: text.slice(decl.type.sourceSpan),
          parent: parentText === undefined ? null : stringLiteralValue(parentText),
          props,
          lines: linesOf(text.text, declSpan),
          initializer: init?.kind === 'StructInitializerExpression' ? span(init.sourceSpan) : null,
          typeEnd: text.end(decl.type.sourceSpan),
          nameSpan,
          indent: indentAt(text.text, declSpan.start),
          locked: lock(decl, block.blockType),
        })
      })
    }
  }
  return elements
}

function bodyParts(
  fb: FunctionBlockDeclaration,
  text: SourceText,
  elements: ReadonlySet<string>,
): { bindings: DesignerBinding[]; events: DesignerEvent[] } {
  const bindings: DesignerBinding[] = []
  const events: DesignerEvent[] = []
  const lines = (s: Statement): DesignerSpan =>
    linesOf(text.text, { start: text.start(s.sourceSpan), end: text.end(s.sourceSpan) })
  for (const statement of fb.body) {
    if (statement.kind === 'AssignmentStatement') {
      const { target, value } = statement
      if (!isVariableExpression(target) || !isVariableExpression(value)) continue
      const t = plainField(target, text)
      const v = plainField(value, text)
      if (t && v && elements.has(t[0].toUpperCase()))
        bindings.push({ element: t[0], property: t[1], variable: `${v[0]}.${v[1]}`, lines: lines(statement) })
    } else if (statement.kind === 'IfStatement') {
      const s = statement
      if (s.elsifClauses.length > 0 || s.elseStatements.length > 0 || !isVariableExpression(s.condition)) continue
      const c = plainField(s.condition, text)
      if (!c || !elements.has(c[0].toUpperCase())) continue
      const first = s.thenStatements[0]
      const last = s.thenStatements.at(-1)
      const code = first && last ? text.text.slice(text.start(first.sourceSpan), text.end(last.sourceSpan)) : ''
      events.push({ element: c[0], event: c[1], code, lines: lines(statement) })
    }
  }
  return { bindings, events }
}

function modelOf(
  fb: FunctionBlockDeclaration,
  text: SourceText,
  isWidgetType: (type: string) => boolean,
): DesignerModel {
  const source = text.text
  const fbStart = text.start(fb.sourceSpan)
  const header = /FUNCTION_BLOCK\s+(?:(?:ABSTRACT|FINAL)\s+)?([A-Za-z_]\w*)/i.exec(source.slice(fbStart))
  const headerOffset = fbStart + (header?.index ?? 0)
  const headerStart = source.lastIndexOf('\n', headerOffset - 1) + 1
  const elements = elementsOf(fb, text, isWidgetType)
  const elementNames = new Set(elements.map((e) => e.name.toUpperCase()))
  const { bindings, events } = bodyParts(fb, text, elementNames)

  const varBlocks = fb.varBlocks.filter((b) => b.blockType === 'VAR')
  const lastVar = varBlocks.at(-1)
  const lastDecl = lastVar?.declarations.at(-1)
  let declarationAt: number
  let declarationIndent: string
  if (lastVar && lastDecl) {
    declarationAt = linesOf(source, { start: text.start(lastDecl.sourceSpan), end: text.end(lastDecl.sourceSpan) }).end
    declarationIndent = indentAt(source, text.start(lastDecl.sourceSpan))
  } else if (lastVar) {
    const endVar = source.toUpperCase().lastIndexOf('END_VAR', text.end(lastVar.sourceSpan))
    declarationAt = source.lastIndexOf('\n', endVar - 1) + 1
    declarationIndent = `${indentAt(source, endVar)}${DEFAULT_INDENT}`
  } else {
    declarationAt = source.indexOf('\n', headerOffset) + 1 || source.length
    declarationIndent = DEFAULT_INDENT
  }

  const fbEnd = text.end(fb.sourceSpan)
  const endKeyword = source.toUpperCase().lastIndexOf('END_FUNCTION_BLOCK', fbEnd)
  const lastStatement = fb.body.at(-1)
  const statementAt = lastStatement
    ? linesOf(source, { start: text.start(lastStatement.sourceSpan), end: text.end(lastStatement.sourceSpan) }).end
    : source.lastIndexOf('\n', endKeyword - 1) + 1
  const statementIndent = lastStatement ? indentAt(source, text.start(lastStatement.sourceSpan)) : DEFAULT_INDENT

  const themePragma = /^[ \t]*\{attribute\s+'hmi_theme'\s*:=\s*'([^']*)'\}[ \t]*\r?\n/im.exec(
    source.slice(0, headerStart),
  )
  const members = new Set<string>()
  for (const block of fb.varBlocks)
    for (const decl of block.declarations) for (const n of decl.names) members.add(n.toUpperCase())
  for (const method of fb.methods) members.add(method.name.toUpperCase())

  const uses = variableExpressions([fb.body, fb.methods, fb.properties]).map((v) => {
    const start = text.start(v.sourceSpan)
    return { name: v.name.toUpperCase(), span: { start, end: start + v.name.length } }
  })

  return {
    name: header?.[1] ?? fb.name,
    extends: fb.extends ?? '',
    theme: themePragma ? themePragma[1] : null,
    themeLines: themePragma ? { start: themePragma.index, end: themePragma.index + themePragma[0].length } : null,
    headerStart,
    elements,
    bindings,
    events,
    uses,
    members,
    declarationAt,
    needsVarBlock: !lastVar,
    declarationIndent,
    statementAt,
    statementIndent,
  }
}

/** Reads a screen or widget block for the designer; the source must declare exactly one FUNCTION_BLOCK. */
export function parseDesignerBlock(source: string, isWidgetType: (type: string) => boolean): DesignerParse {
  const parsed = loadStrucpp().parse(source)
  if (parsed.errors.length > 0 || !parsed.ast)
    return { ok: false, errors: parsed.errors.map((e) => ({ line: e.line, message: e.message })) }
  const unit = parsed.ast
  const others =
    unit.programs.length +
    unit.functions.length +
    unit.interfaces.length +
    unit.types.length +
    unit.configurations.length +
    unit.globalVarBlocks.length
  if (unit.functionBlocks.length !== 1 || others > 0)
    return {
      ok: false,
      errors: [{ line: 1, message: 'the file must declare exactly one FUNCTION_BLOCK and nothing else' }],
    }
  return { ok: true, model: modelOf(unit.functionBlocks[0], new SourceText(source), isWidgetType) }
}
