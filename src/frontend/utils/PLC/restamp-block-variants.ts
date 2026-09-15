import type { BlockVariant } from '@root/middleware/shared/ports/block-types'
import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'
import type { PLCPou } from '@root/middleware/shared/ports/types'

/**
 * Refresh the *types* carried by placed graphical block variants from whatever
 * currently defines the block.
 *
 * A block's signature is copied into `node.data.variant` once, when the block
 * is dropped on the canvas (see the FBD/LD `handleAddElementByDropping`), and
 * then frozen in the saved project. When the definition later changes its pin
 * or return type, already-placed blocks keep the stale one: the transpiler
 * (which reads `node.data.variant` via `collect-library-blocks`) emits the old
 * type, and the relink pass compares a refreshed variable against the stale pin
 * and breaks a link that is semantically fine (DOPE-548).
 *
 * Two definitions feed a placed block, and both are re-stamped on project load:
 * the bundled system libraries, and the project's own functions and function
 * blocks. A user POU takes precedence over a library entry of the same name,
 * since the project owns its own interface.
 *
 * Ladder pin nodes cache their pin's type a second time, in
 * `data.block.variableType`, and that copy is the one the relink pass actually
 * reads. It is otherwise refreshed only by a layout pass that does not run on
 * load, so it is re-stamped here too.
 *
 * The refresh is intentionally type-only: it matches variables by name and
 * copies the type, leaving the pin set, ids, handles and wiring untouched. That
 * keeps extensible (variadic) blocks and existing connections intact while
 * still propagating type changes. A signature that gained or lost a pin needs
 * the node rebuilt, which stays the divergence badge's job.
 */

type VariantVariable = BlockVariant['variables'][number]
type VariantVariableType = VariantVariable['type']

/** Pin types of one definition, keyed by variable name. IEC names are case-insensitive. */
type PinTypes = Map<string, VariantVariableType>

/** Index every library POU by name, for O(1) lookup. */
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

/** Index the project's own functions and function blocks by name. */
function indexUserPous(userPous: PLCPou[]): Map<string, PLCPou> {
  const byName = new Map<string, PLCPou>()
  for (const pou of userPous) byName.set(pou.name.toUpperCase(), pou)
  return byName
}

function libraryPinTypes(pou: SystemLibrary['pous'][number]): PinTypes {
  const types: PinTypes = new Map()
  for (const variable of pou.variables) types.set(variable.name.toUpperCase(), variable.type as VariantVariableType)
  return types
}

function userPouPinTypes(pou: PLCPou): PinTypes {
  const types: PinTypes = new Map()
  for (const variable of pou.interface?.variables ?? []) {
    // Placed variants upper-case their values (see the drop path), and a user
    // pin may be a data type or an array, which the variant schema's union
    // does not name — the placed shape has always carried them.
    types.set(variable.name.toUpperCase(), {
      definition: variable.type.definition,
      value: variable.type.value.toUpperCase(),
    } as VariantVariableType)
  }
  const returnType = pou.interface?.returnType
  // A function's return pin is synthesised as OUT when the block is dropped.
  if (pou.pouType === 'function' && returnType) {
    types.set('OUT', { definition: 'base-type', value: returnType.toUpperCase() } as VariantVariableType)
  }
  return types
}

/** A minimal block-bearing node shape; both FBD and LD nodes satisfy it. */
type BlockBearingNode = { type?: string; data?: { variant?: BlockVariant } }

/** A ladder pin node: it caches the type of the block pin it connects to. */
type PinBearingNode = {
  type?: string
  data?: {
    block?: { id?: string; handleId?: string; variableType?: VariantVariable }
  }
}

function restampBlockNodes(
  nodes: BlockBearingNode[],
  libraryPousByName: Map<string, SystemLibrary['pous'][number]>,
  userPousByName: Map<string, PLCPou>,
): number {
  let changed = 0
  for (const node of nodes) {
    if (node?.type !== 'block') continue
    const variant = node.data?.variant
    const name = variant?.name
    if (!variant || !name) continue

    // The project owns its own POUs, so they win over a library of the same name.
    const userPou = userPousByName.get(name.toUpperCase())
    const libPou = userPou ? undefined : libraryPousByName.get(name)
    if (!userPou && !libPou) continue
    const pinTypes = userPou ? userPouPinTypes(userPou) : libraryPinTypes(libPou!)

    for (const variable of variant.variables) {
      const next = pinTypes.get(variable.name.toUpperCase())
      // A pin the definition no longer declares (EN/ENO, a removed one) is left
      // alone: dropping it would orphan its handle and its wiring.
      if (!next) continue
      const current = variable.type
      if (current.definition === next.definition && current.value === next.value) continue
      variable.type = { definition: next.definition, value: next.value } as VariantVariableType
      changed += 1
    }
  }
  return changed
}

/** Re-stamp the pin type each ladder pin node caches from its block's signature. */
function restampPinNodes(nodes: Array<BlockBearingNode & PinBearingNode>): number {
  const variantsByBlockId = new Map<string, BlockVariant>()
  for (const node of nodes) {
    const variant = node?.type === 'block' ? node.data?.variant : undefined
    const id = (node as { id?: string }).id
    if (variant && typeof id === 'string') variantsByBlockId.set(id, variant)
  }
  if (variantsByBlockId.size === 0) return 0

  let changed = 0
  for (const node of nodes) {
    if (node?.type !== 'variable') continue
    const block = node.data?.block
    if (!block?.id || !block.handleId) continue
    const variant = variantsByBlockId.get(block.id)
    if (!variant) continue

    const handleId = block.handleId.toUpperCase()
    const pin = variant.variables.find((variable) => variable.name.toUpperCase() === handleId)
    if (!pin) continue

    const current = block.variableType?.type
    if (current?.definition === pin.type.definition && current?.value === pin.type.value) continue
    block.variableType = { name: pin.name, class: pin.class, type: { ...pin.type } }
    changed += 1
  }
  return changed
}

/**
 * Re-stamp every block in the given flows from the current system libraries and
 * the project's own POUs. Mutates in place; call it on a clone of loaded data.
 *
 * @returns how many types were refreshed, for the load-time console note.
 */
export function restampFlowBlockVariants(
  flows: Array<{ rung?: { nodes?: unknown }; rungs?: Array<{ nodes?: unknown }> }>,
  systemLibraries: SystemLibrary[],
  userPous: PLCPou[],
): number {
  const libraryPousByName = indexLibraryPous(systemLibraries)
  const userPousByName = indexUserPous(userPous)
  if (libraryPousByName.size === 0 && userPousByName.size === 0) return 0

  let changed = 0
  for (const flow of flows) {
    const rungs = flow.rungs ?? (flow.rung ? [flow.rung] : [])
    for (const rung of rungs) {
      const nodes = rung?.nodes
      if (!Array.isArray(nodes)) continue
      changed += restampBlockNodes(nodes as BlockBearingNode[], libraryPousByName, userPousByName)
      // After the blocks, so the pins copy the refreshed types.
      changed += restampPinNodes(nodes as Array<BlockBearingNode & PinBearingNode>)
    }
  }
  return changed
}
