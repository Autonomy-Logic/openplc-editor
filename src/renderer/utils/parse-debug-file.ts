export interface DebugVariable {
  name: string
  type: string
  index: number
}

export interface ParsedDebugData {
  variables: DebugVariable[]
  totalCount: number
}

export function parseDebugFile(content: string): ParsedDebugData {
  const variables: DebugVariable[] = []

  const debugVarsMatch = content.match(/debug_vars\[\]\s*=\s*\{([\s\S]*?)\};/)

  if (!debugVarsMatch) {
    console.warn('Could not find debug_vars[] array in debug.c')
    return { variables: [], totalCount: 0 }
  }

  const arrayContent = debugVarsMatch[1]

  const entryRegex = /\{\s*&\(([^)]+)\)\s*,\s*(\w+)\s*\}/g

  let match
  let index = 0

  while ((match = entryRegex.exec(arrayContent)) !== null) {
    const fullPath = match[1].trim()
    const type = match[2].trim()

    variables.push({
      name: fullPath,
      type: type,
      index: index,
    })

    index++
  }

  const varCountMatch = content.match(/#define\s+VAR_COUNT\s+(\d+)/)
  const totalCount = varCountMatch ? parseInt(varCountMatch[1], 10) : variables.length

  return { variables, totalCount }
}

export function matchVariableWithDebugEntry(
  pouVariableName: string,
  instanceName: string,
  debugVariables: DebugVariable[],
): number | null {
  const instanceNameUpper = instanceName.toUpperCase()
  const variableNameUpper = pouVariableName.toUpperCase()

  const expectedPath = `RES0__${instanceNameUpper}.${variableNameUpper}`

  const match = debugVariables.find((dv) => dv.name === expectedPath)

  return match ? match.index : null
}

export interface DebugVariableNode {
  name: string
  fullPath: string
  type: string
  index: number
  pouName: string
  isBlock: boolean
  children: DebugVariableNode[]
  parentPath?: string
}

export function buildVariableHierarchy(
  debugVariables: DebugVariable[],
  pous: Array<{
    type: string
    data: { name: string; variables: Array<{ name: string; type: { definition: string; value: string } }> }
  }>,
  instances: Array<{ name: string; program: string }>,
): Map<string, DebugVariableNode[]> {
  const hierarchy = new Map<string, DebugVariableNode[]>()

  const instanceMap = new Map<string, string>()
  instances.forEach((inst) => {
    instanceMap.set(inst.program.toUpperCase(), inst.name.toUpperCase())
  })

  const variablesByInstance = new Map<string, DebugVariable[]>()
  debugVariables.forEach((dv) => {
    const match = dv.name.match(/^RES0__([^.]+)\.(.+)$/)
    if (match) {
      const instanceName = match[1]
      if (!variablesByInstance.has(instanceName)) {
        variablesByInstance.set(instanceName, [])
      }
      variablesByInstance.get(instanceName)!.push(dv)
    }
  })

  variablesByInstance.forEach((vars, instanceName) => {
    const nodes: DebugVariableNode[] = []
    const nodeMap = new Map<string, DebugVariableNode>()

    const programName = Array.from(instanceMap.entries()).find(([_, inst]) => inst === instanceName)?.[0]

    if (!programName) return

    const program = pous.find((p) => p.type === 'program' && p.data.name.toUpperCase() === programName)
    if (!program) return

    vars.forEach((dv) => {
      const parts = dv.name.split('.')
      const varPath = parts.slice(1).join('.')

      const node: DebugVariableNode = {
        name: parts[parts.length - 1],
        fullPath: varPath,
        type: dv.type,
        index: dv.index,
        pouName: programName,
        isBlock: false,
        children: [],
      }

      nodeMap.set(varPath, node)
    })

    const blockVars = program.data.variables.filter((v) => v.type.definition === 'derived')

    nodeMap.forEach((node, path) => {
      const pathParts = path.split('.')

      if (pathParts.length === 1) {
        const isBlockInstance = blockVars.some((bv) => bv.name.toUpperCase() === pathParts[0].toUpperCase())
        if (isBlockInstance) {
          node.isBlock = true
        }
        nodes.push(node)
      } else {
        const parentPath = pathParts.slice(0, -1).join('.')
        const parent = nodeMap.get(parentPath)

        if (parent) {
          parent.isBlock = true
          parent.children.push(node)
          node.parentPath = parentPath
        }
      }
    })

    hierarchy.set(programName, nodes)
  })

  return hierarchy
}
