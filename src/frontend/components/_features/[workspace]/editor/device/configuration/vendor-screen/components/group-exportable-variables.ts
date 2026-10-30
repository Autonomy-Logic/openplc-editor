import type { ExportableVariable } from '@root/middleware/shared/vendor-document/protocol'

/**
 * One grouping bucket in the hierarchical variable picker: a POU program or
 * the global variable list. The flat `ExportableVariable[]` the host hands
 * over already carries `scope` on every item, so grouping is a pure fold with
 * no cross-store reads.
 */
export type ExportableGroup = {
  key: string
  label: string
  kind: 'program' | 'gvl'
  variables: ReadonlyArray<ExportableVariable>
}

/**
 * Group a flat `ExportableVariable[]` by its `scope`. Programs come first in
 * alphabetical order, GVLs last (also alphabetical). Keys are stable:
 * `program:<name>` and `gvl:<listName>` so grouping decisions do not depend
 * on label collisions.
 */
export function groupByScope(variables: ReadonlyArray<ExportableVariable>): ExportableGroup[] {
  const buckets = new Map<string, { label: string; kind: 'program' | 'gvl'; items: ExportableVariable[] }>()
  for (const v of variables) {
    const key = v.scope.kind === 'program' ? `program:${v.scope.programName}` : `gvl:${v.scope.listName}`
    const label = v.scope.kind === 'program' ? v.scope.programName : v.scope.listName
    const bucket = buckets.get(key)
    if (bucket) bucket.items.push(v)
    else buckets.set(key, { label, kind: v.scope.kind, items: [v] })
  }
  const programs: ExportableGroup[] = []
  const gvls: ExportableGroup[] = []
  for (const [key, b] of buckets) {
    const group: ExportableGroup = { key, label: b.label, kind: b.kind, variables: b.items }
    if (b.kind === 'program') programs.push(group)
    else gvls.push(group)
  }
  const byLabel = (a: ExportableGroup, b: ExportableGroup) => a.label.localeCompare(b.label)
  programs.sort(byLabel)
  gvls.sort(byLabel)
  return [...programs, ...gvls]
}
