import type { PLCBody } from '../../../../middleware/shared/ports/open-plc-types'
import type { PLCDataType, PLCStructureVariable } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { computeHunks } from '../../../utils/ai-diff-review'
import { isGraphicalLanguage } from '../context-collector'
import { extractPouST, invalidateSTCache, type ProjectStTranspiler, transpileProjectToST } from '../graphical-context'
import {
  adaptCreatePou,
  adaptCreateVariable,
  adaptUpdatePouBody,
  BASE_TYPES,
  buildDatatypeFromCreateInput,
  type CreateDatatypeInput,
  type CreatePouInput,
  type CreateVariableInput,
  type DeleteDatatypeInput,
  type DeletePouInput,
  type DeleteVariableInput,
  resolveVariableType,
  type UpdateDatatypeInput,
  type UpdatePouBodyInput,
  type UpdateVariableInput,
} from './tool-input-adapters'

/** Claude sometimes emits VAR blocks and POU wrapper keywords despite instructions not to. */
function sanitizePouBody(code: string): string {
  let body = code
  body = body.replace(/^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+\w+.*$/gim, '')
  body = body.replace(/^\s*(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION)\s*;?\s*$/gim, '')
  body = body.replace(
    /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b[\s\S]*?\bEND_VAR\b/gi,
    '',
  )
  body = body.replace(/^\s*:\s*\w+\s*;\s*$/gm, '')
  body = body.replace(/\n{3,}/g, '\n\n').trim()
  return body
}

export type ToolResult = {
  success: boolean
  message: string
}

/** Passed in because desktop and web reach the ST transpiler by different routes. */
export type ToolExecutionOptions = {
  transpileProject?: ProjectStTranspiler
}

/** Tools whose success changes the POUs or data types the cached project ST was produced from. */
const PROJECT_MUTATING_TOOLS = new Set([
  'create_pou',
  'update_pou_body',
  'delete_pou',
  'create_variable',
  'update_variable',
  'delete_variable',
  'create_datatype',
  'update_datatype',
  'delete_datatype',
])

/**
 * Never throws — every error comes back as a failed ToolResult.
 * Async because a datatype rename can await the reference-impact modal.
 */
