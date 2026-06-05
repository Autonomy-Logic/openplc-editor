import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import { addCppLocalVariables } from '../addCppLocalVariables'

// Polyfill structuredClone for jsdom environments that lack it
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val))
}

const makeProjectData = (pous: PLCProjectData['pous']): PLCProjectData => ({
  dataTypes: [],
  pous,
  configurations: {
    resource: {
      tasks: [],
      instances: [],
      globalVariables: [],
    },
  },
})

describe('addCppLocalVariables', () => {
  it('adds hasBeenInitialized variable to cpp pous', () => {
    const project = makeProjectData([
      {
        name: 'myBlock',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'cpp', value: '' },
      },
    ])

    const result = addCppLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(1)
    const added = result.pous[0].interface!.variables[0]
    expect(added.name).toBe('hasBeenInitialized')
    expect(added.class).toBe('local')
    expect(added.type).toEqual({ definition: 'base-type', value: 'BOOL' })
    expect(added.initialValue).toBe('0')
  })

  it('preserves existing variables when adding to cpp pou', () => {
    const existingVar = {
      name: 'myVar',
      class: 'input' as const,
      type: { definition: 'base-type' as const, value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    }
    const project = makeProjectData([
      {
        name: 'myBlock',
        pouType: 'function-block',
        interface: { variables: [existingVar] },
        body: { language: 'cpp', value: '' },
      },
    ])

    const result = addCppLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(2)
    expect(result.pous[0].interface!.variables[0].name).toBe('myVar')
    expect(result.pous[0].interface!.variables[1].name).toBe('hasBeenInitialized')
  })

  it('does not modify non-cpp pous', () => {
    const project = makeProjectData([
      {
        name: 'myProgram',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'st', value: '' },
      },
    ])

    const result = addCppLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(0)
  })

  it('does not mutate the original project data', () => {
    const project = makeProjectData([
      {
        name: 'myBlock',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'cpp', value: '' },
      },
    ])

    addCppLocalVariables(project)

    expect(project.pous[0].interface!.variables).toHaveLength(0)
  })

  it('handles pou with undefined interface', () => {
    const project = makeProjectData([
      {
        name: 'myBlock',
        pouType: 'function-block',
        body: { language: 'cpp', value: '' },
      },
    ])

    const result = addCppLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(1)
    expect(result.pous[0].interface!.variables[0].name).toBe('hasBeenInitialized')
  })

  it('handles multiple pous with mixed languages', () => {
    const project = makeProjectData([
      {
        name: 'block1',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'cpp', value: '' },
      },
      {
        name: 'prog1',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'st', value: '' },
      },
      {
        name: 'block2',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'cpp', value: '' },
      },
    ])

    const result = addCppLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(1)
    expect(result.pous[1].interface!.variables).toHaveLength(0)
    expect(result.pous[2].interface!.variables).toHaveLength(1)
  })
})
