import { createTestStore } from '@root/frontend/store/testing'
import type { PLCProjectData, PLCVariable } from '@root/middleware/shared/ports/types'

import { createProjectPlcModel } from '../project-plc-model'

function makeVariable(name: string, type: string, location: string): PLCVariable {
  return { name, type: { definition: 'base-type', value: type }, location, documentation: '' }
}

function seedProject(
  store: ReturnType<typeof createTestStore>,
  override: Partial<Pick<PLCProjectData, 'pous' | 'configurations'>>,
): void {
  const state = store.getState()
  const base = state.project.data
  state.projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      ...base,
      pous: override.pous ?? [],
      configurations: override.configurations ?? {
        resource: { tasks: [], instances: [], globalVariables: [] },
      },
    },
  })
}

describe('createProjectPlcModel', () => {
  it('lists POU locals and GVL entries as flat qualifiers', () => {
    const store = createTestStore()
    seedProject(store, {
      pous: [
        {
          name: 'Program0',
          pouType: 'program',
          interface: {
            variables: [makeVariable('pump_speed', 'INT', '%QW0.1'), makeVariable('temp_pv', 'REAL', '')],
          },
          body: { language: 'st', value: '' },
        },
      ],
      configurations: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [makeVariable('setpoint', 'INT', '%MW0')],
        },
      },
    })

    const port = createProjectPlcModel(store)
    const variables = port.listExportableVariables()
    expect(variables).toEqual([
      { qualifier: 'Program0.pump_speed', type: 'INT', isWritable: true },
      { qualifier: 'Program0.temp_pv', type: 'REAL', isWritable: true },
      { qualifier: 'GVL.setpoint', type: 'INT', isWritable: true },
    ])
  })

  it('resolveAddress returns the IEC address for POU locals and GVL entries', () => {
    const store = createTestStore()
    seedProject(store, {
      pous: [
        {
          name: 'Program0',
          pouType: 'program',
          interface: { variables: [makeVariable('pump_speed', 'INT', '%QW0.1')] },
          body: { language: 'st', value: '' },
        },
      ],
      configurations: {
        resource: { tasks: [], instances: [], globalVariables: [makeVariable('setpoint', 'INT', '%MW0')] },
      },
    })

    const port = createProjectPlcModel(store)
    expect(port.resolveAddress('Program0.pump_speed')).toBe('%QW0.1')
    expect(port.resolveAddress('GVL.setpoint')).toBe('%MW0')
    expect(port.resolveAddress('GVL.unknown')).toBe('')
    expect(port.resolveAddress('UnknownPou.var')).toBe('')
    expect(port.resolveAddress('malformed')).toBe('')
  })

  it('returns an empty list when the project has no POU programs and no globals', () => {
    const store = createTestStore()
    seedProject(store, {})
    const port = createProjectPlcModel(store)
    expect(port.listExportableVariables()).toEqual([])
  })

  describe('onModelChanged', () => {
    it('fires when a POU variable is added', () => {
      const store = createTestStore()
      seedProject(store, {
        pous: [
          {
            name: 'Program0',
            pouType: 'program',
            interface: { variables: [makeVariable('a', 'BOOL', '')] },
            body: { language: 'st', value: '' },
          },
        ],
      })
      const port = createProjectPlcModel(store)
      const spy = jest.fn()
      const unsub = port.onModelChanged(spy)
      expect(spy).not.toHaveBeenCalled()

      seedProject(store, {
        pous: [
          {
            name: 'Program0',
            pouType: 'program',
            interface: { variables: [makeVariable('a', 'BOOL', ''), makeVariable('b', 'INT', '')] },
            body: { language: 'st', value: '' },
          },
        ],
      })
      expect(spy).toHaveBeenCalledTimes(1)
      unsub()
    })

    it('fires when a new POU program is created with variables', () => {
      const store = createTestStore()
      seedProject(store, { pous: [] })
      const port = createProjectPlcModel(store)
      const spy = jest.fn()
      port.onModelChanged(spy)

      seedProject(store, {
        pous: [
          {
            name: 'Program1',
            pouType: 'program',
            interface: { variables: [makeVariable('x', 'DINT', '%QW0.1')] },
            body: { language: 'st', value: '' },
          },
        ],
      })
      expect(spy).toHaveBeenCalled()
    })

    it('fires when a global variable is added', () => {
      const store = createTestStore()
      seedProject(store, {
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      })
      const port = createProjectPlcModel(store)
      const spy = jest.fn()
      port.onModelChanged(spy)

      seedProject(store, {
        configurations: {
          resource: { tasks: [], instances: [], globalVariables: [makeVariable('setpoint', 'INT', '')] },
        },
      })
      expect(spy).toHaveBeenCalled()
    })

    it('does NOT fire for commits that do not touch variables', () => {
      const store = createTestStore()
      seedProject(store, {
        pous: [
          {
            name: 'Program0',
            pouType: 'program',
            interface: { variables: [makeVariable('a', 'BOOL', '')] },
            body: { language: 'st', value: '' },
          },
        ],
      })
      const port = createProjectPlcModel(store)
      const spy = jest.fn()
      port.onModelChanged(spy)

      // Touch a console log entry (unrelated slice) via its action — a no-op for the model fingerprint.
      store.getState().consoleActions.addLog({ level: 'info', message: 'x' })
      expect(spy).not.toHaveBeenCalled()
    })

    it('unsubscribe() stops further notifications', () => {
      const store = createTestStore()
      seedProject(store, { pous: [] })
      const port = createProjectPlcModel(store)
      const spy = jest.fn()
      const unsub = port.onModelChanged(spy)
      unsub()
      seedProject(store, {
        pous: [
          {
            name: 'Program0',
            pouType: 'program',
            interface: { variables: [makeVariable('a', 'BOOL', '')] },
            body: { language: 'st', value: '' },
          },
        ],
      })
      expect(spy).not.toHaveBeenCalled()
    })
  })
})
