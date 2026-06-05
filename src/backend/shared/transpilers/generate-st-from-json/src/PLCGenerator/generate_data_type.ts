/**
 * TYPE … END_TYPE chunk emitter.
 *
 * Port of `ProgramGenerator.GenerateDataType` (PLCGenerator.py:152-299)
 * plus the project-level wrapper at PLCGenerator.py:632-648 — the
 * `TYPE\n…END_TYPE\n\n` block at the head of a Structured Text program.
 *
 * The recursive structure (a child data type referencing another data
 * type by name forces the dependency to be emitted first) follows
 * Python verbatim. We track "has this datatype been computed yet?" in
 * a `Map<string, boolean>`; the map is pre-seeded with `false` for
 * every `<dataType>` in the project, mirroring how Python populates
 * `self.DatatypeComputed`. Names that aren't in the map (e.g. a
 * `<derived>` name that points at a POU or a library type) are
 * skipped — same as Python's `dict.get(name, True)` short-circuit at
 * line 154.
 */

import {
  getbaseType,
  getcontentOfType,
  getdataType,
  getdataTypeBaseType,
  getdataTypes,
  getdimension,
  getenumValues,
  getinitialValue,
  getlower,
  getname,
  getstructVariables,
  getsubrangeRange,
  gettype,
  getupper,
  getvalue,
} from '../plcopen/accessors'
import type { ProjectTree } from '../plcopen/plcopen'
import { type Element, getLocalTag } from '../xmlclass/xsdschema'
import { ComputeDataTypeName } from './data_type'
import { computeValue } from './pou_assembly'
import type { ProgramChunk } from './program'

/**
 * Container for the recursive walk. `out` accumulates chunks in
 * dependency-respecting order; `computed` mirrors
 * `ProgramGenerator.DatatypeComputed`.
 */
interface DataTypeState {
  project: ProjectTree | Element
  out: ProgramChunk[]
  computed: Map<string, boolean>
}

/**
 * Emit the trailing chunk list for a single data type by name. Mirrors
 * `ProgramGenerator.GenerateDataType` exactly — including the
 * recursive dependency emission and the no-op fast path when the name
 * is unknown or already emitted.
 */
