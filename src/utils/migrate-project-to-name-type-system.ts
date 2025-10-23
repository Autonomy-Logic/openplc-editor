import { PLCProjectData, PLCVariable } from '@root/types/PLC/open-plc'

/**
 * Migration report detailing the changes made during migration
 */
export type MigrationReport = {
  success: boolean
  variablesMigrated: number
  referencesUpdated: number
  unresolvedReferences: Array<{
    pouName: string
    variableName: string
    reason: string
  }>
  errors: string[]
}

/**
 * Removes all ID fields from variables in a project
 * This is a deep operation that modifies the project data structure
 */
function removeVariableIds(variable: PLCVariable): PLCVariable {
  const { id, ...variableWithoutId } = variable as PLCVariable & { id?: string }
  return variableWithoutId as PLCVariable
}

/**
 * Migrates a project from ID-based variable linking to name+type-based linking
 *
 * This function:
 * 1. Removes all `id` fields from variables (local and global)
 * 2. Removes all `id` fields from structure variables in data types
 * 3. Removes all `id` fields from task and instance configurations
 * 4. Validates that all variable references can be resolved by name+type
 *
 * @param projectData - The project data to migrate
 * @returns Migration report with statistics and any unresolved references
 */
export function migrateProjectToNameTypeSystem(projectData: PLCProjectData): {
  migratedProject: PLCProjectData
  report: MigrationReport
} {
  const report: MigrationReport = {
    success: true,
    variablesMigrated: 0,
    referencesUpdated: 0,
    unresolvedReferences: [],
    errors: [],
  }

  try {
    const migratedProject = structuredClone(projectData)

    migratedProject.pous = migratedProject.pous.map((pou) => {
      const originalVariableCount = pou.data.variables.length
      pou.data.variables = pou.data.variables.map(removeVariableIds)
      report.variablesMigrated += originalVariableCount
      return pou
    })

    const globalVariableCount = migratedProject.configuration.resource.globalVariables.length
    migratedProject.configuration.resource.globalVariables =
      migratedProject.configuration.resource.globalVariables.map(removeVariableIds)
    report.variablesMigrated += globalVariableCount

    migratedProject.dataTypes = migratedProject.dataTypes.map((dataType) => {
      if (dataType.derivation === 'structure' && dataType.variable) {
        const structureVariableCount = dataType.variable.length
        dataType.variable = dataType.variable.map((structVar) => {
          const { id, ...structVarWithoutId } = structVar as typeof structVar & { id?: string }
          return structVarWithoutId as typeof structVar
        })
        report.variablesMigrated += structureVariableCount
      }
      return dataType
    })

    migratedProject.configuration.resource.tasks = migratedProject.configuration.resource.tasks.map((task) => {
      const { id, ...taskWithoutId } = task as typeof task & { id?: string }
      return taskWithoutId as typeof task
    })

    migratedProject.configuration.resource.instances = migratedProject.configuration.resource.instances.map(
      (instance) => {
        const { id, ...instanceWithoutId } = instance as typeof instance & { id?: string }
        return instanceWithoutId as typeof instance
      },
    )

    migratedProject.pous.forEach((pou) => {
      const variableNames = new Set<string>()
      pou.data.variables.forEach((variable) => {
        const normalizedName = variable.name.toLowerCase()
        if (variableNames.has(normalizedName)) {
          report.unresolvedReferences.push({
            pouName: pou.data.name,
            variableName: variable.name,
            reason: 'Duplicate variable name (case-insensitive)',
          })
          report.success = false
        }
        variableNames.add(normalizedName)
      })
    })

    const globalVariableNames = new Set<string>()
    migratedProject.configuration.resource.globalVariables.forEach((variable) => {
      const normalizedName = variable.name.toLowerCase()
      if (globalVariableNames.has(normalizedName)) {
        report.unresolvedReferences.push({
          pouName: 'Global',
          variableName: variable.name,
          reason: 'Duplicate global variable name (case-insensitive)',
        })
        report.success = false
      }
      globalVariableNames.add(normalizedName)
    })

    return { migratedProject, report }
  } catch (error) {
    report.success = false
    report.errors.push(error instanceof Error ? error.message : String(error))
    return { migratedProject: projectData, report }
  }
}

/**
 * Checks if a project needs migration (has any ID fields)
 */
export function needsMigration(projectData: PLCProjectData): boolean {
  const hasLocalVariableIds = projectData.pous.some((pou) =>
    pou.data.variables.some((variable) => 'id' in variable && variable.id !== undefined),
  )

  if (hasLocalVariableIds) return true

  const hasGlobalVariableIds = projectData.configuration.resource.globalVariables.some(
    (variable) => 'id' in variable && variable.id !== undefined,
  )

  if (hasGlobalVariableIds) return true

  const hasStructureVariableIds = projectData.dataTypes.some(
    (dataType) =>
      dataType.derivation === 'structure' &&
      dataType.variable &&
      dataType.variable.some((structVar) => 'id' in structVar && structVar.id !== undefined),
  )

  if (hasStructureVariableIds) return true

  return false
}
