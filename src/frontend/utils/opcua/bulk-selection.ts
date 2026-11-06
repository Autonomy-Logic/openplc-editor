import type { OpcUaNodeConfig } from '../../../middleware/shared/ports/types'
import { findInstanceName, type PLCInstanceMapping } from '../debug-variable-finder'
import {
  buildDefaultNodeConfig,
  firstValidationFailure,
  isComplexTreeNode,
  type NodeSkipReason,
} from './node-defaults'
import { isGlobalScopePou } from './resolve-indices'
import { isHiddenByFilter, type TreeIndex, treeIdForNode } from './tree-index'
import type { VariableTreeNode } from './types'

/** How many entries each reason skipped. A reason with no entry is absent, not zero. */
export type SkipReport = Partial<Record<NodeSkipReason, number>>

export type BulkAddPlan = {
  nodes: OpcUaNodeConfig[]
  skipped: SkipReport
}

export type BulkAddInput = {
  /** The groups to walk: the whole tree for Select all, one group for a group tick. */
  tree: readonly VariableTreeNode[]
  /** Index of the WHOLE tree, so a global keeps its single id whichever group lists it. */
  index: TreeIndex
  filter: string
  existingNodes: readonly OpcUaNodeConfig[]
  instances: PLCInstanceMapping[]
  createId: () => string
}

const countSkip = (report: SkipReport, reason: NodeSkipReason): void => {
  report[reason] = (report[reason] ?? 0) + 1
}

/**
 * An FB instance or struct is exposed whole, so a member holding a node of its
 * own would be exposed twice; the parent is skipped instead (BR10).
 */
const aMemberHasItsOwnNode = (entry: VariableTreeNode, exposedPaths: ReadonlySet<string>): boolean =>
  (entry.children ?? []).some(
    (child) => exposedPaths.has(`${child.pouName}:${child.variablePath}`) || aMemberHasItsOwnNode(child, exposedPaths),
  )

/** The filter hides part of a complex entry when the entry matches only through some of its members. */
const filterHidesPartOf = (entry: VariableTreeNode, filter: string): boolean => {
  if (!filter || !isComplexTreeNode(entry)) return false
  if (entry.name.toLowerCase().includes(filter.toLowerCase())) return false
  return (entry.children ?? []).some((child) => isHiddenByFilter(child, filter))
}

/**
 * Decides, without touching the store, which entries a bulk add exposes and why
 * the others are left out. The caller writes the nodes in one batch and reports
 * the skips in one toast.
 */
export function planBulkAdd({
  tree,
  index,
  filter,
  existingNodes,
  instances,
  createId,
}: BulkAddInput): BulkAddPlan {
  const nodes: OpcUaNodeConfig[] = []
  const skipped: SkipReport = {}

  const exposedIds = new Set(existingNodes.map((node) => treeIdForNode(node, index)))
  const exposedPaths = new Set(existingNodes.map((node) => `${node.pouName}:${node.variablePath}`))
  const takenNodeIdsLower = new Set(existingNodes.map((node) => node.nodeId.trim().toLowerCase()))
  const planned = new Set<string>()

  for (const group of tree) {
    for (const entry of group.children ?? []) {
      // An entry already exposed, or one the filter hides, is outside the action (BR18).
      if (exposedIds.has(entry.id) || planned.has(entry.id)) continue
      if (isHiddenByFilter(entry, filter)) continue

      if (!isGlobalScopePou(entry.pouName) && findInstanceName(entry.pouName, instances) === null) {
        countSkip(skipped, 'no-instance')
        planned.add(entry.id)
        continue
      }

      if (aMemberHasItsOwnNode(entry, exposedPaths)) {
        countSkip(skipped, 'member-has-node')
        planned.add(entry.id)
        continue
      }

      if (filterHidesPartOf(entry, filter)) {
        countSkip(skipped, 'filter-hides-part')
        planned.add(entry.id)
        continue
      }

      const config = buildDefaultNodeConfig(entry, createId)
      const failure = firstValidationFailure(config, takenNodeIdsLower)
      if (failure) {
        countSkip(skipped, failure)
        planned.add(entry.id)
        continue
      }

      nodes.push(config)
      planned.add(entry.id)
      takenNodeIdsLower.add(config.nodeId.trim().toLowerCase())
    }
  }

  return { nodes, skipped }
}
