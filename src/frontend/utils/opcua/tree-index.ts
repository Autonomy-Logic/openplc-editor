import { GLOBAL_SCOPE_POU } from './resolve-indices'
import type { VariableTreeNode } from './types'

export type TreeIndex = ReadonlyMap<string, VariableTreeNode>

export function indexTree(tree: readonly VariableTreeNode[]): TreeIndex {
  const index = new Map<string, VariableTreeNode>()
  const walk = (nodes: readonly VariableTreeNode[]) => {
    for (const node of nodes) {
      index.set(node.id, node)
      if (node.children) walk(node.children)
    }
  }
  walk(tree)
  return index
}

/**
 * A VAR_EXTERNAL used to be saved under the POU that declared it and is now
 * attributed to the global scope, so both spellings have to land on the same
 * tree entry. Only ever widens: a node whose own id is in the tree keeps it.
 */
export function treeIdForNode(node: { pouName: string; variablePath: string }, index: TreeIndex): string {
  const own = `${node.pouName}-${node.variablePath}`
  if (index.has(own)) return own
  const asGlobal = `${GLOBAL_SCOPE_POU}-${node.variablePath}`
  return index.has(asGlobal) ? asGlobal : own
}

const matchesOwnName = (node: VariableTreeNode, filter: string): boolean =>
  node.name.toLowerCase().includes(filter.toLowerCase())

const anyDescendantMatches = (node: VariableTreeNode, filter: string): boolean =>
  matchesOwnName(node, filter) || (node.children?.some((child) => anyDescendantMatches(child, filter)) ?? false)

export function isHiddenByFilter(node: VariableTreeNode, filter: string): boolean {
  if (!filter) return false
  return !anyDescendantMatches(node, filter)
}

export function visibleChildren(node: VariableTreeNode, filter: string): VariableTreeNode[] {
  return (node.children ?? []).filter((child) => !isHiddenByFilter(child, filter))
}

export type TopLevelEntryCounts = {
  /** Distinct entries the tree exposes, whatever the filter. */
  total: number
  /** Of those, the ones the filter leaves visible. */
  shown: number
}

/**
 * BR09: an entry is a child of a group row, counted once across the groups
 * that reference it, and a group row is not an entry of its own.
 */
export function countTopLevelEntries(tree: readonly VariableTreeNode[], filter: string): TopLevelEntryCounts {
  const total = new Set<string>()
  const shown = new Set<string>()

  for (const group of tree) {
    for (const child of group.children ?? []) {
      total.add(child.id)
      if (!isHiddenByFilter(child, filter)) shown.add(child.id)
    }
  }

  return { total: total.size, shown: shown.size }
}
