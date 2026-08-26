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
  PLCPou,
  PLCStructureVariable,
  PLCVariable,
  PLCVariableType,
} from '../../../middleware/shared/ports/types'
import { getArrayTotalElements } from '../PLC/array-codegen-helpers'
import { parseDimensionRange } from '../PLC/dimension-range'
import type { LibraryFunctionBlockSource } from '../PLC/function-block-pins'
import { resolveFunctionBlockPins } from '../PLC/function-block-pins'
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
 * What the walk needs beyond the variable, and which way the data travels.
 *
 * `direction` matters only for a function block instance, whose pins are not
 * symmetric: the block's inputs are the caller's to drive, so Python may write
 * them, while its outputs are produced by the instance and are Python's to read.
 * A structure has no such asymmetry — every member travels both ways — so
 * everything else ignores it.
 */
export interface ShmWalkContext {
  dataTypes?: readonly PLCDataType[]
  /** Project POUs, for resolving a function block instance's pins. */
  pous?: readonly PLCPou[]
  /** Installed libraries, for resolving a standard block such as TON. */
  libraries?: readonly LibraryFunctionBlockSource[]
  /** `in` — what the PLC sends the block. `out` — what the block sends back. */
  direction: 'in' | 'out'
}

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

/**
 * Whether a function block pin crosses in a given direction.
 *
 * The one statement of this rule. It was briefly written twice — once in the
 * walk and once where Python reassembles the instance — and the two disagreed:
 * the reassembly ignored direction, so the output seed constructed the instance
 * from a pin the seed had never decoded and the block died on
 * `NameError: name '_ton0_Q' is not defined`. Anything that needs to know which
 * pins are present has to ask here.
 */
export const pinCrossesInDirection = (
  pinClass: 'input' | 'output' | 'inOut' | 'local',
  direction: 'in' | 'out',
): boolean => {
  // FB-internal state never crosses: it is the instance's own business, and
  // letting Python write it would corrupt the block from outside.
  if (pinClass === 'local') return false
  // Outbound is what Python may drive — the block's inputs. Inbound is
  // everything, so Python can read what the instance produced.
  if (direction === 'out') return pinClass === 'input' || pinClass === 'inOut'
  return true
}

/** Index the project's data types by upper-cased name. */
const indexDataTypes = (dataTypes: readonly PLCDataType[]): Map<string, PLCDataType> =>
  new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))

/** IEC base type an enumeration is stored as. STruC++ defaults to INT. */
const ENUM_BASE_DESCRIPTOR = SHM_SCALAR_TYPES.int

/** Everything the recursion carries that does not change between levels. */
interface WalkEnv {
  types: Map<string, PLCDataType>
  userTypeNames: ReadonlySet<string>
  pous: readonly PLCPou[]
  libraries: readonly LibraryFunctionBlockSource[]
  direction: 'in' | 'out'
}

