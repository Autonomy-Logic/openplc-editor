// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Resolve a function block type name to the pins an instance of it exposes.
 *
 * Two places declare a function block: the project itself, and a bundled system
 * library (the IEC standard blocks, OSCAT, and anything else installed). Both
 * carry the pin list, in slightly different shapes, and a caller that needs pins
 * needs them from either source without caring which.
 *
 * The libraries are passed in rather than read from the store, for the reason
 * `debug-tree-traversal` gives for doing the same: a `utils` module may not
 * import `store`, and passing them keeps this a pure function.
 */

import type { PLCPou, PLCVariable, PLCVariableType } from '../../../middleware/shared/ports/types'

/**
 * The shape a library declares a function block in.
 *
 * Structurally what `StlibArchiveDTO.manifest.functionBlocks` provides, narrowed
 * to the fields a pin walk needs, so this module depends on the shape rather
 * than on the library port.
 */
export interface LibraryFunctionBlock {
  name: string
  inputs: ReadonlyArray<{ name: string; type: string }>
  outputs: ReadonlyArray<{ name: string; type: string }>
  inouts: ReadonlyArray<{ name: string; type: string }>
}

/** A library, as far as this module cares: a bag of function block declarations. */
export interface LibraryFunctionBlockSource {
  functionBlocks: ReadonlyArray<LibraryFunctionBlock>
}

/** One pin of a function block instance. */
export interface FunctionBlockPin {
  name: string
  /** `local` covers FB-internal state; a caller decides whether to expose it. */
  class: 'input' | 'output' | 'inOut' | 'local'
  type: PLCVariableType
}

/** Normalise the library's POU-type spelling, which varies by source. */
const isFunctionBlockType = (type: string): boolean => type.toLowerCase().replace(/[^a-z]/g, '') === 'functionblock'

/**
 * A library pin's type, which arrives as a bare IEC type name.
 *
 * An elementary name becomes a `base-type`, which the layout walkers describe.
 * Anything else — a structure the library declares, or a generic like `ANY_NUM`
 * that has no type until it is wired — becomes `user-data-type`, which the
 * walkers either resolve or refuse with a reason. Guessing a width for a generic
 * pin is the one thing that must not happen.
 */
const ELEMENTARY = new Set([
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'TIME_OF_DAY',
  'DATE_AND_TIME',
  'STRING',
  'WSTRING',
])

const libraryPinType = (typeName: string): PLCVariableType =>
  ELEMENTARY.has(typeName.toUpperCase())
    ? { definition: 'base-type', value: typeName }
    : { definition: 'user-data-type', value: typeName }

/**
 * The pins of `typeName`, or `null` when no function block by that name is
 * declared in the project or in any supplied library.
 *
 * The project is searched first: a project POU shadows a library block of the
 * same name, which is the same precedence the variables parser applies.
 */
export const resolveFunctionBlockPins = (
  typeName: string,
  pous: readonly PLCPou[] = [],
  libraries: readonly LibraryFunctionBlockSource[] = [],
): FunctionBlockPin[] | null => {
  const wanted = typeName.toUpperCase()

  const projectPou = pous.find((pou) => isFunctionBlockType(pou.pouType) && pou.name.toUpperCase() === wanted)
  if (projectPou) {
    return (projectPou.interface?.variables ?? [])
      .filter(
        (variable): variable is PLCVariable & { class: FunctionBlockPin['class'] } =>
          variable.class === 'input' ||
          variable.class === 'output' ||
          variable.class === 'inOut' ||
          variable.class === 'local',
      )
      .map((variable) => ({ name: variable.name, class: variable.class, type: variable.type }))
  }

  for (const library of libraries) {
    const block = library.functionBlocks.find((entry) => entry.name.toUpperCase() === wanted)
    if (block) {
      // Declaration order within each group, inputs then in-outs then outputs —
      // the same grouping the editor shows on the block, so the struct reads the
      // way the block looks.
      return [
        ...block.inputs.map((pin) => ({ name: pin.name, class: 'input' as const, type: libraryPinType(pin.type) })),
        ...block.inouts.map((pin) => ({ name: pin.name, class: 'inOut' as const, type: libraryPinType(pin.type) })),
        ...block.outputs.map((pin) => ({ name: pin.name, class: 'output' as const, type: libraryPinType(pin.type) })),
      ]
    }
  }

  return null
}
