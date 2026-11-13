import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OpcUaNodeConfig, OpcUaServerConfig } from '@root/middleware/shared/ports/types'
import { fireEvent, render, screen } from '@testing-library/react'

import { AddressSpaceTab } from '../address-space-tab'

const permissions: OpcUaNodeConfig['permissions'] = { viewer: 'r', operator: 'r', engineer: 'rw' }

const structuredNode = (): OpcUaNodeConfig => ({
  id: 'man',
  pouName: 'main',
  variablePath: 'Man',
  variableType: 'MANUAL_FB',
  nodeId: 'PLC.main.Man',
  browseName: 'Man',
  displayName: 'Man',
  description: '',
  permissions,
  nodeType: 'structure',
  fields: [
    { fieldPath: 'Man.Liga', displayName: 'Liga', datatype: 'BOOL', permissions },
    { fieldPath: 'Man.Desliga', displayName: 'Desliga', datatype: 'BOOL', permissions },
  ],
})

const plainNode = (): OpcUaNodeConfig => ({
  id: 'pump',
  pouName: 'main',
  variablePath: 'PUMP_RUN',
  variableType: 'BOOL',
  nodeId: 'PLC.main.PUMP_RUN',
  browseName: 'PUMP_RUN',
  displayName: 'PUMP_RUN',
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

const renderTab = (nodes: OpcUaNodeConfig[]) => {
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
            variables: [
              {
                name: 'Man',
                class: 'local',
                type: { definition: 'derived', value: 'MANUAL_FB' },
                location: '',
                documentation: '',
                debug: false,
              },
            ],
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
          instances: [{ name: 'instance0', task: 'task0', program: 'main' }],
          globalVariables: [],
        },
      },
    },
  })
  render(<AddressSpaceTab config={config} serverName='opcua' onConfigChange={() => {}} />, {
    wrapper: createStoreWrapper(store),
  })
}

describe('a structured node in Selected for OPC-UA (TC53)', () => {
  it('should keep its members hidden until the row is expanded', () => {
    renderTab([structuredNode()])

    expect(screen.queryByText('Liga')).toBeNull()
    expect(screen.queryByText('Desliga')).toBeNull()
  })

  it('should list its members under the row once it is expanded', () => {
    renderTab([structuredNode()])

    fireEvent.click(screen.getByRole('button', { name: 'Members of Man' }))

    expect(screen.getByText('Liga')).toBeTruthy()
    expect(screen.getByText('Desliga')).toBeTruthy()
  })

  it('should still count the structured node as one configured variable', () => {
    renderTab([structuredNode()])

    fireEvent.click(screen.getByRole('button', { name: 'Members of Man' }))

    expect(screen.getByText('1 variable configured')).toBeTruthy()
  })

  it('should hide the members again when the row is collapsed', () => {
    renderTab([structuredNode()])
    const expander = screen.getByRole('button', { name: 'Members of Man' })

    fireEvent.click(expander)
    fireEvent.click(expander)

    expect(screen.queryByText('Liga')).toBeNull()
  })

  it('should give no expander to a node with no member', () => {
    renderTab([plainNode()])

    expect(screen.queryByRole('button', { name: 'Members of PUMP_RUN' })).toBeNull()
  })
})
