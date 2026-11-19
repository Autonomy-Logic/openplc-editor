/**
 * Which PLC tags each screen of a compiled HMI unit reads and writes, from the instance paths STruC++ resolved in its
 * annotated AST. A runtime serves a viewer only the tags of the screen it shows, and applies only that screen's
 * writes, so these lists bound what a browser may reach.
 */
import type { ASTNode, CompilationUnit, Expression, Statement, VariableExpression } from 'strucpp'

import { hmiLimitUnion, type HmiWriteLimit } from './write-limits'

/** How one screen writes a tag: as a whole value, and which of its bits by bit assignments (`Tag.3 := ...`). */
export interface HmiTagWrite {
  tag: number
  whole: boolean
  /** Bits assigned one at a time, ascending. */
  bits: number[]
  /** The values whole writes can carry (the union over the screen's writes); null when any value of the type. */
  limit: HmiWriteLimit | null
}

/** Where an assignment is: the function block (upper case) and its method (upper case), when in one. */
export interface HmiWriteSite {
  block?: string
  method?: string
}

/** The limit of one whole assignment of `tag` with `value`, or null when it can carry any value of the type. */
export type HmiLimitOf = (value: Expression, tag: number, site: HmiWriteSite) => HmiWriteLimit | null

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

interface Written {
  whole: boolean
  bits: Set<number>
  /** Undefined until a whole write is seen. */
  limit: HmiWriteLimit | null | undefined
}

interface Collected {
  reads: Set<number>
  writes: Map<number, Written>
}

const collected = (): Collected => ({ reads: new Set(), writes: new Map() })

function addWrite(into: Collected, tag: number, bit: number | undefined, limit: HmiWriteLimit | null): void {
  const entry = into.writes.get(tag) ?? { whole: false, bits: new Set<number>(), limit: undefined }
  if (bit === undefined) {
    entry.whole = true
    entry.limit = entry.limit === undefined ? limit : hmiLimitUnion(entry.limit, limit)
  } else entry.bits.add(bit)
  into.writes.set(tag, entry)
}

/** Reads and writes of the tags accessed under `root`, as STruC++ marks them: a bit assignment reads too. */
function accessesUnder(root: ASTNode, walk: HmiAstWalk, into: Collected, limitOf: HmiLimitOf, site: HmiWriteSite) {
  const targets = new Map<VariableExpression, Expression>()
  walk(root, (node) => {
    if (isAssignment(node) && isVariable(node.target)) targets.set(node.target, node.value)
  })
  walk(root, (node) => {
    if (!isVariable(node)) return
    const ref = node.instancePath
    if (!ref || ref.id < 0) return
    const value = targets.get(node)
    if (value !== undefined) {
      addWrite(into, ref.id, ref.bit, ref.bit === undefined ? limitOf(value, ref.id, site) : null)
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
export function hmiPageAccess(
  ast: CompilationUnit,
  screens: readonly string[],
  walk: HmiAstWalk,
  limitOf: HmiLimitOf,
): HmiPageAccess[] {
  const pages = screens.map((name) => name.toUpperCase())
  const byPage = pages.map(collected)
  const shared = collected()
  for (const block of ast.functionBlocks) {
    const name = block.name.toUpperCase()
    const page = pages.indexOf(name)
    const into = page >= 0 ? byPage[page] : shared
    for (const method of block.methods)
      accessesUnder(method, walk, into, limitOf, { block: name, method: method.name.toUpperCase() })
    for (const part of [...block.varBlocks, ...block.properties, ...block.body])
      accessesUnder(part, walk, into, limitOf, { block: name })
  }
  for (const root of [...ast.programs, ...ast.functions, ...ast.configurations])
    accessesUnder(root, walk, shared, limitOf, {})
  return byPage.map((p) => {
    const merged = collected()
    for (const source of [p, shared]) {
      for (const id of source.reads) merged.reads.add(id)
      for (const [tag, w] of source.writes) {
        if (w.whole) addWrite(merged, tag, undefined, w.limit ?? null)
        for (const bit of w.bits) addWrite(merged, tag, bit, null)
      }
    }
    return {
      reads: [...merged.reads].sort((a, b) => a - b),
      writes: [...merged.writes.entries()]
        .sort(([a], [b]) => a - b)
        .map(([tag, w]) => ({
          tag,
          whole: w.whole,
          bits: [...w.bits].sort((a, b) => a - b),
          limit: w.whole ? (w.limit ?? null) : null,
        })),
    }
  })
}