const walk = (
  name: string,
  typeValue: string,
  typeDefinition: PLCVariableType['definition'],
  arrayInfo: { count: number; startIndex: number } | null,
  path: string[],
  field: string,
  access: string,
  env: WalkEnv,
  depth: number,
): ShmWalkResult => {
  const { types, userTypeNames } = env
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
        env,
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

  // A function block instance. `derived` is what the variables parser marks one
  // as, having resolved the name against the project's POUs and libraries;
  // `user-data-type` reaches here only when the name matched no data type
  // either, which is the same situation from this side.
  //
  // Python cannot call the instance — it runs in its own process. What it can do
  // is use the pins, because the generated ST wrapper calls the instance once
  // per scan, in the PLC process where it lives (see `generateSTCode`). So the
  // pins cross like a structure's members, and which ones cross depends on the
  // direction: the block's inputs are the caller's to drive, so Python writes
  // them, and its outputs are the instance's to produce, so Python reads them.
  //
  // FB-internal `local` state never crosses. It is the instance's own business,
  // and letting Python write it would corrupt the block from the outside.
  if (typeDefinition === 'derived' || typeDefinition === 'user-data-type') {
    if (arrayInfo) {
      return { refusal: { path, reason: 'an array of function block instances cannot cross into Python yet' } }
    }

    const pins = resolveFunctionBlockPins(typeValue, env.pous, env.libraries)
    if (!pins) {
      return {
        refusal: {
          path,
          reason: `"${typeValue}" is not a type this project declares, and no function block by that name was found in the project or the installed libraries`,
        },
      }
    }

    const crossing = pins.filter((pin) => pinCrossesInDirection(pin.class, env.direction))

    const leaves: ShmLeaf[] = []
    for (const pin of crossing) {
      // Pin names are upper-cased throughout — the struct field, the Python
      // attribute, the class slot and the constructor keyword. The compiler
      // upper-cases members, so this is also what the C++ side writes
      // (`ton0.IN`), and a user-declared lowercase pin would otherwise give
      // Python an attribute named differently from the slot it was built with.
      const pinName = pin.name.toUpperCase()
      const element = elementTypeOf({ name: pin.name, type: pin.type })
      const result = walk(
        pinName,
        element.value,
        element.definition,
        arrayInfoFor({ name: pin.name, type: pin.type }),
        [...path, pinName],
        `${field}_${pinName}`,
        // A pin is a member of the instance's class, upper-cased, and mangled by
        // the same rule as any other member.
        `${access}.${mangledMemberName(pin.name, pin.type.value, userTypeNames)}`,
        env,
        depth + 1,
      )
      if ('refusal' in result) return result
      leaves.push(...result.leaves)
    }
    return { leaves }
  }

  const descriptor = describeShmField({
    name,
    type: { definition: typeDefinition, value: typeValue },
    location: '',
    documentation: '',
  })
  if (!descriptor) {
    return {
      refusal: {
        path,
        reason:
          `${typeValue.toUpperCase()} is not a type a Python block can exchange. Supported are BOOL, ` +
          'the integer and bit-string types, REAL/LREAL, TIME/DATE/TOD/DT, STRING, WSTRING, arrays of ' +
          'those, and structures and enumerations built from them',
      },
    }
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
export const describeShmLeaves = (variable: PLCVariable, context: ShmWalkContext): ShmWalkResult => {
  const dataTypes = context.dataTypes ?? []
  const env: WalkEnv = {
    types: indexDataTypes(dataTypes),
    userTypeNames: new Set(dataTypes.map((dataType) => dataType.name.toUpperCase())),
    pous: context.pous ?? [],
    libraries: context.libraries ?? [],
    direction: context.direction,
  }

  const element = elementTypeOf(variable)

  return walk(
    variable.name,
    element.value,
    element.definition,
    arrayInfoFor(variable),
    [variable.name],
    variable.name,
    variable.name.toUpperCase(),
    env,
    0,
  )
}

/** Every leaf of every variable, in order, or the first refusal encountered. */
export const describeShmLayout = (variables: readonly PLCVariable[], context: ShmWalkContext): ShmWalkResult => {
  const leaves: ShmLeaf[] = []
  for (const variable of variables) {
    const result = describeShmLeaves(variable, context)
    if ('refusal' in result) return result
    leaves.push(...result.leaves)
  }
  return { leaves }
}

/**
 * The function block instances a Python block declares, in declaration order.
 *
 * The generated ST wrapper calls each of these once per scan, between applying
 * Python's pin writes and publishing the pins back — see `generateSTCode`. Order
 * is the declaration order, so the sequence is stable and a user can reason
 * about which instance runs first.
 */
export const pythonFunctionBlockInstances = (
  variables: readonly PLCVariable[],
  dataTypes: readonly PLCDataType[] = [],
): PLCVariable[] => {
  const declared = new Set(dataTypes.map((dataType) => dataType.name.toUpperCase()))
  return variables.filter(
    (variable) =>
      variable.type.definition === 'derived' ||
      // A name the project does not declare as a data type is a function block:
      // the variables parser marks it `derived` when it resolved the name, and
      // leaves it `user-data-type` when it did not.
      (variable.type.definition === 'user-data-type' && !declared.has(variable.type.value.toUpperCase())),
  )
}
