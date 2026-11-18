/**
 * Which PLC tags each screen of a compiled HMI unit reads and writes, from the instance paths STruC++ resolved in its
 * annotated AST. A runtime serves a viewer only the tags of the screen it shows, and applies only that screen's
 * writes, so these lists bound what a browser may reach.
 */
import type { ASTNode, CompilationUnit, Statement, VariableExpression } from 'strucpp'

/** Tags (ids of the unit's tag table) one screen reads and writes, ascending. */
export interface HmiPageAccess {
  reads: number[]
  writes: number[]
}

/** Visits a node and its children until the visitor returns false (STruC++'s `walkAST`). */
export type HmiAstWalk = (node: ASTNode, visitor: (node: ASTNode) => boolean | void) => void

type AssignmentNode = Extract<Statement, { kind: 'AssignmentStatement' }>

const isAssignment = (node: ASTNode): node is AssignmentNode => node.kind === 'AssignmentStatement'
const isVariable = (node: ASTNode): node is VariableExpression => node.kind === 'VariableExpression'

/** Reads and writes of the tags accessed under `root`, as STruC++ marks them: a bit assignment reads too. */
function accessesUnder(root: ASTNode, walk: HmiAstWalk): { reads: Set<number>; writes: Set<number> } {
  const targets = new Set<VariableExpression>()
  const reads = new Set<number>()
  const writes = new Set<number>()
  walk(root, (node) => {
    if (isAssignment(node) && isVariable(node.target)) targets.add(node.target)
  })
  walk(root, (node) => {
    if (!isVariable(node)) return
    const ref = node.instancePath
    if (!ref || ref.id < 0) return
    if (targets.has(node)) {
      writes.add(ref.id)
      if (ref.bit !== undefined) reads.add(ref.id)
    } else reads.add(ref.id)
  })
  return { reads, writes }
}

const sorted = (set: ReadonlySet<number>): number[] => [...set].sort((a, b) => a - b)

/**
 * Access of each screen, in page order. `screens` are the screens' function block names; tags accessed anywhere else
 * in the unit (the program that runs every page) count for every page.
 */
export function hmiPageAccess(ast: CompilationUnit, screens: readonly string[], walk: HmiAstWalk): HmiPageAccess[] {
  const pages = screens.map((name) => name.toUpperCase())
  const byPage = pages.map(() => ({ reads: new Set<number>(), writes: new Set<number>() }))
  const shared = { reads: new Set<number>(), writes: new Set<number>() }
  const visit = (root: ASTNode, page: number): void => {
    const found = accessesUnder(root, walk)
    const into = page >= 0 ? byPage[page] : shared
    for (const id of found.reads) into.reads.add(id)
    for (const id of found.writes) into.writes.add(id)
  }
  for (const block of ast.functionBlocks) visit(block, pages.indexOf(block.name.toUpperCase()))
  for (const root of [...ast.programs, ...ast.functions, ...ast.configurations]) visit(root, -1)
  return byPage.map((p) => ({
    reads: sorted(new Set([...p.reads, ...shared.reads])),
    writes: sorted(new Set([...p.writes, ...shared.writes])),
  }))
}
