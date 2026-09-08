import type { BlockVariant } from '@root/middleware/shared/ports/block-types'
import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

import { blockParameterSide } from '../graphical/in-out-pin-rules'

/**
 * Refresh placed graphical block variants from the current library definitions.
 *
 * A block's signature is copied into `node.data.variant` when the block is
 * dropped on the canvas and then frozen in the saved project. On project load
 * we re-stamp every block that resolves to a library definition; blocks backed
 * by a user-defined POU are skipped, because the project owns their interface.
 *
 * What is applied in place: pin `type`, pin `class` that stays on the same
 * side, `documentation`, `extensible` and the block `type`. None of those move
 * a pin.
 *
 * A pin the library ADDED is applied only when the caller supplies
 * `measureBlock` — the canvas wires to `data.handles`, so a new pin needs the
 * node's geometry recomputed, and that is each language's own `getBlockSize`.
 * Project load does not supply it: growing every placed block would resize and
 * relayout diagrams before the user has seen them. It is supplied by the
 * explicit library-update action instead, which also runs where components may
 * be imported.
 *
 * What is reported and NOT applied: a pin removed, or a `class` change that
 * moves a pin to the other side. Both invalidate existing wiring, so the
 * library definition is reported and the diagram is left for the user to fix.
 */

type LibraryPou = SystemLibrary['pous'][number]
type VariantVariable = BlockVariant['variables'][number]

/** EN/ENO are implicit control pins; a library POU never declares them. */
const IMPLICIT_PINS = new Set(['EN', 'ENO'])

export type RestampSeverity = 'info' | 'warning' | 'error'

export type RestampChangeKind =
  | 'type'
  | 'class'
  | 'documentation'
  | 'extensible'
  | 'block-type'
  | 'pin-added'
  | 'pin-removed'
  | 'pin-side'

export interface RestampChange {
  /** Library block name, e.g. `ANALOG_IN`. */
  block: string
  /** POU the block sits in, when the caller supplied one. */
  pou?: string
  /** Instance name of the placed block, e.g. `ANALOG_IN0`. */
  instance?: string
  pin?: string
  kind: RestampChangeKind
  from?: string
  to?: string
  severity: RestampSeverity
  /** False when the change was detected but needs geometry this cannot rebuild. */
  applied: boolean
  /** Something is wired to the pin. */
  connected?: boolean
}

/** Geometry for a block, as each language's `getBlockSize` returns it. */
export interface BlockGeometry {
  handles: unknown[]
  leftHandles: unknown[]
  rightHandles: unknown[]
  width: number
  height: number
}

/** A language's `getBlockSize`, injected so this stays language-agnostic. */
export type MeasureBlock = (variant: BlockVariant, handlePosition: { x: number; y: number }) => BlockGeometry

export interface RestampOptions {
  /** POU the flows belong to, stamped onto every change for reporting. */
  pou?: string
  /** Supply to let an added pin be applied rather than only reported. */
  measureBlock?: MeasureBlock
}

export interface RestampReport {
  changes: RestampChange[]
  /** No libraries were loaded, so nothing could be checked. */
  poolEmpty: boolean
  /**
   * The flow was actually altered. Callers persist on this rather than on
   * `changes`: some corrections are silent -- refreshing the copy of a pin
   * held by the variable wired to it produces no message of its own, and
   * without this the fix would be redone on every load and never saved.
   */
  modified: boolean
}

/** Index every library POU by name. First definition wins. */
function indexLibraryPous(systemLibraries: SystemLibrary[]): Map<string, LibraryPou> {
  const byName = new Map<string, LibraryPou>()
  for (const library of systemLibraries) {
    for (const pou of library.pous) {
      if (!byName.has(pou.name)) byName.set(pou.name, pou)
    }
  }
  return byName
}