export function generateDataType(state: DataTypeState, datatypeName: string): void {
  // Mirror PLCGenerator.py:154 — dict.get(name, True). Unknown names
  // (e.g. POU references masquerading as data-type references) get
  // True back, skipping emission entirely. Only names registered in
  // the map AND still flagged False get emitted here.
  if (state.computed.get(datatypeName) !== false) return
  state.computed.set(datatypeName, true)

  const datatype = getdataType(state.project, datatypeName)
  if (!datatype) return
  const name = getname(datatype) ?? datatypeName
  const tagname = ComputeDataTypeName(name)
  const chunks: ProgramChunk[] = [
    ['  ', []],
    [name, [tagname, 'name']],
    [' : ', []],
  ]

  const baseTypeWrapper = getdataTypeBaseType(datatype)
  const baseContent = baseTypeWrapper ? getcontentOfType(baseTypeWrapper) : null
  if (!baseContent) return
  const baseTypeKind = getLocalTag(baseContent)

  if (baseTypeKind === 'derived') {
    const basetypeName = getname(baseContent) ?? ''
    generateDataType(state, basetypeName)
    chunks.push([basetypeName, [tagname, 'base']])
  } else if (
    baseTypeKind === 'subrangeSigned' ||
    baseTypeKind === 'subrangeUnsigned'
  ) {
    const innerBaseWrap = getbaseType(baseContent)
    const innerBase = innerBaseWrap ? getcontentOfType(innerBaseWrap) : null
    let basetypeName = ''
    if (innerBase) {
      const innerTag = getLocalTag(innerBase)
      if (innerTag === 'derived') {
        basetypeName = getname(innerBase) ?? ''
        generateDataType(state, basetypeName)
      } else {
        // Python emits `base_type_type` (the local-tag string itself).
        // No `.upper()` here — that's a subrange-specific quirk in
        // PLCGenerator.py:183, distinct from the array/struct branches.
        basetypeName = innerTag
      }
    }
    const range = getsubrangeRange(baseContent)
    const minValue = range ? (getlower(range) ?? '') : ''
    const maxValue = range ? (getupper(range) ?? '') : ''
    chunks.push(
      [basetypeName, [tagname, 'base']],
      [' (', []],
      [`${minValue}`, [tagname, 'lower']],
      ['..', []],
      [`${maxValue}`, [tagname, 'upper']],
      [')', []],
    )
  } else if (baseTypeKind === 'enum') {
    const values = getenumValues(baseContent)
    chunks.push(['(', []])
    values.forEach((value, i) => {
      if (i > 0) chunks.push([', ', []])
      chunks.push([getname(value) ?? '', [tagname, 'value', i]])
    })
    chunks.push([')', []])
  } else if (baseTypeKind === 'array') {
    const innerBaseWrap = getbaseType(baseContent)
    const innerBase = innerBaseWrap ? getcontentOfType(innerBaseWrap) : null
    let basetypeName = ''
    if (innerBase) {
      const innerTag = getLocalTag(innerBase)
      if (innerTag === 'derived') {
        basetypeName = getname(innerBase) ?? ''
        generateDataType(state, basetypeName)
      } else {
        basetypeName = innerTag.toUpperCase()
      }
    }
    const dims = getdimension(baseContent)
    chunks.push(['ARRAY [', []])
    dims.forEach((dimension, i) => {
      if (i > 0) chunks.push([',', []])
      chunks.push(
        [`${getlower(dimension) ?? ''}`, [tagname, 'range', i, 'lower']],
        ['..', []],
        [`${getupper(dimension) ?? ''}`, [tagname, 'range', i, 'upper']],
      )
    })
    chunks.push(['] OF ', []], [basetypeName, [tagname, 'base']])
  } else if (baseTypeKind === 'struct') {
    chunks.push(['STRUCT', []])
    const structVars = getstructVariables(baseContent)
    structVars.forEach((variable, i) => {
      const elementTypeEl = gettype(variable)
      const elementType = elementTypeEl ? getcontentOfType(elementTypeEl) : null
      let elementtypeName = ''
      if (elementType) {
        const elementTypeKind = getLocalTag(elementType)
        if (elementTypeKind === 'derived') {
          elementtypeName = getname(elementType) ?? ''
          generateDataType(state, elementtypeName)
        } else if (elementTypeKind === 'array') {
          const elInnerWrap = getbaseType(elementType)
          const elInner = elInnerWrap ? getcontentOfType(elInnerWrap) : null
          let basetypeName = ''
          if (elInner) {
            const innerTag = getLocalTag(elInner)
            if (innerTag === 'derived') {
              basetypeName = getname(elInner) ?? ''
              generateDataType(state, basetypeName)
            } else {
              basetypeName = innerTag.toUpperCase()
            }
          }
          const dimensions = getdimension(elementType)
            .map((d) => `${getlower(d) ?? ''}..${getupper(d) ?? ''}`)
            .join(',')
          elementtypeName = `ARRAY [${dimensions}] OF ${basetypeName}`
        } else {
          elementtypeName = elementTypeKind.toUpperCase()
        }
      }
      chunks.push(
        ['\n    ', []],
        [getname(variable) ?? '', [tagname, 'struct', i, 'name']],
        [' : ', []],
        [elementtypeName, [tagname, 'struct', i, 'type']],
      )
      const initial = getinitialValue(variable)
      if (initial !== null) {
        const initialValue = getvalue(initial) ?? ''
        chunks.push(
          [' := ', []],
          [
            computeValue(state.project, initialValue, elementtypeName),
            [tagname, 'struct', i, 'initial value'],
          ],
        )
      }
      chunks.push([';', []])
    })
    chunks.push(['\n  END_STRUCT', []])
  } else {
    // Directly-derived from an elementary type.
    chunks.push([baseTypeKind.toUpperCase(), [tagname, 'base']])
  }

  const initial = getinitialValue(datatype)
  if (initial !== null) {
    const initialValue = getvalue(initial) ?? ''
    chunks.push(
      [' := ', []],
      [
        computeValue(state.project, initialValue, datatypeName),
        [tagname, 'initial value'],
      ],
    )
  }
  chunks.push([';\n', []])

  state.out.push(...chunks)
}

/**
 * Emit the full `TYPE\n…END_TYPE\n\n` block for every `<dataType>`
 * declared in the project. Returns an empty chunk list when the
 * project has no data types (matching Python's `if len(…) > 0`
 * guard at PLCGenerator.py:642).
 */
export function generateDataTypes(
  project: ProjectTree | Element,
): ProgramChunk[] {
  const datatypes = getdataTypes(project)
  if (datatypes.length === 0) return []

  const state: DataTypeState = {
    project,
    out: [],
    computed: new Map(),
  }
  // Pre-seed with every project data type as "uncomputed", mirroring
  // PLCGenerator.py:634-635.
  for (const dt of datatypes) {
    const name = getname(dt)
    if (name !== null) state.computed.set(name, false)
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
