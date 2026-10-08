import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OpcUaNodeConfig, OpcUaServerConfig } from '@root/middleware/shared/ports/types'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { AddressSpaceTab } from '../address-space-tab'

const permissions: OpcUaNodeConfig['permissions'] = { viewer: 'r', operator: 'rw', engineer: 'rw' }

const makeNode = (id: string, variablePath: string): OpcUaNodeConfig => ({
  id,
  pouName: 'main',
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
                name: 'X',
                class: 'local',
                type: { definition: 'base-type', value: 'int' },
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
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
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

describe('AddressSpaceTab orphaned tags', () => {
  it('flags only the tag whose variable no longer exists, and hides its Edit', () => {
    renderTab([makeNode('kept', 'X'), makeNode('gone', 'GHOST')])

    const gone = cardOf('GHOST tag')
    expect(gone.dataset.missing).toBe('true')
    expect(within(gone).getByRole('alert').textContent).toContain('Variable not found in the project')
    expect(within(gone).queryByRole('button', { name: 'Edit' })).toBeNull()

    const kept = cardOf('X tag')
    expect(kept.dataset.missing).toBeUndefined()
    expect(within(kept).queryByRole('alert')).toBeNull()
    expect(within(kept).getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('removes an orphaned tag from the store when Remove is clicked', () => {
    const store = renderTab([makeNode('kept', 'X'), makeNode('gone', 'GHOST')])

    fireEvent.click(within(cardOf('GHOST tag')).getByRole('button', { name: 'Remove' }))

    const server = store.getState().project.data.servers?.find((s) => s.name === 'opcua')
    expect(server?.opcuaServerConfig?.addressSpace.nodes.map((n) => n.id)).toEqual(['kept'])
  })
})
