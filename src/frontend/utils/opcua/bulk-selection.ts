import type { OpcUaNodeConfig, OpcUaSecurityProfile } from '../../../middleware/shared/ports/types'
import { findInstanceName, type PLCInstanceMapping } from '../debug-variable-finder'
import { buildDefaultNodeConfig, firstValidationFailure, isComplexTreeNode, type NodeSkipReason } from './node-defaults'
import { isGlobalScopePou } from './resolve-indices'
import { isHiddenByFilter, treeIdForNode, type TreeIndex } from './tree-index'
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

/** Whether a member of this entry already holds a node of its own. */
const aMemberHasItsOwnNode = (entry: VariableTreeNode, exposedIds: ReadonlySet<string>): boolean =>
  (entry.children ?? []).some((child) => exposedIds.has(child.id) || aMemberHasItsOwnNode(child, exposedIds))

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
export function planBulkAdd({ tree, index, filter, existingNodes, instances, createId }: BulkAddInput): BulkAddPlan {
  const nodes: OpcUaNodeConfig[] = []
  const skipped: SkipReport = {}

  const exposedIds = new Set(existingNodes.map((node) => treeIdForNode(node, index)))
  const takenNodeIdsLower = new Set(existingNodes.map((node) => node.nodeId.trim().toLowerCase()))
  const planned = new Set<string>()

  for (const group of tree) {
    for (const entry of group.children ?? []) {
      if (exposedIds.has(entry.id) || planned.has(entry.id)) continue
      if (isHiddenByFilter(entry, filter)) continue

      if (!isGlobalScopePou(entry.pouName) && findInstanceName(entry.pouName, instances) === null) {
        countSkip(skipped, 'no-instance')
        planned.add(entry.id)
        continue
      }

      if (aMemberHasItsOwnNode(entry, exposedIds)) {
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

/**
 * The visible children of a group a bulk add could expose: already exposed entries and the ones
 * the planner does not always skip. An entry it always skips is neutral, so a group holding only
 * such entries can still read as fully exposed.
 */
export function exposableChildren({
  group,
  index,
  filter,
  existingNodes,
}: {
  group: VariableTreeNode
  index: TreeIndex
  filter: string
  existingNodes: readonly OpcUaNodeConfig[]
}): VariableTreeNode[] {
  const exposedIds = new Set(existingNodes.map((node) => treeIdForNode(node, index)))
  const takenNodeIdsLower = new Set(existingNodes.map((node) => node.nodeId.trim().toLowerCase()))

  return (group.children ?? []).filter((entry) => {
    if (isHiddenByFilter(entry, filter)) return false
    if (exposedIds.has(entry.id)) return true
    if (aMemberHasItsOwnNode(entry, exposedIds)) return false
    if (filterHidesPartOf(entry, filter)) return false
    return !firstValidationFailure(
      buildDefaultNodeConfig(entry, () => 'probe'),
      takenNodeIdsLower,
    )
  })
}

export type BulkRemovePlan = {
  /** Ids of the stored nodes the action removes. */
  nodeIds: string[]
}

export type BulkRemoveInput = {
  /** The groups to walk: the whole tree for Remove all, one group for a group untick. */
  groups: readonly VariableTreeNode[]
  index: TreeIndex
  filter: string
  existingNodes: readonly OpcUaNodeConfig[]
  /** True for Remove all: every stored node goes, including the ones no longer in the tree. */
  everyGroup?: boolean
}

const idsOf = (entry: VariableTreeNode): string[] => [
  entry.id,
  ...(entry.children ?? []).flatMap((child) => idsOf(child)),
]

/** The nodes a group untick removes: the ones the group owns, not the globals it references. */
export function planBulkRemove({ groups, index, filter, existingNodes, everyGroup }: BulkRemoveInput): BulkRemovePlan {
  if (everyGroup && !filter) return { nodeIds: existingNodes.map((node) => node.id) }

  const owned = new Set<string>()

  for (const group of groups) {
    for (const entry of group.children ?? []) {
      if (isHiddenByFilter(entry, filter)) continue
      if (entry.pouName !== group.pouName) continue
      for (const id of idsOf(entry)) owned.add(id)
    }
  }

  return {
    nodeIds: existingNodes.filter((node) => owned.has(treeIdForNode(node, index))).map((node) => node.id),
  }
}

/** The anonymous reach of a server, as the confirmation states it. */
export type AnonymousAccess = {
  role: 'Viewer' | 'Operator' | 'Engineer'
  canWrite: boolean
}

const ROLE_RANK = { viewer: 0, operator: 1, engineer: 2 } as const
const ROLE_LABEL = { viewer: 'Viewer', operator: 'Operator', engineer: 'Engineer' } as const

/** The anonymous access an enabled security profile offers, or null when none does. */
export function anonymousAccess(profiles: readonly OpcUaSecurityProfile[]): AnonymousAccess | null {
  const anonymous = profiles.filter((profile) => profile.enabled && profile.authMethods.includes('Anonymous'))
  if (anonymous.length === 0) return null

  const mostPermissive = anonymous.reduce<keyof typeof ROLE_RANK>((worst, profile) => {
    const role = profile.anonymousRole ?? 'viewer'
    return ROLE_RANK[role] > ROLE_RANK[worst] ? role : worst
  }, 'viewer')

  return { role: ROLE_LABEL[mostPermissive], canWrite: mostPermissive === 'engineer' }
}

export function bulkConfirmationMessage({
  count,
  access,
  serverEnabled,
}: {
  count: number
  access: AnonymousAccess
  serverEnabled: boolean
}): string {
  const subject = count === 1 ? '1 variable' : `${count} variables`
  const object = count === 1 ? 'it' : 'them'
  const verb = access.canWrite ? 'read and write' : 'read'
  const disabled = serverEnabled ? '' : ' The server is currently disabled.'

  return `Expose ${subject}? Anonymous clients can ${verb} ${object} (role ${access.role}).${disabled}`
}
