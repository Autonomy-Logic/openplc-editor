import type { DebugTreeNode, PLCGlobalVariableList, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'
import { GLOBAL_CONFIG_NAME } from './debug-variable-finder'

export type MonitorView = {
  name: string
  entries: string[]
}

export type TagRow = {
  compositeKey: string
  fullPath: string
  name: string
  scope: string
  area: string
  address: string
  type: string
  comment: string
  depth: number
  isComplex: boolean
  hasChildren: boolean
  debugIndex?: number
  enumValues?: string[]
}

export type BuildTagRowsInput = {
  trees: DebugTreeNode[]
  pous: PLCPou[]
  globalVariables: PLCVariable[]
  globalVariableLists?: PLCGlobalVariableList[]
  views: MonitorView[]
  expandedKeys?: ReadonlySet<string>
}

const GLOBAL_SCOPE_LABEL = 'Global'

function scopeOfCompositeKey(compositeKey: string): string {
  const owner = compositeKey.split(':')[0]
  return owner === GLOBAL_CONFIG_NAME ? GLOBAL_SCOPE_LABEL : owner
}

function buildVariableIndex(
  pous: PLCPou[],
  globalVariables: PLCVariable[],
  globalVariableLists: PLCGlobalVariableList[],
): Map<string, PLCVariable> {
  const index = new Map<string, PLCVariable>()

  for (const variable of globalVariables) {
    index.set(`${GLOBAL_SCOPE_LABEL}:${variable.name.toUpperCase()}`, variable)
  }

  for (const list of globalVariableLists) {
    for (const variable of list.variables) {
      const key = `${GLOBAL_SCOPE_LABEL}:${variable.name.toUpperCase()}`
      if (!index.has(key)) index.set(key, variable)
    }
  }

  for (const pou of pous) {
    for (const variable of pou.interface?.variables ?? []) {
      index.set(`${pou.name}:${variable.name.toUpperCase()}`, variable)
    }
  }

  return index
}

function buildAreaIndex(views: MonitorView[]): Map<string, string> {
  const areas = new Map<string, string>()
  for (const view of views) {
    for (const entry of view.entries) {
      if (!areas.has(entry)) areas.set(entry, view.name)
    }
  }
  return areas
}

function rowOfNode(
  node: DebugTreeNode,
  depth: number,
  scope: string,
  variable: PLCVariable | undefined,
  area: string,
): TagRow {
  return {
    compositeKey: node.compositeKey,
    fullPath: node.fullPath,
    name: node.name,
    scope,
    area,
    address: variable?.location ?? '',
    type: node.type,
    comment: variable?.documentation ?? '',
    depth,
    isComplex: node.isComplex,
    hasChildren: (node.children?.length ?? 0) > 0,
    ...(node.debugIndex !== undefined ? { debugIndex: node.debugIndex } : {}),
    ...(node.enumValues ? { enumValues: node.enumValues } : {}),
  }
}

export function buildTagRows({
  trees,
  pous,
  globalVariables,
  globalVariableLists = [],
  views,
  expandedKeys,
}: BuildTagRowsInput): TagRow[] {
  const variables = buildVariableIndex(pous, globalVariables, globalVariableLists)
  const areas = buildAreaIndex(views)
  const expanded = expandedKeys ?? new Set<string>()
  const rows: TagRow[] = []

  const sortedTrees = [...trees].sort((a, b) => {
    const scopeOrder = scopeOfCompositeKey(a.compositeKey).localeCompare(scopeOfCompositeKey(b.compositeKey))
    return scopeOrder !== 0 ? scopeOrder : a.name.localeCompare(b.name)
  })

  const pushNode = (node: DebugTreeNode, depth: number, scope: string) => {
    const declaration = depth === 0 ? variables.get(`${scope}:${node.name.toUpperCase()}`) : undefined
    rows.push(rowOfNode(node, depth, scope, declaration, areas.get(node.compositeKey) ?? ''))

    if (!expanded.has(node.compositeKey)) return
    for (const child of node.children ?? []) {
      pushNode(child, depth + 1, scope)
    }
  }

  for (const tree of sortedTrees) {
    pushNode(tree, 0, scopeOfCompositeKey(tree.compositeKey))
  }

  return rows
}

export function filterTagRows(rows: TagRow[], query: string): TagRow[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return rows

  return rows.filter((row) =>
    [row.name, row.scope, row.area, row.address, row.type, row.comment].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  )
}

function isDescendantKey(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(`${ancestor}.`) || candidate.startsWith(`${ancestor}[`)
}

export function rowsOfView(rows: TagRow[], views: MonitorView[], viewName: string): TagRow[] {
  if (viewName.length === 0) return rows

  const view = views.find((candidate) => candidate.name === viewName)
  if (!view) return []

  const entries = new Set(view.entries)
  return rows.filter(
    (row) => entries.has(row.compositeKey) || view.entries.some((entry) => isDescendantKey(row.compositeKey, entry)),
  )
}

export function nextMonitorViewName(views: MonitorView[]): string {
  let index = views.length + 1
  while (nameTaken(views, `View ${index}`)) index += 1
  return `View ${index}`
}

export type MonitorViewResult = {
  views: MonitorView[]
  error?: string
}

function normalizedName(name: string): string {
  return name.trim()
}

function nameTaken(views: MonitorView[], name: string): boolean {
  return views.some((view) => view.name.toLowerCase() === name.toLowerCase())
}

export function createMonitorView(views: MonitorView[], name: string): MonitorViewResult {
  const candidate = normalizedName(name)
  if (candidate.length === 0) return { views, error: 'The view needs a name.' }
  if (nameTaken(views, candidate)) return { views, error: `A view named "${candidate}" already exists.` }

  return { views: [...views, { name: candidate, entries: [] }] }
}

export function renameMonitorView(views: MonitorView[], from: string, to: string): MonitorViewResult {
  const candidate = normalizedName(to)
  if (candidate.length === 0) return { views, error: 'The view needs a name.' }
  if (!views.some((view) => view.name === from)) return { views, error: `There is no view named "${from}".` }
  if (candidate.toLowerCase() !== from.toLowerCase() && nameTaken(views, candidate)) {
    return { views, error: `A view named "${candidate}" already exists.` }
  }

  return { views: views.map((view) => (view.name === from ? { ...view, name: candidate } : view)) }
}

export function removeMonitorView(views: MonitorView[], name: string): MonitorView[] {
  return views.filter((view) => view.name !== name)
}

export function assignTagToView(views: MonitorView[], compositeKey: string, viewName: string): MonitorView[] {
  const withoutTag = views.map((view) => ({
    ...view,
    entries: view.entries.filter((entry) => entry !== compositeKey),
  }))

  if (viewName.length === 0) return withoutTag

  return withoutTag.map((view) =>
    view.name === viewName ? { ...view, entries: [...view.entries, compositeKey] } : view,
  )
}

export function pruneMonitorViews(views: MonitorView[], knownKeys: ReadonlySet<string>): MonitorView[] {
  return views.map((view) => ({ ...view, entries: view.entries.filter((entry) => knownKeys.has(entry)) }))
}
