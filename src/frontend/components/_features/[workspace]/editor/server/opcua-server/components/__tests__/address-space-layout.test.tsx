import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OpcUaNodeConfig, OpcUaServerConfig } from '@root/middleware/shared/ports/types'
import { fireEvent, render, screen } from '@testing-library/react'

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

const renderTab = (nodes: OpcUaNodeConfig[], variables = [variable('TANK_LEVEL'), variable('TANK_ALARM')]) => {
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
          interface: { variables },
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

describe('the Address Space tab layout (TC34, TC36, TC37, TC38)', () => {
  it('should no longer show the paragraph, the Namespace URI or the old subtitle', () => {
    renderTab([])

    expect(screen.queryByText('Select PLC variables to expose via OPC-UA')).toBeNull()
    expect(screen.queryByText('Namespace URI')).toBeNull()
    expect(screen.queryByPlaceholderText('urn:openplc:opcua:namespace')).toBeNull()
    expect(screen.queryByText('Select variables to expose')).toBeNull()
  })

  it('should keep the titles and the filter', () => {
    renderTab([])

    expect(screen.getByText('Available PLC Variables')).toBeTruthy()
    expect(screen.getByText('Selected for OPC-UA')).toBeTruthy()
    expect(screen.getByPlaceholderText('Filter variables...')).toBeTruthy()
  })

  it('should count the available entries', () => {
    renderTab([])

    expect(screen.getByText('2 available')).toBeTruthy()
  })

  it('should read "M of N shown" while a filter is typed', () => {
    renderTab([])

    fireEvent.change(screen.getByPlaceholderText('Filter variables...'), { target: { value: 'TANK_LEVEL' } })

    expect(screen.getByText('1 of 2 shown')).toBeTruthy()
  })

  it('should go back to the plain count when the filter is cleared', () => {
    renderTab([])
    const filter = screen.getByPlaceholderText('Filter variables...')

    fireEvent.change(filter, { target: { value: 'TANK' } })
    fireEvent.change(filter, { target: { value: '' } })

    expect(screen.getByText('2 available')).toBeTruthy()
  })

  it('should count no entry of a group row', () => {
    renderTab([])

    fireEvent.change(screen.getByPlaceholderText('Filter variables...'), { target: { value: 'main' } })

    expect(screen.getByText('0 of 2 shown')).toBeTruthy()
  })

  it('should say how many variables are configured', () => {
    renderTab([makeNode('a', 'TANK_LEVEL')])

    expect(screen.getByText('1 variable configured')).toBeTruthy()
  })

  it('should show zero counts and the empty message with no variables at all', () => {
    renderTab([], [])

    expect(screen.getByText('0 available')).toBeTruthy()
    expect(screen.getByText('0 variables configured')).toBeTruthy()
    expect(
      screen.getByText('No variables selected. Select variables from the left panel to expose them via OPC-UA.'),
    ).toBeTruthy()
  })
})

describe('the Address Space lists show they can scroll (TC39)', () => {
  it('should give both lists the always-visible scrollbar', () => {
    renderTab([])

    const lists = document.querySelectorAll('.oplc-visible-scrollbar')
    expect(lists).toHaveLength(2)
  })
})
