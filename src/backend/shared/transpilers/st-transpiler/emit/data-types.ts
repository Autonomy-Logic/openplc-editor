/**
 * IR-native `TYPE … END_TYPE` block emitter.
 *
 * JSON-direct port of `generate_data_type.ts` — walks
 * `TranspileProject.dataTypes` instead of the parsed DOM, but emits
 * byte-identical chunks (verified by the comparison helper).
 *
 * The recursive emission order (a child data type referencing
 * another forces the dependency to emit first) mirrors
 * `ProgramGenerator.GenerateDataType` (PLCGenerator.py:152-299) line
 * for line.  Only difference from the DOM version: no `subrange`
 * branch — the IR's `TranspileDataType` union doesn't carry
 * subranges (matches the schema at `backend/shared/types/PLC/open-plc.ts`).
 */

import { ComputeDataTypeName } from '../helpers/data-type'
import type { ProgramChunk } from '../helpers/program'
import type { TranspileDataType, TranspileProject, TranspileVariable, TranspileVariableType } from '../types'
import { computeValue } from './value'

interface DataTypeState {
  project: TranspileProject
  out: ProgramChunk[]
  byName: Map<string, TranspileDataType>
  computed: Map<string, boolean>
}

export function generateDataTypes(project: TranspileProject): ProgramChunk[] {
  if (project.dataTypes.length === 0) return []

  const state: DataTypeState = {
    project,
    out: [],
    byName: new Map(project.dataTypes.map((dt) => [dt.name, dt])),
    computed: new Map(project.dataTypes.map((dt) => [dt.name, false])),
  }

  const program: ProgramChunk[] = []
  program.push(['TYPE\n', []])
  for (const name of state.computed.keys()) {
    generateDataType(state, name)
  }
  program.push(...state.out)
  program.push(['END_TYPE\n\n', []])
  return program
}

function generateDataType(state: DataTypeState, datatypeName: string): void {
  // Mirror PLCGenerator.py:154 — dict.get(name, True).  Unknown names
  // (e.g. POU references) get True back, skipping emission.
  if (state.computed.get(datatypeName) !== false) return
  state.computed.set(datatypeName, true)

  const dt = state.byName.get(datatypeName)
  if (!dt) return

  const tagname = ComputeDataTypeName(dt.name)
  const chunks: ProgramChunk[] = [
    ['  ', []],
    [dt.name, [tagname, 'name']],
    [' : ', []],
  ]

  if (dt.derivation === 'directly-derived') {
    // Branch on whether the base is elementary or another data type.
    const base = dt.baseType
    if (state.byName.has(base)) {
      generateDataType(state, base)
      chunks.push([base, [tagname, 'base']])
    } else {
      // Elementary IEC base — emit uppercased to match the DOM
      // walker (which does `baseTypeKind.toUpperCase()` for the
      // elementary branch at PLCGenerator.py:286).
      chunks.push([base.toUpperCase(), [tagname, 'base']])
    }
  } else if (dt.derivation === 'enumerated') {
    chunks.push(['(', []])
    dt.values.forEach((value, i) => {
      if (i > 0) chunks.push([', ', []])
      chunks.push([value.description, [tagname, 'value', i]])
    })
    chunks.push([')', []])
  } else if (dt.derivation === 'array') {
    const baseTypeName = resolveArrayBaseName(dt.baseType, state)
    chunks.push(['ARRAY [', []])
    dt.dimensions.forEach((dimension, i) => {
      if (i > 0) chunks.push([',', []])
      const [lower, upper] = dimension.dimension.split('..')
      chunks.push(
        [`${lower}`, [tagname, 'range', i, 'lower']],
        ['..', []],
        [`${upper}`, [tagname, 'range', i, 'upper']],
      )
    })
    chunks.push(['] OF ', []], [baseTypeName, [tagname, 'base']])
  } else if (dt.derivation === 'structure') {
    chunks.push(['STRUCT', []])
    dt.variable.forEach((variable, i) => {
      const elementtypeName = resolveStructFieldType(variable, state)
      chunks.push(
        ['\n    ', []],
        [variable.name, [tagname, 'struct', i, 'name']],
        [' : ', []],
        [elementtypeName, [tagname, 'struct', i, 'type']],
      )
      if (variable.initialValue !== undefined && variable.initialValue !== '') {
        chunks.push(
          [' := ', []],
          [
            computeValue(state.project, variable.initialValue, elementtypeName),
            [tagname, 'struct', i, 'initial value'],
          ],
        )
      }
      chunks.push([';', []])
    })
    chunks.push(['\n  END_STRUCT', []])
  }

  if (dt.initialValue !== undefined && dt.initialValue !== '') {
    chunks.push([' := ', []], [computeValue(state.project, dt.initialValue, datatypeName), [tagname, 'initial value']])
  }
  chunks.push([';\n', []])

  state.out.push(...chunks)
}

function resolveArrayBaseName(baseType: string | { value: string }, state: DataTypeState): string {
  const name = typeof baseType === 'string' ? baseType : baseType.value
  if (state.byName.has(name)) {
    generateDataType(state, name)
    return name
  }
  return name.toUpperCase()
}

function resolveStructFieldType(variable: TranspileVariable, state: DataTypeState): string {
  const type = variable.type
  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    if (state.byName.has(type.value)) generateDataType(state, type.value)
    return type.value
  }
  if (type.definition === 'array') {
    const baseName = resolveArrayBaseName(type.data.baseType, state)
    const dimensions = type.data.dimensions.map((d) => d.dimension).join(',')
    return `ARRAY [${dimensions}] OF ${baseName}`
  }
  return formatBaseType(type)
}

function formatBaseType(type: TranspileVariableType): string {
  if (type.definition === 'base-type') {
    return type.value.toUpperCase()
  }
  if (type.definition === 'array') {
    const baseName = typeof type.data.baseType === 'string' ? type.data.baseType : type.data.baseType.value
    const dimensions = type.data.dimensions.map((d) => d.dimension).join(',')
    return `ARRAY [${dimensions}] OF ${baseName.toUpperCase()}`
  }
  return type.value
}
