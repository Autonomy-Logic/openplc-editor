import type { PLCPou, PLCProjectData, PLCVariable } from '../../../ports/types'
import { resolveProjectAliases } from '../resolve-project-aliases'

function intVar(name: string, location: string): PLCVariable {
  return { name, class: 'local', type: { definition: 'base-type', value: 'INT' }, location, documentation: '' }
}

function pou(name: string, variables: PLCVariable[]): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables },
    body: { language: 'st', value: '' },
    documentation: '',
  }
}

function projectData(overrides: Partial<PLCProjectData> = {}): PLCProjectData {
  return {
    dataTypes: [],
    pous: [],
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    ...overrides,
  }
}

describe('resolveProjectAliases', () => {
  it('resolves an alias-bound location to the alias current address', () => {
    const data = projectData({ pous: [pou('main', [intVar('door', 'doorSensor')])] })

    const resolved = resolveProjectAliases(data, new Map([['doorSensor', '%IX0.1']]))

    expect(resolved.pous[0].interface?.variables[0].location).toBe('%IX0.1')
  })

  it('passes a literal %addr through verbatim, ignoring the alias index', () => {
    // A manual location is honoured exactly as typed — an index entry that
    // happens to share the text must not rewrite it.
    const data = projectData({ pous: [pou('main', [intVar('manual', '%QW10')])] })

    const resolved = resolveProjectAliases(data, new Map([['%QW10', '%QW99']]))

    expect(resolved.pous[0].interface?.variables[0].location).toBe('%QW10')
  })

  it('empties the location of an orphaned alias so the variable becomes unlocated', () => {
    const data = projectData({ pous: [pou('main', [intVar('gone', 'deletedDevice')])] })

    const resolved = resolveProjectAliases(data, new Map())

    expect(resolved.pous[0].interface?.variables[0].location).toBe('')
  })

  it('leaves an already-empty location empty', () => {
    const data = projectData({ pous: [pou('main', [intVar('unbound', '')])] })

    const resolved = resolveProjectAliases(data, new Map([['', '%IX9.9']]))

    expect(resolved.pous[0].interface?.variables[0].location).toBe('')
  })

  it('resolves resource global variables as well as POU interface variables', () => {
    const data = projectData({
      pous: [pou('main', [intVar('local', 'aliasA')])],
      configurations: {
        resource: { tasks: [], instances: [], globalVariables: [intVar('glob', 'aliasB')] },
      },
    })

    const resolved = resolveProjectAliases(
      data,
      new Map([
        ['aliasA', '%IX1.0'],
        ['aliasB', '%QX2.0'],
      ]),
    )

    expect(resolved.pous[0].interface?.variables[0].location).toBe('%IX1.0')
    expect(resolved.configurations.resource.globalVariables[0].location).toBe('%QX2.0')
  })

  it('resolves every variable of every POU, not just the first', () => {
    const data = projectData({
      pous: [pou('one', [intVar('a', 'aliasA'), intVar('b', 'aliasB')]), pou('two', [intVar('c', 'aliasC')])],
    })

    const resolved = resolveProjectAliases(
      data,
      new Map([
        ['aliasA', '%IX0.0'],
        ['aliasB', '%IX0.1'],
        ['aliasC', '%IX0.2'],
      ]),
    )

    expect(resolved.pous[0].interface?.variables.map((v) => v.location)).toEqual(['%IX0.0', '%IX0.1'])
    expect(resolved.pous[1].interface?.variables[0].location).toBe('%IX0.2')
  })

  it('never mutates the input — the store keeps the alias-name form for display', () => {
    const data = projectData({ pous: [pou('main', [intVar('door', 'doorSensor')])] })

    const resolved = resolveProjectAliases(data, new Map([['doorSensor', '%IX0.1']]))

    expect(data.pous[0].interface?.variables[0].location).toBe('doorSensor')
    expect(resolved).not.toBe(data)
    expect(resolved.pous[0]).not.toBe(data.pous[0])
  })

  it('leaves globalVariableLists untouched — GVLs sit outside the alias surface', () => {
    // Deliberate parity with `renameAlias`, which also skips GVLs. Resolving
    // them here without cascading renames there would let a GVL variable
    // resolve to an address a later rename never updates.
    const data = projectData({
      globalVariableLists: [{ name: 'GVL', variables: [intVar('gvlVar', 'doorSensor')] }],
    })

    const resolved = resolveProjectAliases(data, new Map([['doorSensor', '%IX0.1']]))

    expect(resolved.globalVariableLists?.[0].variables[0].location).toBe('doorSensor')
  })
})
