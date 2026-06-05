import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import { addPythonLocalVariables } from '../addPythonLocalVariables'

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

describe('addPythonLocalVariables', () => {
  it('adds three runtime variables to python pous', () => {
    const project = makeProjectData([
      {
        name: 'pyBlock',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'python', value: '' },
      },
    ])

    const result = addPythonLocalVariables(project)

    const vars = result.pous[0].interface!.variables
    expect(vars).toHaveLength(3)
    expect(vars[0].name).toBe('first_run')
    expect(vars[0].class).toBe('local')
    expect(vars[0].type).toEqual({ definition: 'base-type', value: 'BOOL' })
    expect(vars[1].name).toBe('shm_in_ptr')
    expect(vars[1].class).toBe('local')
    expect(vars[1].type).toEqual({ definition: 'base-type', value: 'ULINT' })
    expect(vars[2].name).toBe('shm_out_ptr')
    expect(vars[2].class).toBe('local')
    expect(vars[2].type).toEqual({ definition: 'base-type', value: 'ULINT' })
  })

  it('preserves existing variables when adding runtime variables', () => {
    const existingVar = {
      name: 'myInput',
      class: 'input' as const,
      type: { definition: 'base-type' as const, value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    }
    const project = makeProjectData([
      {
        name: 'pyBlock',
        pouType: 'function-block',
        interface: { variables: [existingVar] },
        body: { language: 'python', value: '' },
      },
    ])

    const result = addPythonLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(4)
    expect(result.pous[0].interface!.variables[0].name).toBe('myInput')
  })

  it('does not modify non-python pous', () => {
    const project = makeProjectData([
      {
        name: 'stProgram',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'st', value: '' },
      },
    ])

    const result = addPythonLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(0)
  })

  it('does not mutate the original project data', () => {
    const project = makeProjectData([
      {
        name: 'pyBlock',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'python', value: '' },
      },
    ])

    addPythonLocalVariables(project)

    expect(project.pous[0].interface!.variables).toHaveLength(0)
  })

  it('handles pou with undefined interface', () => {
    const project = makeProjectData([
      {
        name: 'pyBlock',
        pouType: 'function-block',
        body: { language: 'python', value: '' },
      },
    ])

    const result = addPythonLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(3)
  })

  it('handles multiple pous with mixed languages', () => {
    const project = makeProjectData([
      {
        name: 'py1',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'python', value: '' },
      },
      {
        name: 'st1',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'st', value: '' },
      },
      {
        name: 'py2',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'python', value: '' },
      },
    ])

    const result = addPythonLocalVariables(project)

    expect(result.pous[0].interface!.variables).toHaveLength(3)
    expect(result.pous[1].interface!.variables).toHaveLength(0)
    expect(result.pous[2].interface!.variables).toHaveLength(3)
  })
})
