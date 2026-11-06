import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OpcUaNodeConfig, OpcUaServerConfig } from '@root/middleware/shared/ports/types'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { AddressSpaceTab } from '../address-space-tab'

const permissions: OpcUaNodeConfig['permissions'] = { viewer: 'r', operator: 'rw', engineer: 'rw' }

const makeNode = (id: string, variablePath: string, pouName = 'main'): OpcUaNodeConfig => ({
  id,
  pouName,
  variablePath,
  variableType: 'INT',
  nodeId: `ns=1;s=${variablePath}`,
  browseName: variablePath,
  displayName: `${variablePath} tag`,
  description: '',
  permissions,
  nodeType: 'variable',
})

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

const variable = (name: string) => ({
  name,
  class: 'local' as const,
  type: { definition: 'base-type' as const, value: 'int' as const },
  location: '',
  documentation: '',
  debug: false,
})

const mainInstance = { name: 'instance0', task: 'task0', program: 'main' }

const renderTab = (
  nodes: OpcUaNodeConfig[],
  {
    instances = [mainInstance],
    globalVariables = [],
  }: { instances?: (typeof mainInstance)[]; globalVariables?: ReturnType<typeof variable>[] } = {},
) => {
  const store = createTestStore()
  const config = makeConfig(nodes)
  store.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '/test' },
    data: {
      dataTypes: [],
      pous: [
        {
          name: 'main',
          pouType: 'program',
          interface: {
            variables: [variable('X')],
          },
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
          instances,
          globalVariables: globalVariables.map((v) => ({ ...v, class: 'global' as const })),
        },
      },
    },
  })
  render(<AddressSpaceTab config={config} serverName='opcua' onConfigChange={() => {}} />, {
    wrapper: createStoreWrapper(store),
  })
  return store
}

const cardOf = (displayName: string): HTMLElement => {
  const card = screen.getByText(displayName).closest('[class*="rounded-lg"]')
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${displayName}`)
  return card
}


const openDebugSession = (store: ReturnType<typeof createTestStore>) =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = (store: ReturnType<typeof createTestStore>) =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

/** The selection tick of the Available PLC Variables tree is a button, not an input. */
const treeTick = (name: string) => {
  const row = screen.getByText(name).closest('div')?.parentElement
  if (!row) throw new Error(`no tree row for ${name}`)
  const tick = row.querySelector<HTMLButtonElement>('button[aria-label="Toggle selection"]')
  if (!tick) throw new Error(`no selection tick for ${name}`)
  return tick
}

describe('OPC-UA Address Space during a debug session (TC12)', () => {
  it('should keep the Edit and Remove actions available while no debug session is open', () => {
    renderTab([makeNode('kept', 'X')])

    const card = cardOf('X tag')
    expect(within(card).getByRole<HTMLButtonElement>('button', { name: 'Edit' }).matches(':disabled')).toBe(false)
    expect(within(card).getByRole<HTMLButtonElement>('button', { name: 'Remove' }).matches(':disabled')).toBe(false)
  })

  it('should disable the Edit and Remove actions while the debugger is open', () => {
    const store = renderTab([makeNode('kept', 'X')])

    openDebugSession(store)

    const card = cardOf('X tag')
    expect(within(card).getByRole<HTMLButtonElement>('button', { name: 'Edit' }).matches(':disabled')).toBe(true)
    expect(within(card).getByRole<HTMLButtonElement>('button', { name: 'Remove' }).matches(':disabled')).toBe(true)
  })

  it('should open the configuration modal from Edit while no debug session is open', () => {
    renderTab([makeNode('kept', 'X')])

    fireEvent.click(within(cardOf('X tag')).getByRole('button', { name: 'Edit' }))

    expect(screen.queryByText('Edit OPC-UA Node')).not.toBeNull()
  })

  it('should open no configuration modal when the locked Edit action is clicked', () => {
    const store = renderTab([makeNode('kept', 'X')])

    openDebugSession(store)
    fireEvent.click(within(cardOf('X tag')).getByRole('button', { name: 'Edit' }))

    expect(screen.queryByText('Edit OPC-UA Node')).toBeNull()
  })

  it('should keep the node list unchanged when the locked Remove action is clicked', () => {
    const store = renderTab([makeNode('kept', 'X')])

    openDebugSession(store)
    fireEvent.click(within(cardOf('X tag')).getByRole('button', { name: 'Remove' }))

    const server = store.getState().project.data.servers?.find((s) => s.name === 'opcua')
    expect(server?.opcuaServerConfig?.addressSpace.nodes).toHaveLength(1)
  })

  it('should keep the available variables ticks usable while no debug session is open', () => {
    renderTab([])

    expect(treeTick('X').matches(':disabled')).toBe(false)
  })

  it('should disable the available variables ticks while the debugger is open', () => {
    const store = renderTab([])

    openDebugSession(store)

    expect(treeTick('X').matches(':disabled')).toBe(true)
  })

  it('should keep the variable filter usable while the debugger is open (BR03)', () => {
    const store = renderTab([])

    openDebugSession(store)
    const filter = screen.getByPlaceholderText<HTMLInputElement>('Filter variables...')

    expect(filter.matches(':disabled')).toBe(false)
  })

  it('should disable the Namespace URI field while the debugger is open', () => {
    const store = renderTab([])

    openDebugSession(store)

    expect(screen.getByPlaceholderText<HTMLInputElement>('urn:openplc:opcua:namespace').matches(':disabled')).toBe(true)
  })

  it('should release the Address Space once the debug session is closed', () => {
    const store = renderTab([makeNode('kept', 'X')])

    openDebugSession(store)
    closeDebugSession(store)

    expect(within(cardOf('X tag')).getByRole<HTMLButtonElement>('button', { name: 'Edit' }).matches(':disabled')).toBe(
      false,
    )
  })
})
