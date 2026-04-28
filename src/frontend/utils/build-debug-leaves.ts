/**
 * Walk the project's POUs + the editor's standard library + user types
 * and produce a flat list of debugger leaves (path + IEC type) to hand to
 * STruC++ via `compile()`'s `debugLeaves` option.
 *
 * Reuses the existing tree-traversal visitor pattern — same walk that
 * powers the watch panel and ladder coloring — so the leaves the
 * debugger MATERIALIZES are exactly the leaves the editor DISPLAYS.
 *
 * The editor's library is the single source of truth here. STruC++
 * doesn't need to look at its own library: the user's invariant says
 * the two libraries must agree (otherwise the program wouldn't compile).
 */

import type { PLCDataType, PLCInstance, PLCPou } from '../../middleware/shared/ports/types'
import type { DebugNodeVisitor, TraversalContext } from './debug-tree-traversal'
import { traverseVariable } from './debug-tree-traversal'
import { findInstanceName, type PLCInstanceMapping } from './debug-variable-finder'

/** One leaf descriptor — what STruC++'s `debugLeaves` option expects. */
export interface DebugLeafSpec {
  path: string
  type: string
}

/**
 * Visitor that flattens the tree into a list of leaves.
 *
 * Complex nodes (FBs, structs, arrays) emit nothing themselves — only
 * their leaves do. The path string carries the full address for STruC++
 * to resolve via `g_config.<path>`.
 */
class LeafCollector implements DebugNodeVisitor<void> {
  constructor(public readonly leaves: DebugLeafSpec[]) {}

  visitLeaf(_name: string, fullPath: string, _compositeKey: string, typeName: string): void {
    this.leaves.push({ path: fullPath, type: typeName })
  }

  visitComplex(): void {
    // No-op — children are visited individually.
  }

  visitArray(): void {
    // No-op — element children are visited individually.
  }
}

/**
 * Project shape required by the leaf walker.
 * Same contract as DebugProjectData on debug-tree-builder.
 */
export interface LeafBuildInput {
  pous: PLCPou[]
  dataTypes: PLCDataType[]
  instances: PLCInstance[]
}

/**
 * Walk every program instance and emit one leaf per debuggable field.
 * Returns the list in declaration order (instance → variable → field /
 * array element), matching the order strucpp will pack into the debug
 * arrays.
 */
export function buildDebugLeaves(input: LeafBuildInput): DebugLeafSpec[] {
  const leaves: DebugLeafSpec[] = []
  const visitor = new LeafCollector(leaves)

  const instanceMappings: PLCInstanceMapping[] = input.instances.map((inst) => ({
    name: inst.name,
    program: inst.program,
  }))

  for (const pou of input.pous) {
    if (pou.pouType !== 'program') continue

    const instanceName = findInstanceName(pou.name, instanceMappings)
    if (!instanceName) continue

    const variables = pou.interface?.variables ?? []
    const context: TraversalContext = {
      debugVariables: [], // unused by LeafCollector — we don't need indexes here
      projectPous: input.pous,
      pouName: pou.name,
      instanceName,
      dataTypes: input.dataTypes,
    }

    for (const variable of variables) {
      try {
        traverseVariable(variable, context, visitor)
      } catch {
        // Bad variable shouldn't kill the leaf list — skip and continue.
      }
    }
  }

  return leaves
}
