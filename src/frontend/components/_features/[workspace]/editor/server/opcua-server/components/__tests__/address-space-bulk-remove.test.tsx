import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type {
  OpcUaNodeConfig,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  PLCVariable,
} from '@root/middleware/shared/ports/types'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@root/frontend/utils/toast', () => ({ toast: () => undefined }))

import type { OpenPLCStore } from '@root/frontend/store'

import { AddressSpaceTab } from '../address-space-tab'

const permissions: OpcUaNodeConfig['permissions'] = { viewer: 'r', operator: 'r', engineer: 'rw' }

const anonymousProfile = (over: Partial<OpcUaSecurityProfile> = {}): OpcUaSecurityProfile => ({
  id: 'p1',
  name: 'insecure',
  enabled: true,
  securityPolicy: 'None',
  securityMode: 'None',
  authMethods: ['Anonymous'],
  anonymousRole: 'viewer',
  ...over,
})

const makeConfig = (nodes: OpcUaNodeConfig[], profiles: OpcUaSecurityProfile[], enabled = true): OpcUaServerConfig => ({
  server: {
    enabled,
    name: 'Server',
    applicationUri: 'urn:test:server',
    productUri: 'urn:test:product',
    bindAddress: '0.0.0.0',
    port: 4840,
    endpointPath: '/openplc',
  },
  securityProfiles: profiles,
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

const node = (id: string, variablePath: string): OpcUaNodeConfig => ({
  id,
  pouName: 'main',
  variablePath,
  variableType: 'BOOL',
  nodeId: `PLC.main.${variablePath}`,
  browseName: variablePath,
  displayName: variablePath,
  description: '',
  permissions,
  nodeType: 'variable',
})

let store: OpenPLCStore

const renderTab = ({
  nodes = [],
  profiles = [],
  serverEnabled = true,
}: { nodes?: OpcUaNodeConfig[]; profiles?: OpcUaSecurityProfile[]; serverEnabled?: boolean } = {}) => {
  store = createTestStore()
  const config = makeConfig(nodes, profiles, serverEnabled)
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
  return store
}

const storedNodes = () =>
  store.getState().project.data.servers?.find((s) => s.name === 'opcua')?.opcuaServerConfig?.addressSpace.nodes ?? []

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })

const confirm = () => fireEvent.click(button('Confirm'))
const cancel = () => fireEvent.click(button('Cancel'))

const tickOf = (name: string) => {
  const row = screen.getByText(name).closest('div')
  if (!row) throw new Error(`no row for ${name}`)
  const tick = row.querySelector<HTMLButtonElement>('button[aria-label="Toggle selection"]')
  if (!tick) throw new Error(`no tick for ${name}`)
  return tick
}

const ALL_THREE = [node('n1', 'TANK_LEVEL'), node('n2', 'TANK_ALARM'), node('n3', 'PUMP_RUN')]

describe('Remove all (TC56)', () => {
  it('should ask for confirmation before removing anything', () => {
    renderTab({ nodes: ALL_THREE })

    fireEvent.click(button('Remove all'))

    expect(screen.getByText(/3 nodes will be removed/)).toBeTruthy()
    expect(storedNodes()).toHaveLength(3)
  })

  it('should remove every node when the user confirms', () => {
    renderTab({ nodes: ALL_THREE })

    fireEvent.click(button('Remove all'))
    confirm()

    expect(storedNodes()).toHaveLength(0)
  })

  it('should leave the nodes alone when the user cancels', () => {
    renderTab({ nodes: ALL_THREE })

    fireEvent.click(button('Remove all'))
    cancel()

    expect(storedNodes()).toHaveLength(3)
  })

  it('should remove the whole batch in one store update (NFR01)', () => {
    renderTab({ nodes: ALL_THREE })
    fireEvent.click(button('Remove all'))
    let updates = 0
    const unsubscribe = store.subscribe(() => (updates += 1))

    confirm()
    unsubscribe()

    expect(updates).toBe(1)
  })

  it('should offer no Remove all with nothing exposed', () => {
    renderTab({ nodes: [] })

    expect(button('Remove all').disabled).toBe(true)
  })
})

