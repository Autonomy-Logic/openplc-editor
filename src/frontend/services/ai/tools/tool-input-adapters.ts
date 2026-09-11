import { v4 as uuidv4 } from 'uuid'

import type { PLCBody } from '../../../../middleware/shared/ports/open-plc-types'
import type {
  PLCDataType,
  PLCStructureVariable,
  PLCVariable,
  PLCVariableType,
} from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'

type TextualLanguage = 'st' | 'il' | 'python' | 'cpp'

// --- Base type mapping ---

const BASE_TYPES = new Set([
  'bool',
  'sint',
  'int',
  'dint',
  'lint',
  'usint',
  'uint',
  'udint',
  'ulint',
  'real',
  'lreal',
  'time',
  'date',
  'tod',
  'dt',
  'string',
  'byte',
  'word',
  'dword',
  'lword',
])

function resolveVariableType(typeStr: string): PLCVariableType {
  const lower = typeStr.toLowerCase()
  if (BASE_TYPES.has(lower)) {
    return { definition: 'base-type' as const, value: lower }
  }
  return { definition: 'user-data-type' as const, value: typeStr }
}

// --- create_pou adapter ---

export type CreatePouInput = {
  name: string
  type: 'program' | 'function' | 'function-block'
  language: 'st' | 'il' | 'python' | 'cpp'
  body?: string
}

export function adaptCreatePou(input: CreatePouInput): {
  createProps: { name: string; type: 'program' | 'function' | 'function-block'; language: TextualLanguage }
  body?: string
} {
  return {
    createProps: { name: input.name, type: input.type, language: input.language },
    body: input.body,
  }
}

// --- update_pou_body adapter ---

export type UpdatePouBodyInput = {
  pouName: string
  code: string
}

export function adaptUpdatePouBody(input: UpdatePouBodyInput): { name: string; content: PLCBody } | null {
  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === input.pouName)
  if (!pou) return null
  return {
    name: input.pouName,
    content: { language: pou.body.language, value: input.code } as PLCBody,
  }
}

// --- create_variable adapter ---

export type CreateVariableInput = {
  pouName?: string | null
  name: string
  class?: 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp'
  type: string
  initialValue?: string
}

export function adaptCreateVariable(input: CreateVariableInput): {
  scope: 'global' | 'local'
  associatedPou?: string
  data: PLCVariable
} {
  const isGlobal = !input.pouName
  const variableData: PLCVariable = {
    name: input.name,
    class: isGlobal ? 'global' : (input.class ?? 'local'),
    type: resolveVariableType(input.type),
    location: '',
    initialValue: input.initialValue ?? null,
    documentation: '',
    debug: false,
  }

  return {
    scope: isGlobal ? 'global' : 'local',
    associatedPou: input.pouName ?? undefined,
    data: variableData,
  }
}

// --- delete_pou adapter ---

export type DeletePouInput = {
  pouName: string
}

// --- update_variable adapter ---

export type UpdateVariableInput = {
  pouName?: string | null
  currentName: string
  newName?: string
  class?: 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp'
  type?: string
  initialValue?: string
}

// --- delete_variable adapter ---

export type DeleteVariableInput = {
  pouName?: string | null
  variableName: string
}

// --- create_datatype adapter ---

export type CreateDatatypeInput = {
  name: string
  derivation: 'structure' | 'enumerated' | 'array'
  fields?: Array<{ name: string; type: string }>
  values?: string[]
  baseType?: string
  dimensions?: string[]
  initialValue?: string
}

/**
 * Build the full PLCDataType payload from a create_datatype tool input.
 * Returns null if derivation-specific required fields are missing.
 */
export function buildDatatypeFromCreateInput(input: CreateDatatypeInput): PLCDataType | null {
  if (input.derivation === 'structure') {
    if (!input.fields || input.fields.length === 0) return null
    const variable: PLCStructureVariable[] = input.fields.map((f) => ({
      name: f.name,
      type: resolveVariableType(f.type),
    }))
    return { name: input.name, derivation: 'structure', variable }
  }
  if (input.derivation === 'enumerated') {
    if (!input.values || input.values.length === 0) return null
    return {
      name: input.name,
      derivation: 'enumerated',
      values: input.values.map((v) => ({ description: v })),
      ...(input.initialValue !== undefined ? { initialValue: input.initialValue } : {}),
    }
  }
  if (input.derivation === 'array') {
    if (!input.baseType || !input.dimensions || input.dimensions.length === 0) return null
    return {
      name: input.name,
      derivation: 'array',
      baseType: resolveVariableType(input.baseType),
      dimensions: input.dimensions.map((d) => ({ dimension: d })),
      ...(input.initialValue !== undefined ? { initialValue: input.initialValue } : {}),
    }
  }
  return null
}

// --- update_datatype adapter ---

export type UpdateDatatypeInput = {
  name: string
  newName?: string
  fields?: Array<{ name: string; type: string }>
  values?: string[]
  baseType?: string
  dimensions?: string[]
  initialValue?: string
}

// --- delete_datatype adapter ---

export type DeleteDatatypeInput = {
  name: string
}

export { BASE_TYPES, resolveVariableType, uuidv4 }
