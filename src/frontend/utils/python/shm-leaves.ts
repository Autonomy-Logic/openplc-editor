// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Flatten a Python block's interface variable into the scalar fields that
 * actually cross shared memory.
 *
 * A structure or an enumeration cannot be memcpy'd across the boundary the way a
 * scalar can: the PLC side holds `IECVar<T>` wrappers inside a strucpp struct,
 * and the Python side holds an object. What both sides can agree on is the list
 * of scalar leaves, in order — so that is what this produces, and every emitter
 * works from it.
 *
 * Flattening rather than nesting is deliberate. The transport struct is ours to
 * define, so nesting would buy nothing and would put `#pragma pack` inside
 * `#pragma pack`, where an already-laid-out member type keeps its own padding —
 * exactly the trap that made WSTRING 254 bytes against Python's 253. One field
 * per leaf, all at the top level, is a layout both sides compute the same way.
 *
 * What a leaf carries is the two halves of the same field: `field`, the name in
 * our packed struct and the position in the format string, and `access`, the
 * expression that reaches the value on the strucpp side. They are separate
 * because the second is not ours to choose — see `mangledMemberName`.
 */

import type {
  PLCDataType,
  PLCStructureVariable,
  PLCVariable,
  PLCVariableType,
} from '../../../middleware/shared/ports/types'
import { getArrayTotalElements } from '../PLC/array-codegen-helpers'
import { parseDimensionRange } from '../PLC/dimension-range'
import type { ShmFieldDescriptor } from './shm-type-map'
import { describeShmField, SHM_SCALAR_TYPES } from './shm-type-map'

/** One scalar field of the transport struct. */
export interface ShmLeaf {
  /** Field name in `shm_data_in_t` / `shm_data_out_t`, unique within the struct. */
  field: string
  /** Attribute path on the Python side, e.g. `['m', 'speed']`. */
  path: string[]
  /** Expression reaching the value on the strucpp side, e.g. `M.SPEED`. */
  access: string
  /** How the field is laid out and decoded. */
  descriptor: ShmFieldDescriptor
  /** Elements when the leaf is an array of scalars; 1 otherwise. */
  count: number
  /** Lowest IEC index, for an array leaf; 0 otherwise. */
  startIndex: number
  /**
   * The enumeration this leaf came from, when it is one.
   *
   * The value crossing the boundary is the plain integer the PLC stores. The
   * name tells the Python side which `IntEnum` to present it as, so the user
   * writes `mode == Mode.RUNNING` rather than comparing against a bare number,
   * and tells the C side which scoped enum to cast through: an `IEC_ENUM_Var`
   * yields an `IEC_ENUM_Value`, which converts to the enum but not to an
   * integer.
   */
  enumTypeName?: string
}

/** Why a variable cannot cross, phrased for the user. */
export interface ShmRefusal {
  path: string[]
  reason: string
}

export type ShmWalkResult = { leaves: ShmLeaf[] } | { refusal: ShmRefusal }

/**
 * The member's C++ name, mirroring STruC++'s `member-mangling.ts`.
 *
 * A member whose name matches its own user-defined type is emitted with a
 * trailing underscore, because GCC rejects a member that changes the meaning of
 * its type name inside the class. CODESYS allows `RunningLights : RunningLights`
 * and real projects use it, so the case is not hypothetical.
 *
 * This is a deliberate coupling to the compiler, and the only one in this file:
 * everything else here describes a layout we define ourselves. It is restated
 * rather than derived because the compiler exposes no way to ask, and the
 * alternative — emitting a member name that does not exist — fails the build
 * with an error that points at generated code the user never wrote.
 *
 * The interface-method collision that rule also covers cannot arise here: it
 * applies to a function block implementing an interface, and only a STRUCT's
 * members are walked.
 */
const mangledMemberName = (memberName: string, memberTypeName: string, userTypeNames: ReadonlySet<string>): string => {
  const upper = memberName.toUpperCase()
  return upper === memberTypeName.toUpperCase() && userTypeNames.has(upper) ? `${upper}_` : upper
}

/** Index the project's data types by upper-cased name. */
const indexDataTypes = (dataTypes: readonly PLCDataType[]): Map<string, PLCDataType> =>
  new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))

/** IEC base type an enumeration is stored as. STruC++ defaults to INT. */
const ENUM_BASE_DESCRIPTOR = SHM_SCALAR_TYPES.int

