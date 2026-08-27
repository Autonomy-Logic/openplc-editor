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
  /**
   * Python access path. A string is an attribute, a number is an index — so
   * `['m', 'trims', 0]` is `m.trims[0]`.
   *
   * Indices are carried as numbers rather than baked into a string because the
   * Python side has to rebuild the container: a run of leaves differing only in
   * their trailing index is one list.
   */
  path: ReadonlyArray<string | number>
  /** Expression reaching this exact scalar on the strucpp side, e.g. `M.TRIMS[0]`. */
  access: string
  /**
   * Class name of each container along `path`, or `null` where the node is a
   * list (its length is derivable from the indices present) or the leaf itself.
   * Same length as `path`.
   *
   * This is what lets the Python side rebuild a composite FROM THE LEAVES rather
   * than by walking the project's types a second time. The second walk is what
   * broke before: it enumerated a function block's pins flatly while the leaf
   * walk had descended into a structure pin, so the constructor named a
   * temporary the decode never produced.
   */
  objectPath: ReadonlyArray<string | null>
  /** How the field is laid out and decoded. */
  descriptor: ShmFieldDescriptor
  /**
   * Whether this leaf is an element of an array OF that same type.
   *
   * It changes how an enumeration is reached, and only an enumeration.
   * `IEC_ARRAY_1D<MODE, …>::operator[]` yields a RAW scoped `MODE` — the
   * container holds values, not wrappers — while a standalone enumeration
   * variable is an `IEC_ENUM_Var`. So `MODES[0].get().get()` does not compile
   * where `MD.get().get()` does. An enumeration reached as a structure member
   * inside an array (`BANK[0].MODE`) is still a wrapper, because the structure
   * holds wrappers; hence "element of an array of that type", not merely
   * "somewhere under an array".
   */
  arrayElement?: boolean
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
  path: ReadonlyArray<string | number>
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

/**
 * Python class name for a function block type — upper-cased, the single rule,
 * matching `injectPythonRuntime`'s `pythonClassName`. Declared here too because
 * the leaf has to name the class the constructor will use.
 */
export const pythonClassNameFor = (typeName: string): string => typeName.toUpperCase()

/** Index the project's data types by upper-cased name. */
const indexDataTypes = (dataTypes: readonly PLCDataType[]): Map<string, PLCDataType> =>
  new Map(dataTypes.map((dataType) => [dataType.name.toUpperCase(), dataType]))

/**
 * How an enumeration crosses: as a 32-bit signed integer.
 *
 * Matches the C++ storage rather than the IEC view, deliberately. The editor's
 * enumerated data type carries no base type, so `type-codegen` emits a bare
 * `enum class Mode { … }` — and a C++ enum with no explicit base has `int` as
 * its underlying type, i.e. 32 bits. `debug-map.json` reports such a leaf as
 * `INT size=2` because that is the IEC-level view, and this used to follow that,
 * casting through `int16_t`.
 *
 * Nothing had gone wrong (no project has 32 768 enumerators), but the cast was
 * narrowing something the compiler stores wide, which is a truncation waiting
 * for a reason. Carrying the full width removes the question instead of
 * documenting it. The four extra bytes per enumeration are irrelevant here.
 */
const ENUM_BASE_DESCRIPTOR = SHM_SCALAR_TYPES.dint

/** Everything the recursion carries that does not change between levels. */
interface WalkEnv {
  types: Map<string, PLCDataType>
  userTypeNames: ReadonlySet<string>
  pous: readonly PLCPou[]
  libraries: readonly LibraryFunctionBlockSource[]
  direction: 'in' | 'out'
}

/**
 * Walk one declaration, expanding an array into one recursion per element.
 *
 * The element type is what gets described; the indices only extend the four
 * names that identify a leaf — the Python path, the struct field, the strucpp
 * access expression and the compiler's own path. Nothing about the element's
 * type has to know it lives in an array, which is the whole point.
 */
const walkDeclaration = (
  declaration: { name: string; type: PLCVariableType },
  path: ReadonlyArray<string | number>,
  field: string,
  access: string,
  objectPath: ReadonlyArray<string | null>,
  env: WalkEnv,
  depth: number,
): ShmWalkResult => {
  const shape = arrayShapeOf(declaration)
  if ('reason' in shape) return { refusal: { path, reason: shape.reason } }

  const element = elementTypeOf(declaration)
  if (shape.dims === null) {
    return walk(declaration.name, element.value, element.definition, path, field, access, objectPath, false, env, depth)
  }

  const leaves: ShmLeaf[] = []
  for (const indices of elementIndices(shape.dims)) {
    const result = walk(
      declaration.name,
      element.value,
      element.definition,
      [...path, ...indices],
      `${field}_${indices.join('_')}`,
      `${access}${subscriptFor(indices)}`,
      // A list node carries no class name; its length comes from the indices.
      [...objectPath, ...indices.map(() => null)],
      // Directly an element of this array — see `ShmLeaf.arrayElement`.
      true,
      env,
      depth,
    )
    if ('refusal' in result) return result
    leaves.push(...result.leaves)
  }
  return { leaves }
}

