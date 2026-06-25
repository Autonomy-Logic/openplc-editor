import type { BlockVariant } from '@root/middleware/shared/ports/block-types'
import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

/**
 * Refresh the *types* carried by placed graphical block variants from the
 * current library definitions.
 *
 * A block's signature is copied into `node.data.variant` once, when the block
 * is dropped on the canvas (see the FBD/LD `handleAddElementByDropping`), and
 * then frozen in the saved project. When a library updates a block's pin or
 * return type — e.g. `ADR` moving from `ULINT` to the platform-width `__XWORD`
 * — already-placed blocks keep the stale type and the transpiler (which reads
 * `node.data.variant` via `collect-library-blocks`) emits the old type.
 *
 * On project load we re-stamp the variable types of every block that resolves
 * to a **library** definition (the bundled / system libraries in
 * `libraries.system`). Blocks backed by a **user-defined POU** (a function or
 * function-block authored in this project) are skipped — their interface lives
 * in the project, not the library, so the project is the source of truth.
 *
 * The refresh is intentionally type-only: it matches variables by name and
 * copies the library's `type`, leaving the pin set, ids, handles and wiring
 * untouched. That keeps extensible (variadic) blocks and existing connections
 * intact while still propagating type changes.
 */

type VariantVariable = BlockVariant['variables'][number]

/** Index every library POU by name → its variables, for O(1) lookup. */
function indexLibraryPous(systemLibraries: SystemLibrary[]): Map<string, SystemLibrary['pous'][number]> {
  const byName = new Map<string, SystemLibrary['pous'][number]>()
  for (const library of systemLibraries) {
    for (const pou of library.pous) {
      // First definition wins; bundled libraries don't collide on name.
      if (!byName.has(pou.name)) byName.set(pou.name, pou)
    }
  }
  return byName
}

/** A minimal block-bearing node shape; both FBD and LD nodes satisfy it. */
type BlockBearingNode = { type?: string; data?: { variant?: BlockVariant } }

/**
 * Re-stamp variable types in place for every library-backed block node.
 *
 * @param nodes            the flow's nodes (FBD `rung.nodes` or an LD
 *                         `rung.nodes`)
 * @param libraryPousByName library POUs indexed by name
 * @param userPouNames     names of user-defined POUs to skip (uppercased)
 * @returns the number of variables actually changed (for logging/tests)
 */
function restampNodes(
  nodes: BlockBearingNode[],
  libraryPousByName: Map<string, SystemLibrary['pous'][number]>,
  userPouNames: Set<string>,
): number {
  let changed = 0
  for (const node of nodes) {
    if (node?.type !== 'block') continue
    const variant = node.data?.variant
    const name = variant?.name
    if (!variant || !name) continue

    // Skip blocks backed by a user-defined POU — the project owns their shape.
    if (userPouNames.has(name.toUpperCase())) continue

    const libPou = libraryPousByName.get(name)
    if (!libPou) continue

    // Index the library's variables by name for matching.
    const libVarByName = new Map(libPou.variables.map((v) => [v.name, v]))

    for (const variable of variant.variables) {
      const libVar = libVarByName.get(variable.name)
      if (!libVar) continue
      const next = libVar.type
      const current = variable.type
      if (current.definition === next.definition && current.value === next.value) continue
      // The block-variant type union only admits 'base-type' / 'generic-type';
      // library `typeRef()` emits exactly those, so the shape is compatible.
      variable.type = { definition: next.definition, value: next.value } as VariantVariable['type']
      changed += 1
    }
  }
  return changed
}

/**
 * Re-stamp every block in the given flows from the current system libraries.
 * Mutates the flow objects in place. Returns the total number of variable
 * types changed (0 when nothing was stale).
 *
 * `flows` accepts both FBD flows (single `rung`) and LD flows (`rungs[]`); the
 * shape is duck-typed so the helper stays language-agnostic and on the shared
 * surface.
 */
export function restampFlowLibraryVariants(
  flows: Array<{ rung?: { nodes?: unknown }; rungs?: Array<{ nodes?: unknown }> }>,
  systemLibraries: SystemLibrary[],
  userPouNames: Iterable<string>,
): number {
  const libraryPousByName = indexLibraryPous(systemLibraries)
  if (libraryPousByName.size === 0) return 0
  const skip = new Set<string>()
  for (const n of userPouNames) skip.add(n.toUpperCase())

  let changed = 0
  for (const flow of flows) {
    const rungs = flow.rungs ?? (flow.rung ? [flow.rung] : [])
    for (const rung of rungs) {
      const nodes = rung?.nodes
      if (Array.isArray(nodes)) changed += restampNodes(nodes as BlockBearingNode[], libraryPousByName, skip)
    }
  }
  return changed
}