export async function executeTool(
  toolName: string,
  toolInput: unknown,
  options: ToolExecutionOptions = {},
): Promise<ToolResult> {
  try {
    // `await` keeps a rejection inside this try/catch (never-throws contract).
    const result = await dispatchTool(toolName, toolInput, options)
    if (result.success && PROJECT_MUTATING_TOOLS.has(toolName)) invalidateSTCache()
    return result
  } catch (error) {
    return {
      success: false,
      message: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function dispatchTool(
  toolName: string,
  toolInput: unknown,
  options: ToolExecutionOptions,
): ToolResult | Promise<ToolResult> {
  switch (toolName) {
    case 'create_pou':
      return executeCreatePou(toolInput as CreatePouInput)
    case 'update_pou_body':
      return executeUpdatePouBody(toolInput as UpdatePouBodyInput)
    case 'create_variable':
      return executeCreateVariable(toolInput as CreateVariableInput)
    case 'delete_pou':
      return executeDeletePou(toolInput as DeletePouInput)
    case 'update_variable':
      return executeUpdateVariable(toolInput as UpdateVariableInput)
    case 'delete_variable':
      return executeDeleteVariable(toolInput as DeleteVariableInput)
    case 'create_datatype':
      return executeCreateDatatype(toolInput as CreateDatatypeInput)
    case 'update_datatype':
      return executeUpdateDatatype(toolInput as UpdateDatatypeInput)
    case 'delete_datatype':
      return executeDeleteDatatype(toolInput as DeleteDatatypeInput)
    case 'read_project_state':
      return executeReadProjectState()
    case 'read_pou_body':
      return executeReadPouBody(toolInput as ReadPouBodyInput, options)
    default:
      return { success: false, message: `Unknown tool: ${toolName}` }
  }
}

function executeCreatePou(input: CreatePouInput): ToolResult {
  if (!input.name || !input.type || !input.language) {
    return { success: false, message: 'Missing required fields: name, type, language' }
  }

  const validLanguages = ['st', 'il', 'python', 'cpp']
  if (!validLanguages.includes(input.language)) {
    return {
      success: false,
      message: `Language "${input.language}" is not supported. Use one of: ${validLanguages.join(', ')}.`,
    }
  }

  const validTypes = ['program', 'function', 'function-block']
  if (!validTypes.includes(input.type)) {
    return { success: false, message: `Invalid POU type "${input.type}". Use one of: ${validTypes.join(', ')}` }
  }

  const { createProps, body: rawBody } = adaptCreatePou(input)
  const body = rawBody ? sanitizePouBody(rawBody) : undefined

  const state = openPLCStoreBase.getState()

  // A "main" POU is auto-created in every project, so a (re)create carrying a body redirects to update_pou_body.
  if (createProps.name.toLowerCase() === 'main') {
    const existingMain = state.project.data.pous.find((p) => p.name.toLowerCase() === 'main')
    if (existingMain) {
      if (rawBody) {
        const redirected = executeUpdatePouBody({ pouName: existingMain.name, code: rawBody })
        if (!redirected.success) return redirected
        return {
          success: true,
          message: `"${existingMain.name}" already exists (auto-created with every project); updated its body instead of creating a duplicate.`,
        }
      }
      return {
        success: false,
        message:
          'A "main" POU is auto-created in every project and already exists. Use update_pou_body to modify the existing main POU instead of creating a new one.',
      }
    }
  }

  const existingPou = state.project.data.pous.find((p) => p.name === createProps.name)
  if (existingPou) {
    return { success: false, message: `A POU named "${createProps.name}" already exists.` }
  }
  const existingDt = state.project.data.dataTypes.find((d) => d.name === createProps.name)
  if (existingDt) {
    return { success: false, message: `A data type named "${createProps.name}" already exists.` }
  }

  const result = state.pouActions.create(createProps)
  if (!result.ok) {
    return { success: false, message: result.message ?? `Failed to create POU "${createProps.name}".` }
  }

  if (body) {
    const freshState = openPLCStoreBase.getState()
    const pou = freshState.project.data.pous.find((p) => p.name === createProps.name)
    if (pou) {
      freshState.projectActions.updatePou({
        name: createProps.name,
        content: { language: createProps.language, value: body } as PLCBody,
      })
      freshState.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(createProps.name)

      const hunks = computeHunks('', body)
      if (hunks.length > 0) {
        freshState.aiActions.setPendingDiff(createProps.name, {
          oldBody: '',
          newBody: body,
          hunks,
          acceptedHunks: hunks.map((h) => h.id),
        })
      }

      window.dispatchEvent(
        new CustomEvent('ai-pou-updated', { detail: { pouName: createProps.name, body, oldBody: '' } }),
      )
    }
  }

  return {
    success: true,
    message: `Created ${createProps.type} "${createProps.name}" (${createProps.language})${body ? ' with initial code' : ''}`,
  }
}

function executeUpdatePouBody(input: UpdatePouBodyInput): ToolResult {
  if (!input.pouName || input.code === undefined) {
    return { success: false, message: 'Missing required fields: pouName, code' }
  }

  input = { ...input, code: sanitizePouBody(input.code) }

  const adapted = adaptUpdatePouBody(input)
  if (!adapted) {
    return { success: false, message: `POU "${input.pouName}" not found.` }
  }

  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === input.pouName)
  if (!pou) {
    return { success: false, message: `POU "${input.pouName}" not found.` }
  }

  const lang = pou.body.language
  if (lang === 'ld' || lang === 'fbd' || lang === 'sfc') {
    return {
      success: false,
      message: `Cannot update body of graphical POU "${input.pouName}" (${lang}). Only textual POUs can be modified.`,
    }
  }

  const oldBody = typeof pou.body.value === 'string' ? pou.body.value : ''

  state.projectActions.updatePou(adapted)
  state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(input.pouName)

  // Pending diff lets per-hunk review work with no editor mounted; the event below syncs the model if one is open.
  const hunks = computeHunks(oldBody, input.code)
  if (hunks.length > 0) {
    state.aiActions.setPendingDiff(input.pouName, {
      oldBody,
      newBody: input.code,
      hunks,
      acceptedHunks: hunks.map((h) => h.id),
    })
  }

  window.dispatchEvent(
    new CustomEvent('ai-pou-updated', { detail: { pouName: input.pouName, body: input.code, oldBody } }),
  )

  return { success: true, message: `Updated body of "${input.pouName}"` }
}

function executeCreateVariable(input: CreateVariableInput): ToolResult {
  if (!input.name || !input.type) {
    return { success: false, message: 'Missing required fields: name, type' }
  }

  if (input.pouName) {
    const state = openPLCStoreBase.getState()
    const pou = state.project.data.pous.find((p) => p.name === input.pouName)
    if (!pou) {
      return { success: false, message: `POU "${input.pouName}" not found.` }
    }
  }

  const adapted = adaptCreateVariable(input)

  const state = openPLCStoreBase.getState()
  const result = state.projectActions.createVariable(adapted)

  if (!result.ok) {
    return { success: false, message: result.message ?? `Failed to create variable "${input.name}"` }
  }

  if (input.pouName) {
    state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(input.pouName)
  }

  const scope = input.pouName ? `in "${input.pouName}"` : 'as global'
  return { success: true, message: `Created variable "${input.name}" (${input.type}) ${scope}` }
}

function executeDeletePou(input: DeletePouInput): ToolResult {
  if (!input.pouName) {
    return { success: false, message: 'Missing required field: pouName' }
  }

  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === input.pouName)
  if (!pou) {
    return { success: false, message: `POU "${input.pouName}" not found.` }
  }

  state.projectActions.deletePou(input.pouName)
  state.ladderFlowActions.removeLadderFlow(input.pouName)
  state.fbdFlowActions.removeFBDFlow(input.pouName)
  state.editorActions.removeModel(input.pouName)
  state.libraryActions.removeUserLibrary(input.pouName)
  state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(input.pouName)

  return { success: true, message: `Deleted POU "${input.pouName}"` }
}

function executeUpdateVariable(input: UpdateVariableInput): ToolResult {
  if (!input.currentName) {
    return { success: false, message: 'Missing required field: currentName' }
  }

  const state = openPLCStoreBase.getState()
  const isGlobal = !input.pouName

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let variable: any
  if (isGlobal) {
    variable = state.project.data.configurations.resource.globalVariables.find((v) => v.name === input.currentName)
  } else {
    const pou = state.project.data.pous.find((p) => p.name === input.pouName)
    if (!pou) {
      return { success: false, message: `POU "${input.pouName}" not found.` }
    }
    variable = (pou.interface?.variables ?? []).find((v) => v.name === input.currentName)
  }

  if (!variable) {
    const scope = isGlobal ? 'global scope' : `POU "${input.pouName}"`
    return { success: false, message: `Variable "${input.currentName}" not found in ${scope}.` }
  }

  const updateData: Record<string, unknown> = {}
  if (input.newName) updateData.name = input.newName
  if (input.class) updateData.class = input.class
  if (input.type) {
    const lower = input.type.toLowerCase()
    updateData.type = BASE_TYPES.has(lower)
      ? { definition: 'base-type', value: lower }
      : { definition: 'user-data-type', value: input.type }
  }
  if (input.initialValue !== undefined) updateData.initialValue = input.initialValue

  // The slice matches `variableId` against `v.name`, and a variable created via the UI has no `id` field.
  const result = state.projectActions.updateVariable({
    scope: isGlobal ? 'global' : 'local',
    associatedPou: input.pouName ?? undefined,
    variableId: variable.name,
    data: updateData,
  })

  if (!result.ok) {
    return { success: false, message: result.message ?? `Failed to update variable "${input.currentName}"` }
  }

  if (input.pouName) {
    state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(input.pouName)
  }

  const changes = []
  if (input.newName) changes.push(`renamed to "${input.newName}"`)
  if (input.type) changes.push(`type -> ${input.type}`)
  if (input.class) changes.push(`class -> ${input.class}`)
  if (input.initialValue !== undefined) changes.push(`initial -> ${input.initialValue}`)

  return { success: true, message: `Updated variable "${input.currentName}": ${changes.join(', ')}` }
}

function executeDeleteVariable(input: DeleteVariableInput): ToolResult {
  if (!input.variableName) {
    return { success: false, message: 'Missing required field: variableName' }
  }

  const state = openPLCStoreBase.getState()
  const isGlobal = !input.pouName

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let variable: any
  if (isGlobal) {
    variable = state.project.data.configurations.resource.globalVariables.find((v) => v.name === input.variableName)
  } else {
    const pou = state.project.data.pous.find((p) => p.name === input.pouName)
    if (!pou) {
      return { success: false, message: `POU "${input.pouName}" not found.` }
    }
    variable = (pou.interface?.variables ?? []).find((v) => v.name === input.variableName)
  }

  if (!variable) {
    const scope = isGlobal ? 'global scope' : `POU "${input.pouName}"`
    return { success: false, message: `Variable "${input.variableName}" not found in ${scope}.` }
  }

  // A variable created via the UI has no `id`, so delete by name.
  const deleteResult = state.projectActions.deleteVariable({
    scope: isGlobal ? 'global' : 'local',
    associatedPou: input.pouName ?? undefined,
    variableName: input.variableName,
  })

  if (!deleteResult.ok) {
    return { success: false, message: deleteResult.message ?? `Failed to delete variable "${input.variableName}"` }
  }

  if (input.pouName) {
    state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState(input.pouName)
  }

  const scope = isGlobal ? 'from global scope' : `from "${input.pouName}"`
  return { success: true, message: `Deleted variable "${input.variableName}" ${scope}` }
}

function executeCreateDatatype(input: CreateDatatypeInput): ToolResult {
  if (!input.name || !input.derivation) {
    return { success: false, message: 'Missing required fields: name, derivation' }
  }

  const validDerivations = ['structure', 'enumerated', 'array']
  if (!validDerivations.includes(input.derivation)) {
    return {
      success: false,
      message: `Invalid derivation "${input.derivation}". Use one of: ${validDerivations.join(', ')}`,
    }
  }

  const state = openPLCStoreBase.getState()
  if (state.project.data.dataTypes.find((d) => d.name === input.name)) {
    return { success: false, message: `A data type named "${input.name}" already exists.` }
  }
  if (state.project.data.pous.find((p) => p.name === input.name)) {
    return { success: false, message: `A POU named "${input.name}" already exists.` }
  }

  if (input.derivation === 'structure') {
    const fieldNames = new Set<string>()
    for (const f of input.fields ?? []) {
      if (fieldNames.has(f.name)) return { success: false, message: `Duplicate field name "${f.name}".` }
      fieldNames.add(f.name)
    }
  }

  const fullData = buildDatatypeFromCreateInput(input)
  if (!fullData) {
    if (input.derivation === 'structure') return { success: false, message: 'Structure requires at least one field.' }
    if (input.derivation === 'enumerated')
      return { success: false, message: 'Enumeration requires at least one value.' }
    if (input.derivation === 'array')
      return { success: false, message: 'Array requires "baseType" and at least one "dimensions" entry.' }
    return { success: false, message: 'Invalid data type definition.' }
  }

  const createResult = state.datatypeActions.create({ name: input.name, derivation: input.derivation })
  if (!createResult.ok) {
    return { success: false, message: createResult.message ?? `Failed to create data type "${input.name}"` }
  }

  // The skeleton builder doesn't populate fields/values/dimensions.
  openPLCStoreBase.getState().projectActions.updateDatatype(input.name, fullData)

  let detail = ''
  if (input.derivation === 'structure') detail = ` with ${input.fields?.length ?? 0} field(s)`
  if (input.derivation === 'enumerated') detail = ` with ${input.values?.length ?? 0} value(s)`
  if (input.derivation === 'array') detail = ` of ${input.baseType} [${input.dimensions?.join(', ')}]`

  return { success: true, message: `Created ${input.derivation} "${input.name}"${detail}` }
}

async function executeUpdateDatatype(input: UpdateDatatypeInput): Promise<ToolResult> {
  if (!input.name) {
    return { success: false, message: 'Missing required field: name' }
  }

  const state = openPLCStoreBase.getState()
  const existing = state.project.data.dataTypes.find((d) => d.name === input.name)
  if (!existing) {
    return { success: false, message: `Data type "${input.name}" not found.` }
  }

  // Derivation cannot change after creation, so only fields for the existing one are accepted.
  const derivation = existing.derivation

  if (derivation === 'structure' && input.fields) {
    const fieldNames = new Set<string>()
    for (const f of input.fields) {
      if (fieldNames.has(f.name)) return { success: false, message: `Duplicate field name "${f.name}".` }
      fieldNames.add(f.name)
    }
  }

  // Handle rename first so tabs/editors/files pick up the new name before we replace contents.
  const targetName = input.newName && input.newName !== input.name ? input.newName : input.name
  if (input.newName && input.newName !== input.name) {
    if (state.project.data.dataTypes.find((d) => d.name === input.newName)) {
      return { success: false, message: `A data type named "${input.newName}" already exists.` }
    }
    if (state.project.data.pous.find((p) => p.name === input.newName)) {
      return { success: false, message: `A POU named "${input.newName}" already exists.` }
    }
    // Awaits the reference-impact modal when the type is referenced; a cancel surfaces as a failed tool result.
    const renameResult = await state.datatypeActions.rename(input.name, input.newName)
    if (!renameResult.ok) {
      return { success: false, message: renameResult.message ?? `Failed to rename "${input.name}"` }
    }
  }

  // Preserve sections the caller didn't provide, so a partial update doesn't wipe fields.
  let newData: PLCDataType
  if (derivation === 'structure') {
    const variable: PLCStructureVariable[] = input.fields
      ? input.fields.map((f) => ({ name: f.name, type: resolveVariableType(f.type) }))
      : existing.variable
    newData = { name: targetName, derivation: 'structure', variable }
  } else if (derivation === 'enumerated') {
    const values = input.values ? input.values.map((v) => ({ description: v })) : existing.values
    const initialValue = input.initialValue !== undefined ? input.initialValue : existing.initialValue
    newData = {
      name: targetName,
      derivation: 'enumerated',
      values,
      ...(initialValue !== undefined ? { initialValue } : {}),
    }
  } else {
    const baseType = input.baseType ? resolveVariableType(input.baseType) : existing.baseType
    const dimensions = input.dimensions ? input.dimensions.map((d) => ({ dimension: d })) : existing.dimensions
    const initialValue = input.initialValue !== undefined ? input.initialValue : existing.initialValue
    newData = {
      name: targetName,
      derivation: 'array',
      baseType,
      dimensions,
      ...(initialValue !== undefined ? { initialValue } : {}),
    }
  }

  openPLCStoreBase.getState().projectActions.updateDatatype(targetName, newData)
  openPLCStoreBase.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState(targetName)

  const changes: string[] = []
  if (input.newName && input.newName !== input.name) changes.push(`renamed to "${input.newName}"`)
  if (input.fields) changes.push(`${input.fields.length} field(s)`)
  if (input.values) changes.push(`${input.values.length} value(s)`)
  if (input.baseType) changes.push(`baseType -> ${input.baseType}`)
  if (input.dimensions) changes.push(`dimensions -> [${input.dimensions.join(', ')}]`)
  if (input.initialValue !== undefined) changes.push(`initial -> ${input.initialValue}`)

  return {
    success: true,
    message: `Updated ${derivation} "${input.name}"${changes.length ? `: ${changes.join(', ')}` : ''}`,
  }
}

function executeDeleteDatatype(input: DeleteDatatypeInput): ToolResult {
  if (!input.name) {
    return { success: false, message: 'Missing required field: name' }
  }

  const state = openPLCStoreBase.getState()
  const existing = state.project.data.dataTypes.find((d) => d.name === input.name)
  if (!existing) {
    return { success: false, message: `Data type "${input.name}" not found.` }
  }

  // datatypeActions.delete cleans the tab/editor/file slices too, not just the project slice.
  state.datatypeActions.delete(input.name)

  return { success: true, message: `Deleted data type "${input.name}"` }
}

function executeReadProjectState(): ToolResult {
  const state = openPLCStoreBase.getState()
  const project = state.project.data

  const lines: string[] = []
  lines.push(`Project: ${state.project.meta.name}`)
  lines.push('')

  lines.push(`POUs (${project.pous.length}):`)
  for (const pou of project.pous) {
    const vars = pou.interface?.variables ?? []
    const bodyLen = typeof pou.body.value === 'string' ? pou.body.value.length : 0
    lines.push(`  - ${pou.name} [${pou.pouType}, ${pou.body.language}] (${vars.length} vars, ${bodyLen} chars)`)
    for (const v of vars) {
      lines.push(
        `      ${v.class ?? 'local'} ${v.name} : ${v.type.value}${v.initialValue ? ` := ${v.initialValue}` : ''}`,
      )
    }
  }

  const globals = project.configurations.resource.globalVariables
  if (globals.length > 0) {
    lines.push('')
    lines.push(`Global Variables (${globals.length}):`)
    for (const v of globals) {
      lines.push(`  - ${v.name} : ${v.type.value}${v.initialValue ? ` := ${v.initialValue}` : ''}`)
    }
  }

  if (project.dataTypes.length > 0) {
    lines.push('')
    lines.push(`Data Types (${project.dataTypes.length}):`)
    for (const dt of project.dataTypes) {
      if (dt.derivation === 'structure') {
        const fields = (dt.variable ?? []).map((v) => `${v.name}: ${v.type.value}`).join(', ')
        lines.push(`  - ${dt.name} [struct] { ${fields} }`)
      } else if (dt.derivation === 'enumerated') {
        const vals = (dt.values ?? []).map((v) => v.description).join(', ')
        lines.push(`  - ${dt.name} [enum] (${vals})`)
      } else if (dt.derivation === 'array') {
        const dims = (dt.dimensions ?? []).map((d) => d.dimension).join(', ')
        lines.push(`  - ${dt.name} [array] ${dt.baseType?.value}[${dims}]`)
      }
    }
  }

  return { success: true, message: lines.join('\n') }
}

export type ReadPouBodyInput = { name?: string }

/** A graphical POU's body is node coordinates, so it comes back as the transpiled ST equivalent. */
async function executeReadPouBody(input: ReadPouBodyInput, options: ToolExecutionOptions): Promise<ToolResult> {
  const requested = input?.name
  if (typeof requested !== 'string' || requested.trim() === '') {
    return { success: false, message: 'Missing required field: name' }
  }

  const state = openPLCStoreBase.getState()
  const pous = state.project.data.pous
  const pou = pous.find((p) => p.name.toLowerCase() === requested.trim().toLowerCase())
  if (!pou) {
    const available = pous.map((p) => p.name).join(', ')
    return {
      success: false,
      message: `POU "${requested}" not found. Available POUs: ${available || '(none)'}`,
    }
  }

  const header = `${pou.name} [${pou.pouType}, ${pou.body.language}]`

  if (isGraphicalLanguage(pou.body.language)) {
    const programSt = await transpileProjectToST(state.project.data, options.transpileProject)
    const st = programSt ? extractPouST(programSt, pou.name, pou.pouType) : ''
    if (!st) {
      return {
        success: false,
        message: `${header}: could not produce the ST equivalent for this ${pou.body.language.toUpperCase()} diagram (transpile unavailable or the POU produced no output).`,
      }
    }
    return {
      success: true,
      message: `${header} — transpiled ST equivalent (the stored body is a diagram):\n\n${st}`,
    }
  }

  const value = pou.body.value
  if (typeof value !== 'string' || value.trim() === '') {
    return { success: true, message: `${header}: body is empty.` }
  }
  return { success: true, message: `${header}:\n\n${value}` }
}
