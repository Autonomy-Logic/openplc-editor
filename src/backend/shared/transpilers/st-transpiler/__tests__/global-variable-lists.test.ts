import type { PLCProjectData as SchemaPLCProjectData } from '../../../types/PLC/open-plc'
import { fromSchemaShape } from '../from-schema'

/**
 * The schema→IR projection of a Global Variable List — the code that actually runs on a
 * desktop compile.
 *
 * A GVL has no IEC equivalent, so it is compiled as the shape STruC++ resolves qualified
 * member access through: a STRUCT type, one global instance named after the list, and a
 * `VAR_EXTERNAL` in each POU that mentions it. Every rule here fails silently when
 * broken — a missing external does not warn, it just stops resolving — which is why they
 * are pinned against the projection rather than only against the text serialiser.
 */
const project = (over: Partial<SchemaPLCProjectData>): SchemaPLCProjectData =>
  ({
    dataTypes: [],
    pous: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
    libraries: [],
    ...over,
  }) as SchemaPLCProjectData

const member = (name: string, value = 'BOOL', location = '') => ({
  name,
  class: 'global' as const,
  type: { definition: 'base-type' as const, value },
  location,
  initialValue: '',
  documentation: '',
})

const stPou = (name: string, body: string): SchemaPLCProjectData['pous'][number] => ({
  type: 'program',
  data: {
    name,
    language: 'st',
    variables: [],
    body: { language: 'st', value: body },
    documentation: '',
  },
})

describe('fromSchemaShape — global variable lists', () => {
  it('emits a struct named apart from the instance', () => {
    // Types and variables share one namespace, so the type cannot take the list's name.
    const ir = fromSchemaShape(project({ globalVariableLists: [{ name: 'GVL', variables: [member('Output1')] }] }))

    expect(ir.dataTypes).toEqual([
      {
        name: 'GVL_TYPE',
        derivation: 'structure',
        variable: [{ name: 'Output1', type: { definition: 'base-type', value: 'BOOL' } }],
      },
    ])
    expect(ir.configuration.globalVariables).toEqual([
      { name: 'GVL', type: { definition: 'derived', value: 'GVL_TYPE' }, location: '' },
    ])
  })

  it('leaves member addresses out of the struct', () => {
    // A struct member cannot be bound to I/O: the compiler accepts an `AT` there and
    // silently discards it, so emitting one would imply a binding that does not exist.
    const ir = fromSchemaShape(
      project({ globalVariableLists: [{ name: 'GVL', variables: [member('Output1', 'BOOL', '%QX0.0')] }] }),
    )

    expect(JSON.stringify(ir.dataTypes)).not.toContain('%QX0.0')
  })

  it('skips an empty list entirely', () => {
    // An empty STRUCT is not a legal type, so there is nothing to instantiate.
    const ir = fromSchemaShape(project({ globalVariableLists: [{ name: 'GVL', variables: [] }] }))

    expect(ir.dataTypes).toEqual([])
    expect(ir.configuration.globalVariables).toEqual([])
  })

  it('declares a VAR_EXTERNAL in the POU that references the list', () => {
    // Without one, `GVL.Output1` fails with "Undeclared variable 'GVL'".
    const ir = fromSchemaShape(
      project({
        globalVariableLists: [{ name: 'GVL', variables: [member('Output1')] }],
        pous: [stPou('Main', 'GVL.Output1 := TRUE;')],
      }),
    )

    expect(ir.pous[0].interface.variables).toEqual([
      { name: 'GVL', class: 'external', type: { definition: 'derived', value: 'GVL_TYPE' }, location: '' },
    ])
  })

  it('declares one for a reference that starts a line', () => {
    // Regression: scanning `JSON.stringify(pou)` escaped the newline to `\` + `n`, and
    // the word character that left in front of `GVL` made the reference invisible — so
    // no external was emitted and the build failed with the very error it prevents.
    const ir = fromSchemaShape(
      project({
        globalVariableLists: [{ name: 'GVL', variables: [member('Output1')] }],
        pous: [stPou('Main', 'x := 1;\nGVL.Output1 := TRUE;')],
      }),
    )

    expect(ir.pous[0].interface.variables.map((v) => v.name)).toEqual(['GVL'])
  })

  it('leaves a POU that never mentions the list alone', () => {
    const ir = fromSchemaShape(
      project({
        globalVariableLists: [{ name: 'GVL', variables: [member('Output1')] }],
        pous: [stPou('Other', 'x := y + 1;')],
      }),
    )

    expect(ir.pous[0].interface.variables).toEqual([])
  })

  it('does not drag in a list whose name merely prefixes the one referenced', () => {
    const ir = fromSchemaShape(
      project({
        globalVariableLists: [
          { name: 'GVL', variables: [member('A')] },
          { name: 'GVL_OTHER', variables: [member('B')] },
        ],
        pous: [stPou('Main', 'GVL_OTHER.B := TRUE;')],
      }),
    )

    expect(ir.pous[0].interface.variables.map((v) => v.name)).toEqual(['GVL_OTHER'])
  })

  it('matches a reference regardless of case', () => {
    const ir = fromSchemaShape(
      project({
        globalVariableLists: [{ name: 'GVL', variables: [member('Output1')] }],
        pous: [stPou('Main', 'gvl.output1 := TRUE;')],
      }),
    )

    expect(ir.pous[0].interface.variables.map((v) => v.name)).toEqual(['GVL'])
  })

  it('projects nothing when a project carries no lists at all', () => {
    // Older projects have no such field; absent must read as "no lists", not as a crash.
    const ir = fromSchemaShape(project({ pous: [stPou('Main', 'x := 1;')] }))

    expect(ir.dataTypes).toEqual([])
    expect(ir.pous[0].interface.variables).toEqual([])
  })
})