const walk = (
  name: string,
  typeValue: string,
  typeDefinition: PLCVariableType['definition'],
  arrayInfo: { count: number; startIndex: number } | null,
  path: string[],
  field: string,
  access: string,
  types: Map<string, PLCDataType>,
  userTypeNames: ReadonlySet<string>,
  depth: number,
): ShmWalkResult => {
  // A structure that contains itself would otherwise recurse forever. The
  // compiler rejects that too, but this walk runs first and must not hang.
  if (depth > 16) {
    return { refusal: { path, reason: 'the type nests too deeply, or refers to itself' } }
  }

  const dataType = typeDefinition === 'user-data-type' ? types.get(typeValue.toUpperCase()) : undefined

  if (dataType?.derivation === 'structure') {
    if (arrayInfo) {
      return { refusal: { path, reason: 'an array of structures cannot cross into Python yet' } }
    }
    const leaves: ShmLeaf[] = []
    for (const member of dataType.variable) {
      // An array member is walked by its element type, exactly as a top-level
      // array variable is: the count and lower bound travel separately, so the
      // element is what has to be describable.
      const element = elementTypeOf(member)
      const result = walk(
        member.name,
        element.value,
        element.definition,
        arrayInfoFor(member),
        [...path, member.name],
        `${field}_${member.name}`,
        `${access}.${mangledMemberName(member.name, member.type.value, userTypeNames)}`,
        types,
        userTypeNames,
        depth + 1,
      )
      if ('refusal' in result) return result
      leaves.push(...result.leaves)
    }
    return { leaves }
  }

  if (dataType?.derivation === 'enumerated') {
    // An enumeration is stored as its base integer, which is what crosses. The
    // Python side gets an IntEnum, so `mode == Mode.RUNNING` reads naturally
    // while the wire format stays a plain int.
    return {
      leaves: [
        {
          field,
          path,
          access,
          descriptor: ENUM_BASE_DESCRIPTOR,
          count: arrayInfo?.count ?? 1,
          startIndex: arrayInfo?.startIndex ?? 0,
          enumTypeName: dataType.name,
        },
      ],
    }
  }

  if (dataType?.derivation === 'array') {
    return { refusal: { path, reason: 'a named ARRAY type cannot cross into Python yet' } }
  }

  if (typeDefinition === 'user-data-type') {
    // Not in the project's data types: a function block instance. Python runs in
    // its own process and cannot call one — the block would have to reach back
    // into the scan it is not part of.
    return {
      refusal: {
        path,
        reason: `"${typeValue}" is a function block instance, which a Python block cannot hold — it runs in its own process and cannot call into the scan`,
      },
    }
  }

  const descriptor = describeShmField({
    name,
    type: { definition: typeDefinition, value: typeValue },
    location: '',
    documentation: '',
  })
  if (!descriptor) {
    return { refusal: { path, reason: `${typeValue.toUpperCase()} is not a type Python can exchange` } }
  }

  return {
    leaves: [
      {
        field,
        path,
        access,
        descriptor,
        count: arrayInfo?.count ?? 1,
        startIndex: arrayInfo?.startIndex ?? 0,
      },
    ],
  }
}

/**
 * The type that actually describes a declaration's elements.
 *
 * For an array that is its element type; for anything else it is the type
 * itself. An array's own `value` is the whole declaration text
 * (`ARRAY [0..2] OF INT`), which names nothing describable — reading it as a
 * type is what made an array member inside a structure refuse.
 */
const elementTypeOf = (declaration: PLCVariable | PLCStructureVariable): PLCVariableType => {
  if (declaration.type.definition === 'array' && declaration.type.data) {
    return { definition: declaration.type.data.baseType.definition, value: declaration.type.data.baseType.value }
  }
  return declaration.type
}

/** Element count and lower bound when a declaration is an array. */
const arrayInfoFor = (
  declaration: PLCVariable | PLCStructureVariable,
): { count: number; startIndex: number } | null => {
  if (declaration.type.definition !== 'array' || !declaration.type.data) return null
  const dimensions = declaration.type.data.dimensions
  const first = dimensions[0] ? parseDimensionRange(dimensions[0].dimension) : null
  const asVariable: PLCVariable = {
    name: declaration.name,
    type: declaration.type,
    location: '',
    documentation: '',
  }
  return { count: getArrayTotalElements(asVariable), startIndex: first ? first.lower : 0 }
}

/**
 * The scalar fields one interface variable contributes, in order — or the reason
 * it cannot cross.
 *
 * A refusal is not a skip. A field the Python format string omits does not go
 * missing: `struct.unpack` reads every later field from the wrong offset, so the
 * failure lands on unrelated variables and reads as corrupted data. Refusing
 * stops the build with the name of the variable that caused it.
 */
export const describeShmLeaves = (variable: PLCVariable, dataTypes: readonly PLCDataType[] = []): ShmWalkResult => {
  const types = indexDataTypes(dataTypes)
  const userTypeNames = new Set(dataTypes.map((dataType) => dataType.name.toUpperCase()))

  const element = elementTypeOf(variable)

  return walk(
    variable.name,
    element.value,
    element.definition,
    arrayInfoFor(variable),
    [variable.name],
    variable.name,
    variable.name.toUpperCase(),
    types,
    userTypeNames,
    0,
  )
}

/** Every leaf of every variable, in order, or the first refusal encountered. */
export const describeShmLayout = (
  variables: readonly PLCVariable[],
  dataTypes: readonly PLCDataType[] = [],
): ShmWalkResult => {
  const leaves: ShmLeaf[] = []
  for (const variable of variables) {
    const result = describeShmLeaves(variable, dataTypes)
    if ('refusal' in result) return result
    leaves.push(...result.leaves)
  }
  return { leaves }
}
