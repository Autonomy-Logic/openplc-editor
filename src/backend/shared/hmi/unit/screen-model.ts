/**
 * What the HMI build reads from a screen or widget block, from the STruC++ parser's syntax tree: elements declared
 * with their initializer texts, bindings in the body, references to PLC variables and where generated methods go.
 */
import type { FunctionBlockDeclaration, SourceSpan, Statement, VariableExpression } from 'strucpp'

import { loadStrucpp } from '../../library/strucpp-runtime'

/** An element: a VAR of a widget type. */
export interface HmiElementDecl {
  /** Name as written. */
  name: string
  /** Type as written. */
  type: string
  /** Initializer values as ST text, by upper-case property name. */
  props: ReadonlyMap<string, string>
}

/** `Element.Property := Variable;` in the body. */
export interface HmiBinding {
  element: string
  property: string
  /** Bound variable as written, `POU.Name` or `GVL.Name`. */
  variable: string
}

export interface HmiBlockModel {
  /** Name as written. */
  name: string
  /** Base block as written; empty when there is none. */
  extends: string
  /** `{attribute 'hmi_theme' := '<Name>'}` on the block. */
  theme?: string
  elements: readonly HmiElementDecl[]
  bindings: readonly HmiBinding[]
  /** Every `A.B` read or written anywhere in the block, upper-case, where A is not a variable of the block. */
  references: ReadonlySet<string>
  /** Upper-case names of the block's methods. */
  methods: ReadonlySet<string>
  /** Offset where generated methods are inserted: after the declarations, before methods and body. */
  insertAt: number
}

export type HmiBlockParse = { ok: true; model: HmiBlockModel } | { ok: false; errors: string[] }

/** Offsets of line starts, for turning 1-based inclusive spans into string offsets. */
export class SourceText {
  private readonly starts: number[] = [0]

  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.starts.push(i + 1)
  }

  offset(line: number, col: number): number {
    return (this.starts[line - 1] ?? this.text.length) + col - 1
  }

  start(span: SourceSpan): number {
    return this.offset(span.startLine, span.startCol)
  }

  end(span: SourceSpan): number {
    return this.offset(span.endLine, span.endCol) + 1
  }

  slice(span: SourceSpan): string {
    return this.text.slice(this.start(span), this.end(span))
  }
}

function isVariableExpression(node: object): node is VariableExpression {
  return 'kind' in node && node.kind === 'VariableExpression'
}

/** Every VariableExpression under a node. */
function variableExpressions(node: unknown, out: VariableExpression[] = []): VariableExpression[] {
  if (Array.isArray(node)) {
    for (const item of node) variableExpressions(item, out)
  } else if (typeof node === 'object' && node !== null) {
    if (isVariableExpression(node)) out.push(node)
    for (const value of Object.values(node)) variableExpressions(value, out)
  }
  return out
}

/** `A.B` with nothing else: no subscripts, dereference or deeper fields. */
function plainField(v: VariableExpression): string | undefined {
  if (v.subscripts.length > 0 || v.isDereference || v.fieldAccess.length !== 1) return undefined
  if (v.accessChain !== undefined && v.accessChain.some((step) => step.kind !== 'field')) return undefined
  return `${v.name}.${v.fieldAccess[0]}`
}

function bindingOf(statement: Statement, text: SourceText): HmiBinding | undefined {
  if (statement.kind !== 'AssignmentStatement') return undefined
  const { target, value } = statement
  if (!isVariableExpression(target) || !isVariableExpression(value)) return undefined
  if (plainField(target) === undefined || plainField(value) === undefined) return undefined
  const [element, property] = text
    .slice(target.sourceSpan)
    .split('.')
    .map((s) => s.trim())
  return { element, property, variable: text.slice(value.sourceSpan).replace(/\s+/g, '') }
}

function modelOf(
  fb: FunctionBlockDeclaration,
  text: SourceText,
  isWidgetType: (type: string) => boolean,
): HmiBlockModel {
  const elements: HmiElementDecl[] = []
  const locals = new Set<string>()
  for (const block of fb.varBlocks) {
    for (const decl of block.declarations) {
      decl.names.forEach((name, i) => {
        locals.add(name)
        if (block.blockType !== 'VAR' || !isWidgetType(decl.type.name)) return
        const props = new Map<string, string>()
        const init = decl.initialValue
        if (init?.kind === 'StructInitializerExpression')
          for (const element of init.elements) props.set(element.name, text.slice(element.value.sourceSpan))
        const nameSpan = decl.nameSpans?.[i]
        elements.push({
          name: nameSpan ? text.slice(nameSpan) : name,
          type: text.slice(decl.type.sourceSpan),
          props,
        })
      })
    }
  }
  const references = new Set<string>()
  for (const v of variableExpressions([fb.body, fb.methods, fb.properties])) {
    if (locals.has(v.name) || v.fieldAccess.length === 0) continue
    references.add(`${v.name}.${v.fieldAccess[0]}`)
  }
  const bindings = fb.body.flatMap((s) => {
    const b = bindingOf(s, text)
    return b ? [b] : []
  })
  const lastVar = fb.varBlocks.at(-1)
  const firstAfter = [...fb.methods.map((m) => m.sourceSpan), ...fb.body.map((s) => s.sourceSpan)]
    .map((span) => text.start(span))
    .sort((a, b) => a - b)[0]
  const end = text.text.toUpperCase().lastIndexOf('END_FUNCTION_BLOCK', text.end(fb.sourceSpan))
  const model: HmiBlockModel = {
    name: text.slice(fb.sourceSpan).match(/FUNCTION_BLOCK\s+(?:(?:ABSTRACT|FINAL)\s+)?([A-Za-z_]\w*)/i)?.[1] ?? fb.name,
    extends: fb.extends ?? '',
    elements,
    bindings,
    references,
    methods: new Set(fb.methods.map((m) => m.name.toUpperCase())),
    insertAt: lastVar ? text.end(lastVar.sourceSpan) : (firstAfter ?? end),
  }
  const theme = fb.attributes?.find((a) => a.name.toLowerCase() === 'hmi_theme')?.value
  if (theme !== undefined) model.theme = theme
  return model
}

/**
 * Reads a screen or widget block: the source must declare exactly one FUNCTION_BLOCK and nothing else. Widget types
 * (upper-case names) decide which variables are elements.
 */
export function parseHmiBlock(source: string, isWidgetType: (type: string) => boolean): HmiBlockParse {
  const parsed = loadStrucpp().parse(source)
  if (parsed.errors.length > 0 || !parsed.ast)
    return { ok: false, errors: parsed.errors.map((e) => `line ${e.line}: ${e.message}`) }
  const unit = parsed.ast
  const others =
    unit.programs.length +
    unit.functions.length +
    unit.interfaces.length +
    unit.types.length +
    unit.configurations.length +
    unit.globalVarBlocks.length
  if (unit.functionBlocks.length !== 1 || others > 0)
    return { ok: false, errors: ['the file must declare exactly one FUNCTION_BLOCK and nothing else'] }
  return { ok: true, model: modelOf(unit.functionBlocks[0], new SourceText(source), isWidgetType) }
}
