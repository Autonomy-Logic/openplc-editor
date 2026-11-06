import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OpcUaNodeConfig, OpcUaServerConfig, PLCVariable } from '@root/middleware/shared/ports/types'
import { fireEvent, render, screen } from '@testing-library/react'

const toasts: { title: string; description?: string }[] = []

vi.mock('@root/frontend/utils/toast', () => ({
  toast: (args: { title: string; description?: string }) => toasts.push(args),
}))

import type { OpenPLCStore } from '@root/frontend/store'

import { AddressSpaceTab } from '../address-space-tab'

const permissions: OpcUaNodeConfig['permissions'] = { viewer: 'r', operator: 'r', engineer: 'rw' }

const makeConfig = (nodes: OpcUaNodeConfig[]): OpcUaServerConfig => ({
  server: {
    enabled: true,
    name: 'Server',
    applicationUri: 'urn:test:server',
    productUri: 'urn:test:product',
    bindAddress: '0.0.0.0',
    port: 4840,
    endpointPath: '/openplc',
  },
  securityProfiles: [],
  security: {
    serverCertificateStrategy: 'auto_self_signed',
    serverCertificateCustom: null,
    serverPrivateKeyCustom: null,
    trustedClientCertificates: [],
  },
  users: [],
  cycleTimeMs: 100,
  addressSpace: { namespaceUri: 'urn:test:ns', nodes },
})

const variable = (name: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: 'bool' },
  location: '',
  documentation: '',
  debug: false,
})

let store: OpenPLCStore

/** Two programs: "main" is instantiated, "orphan" is not, so one entry is always skipped. */
const renderTab = (nodes: OpcUaNodeConfig[] = [], filter?: string) => {
  toasts.length = 0
  store = createTestStore()
  const config = makeConfig(nodes)
  store.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '/test' },
    data: {
      dataTypes: [],
      pous: [
        {
          name: 'main',
          pouType: 'program',
          interface: { variables: [variable('TANK_LEVEL'), variable('TANK_ALARM'), variable('PUMP_RUN')] },
          body: { language: 'st', value: '' },
          documentation: '',
        },
        {
          name: 'orphan',
          pouType: 'program',
          interface: { variables: [variable('ORPHAN_VAR')] },
          body: { language: 'st', value: '' },
          documentation: '',
        },
      ],
      globalVariableLists: [],
      servers: [{ name: 'opcua', protocol: 'opcua', opcuaServerConfig: config }],
      remoteDevices: [],
      configurations: {
        resource: {
          tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
          instances: [{ name: 'instance0', task: 'task0', program: 'main' }],
          globalVariables: [],
        },
      },
    },
  })
  render(<AddressSpaceTab config={config} serverName='opcua' onConfigChange={() => {}} />, {
    wrapper: createStoreWrapper(store),
  })
  if (filter) fireEvent.change(screen.getByPlaceholderText('Filter variables...'), { target: { value: filter } })
  return store
}

const storedNodes = () =>
  store.getState().project.data.servers?.find((s) => s.name === 'opcua')?.opcuaServerConfig?.addressSpace.nodes ?? []

const selectAll = () => fireEvent.click(screen.getByRole('button', { name: 'Select all' }))

const groupTick = (name: string) => {
  const row = screen.getByText(name).closest('div')?.parentElement
  if (!row) throw new Error(`no group row for ${name}`)
  const tick = row.querySelector<HTMLButtonElement>('button[aria-label="Toggle selection"]')
  if (!tick) throw new Error(`no tick for the group ${name}`)
  return tick
}

describe('Select all in the Address Space (TC41, TC43, TC44)', () => {
  it('should expose every entry whose program is instantiated', () => {
    renderTab()

    selectAll()

    expect(storedNodes().map((node) => node.nodeId).sort()).toEqual([
      'PLC.main.PUMP_RUN',
      'PLC.main.TANK_ALARM',
      'PLC.main.TANK_LEVEL',
    ])
  })

  it('should open no modal', () => {
    renderTab()

    selectAll()

    expect(screen.queryByText('Configure OPC-UA Node')).toBeNull()
  })

  it('should report the entry whose program has no instance', () => {
    renderTab()

    selectAll()

    expect(toasts).toHaveLength(1)
    expect(toasts[0].description).toContain('skipped: program has no instance in Resources')
    expect(toasts[0].description).toContain('1')
  })

  it('should update the configured count', () => {
    renderTab()

    selectAll()

    expect(screen.getByText('3 variables configured')).toBeTruthy()
  })

  it('should expose only what the filter shows, and report nothing (TC43)', () => {
    renderTab([], 'TANK')

    selectAll()

    expect(storedNodes().map((node) => node.nodeId).sort()).toEqual(['PLC.main.TANK_ALARM', 'PLC.main.TANK_LEVEL'])
    expect(toasts).toHaveLength(0)
  })

  it('should keep an existing node and its configuration (TC44)', () => {
    const kept: OpcUaNodeConfig = {
      id: 'kept',
      pouName: 'main',
      variablePath: 'TANK_LEVEL',
      variableType: 'BOOL',
      nodeId: 'PLC.main.TankLevelCustom',
      browseName: 'TANK_LEVEL',
      displayName: 'Level',
      description: '',
      permissions,
      nodeType: 'variable',
    }
    renderTab([kept])

    selectAll()

    const forTankLevel = storedNodes().filter((node) => node.variablePath === 'TANK_LEVEL')
    expect(forTankLevel).toHaveLength(1)
    expect(forTankLevel[0].nodeId).toBe('PLC.main.TankLevelCustom')
    expect(forTankLevel[0].displayName).toBe('Level')
  })

  it('should write the whole batch in one store update (NFR01)', () => {
    renderTab()
    let updates = 0
    const unsubscribe = store.subscribe(() => (updates += 1))

    selectAll()
    unsubscribe()

    expect(updates).toBe(1)
  })
})

describe('ticking a program group (TC50, TC51)', () => {
  it('should expose every entry of the group', () => {
    renderTab()

    fireEvent.click(groupTick('main'))

    expect(storedNodes()).toHaveLength(3)
  })

  it('should expose only the visible children while a filter is typed (TC51)', () => {
    renderTab([], 'TANK')

    fireEvent.click(groupTick('main'))

    expect(storedNodes().map((node) => node.nodeId).sort()).toEqual(['PLC.main.TANK_ALARM', 'PLC.main.TANK_LEVEL'])
  })

  it('should open no modal for a group', () => {
    renderTab()

    fireEvent.click(groupTick('main'))

    expect(screen.queryByText('Configure OPC-UA Node')).toBeNull()
  })
})

describe('ticking a single entry still opens the modal (TC52)', () => {
  it('should open the configuration modal and add nothing yet', () => {
    renderTab()

    const row = screen.getByText('PUMP_RUN').closest('div')?.parentElement
    const tick = row?.querySelector<HTMLButtonElement>('button[aria-label="Toggle selection"]')
    fireEvent.click(tick as HTMLButtonElement)

    expect(screen.queryByText('Configure OPC-UA Node')).not.toBeNull()
    expect(storedNodes()).toHaveLength(0)
  })
})
