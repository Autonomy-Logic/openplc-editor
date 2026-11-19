/**
 * Which PLC tags each screen of a compiled HMI unit reads and writes, from the instance paths STruC++ resolved in its
 * annotated AST. A runtime serves a viewer only the tags of the screen it shows, and applies only that screen's
 * writes, so these lists bound what a browser may reach.
 */
import type { ASTNode, CompilationUnit, Statement, VariableExpression } from 'strucpp'

/** How one screen writes a tag: as a whole value, and which of its bits by bit assignments (`Tag.3 := ...`). */
export interface HmiTagWrite {
  tag: number
  whole: boolean
  /** Bits assigned one at a time, ascending. */
  bits: number[]
}

/** Tags (ids of the unit's tag table) one screen reads, ascending, and how it writes them, by ascending tag. */
export interface HmiPageAccess {
  reads: number[]
  writes: HmiTagWrite[]
}

/** Visits a node and its children until the visitor returns false (STruC++'s `walkAST`). */
export type HmiAstWalk = (node: ASTNode, visitor: (node: ASTNode) => boolean | void) => void

type AssignmentNode = Extract<Statement, { kind: 'AssignmentStatement' }>

const isAssignment = (node: ASTNode): node is AssignmentNode => node.kind === 'AssignmentStatement'
const isVariable = (node: ASTNode): node is VariableExpression => node.kind === 'VariableExpression'

interface Collected {
  reads: Set<number>
  writes: Map<number, { whole: boolean; bits: Set<number> }>
}

const collected = (): Collected => ({ reads: new Set(), writes: new Map() })

function addWrite(into: Collected, tag: number, bit: number | undefined): void {
  const entry = into.writes.get(tag) ?? { whole: false, bits: new Set<number>() }
  if (bit === undefined) entry.whole = true
  else entry.bits.add(bit)
  into.writes.set(tag, entry)
}

/** Reads and writes of the tags accessed under `root`, as STruC++ marks them: a bit assignment reads too. */
function accessesUnder(root: ASTNode, walk: HmiAstWalk, into: Collected): void {
  const targets = new Set<VariableExpression>()
  walk(root, (node) => {
    if (isAssignment(node) && isVariable(node.target)) targets.add(node.target)
  })
  walk(root, (node) => {
    if (!isVariable(node)) return
    const ref = node.instancePath
    if (!ref || ref.id < 0) return
    if (targets.has(node)) {
      addWrite(into, ref.id, ref.bit)
      if (ref.bit !== undefined) into.reads.add(ref.id)
    } else into.reads.add(ref.id)
  })
}

/** Number of bit assignments (`Tag.3 := ...`) to tags under `root`. */
export function hmiBitAssignments(ast: CompilationUnit, walk: HmiAstWalk): number {
  let count = 0
  walk(ast, (node) => {
    if (isAssignment(node) && isVariable(node.target)) {
      const ref = node.target.instancePath
      if (ref && ref.id >= 0 && ref.bit !== undefined) count++
    }
  })
  return count
}

/**
 * Access of each screen, in page order. `screens` are the screens' function block names; tags accessed anywhere else
 * in the unit (the program that runs every page) count for every page.
 */
export function hmiPageAccess(ast: CompilationUnit, screens: readonly string[], walk: HmiAstWalk): HmiPageAccess[] {
  const pages = screens.map((name) => name.toUpperCase())
  const byPage = pages.map(collected)
  const shared = collected()
  for (const block of ast.functionBlocks) {
    const page = pages.indexOf(block.name.toUpperCase())
    accessesUnder(block, walk, page >= 0 ? byPage[page] : shared)
  }
  for (const root of [...ast.programs, ...ast.functions, ...ast.configurations]) accessesUnder(root, walk, shared)
  return byPage.map((p) => {
    const merged = collected()
    for (const source of [p, shared]) {
      for (const id of source.reads) merged.reads.add(id)
      for (const [tag, w] of source.writes) {
        if (w.whole) addWrite(merged, tag, undefined)
        for (const bit of w.bits) addWrite(merged, tag, bit)
      }
    }
    return {
      reads: [...merged.reads].sort((a, b) => a - b),
      writes: [...merged.writes.entries()]
        .sort(([a], [b]) => a - b)
        .map(([tag, w]) => ({ tag, whole: w.whole, bits: [...w.bits].sort((a, b) => a - b) })),
    }
  })
}
