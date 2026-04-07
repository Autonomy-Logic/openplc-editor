import type { PLCPou } from '@root/types/PLC/open-plc'

import { ipcPouToFlat } from '../ipc-pou-to-flat'

const makeVariable = (name: string) => ({
  name,
  class: 'local' as const,
  type: { definition: 'base-type' as const, value: 'bool' as const },
  location: '',
  documentation: '',
  initialValue: '',
})

describe('ipcPouToFlat', () => {
  it('converts a program POU to flat format', () => {
    const ipcPou: PLCPou = {
      type: 'program',
      data: {
        name: 'main',
        language: 'st',
        variables: [makeVariable('x')],
        body: { language: 'st', value: 'x := TRUE;' },
        documentation: 'A test POU',
      },
    }

    const result = ipcPouToFlat(ipcPou)

    expect(result.name).toBe('main')
    expect(result.pouType).toBe('program')
    expect(result.body).toEqual({ language: 'st', value: 'x := TRUE;' })
    expect(result.documentation).toBe('A test POU')
    expect(result.interface).toEqual({
      returnType: undefined,
      variables: ipcPou.data.variables,
    })
  })

  it('includes returnType for function POUs', () => {
    const ipcPou: PLCPou = {
      type: 'function',
      data: {
        name: 'myFunc',
        language: 'st',
        returnType: 'INT',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    }

    const result = ipcPouToFlat(ipcPou)

    expect(result.pouType).toBe('function')
    expect(result.interface?.returnType).toBe('INT')
  })

  it('handles missing returnType gracefully', () => {
    const ipcPou: PLCPou = {
      type: 'program',
      data: {
        name: 'prog',
        language: 'st',
        variables: [],
        body: { language: 'st', value: '' },
        documentation: '',
      },
    }

    const result = ipcPouToFlat(ipcPou)
    expect(result.interface?.returnType).toBeUndefined()
  })

  it('handles missing variables gracefully', () => {
    // Simulate a POU that has no variables key at all
    const ipcPou = {
      type: 'program',
      data: {
        name: 'prog',
        language: 'st',
        body: { language: 'st', value: '' },
        documentation: '',
      },
    } as unknown as PLCPou

    const result = ipcPouToFlat(ipcPou)
    expect(result.interface?.variables).toEqual([])
  })

  it('includes variablesText when present', () => {
    const ipcPou = {
      type: 'program',
      data: {
        name: 'prog',
        language: 'st',
        variables: [],
        variablesText: 'VAR\n  x : BOOL;\nEND_VAR',
        body: { language: 'st', value: '' },
        documentation: '',
      },
    } as unknown as PLCPou

    const result = ipcPouToFlat(ipcPou)
    expect(result.variablesText).toBe('VAR\n  x : BOOL;\nEND_VAR')
  })
})
