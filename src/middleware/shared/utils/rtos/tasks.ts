import type { RtosDebugOwnerRange } from './types'

export interface RtosInstanceLike {
  name: string
  task: string
}

/**
 * Which task owns each run of the debug table, so the firmware locks only that
 * task, not every task, while the debugger or OPC-UA touches one of its variables.
 *
 * A leaf belongs to the program instance its path starts with (`INSTANCE.VAR`),
 * and so to that instance's task. A first segment that names a global (`MOTOR_ON`,
 * `LINE.SPEED`) is never taken for an instance. Globals are left out, since the
 * firmware treats every variable not listed as shared. Consecutive leaves of one
 * task in one array collapse into a single range.
 */
export function buildDebugOwnerRanges(
  debugMapJson: string,
  instances: readonly RtosInstanceLike[],
  globalNames: readonly string[] = [],
): RtosDebugOwnerRange[] {
  let leaves: unknown
  try {
    const map: unknown = JSON.parse(debugMapJson)
    leaves = typeof map === 'object' && map !== null && 'leaves' in map ? map.leaves : undefined
  } catch {
    return []
  }
  if (!Array.isArray(leaves)) return []
  const list: unknown[] = leaves

  const taskOf = new Map(instances.map((instance) => [instance.name.toUpperCase(), instance.task]))
  const globals = new Set(globalNames.map((name) => name.toUpperCase()))
  const owned: { arr: number; elem: number; task: string }[] = []
  for (const leaf of list) {
    if (typeof leaf !== 'object' || leaf === null) continue
    const arr = 'arrayIdx' in leaf ? leaf.arrayIdx : undefined
    const elem = 'elemIdx' in leaf ? leaf.elemIdx : undefined
    const path = 'path' in leaf ? leaf.path : undefined
    if (typeof arr !== 'number' || typeof elem !== 'number' || typeof path !== 'string') continue
    const segments = path.split('.')
    const head = segments[0].toUpperCase()
    if (segments.length < 2 || globals.has(head)) continue
    const task = taskOf.get(head)
    if (task !== undefined) owned.push({ arr, elem, task })
  }
  owned.sort((a, b) => a.arr - b.arr || a.elem - b.elem)

  const ranges: RtosDebugOwnerRange[] = []
  for (const { arr, elem, task } of owned) {
    const last = ranges[ranges.length - 1]
    if (last && last.arr === arr && last.task === task && last.last === elem - 1) {
      last.last = elem
    } else {
      ranges.push({ arr, first: elem, last: elem, task })
    }
  }
  return ranges
}

/**
 * The number of distinct IEC priorities among the tasks. Each takes a native
 * level of its own, so more than the backend's band holds cannot keep IEC order
 * (0 is the highest) and the build refuses them.
 */
export function countDistinctPriorities(tasks: readonly { priority: number }[]): number {
  return new Set(tasks.map((task) => task.priority)).size
}