type FlowEdge = {
  source?: string
  target?: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

type Handle = { glbPosition?: { x: number; y: number } }

/**
 * A variable wired to a block pin keeps its own copy of that pin's signature.
 * The canvas renders its type as the `(*TYPE*)` placeholder and validates
 * dropped variables against it, so it has to move with the pin.
 */
type AttachedPin = {
  id?: string
  handleId?: string
  variableType?: { name?: string; class?: string; type?: { definition: string; value: string } }
}

type BlockBearingNode = {
  id?: string
  type?: string
  width?: number
  height?: number
  measured?: { width: number; height: number }
  data?: {
    variant?: BlockVariant
    variable?: { name?: string }
    connectedVariables?: Array<{ handleId?: string }>
    block?: AttachedPin
    handles?: unknown[]
    inputHandles?: unknown[]
    outputHandles?: unknown[]
    inputConnector?: Handle
    outputConnector?: Handle
  }
}

type RungLike = { nodes?: unknown; edges?: unknown }

/** Is anything wired to this pin — an edge, or a variable bound to the handle? */
function isPinConnected(node: BlockBearingNode, pin: string, edges: FlowEdge[]): boolean {
  if (node.id) {
    for (const edge of edges) {
      if (edge.source === node.id && edge.sourceHandle === pin) return true
      if (edge.target === node.id && edge.targetHandle === pin) return true
    }
  }
  return (node.data?.connectedVariables ?? []).some((bound) => bound.handleId === pin)
}

const typeLabel = (type: { definition: string; value: string }): string => type.value

/**
 * Recompute a node's handles and box for its current variant, anchored on the
 * input connector it already has so the block does not move.
 */
function remeasure(node: BlockBearingNode, measureBlock: MeasureBlock): boolean {
  const variant = node.data?.variant
  const anchor = node.data?.inputConnector?.glbPosition
  if (!variant || !node.data || !anchor) return false

  const size = measureBlock(variant, { x: anchor.x, y: anchor.y })
  node.data.handles = size.handles
  node.data.inputHandles = size.leftHandles
  node.data.outputHandles = size.rightHandles
  node.data.inputConnector = size.leftHandles[0] as Handle
  node.data.outputConnector = size.rightHandles[0] as Handle
  node.width = size.width
  node.height = size.height
  node.measured = { width: size.width, height: size.height }
  return true
}

function restampNodes(
  nodes: BlockBearingNode[],
  edges: FlowEdge[],
  libraryPousByName: Map<string, LibraryPou>,
  userPouNames: Set<string>,
  pou: string | undefined,
  measureBlock: MeasureBlock | undefined,
  changes: RestampChange[],
): boolean {
  let modified = false
  // Block node id -> its pins as the library now declares them, so the
  // variables wired to those pins can be brought along.
  const refreshedPins = new Map<string, Map<string, LibraryPou['variables'][number]>>()

  for (const node of nodes) {
    if (node?.type !== 'block') continue
    const variant = node.data?.variant
    const name = variant?.name
    if (!variant || !name) continue

    // The project owns a user-defined POU's shape.
    if (userPouNames.has(name.toUpperCase())) continue

    const libPou = libraryPousByName.get(name)
    if (!libPou) continue

    const instance = node.data?.variable?.name
    const record = (change: Omit<RestampChange, 'block' | 'pou' | 'instance'>): void => {
      changes.push({ block: name, pou, instance, ...change })
    }

    if (variant.documentation !== libPou.documentation) {
      variant.documentation = libPou.documentation
      modified = true
      record({ kind: 'documentation', severity: 'info', applied: true })
    }

    if ((variant.extensible ?? false) !== (libPou.extensible ?? false)) {
      const from = String(variant.extensible ?? false)
      variant.extensible = libPou.extensible ?? false
      modified = true
      record({ kind: 'extensible', from, to: String(variant.extensible), severity: 'warning', applied: true })
    }

    // 'generic' is the unnamed placeholder block, which resolves to no library.
    //
    // Reported, never applied: a function block needs an instance variable in
    // the POU and a function must not have one, so switching the kind under a
    // placed block leaves it referring to a variable that does not exist -- the
    // editor then marks it wrong with nothing to explain why.
    if (variant.type !== 'generic' && variant.type !== libPou.type) {
      record({ kind: 'block-type', from: variant.type, to: libPou.type, severity: 'error', applied: false })
    }

    const libVarByName = new Map(libPou.variables.map((variable) => [variable.name, variable]))
    if (node.id) refreshedPins.set(node.id, libVarByName)
    const seen = new Set<string>()
    // Block width and handle positions are measured from the pins: their
    // names, which side they sit on, and whether an in-out marker has to be
    // paid for. Anything that moves those needs the box measured again.
    let geometryChanged = false

    for (const variable of variant.variables) {
      if (IMPLICIT_PINS.has(variable.name)) continue
      seen.add(variable.name)
      const connected = isPinConnected(node, variable.name, edges)
      const libVar = libVarByName.get(variable.name)

      if (!libVar) {
        // An extensible block grows past its declared parameters -- ADD's IN3,
        // IN4 and so on are the diagram's, not the library's. Only a fixed
        // block can actually lose a pin.
        if (libPou.extensible) continue
        record({
          kind: 'pin-removed',
          pin: variable.name,
          from: typeLabel(variable.type),
          severity: connected ? 'error' : 'warning',
          applied: false,
          connected,
        })
        continue
      }

      if (variable.class !== libVar.class) {
        const from = variable.class
        if (blockParameterSide(variable) === blockParameterSide(libVar)) {
          variable.class = libVar.class
          geometryChanged = true
          modified = true
          record({ kind: 'class', pin: variable.name, from, to: libVar.class, severity: 'info', applied: true })
        } else {
          record({
            kind: 'pin-side',
            pin: variable.name,
            from,
            to: libVar.class,
            severity: connected ? 'error' : 'warning',
            applied: false,
            connected,
          })
        }
      }

      const next = libVar.type
      const current = variable.type
      if (current.definition !== next.definition || current.value !== next.value) {
        const from = typeLabel(current)
        // A library types `generic-type` value as a plain string; the variant
        // narrows it to the ANY_* union, so the pairing has to be asserted.
        variable.type = { definition: next.definition, value: next.value } as VariantVariable['type']
        modified = true
        record({
          kind: 'type',
          pin: variable.name,
          from,
          to: next.value,
          severity: connected ? 'warning' : 'info',
          applied: true,
          connected,
        })
      }
    }

    const added = libPou.variables.filter((libVar) => !IMPLICIT_PINS.has(libVar.name) && !seen.has(libVar.name))
    // Appended together so the box is measured once, whatever the library added.
    let grown = false
    if (added.length > 0 && measureBlock) {
      const before = variant.variables.length
      variant.variables.push(...(added as VariantVariable[]))
      grown = remeasure(node, measureBlock)
      if (!grown) variant.variables.length = before
      else {
        geometryChanged = false // remeasure() already ran for this node
        modified = true
      }
    }
    if (geometryChanged && measureBlock) remeasure(node, measureBlock)

    for (const libVar of added) {
      record({
        kind: 'pin-added',
        pin: libVar.name,
        to: typeLabel(libVar.type),
        severity: grown ? 'info' : 'warning',
        applied: grown,
      })
    }
  }

  // A variable wired to a pin carries its own copy of that pin's signature.
  // Leaving it behind shows the old type on the canvas and rejects a variable
  // of the new one, which reads as the update having done nothing.
  for (const node of nodes) {
    const attached = node.data?.block
    if (!attached?.id || !attached.handleId || !attached.variableType) continue
    const libVar = refreshedPins.get(attached.id)?.get(attached.handleId)
    if (!libVar) continue
    const current = attached.variableType
    if (
      current.name === libVar.name &&
      current.class === libVar.class &&
      current.type?.definition === libVar.type.definition &&
      current.type?.value === libVar.type.value
    ) {
      continue
    }
    attached.variableType = { name: libVar.name, class: libVar.class, type: { ...libVar.type } }
    modified = true
  }

  return modified
}

/**
 * Re-stamp every block in the given flows from the current system libraries.
 * Mutates the flow objects in place.
 *
 * `flows` accepts both FBD flows (single `rung`) and LD flows (`rungs[]`); the
 * shape is duck-typed so the helper stays language-agnostic.
 */
export function restampFlowLibraryVariants(
  flows: Array<{ rung?: RungLike; rungs?: RungLike[] }>,
  systemLibraries: SystemLibrary[],
  userPouNames: Iterable<string>,
  options: RestampOptions = {},
): RestampReport {
  const libraryPousByName = indexLibraryPous(systemLibraries)
  if (libraryPousByName.size === 0) return { changes: [], poolEmpty: true, modified: false }

  const skip = new Set<string>()
  for (const userPouName of userPouNames) skip.add(userPouName.toUpperCase())

  const changes: RestampChange[] = []
  let modified = false
  for (const flow of flows) {
    const rungs = flow.rungs ?? (flow.rung ? [flow.rung] : [])
    for (const rung of rungs) {
      const nodes = rung?.nodes
      if (!Array.isArray(nodes)) continue
      const edges = Array.isArray(rung?.edges) ? (rung.edges as FlowEdge[]) : []
      const touched = restampNodes(
        nodes as BlockBearingNode[],
        edges,
        libraryPousByName,
        skip,
        options.pou,
        options.measureBlock,
        changes,
      )
      modified = modified || touched
    }
  }
  return { changes, poolEmpty: false, modified }
}

export interface RestampSummaryLine {
  severity: RestampSeverity
  message: string
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** Verb agreeing with a count of placed blocks. */
const verb = (count: number, singular: string, pluralForm: string): string => (count === 1 ? singular : pluralForm)

const where = (pous: Set<string>): string => {
  const named = [...pous].filter(Boolean).sort()
  return named.length ? ` in ${named.join(', ')}` : ''
}

function lineFor(change: RestampChange, count: number, pous: Set<string>): string {
  const { block, pin, from, to } = change
  const at = where(pous)
  switch (change.kind) {
    case 'documentation':
      return `${block}: documentation refreshed from the library — ${plural(count, 'block')}${at}.`
    case 'type':
      return `${block}.${pin}: type ${from} → ${to} — ${plural(count, 'block')}${at}.`
    case 'class':
      return `${block}.${pin}: class ${from} → ${to} — ${plural(count, 'block')}${at}.`
    case 'extensible':
      return `${block}: extensible ${from} → ${to} — ${plural(count, 'block')}${at}.`
    case 'block-type':
      return (
        `${block}: the library changed this from a ${from} to a ${to}. ` +
        `${plural(count, 'placed block')}${at} still ${verb(count, 'carries', 'carry')} the old kind; ` +
        `delete and re-place ${verb(count, 'it', 'them')}.`
      )
    case 'pin-added':
      return (
        `${block}: the library added pin ${pin} (${to}). ${plural(count, 'placed block')}${at} ` +
        `${verb(count, 'does not draw', 'do not draw')} it yet.`
      )
    case 'pin-removed':
      return (
        `${block}: the library removed pin ${pin}. ${plural(count, 'placed block')}${at} still ` +
        `${verb(count, 'draws', 'draw')} it` +
        `${change.connected ? ', with something wired to it' : ''}.`
      )
    case 'pin-side':
      return (
        `${block}.${pin}: class ${from} → ${to} moves the pin to the other side. ` +
        `${plural(count, 'placed block')}${at} ${verb(count, 'keeps', 'keep')} it where it is` +
        `${change.connected ? ', with something wired to it' : ''}.`
      )
  }
}

/**
 * Collapse per-block changes into one line each, so a project that places the
 * same block a hundred times reports once rather than a hundred times.
 */
export function summariseRestampChanges(changes: RestampChange[]): RestampSummaryLine[] {
  const groups = new Map<string, { change: RestampChange; count: number; pous: Set<string> }>()
  for (const change of changes) {
    const key = [change.block, change.kind, change.pin, change.from, change.to, change.severity].join('|')
    const group = groups.get(key)
    if (group) {
      group.count += 1
      if (change.pou) group.pous.add(change.pou)
    } else {
      groups.set(key, { change, count: 1, pous: new Set(change.pou ? [change.pou] : []) })
    }
  }

  const order: Record<RestampSeverity, number> = { error: 0, warning: 1, info: 2 }
  return [...groups.values()]
    .map(({ change, count, pous }) => ({ severity: change.severity, message: lineFor(change, count, pous) }))
    .sort((a, b) => order[a.severity] - order[b.severity] || a.message.localeCompare(b.message))
}
