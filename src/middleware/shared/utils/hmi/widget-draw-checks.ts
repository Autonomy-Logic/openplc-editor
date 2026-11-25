/**
 * A widget draws in the box its container gives it, so its drawing calls take positions and lengths from Left, Top,
 * Width and Height. This finds the drawing calls in a widget block whose position or length is a fixed value.
 */
import type { ASTNode, Expression, FunctionBlockDeclaration, FunctionCallExpression, VarBlock } from 'strucpp'
import { parse } from 'strucpp'

import { SourceText } from './st-source-text'

type Argument = FunctionCallExpression['arguments'][number]

/** A drawing call with fixed coordinates, and where it is. */
export interface HmiDrawFinding {
  message: string
  /** 1-based line of the call. */
  line: number
  /** Offsets of the first fixed argument. */
  span: { start: number; end: number }
}

/** Each drawing function's parameters that are positions or lengths, in declaration order (they come first). */
const DRAW_COORDINATES: ReadonlyMap<string, readonly string[]> = new Map([
  ['HMI_FILLRECT', ['X', 'Y', 'W', 'H']],
  ['HMI_STROKERECT', ['X', 'Y', 'W', 'H']],
  ['HMI_LINE', ['X1', 'Y1', 'X2', 'Y2']],
  ['HMI_FILLCIRCLE', ['Cx', 'Cy', 'R']],
  ['HMI_STROKECIRCLE', ['Cx', 'Cy', 'R']],
  ['HMI_FILLELLIPSE', ['Cx', 'Cy', 'Rx', 'Ry']],
  ['HMI_STROKEELLIPSE', ['Cx', 'Cy', 'Rx', 'Ry']],
  ['HMI_ARC', ['Cx', 'Cy', 'R']],
  ['HMI_POLYPOINT', ['X', 'Y']],
  ['HMI_TEXT', ['X', 'Y']],
  ['HMI_TEXTBOX', ['X', 'Y', 'W', 'H']],
  ['HMI_CLIP', ['X', 'Y', 'W', 'H']],
  ['HMI_HIT', ['X', 'Y', 'W', 'H']],
])

const isNode = (value: unknown): value is ASTNode =>
  typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'

/** Visits every node under `node`, the parent links left out. */
function walk(node: ASTNode, visit: (node: ASTNode) => void): void {
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'sourceSpan') continue
    for (const child of Array.isArray(value) ? value : [value]) if (isNode(child)) walk(child, visit)
  }
}

/** Whether an expression is a fixed value: numbers and the block's constants, through operators and parentheses. */
function fixed(expr: Expression, constants: ReadonlySet<string>): boolean {
  switch (expr.kind) {
    case 'LiteralExpression':
      return expr.literalType !== 'STRING' && expr.literalType !== 'WSTRING'
    case 'ParenthesizedExpression':
      return fixed(expr.expression, constants)
    case 'UnaryExpression':
      return fixed(expr.operand, constants)
    case 'BinaryExpression':
      return fixed(expr.left, constants) && fixed(expr.right, constants)
    case 'VariableExpression':
      return expr.subscripts.length === 0 && expr.fieldAccess.length === 0 && constants.has(expr.name.toUpperCase())
    default:
      return false
  }
}

/** The arguments of a call that are positions or lengths and fixed, by parameter name. */
function fixedCoordinates(
  parameters: readonly string[],
  args: readonly Argument[],
  constants: ReadonlySet<string>,
): Array<{ parameter: string; arg: Argument }> {
  const found: Array<{ parameter: string; arg: Argument }> = []
  args.forEach((arg, index) => {
    const parameter = arg.name ? parameters.find((p) => p.toUpperCase() === arg.name?.toUpperCase()) : parameters[index]
    if (parameter !== undefined && !arg.isOutput && fixed(arg.value, constants)) found.push({ parameter, arg })
  })
  return found
}

const isVarBlock = (node: ASTNode): node is VarBlock => node.kind === 'VarBlock'
const isCall = (node: ASTNode): node is FunctionCallExpression => node.kind === 'FunctionCallExpression'

/** Upper-case names the block and its methods declare CONSTANT. */
function constantsOf(block: FunctionBlockDeclaration): Set<string> {
  const names = new Set<string>()
  walk(block, (node) => {
    if (isVarBlock(node) && node.isConstant)
      for (const d of node.declarations) for (const n of d.names) names.add(n.toUpperCase())
  })
  return names
}

/**
 * The drawing calls in a widget block's source that draw at a fixed position or with a fixed length. A source that
 * does not parse gives none: the compiler reports it.
 */
export function hmiFixedDrawCalls(source: string): HmiDrawFinding[] {
  const parsed = parse(source)
  if (parsed.errors.length > 0 || !parsed.ast) return []
  const text = new SourceText(source)
  const findings: HmiDrawFinding[] = []
  for (const block of parsed.ast.functionBlocks) {
    const constants = constantsOf(block)
    walk(block, (node) => {
      if (!isCall(node)) return
      const parameters = DRAW_COORDINATES.get(node.functionName.toUpperCase())
      if (!parameters) return
      const found = fixedCoordinates(parameters, node.arguments, constants)
      if (found.length === 0) return
      const first = found[0].arg.value.sourceSpan
      const name = /^\s*([A-Za-z_]\w*)/.exec(text.slice(node.sourceSpan))?.[1] ?? node.functionName
      findings.push({
        message:
          `${name}: ${found.map((f) => f.parameter).join(', ')} ${found.length === 1 ? 'is' : 'are'} fixed. ` +
          'A widget draws in the box it is given: take positions and lengths from Left, Top, Width and Height, ' +
          'and use Sc(n) for a length that scales with the widget.',
        line: first.startLine,
        span: { start: text.start(first), end: text.end(first) },
      })
    })
  }
  return findings
}