describe('unticking a program group (TC55)', () => {
  it('should ask for confirmation with the number of nodes the group owns', () => {
    renderTab({ nodes: ALL_THREE })

    fireEvent.click(tickOf('main'))

    expect(screen.getByText(/3 nodes will be removed/)).toBeTruthy()
  })

  it('should remove the group nodes when the user confirms', () => {
    renderTab({ nodes: ALL_THREE })

    fireEvent.click(tickOf('main'))
    confirm()

    expect(storedNodes()).toHaveLength(0)
  })

  it('should leave the nodes alone when the user cancels', () => {
    renderTab({ nodes: ALL_THREE })

    fireEvent.click(tickOf('main'))
    cancel()

    expect(storedNodes()).toHaveLength(3)
  })
})

describe('the anonymous-access confirmation (TC58, TC61, TC62, TC75, TC79)', () => {
  it('should ask before exposing anything when an enabled profile allows Anonymous', () => {
    renderTab({ profiles: [anonymousProfile()] })

    fireEvent.click(button('Select all'))

    expect(screen.getByText('Expose 3 variables? Anonymous clients can read them (role Viewer).')).toBeTruthy()
    expect(storedNodes()).toHaveLength(0)
  })

  it('should expose the nodes when the user confirms', () => {
    renderTab({ profiles: [anonymousProfile()] })

    fireEvent.click(button('Select all'))
    confirm()

    expect(storedNodes()).toHaveLength(3)
  })

  it('should expose nothing when the user cancels (TC61)', () => {
    renderTab({ profiles: [anonymousProfile({ anonymousRole: 'engineer' })] })

    fireEvent.click(button('Select all'))
    cancel()

    expect(storedNodes()).toHaveLength(0)
  })

  it('should name the most permissive role (TC59)', () => {
    renderTab({
      profiles: [anonymousProfile(), anonymousProfile({ id: 'p2', name: 'commissioning', anonymousRole: 'engineer' })],
    })

    fireEvent.click(button('Select all'))

    expect(
      screen.getByText('Expose 3 variables? Anonymous clients can read and write them (role Engineer).'),
    ).toBeTruthy()
  })

  it('should say when the server is disabled (TC75)', () => {
    renderTab({ profiles: [anonymousProfile()], serverEnabled: false })

    fireEvent.click(button('Select all'))

    expect(
      screen.getByText(
        'Expose 3 variables? Anonymous clients can read them (role Viewer). The server is currently disabled.',
      ),
    ).toBeTruthy()
  })

  it('should ask nothing when no enabled profile allows Anonymous (TC62)', () => {
    renderTab({ profiles: [anonymousProfile({ enabled: false })] })

    fireEvent.click(button('Select all'))

    expect(storedNodes()).toHaveLength(3)
  })

  it('should count only the entries the action will really add (TC60)', () => {
    renderTab({ nodes: [node('n1', 'TANK_LEVEL')], profiles: [anonymousProfile()] })

    fireEvent.click(button('Select all'))

    expect(screen.getByText('Expose 2 variables? Anonymous clients can read them (role Viewer).')).toBeTruthy()
  })

  it('should ask nothing when the action would add nothing (TC79)', () => {
    renderTab({ nodes: ALL_THREE, profiles: [anonymousProfile()] })

    fireEvent.click(button('Select all'))

    expect(screen.queryByText(/Anonymous clients can/)).toBeNull()
  })

  it('should also ask before a group tick (TC58)', () => {
    renderTab({ profiles: [anonymousProfile()] })

    fireEvent.click(tickOf('main'))

    expect(screen.getByText('Expose 3 variables? Anonymous clients can read them (role Viewer).')).toBeTruthy()
  })
})
