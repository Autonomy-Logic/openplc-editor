import type { PLCPou, PLCProjectData, PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayTotalElements } from '../PLC/array-codegen-helpers'

const MAX_DEPTH = 32

/** The function block type a variable instantiates, and how many instances it holds. */
function instancesOf(variable: PLCVariable): { type: string; count: number } | null {
  const { type } = variable
  if (type.definition === 'derived' || type.definition === 'user-data-type') return { type: type.value, count: 1 }
  if (type.definition === 'array') {
    const base = type.data?.baseType
    if (base?.definition === 'user-data-type') {
      return { type: base.value, count: getArrayTotalElements(variable) }
    }
  }
  return null
}

/**
 * How many Python function block instances a project runs: each program instance and every global, through
 * function blocks that hold others. A block the project cannot see (from a library) is not counted, and starts on
 * demand.
 */
export function countPythonBlockInstances(project: PLCProjectData): number {
  const pous = new Map<string, PLCPou>(project.pous.map((pou) => [pou.name.toUpperCase(), pou]))
  const memo = new Map<string, number>()

  const inVariables = (variables: readonly PLCVariable[], depth: number): number =>
    variables.reduce((total, variable) => {
      const instances = instancesOf(variable)
      return instances ? total + instances.count * inType(instances.type, depth + 1) : total
    }, 0)

  const inType = (name: string, depth: number): number => {
    const key = name.toUpperCase()
    const known = memo.get(key)
    if (known !== undefined) return known
    const pou = pous.get(key)
    if (!pou || depth > MAX_DEPTH || pou.pouType !== 'function-block') return 0
    memo.set(key, 0)
    const count = pou.body.language === 'python' ? 1 : inVariables(pou.interface?.variables ?? [], depth)
    memo.set(key, count)
    return count
  }

  const programs = project.configurations.resource.instances.reduce((total, instance) => {
    const program = pous.get(instance.program.toUpperCase())
    return program ? total + inVariables(program.interface?.variables ?? [], 0) : total
  }, 0)
  const globals = [
    ...project.configurations.resource.globalVariables,
    ...(project.globalVariableLists ?? []).flatMap((list) => list.variables),
  ]
  return programs + inVariables(globals, 0)
}