/**
 * Describe ONE element — never an array. An array is expanded by
 * `walkDeclaration` into one call per element, which is what lets a
 * multi-dimensional array, an array of strings, an array of structures and an
 * array of enumerations all fall out of the ordinary scalar path instead of each
 * needing a special case that the previous count-based model could not express.
 */
const walk = (
  name: string,
  typeValue: string,
  typeDefinition: PLCVariableType['definition'],
  path: ReadonlyArray<string | number>,
  field: string,
  access: string,
  objectPath: ReadonlyArray<string | null>,
  arrayElement: boolean,
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
    const leaves: ShmLeaf[] = []
    for (const member of dataType.variable) {
      const result = walkDeclaration(
        member,
        [...path, member.name],
        `${field}_${member.name}`,
        `${access}.${mangledMemberName(member.name, member.type.value, userTypeNames)}`,
        // This node is an instance of the structure; the member is one level in.
        [...objectPath.slice(0, -1), dataType.name, null],
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
    // while the wire format stays a plain int. An ARRAY of enumerations needs no
    // special case: each element arrives here on its own.
    return {
      leaves: [
        {
          field,
          path,
          access,
          objectPath,
          descriptor: ENUM_BASE_DESCRIPTOR,
          enumTypeName: dataType.name,
          ...(arrayElement ? { arrayElement: true } : {}),
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
      const result = walkDeclaration(
        { name: pinName, type: pin.type },
        [...path, pinName],
        `${field}_${pinName}`,
        // A pin is a member of the instance's class, upper-cased, and mangled by
        // the same rule as any other member.
        `${access}.${mangledMemberName(pin.name, pin.type.value, userTypeNames)}`,
        // This node is the instance; its class is named by the block type.
        [...objectPath.slice(0, -1), pythonClassNameFor(typeValue), null],
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
    leaves: [{ field, path, access, objectPath, descriptor }],
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

/** Bounds of one array dimension, as the user declared them. */
interface Dimension {
  lower: number
  upper: number
}

/**
 * Array dimensions of a declaration — `null` when it is not an array — or the
 * reason its shape cannot be read.
 *
 * Rank is NOT limited here. The compiler enumerates every element of an array
 * of any supported rank as its own leaf (`GRID2[1][0]`, `CUBE3[0][1][0]`), so
 * describing an array is a matter of following that enumeration rather than of
 * inventing a repeat count — which is what the count-based model this replaces
 * could not do for a multi-dimensional array, an array of strings, an array of
 * structures or an array of enumerations.
 *
 * `strucpp` passes rank 1 as `IEC_ARRAY_1D` (indexed `[i]`) and rank 2 / 3 as
 * `Array2D` / `Array3D` (indexed `(i, j)`), and caps container generation at
 * rank 3 — so that is the ceiling, and it is stated here rather than assumed.
 */
type ArrayShape = { dims: Dimension[] | null } | { reason: string }

const MAX_RANK = 3

const arrayShapeOf = (declaration: PLCVariable | PLCStructureVariable): ArrayShape => {
  if (declaration.type.definition !== 'array' || !declaration.type.data) return { dims: null }
  const declared = declaration.type.data.dimensions
  if (declared.length > MAX_RANK) {
    return {
      reason:
        `a ${declared.length}-dimensional array cannot cross into Python — the compiler generates ` +
        `array containers up to ${MAX_RANK} dimensions`,
    }
  }
  const dims: Dimension[] = []
  for (const dimension of declared) {
    const range = parseDimensionRange(dimension.dimension)
    if (!range || range.upper < range.lower) {
      return { reason: 'its array bounds cannot be read, so the fields it needs cannot be enumerated' }
    }
    dims.push({ lower: range.lower, upper: range.upper })
  }
  /* istanbul ignore next -- defensive: `definition: 'array'` always carries at least one dimension */
  if (dims.length === 0) {
    return { reason: 'its array bounds cannot be read, so the fields it needs cannot be enumerated' }
  }
  return { dims }
}

/**
 * Every index tuple of an array, in ROW-MAJOR order — the order the compiler
 * enumerates them in, and the order the packed struct therefore has to use.
 * `[1..2, 0..1]` yields `[1,0] [1,1] [2,0] [2,1]`.
 */
const elementIndices = (dims: readonly Dimension[]): number[][] => {
  let tuples: number[][] = [[]]
  for (const dim of dims) {
    const next: number[][] = []
    for (const prefix of tuples) {
      for (let i = dim.lower; i <= dim.upper; i++) next.push([...prefix, i])
    }
    tuples = next
  }
  return tuples
}

/**
 * How strucpp subscripts an element: rank 1 is `[i]` on an `IEC_ARRAY_1D`, rank
 * 2 and 3 are `(i, j)` through `Array2D` / `Array3D::operator()`, whose backing
 * storage is private so there is no flat accessor to use instead.
 */
const subscriptFor = (indices: readonly number[]): string =>
  indices.length === 1 ? `[${indices[0]}]` : `(${indices.join(', ')})`

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

  return walkDeclaration(variable, [variable.name], variable.name, variable.name.toUpperCase(), [null], env, 0)
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
