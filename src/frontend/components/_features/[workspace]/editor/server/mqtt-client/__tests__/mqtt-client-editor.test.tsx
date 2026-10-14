// Byte-identical with openplc-web; ports come through PlatformProvider so it runs under Jest and Vitest.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { MqttProjectIntegrationV1 } from '@root/frontend/utils/mqtt/contract/contract'
import { createSessionMqttCredentialStore } from '@root/frontend/utils/mqtt/credentials/session-store'
import { createDefaultMqttIntegration } from '@root/frontend/utils/mqtt/project/model'
import type { MqttCredentialStorePort } from '@root/middleware/shared/ports/mqtt-credential-port'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { BoardInfo, PLCPou, PLCServer, PLCVariable } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

import statusConnected from '../../../../../../../utils/mqtt/contract/fixtures/api/status-connected-sparkplug.json'
import statusRetry from '../../../../../../../utils/mqtt/contract/fixtures/api/status-retry-certificate-error.json'
import { MqttClientEditor } from '..'

const PASSWORD_MARKER = 'MARKER-PW-e3-ui-91c4'
const USERNAME_MARKER = 'MARKER-USER-e3-ui-3d70'
const V4 = 'OpenPLC Runtime v4'
const V3 = 'OpenPLC Runtime v3'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const board = (mqttClient: boolean): BoardInfo => ({
  compiler: 'openplc-compiler',
  core: '',
  preview: '',
  specs: {},
  capabilities: { mqttClient },
})

const variable = (name: string, type: PLCVariable['type']): PLCVariable => ({
  name,
  class: 'local',
  type,
  location: '',
  documentation: '',
})

const POUS: PLCPou[] = [
  {
    name: 'Main',
    pouType: 'program',
    interface: {
      variables: [
        variable('Counter', { definition: 'base-type', value: 'DINT' }),
        variable('Total', { definition: 'base-type', value: 'LINT' }),
        variable('Tank', { definition: 'user-data-type', value: 'TankT' }),
        variable('Pump', { definition: 'derived', value: 'PumpFb' }),
        variable('Levels', {
          definition: 'array',
          value: 'ARRAY',
          data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '-2..1' }] },
        }),
        variable('Mode', { definition: 'user-data-type', value: 'ModeE' }),
      ],
    },
    body: { language: 'st', value: '' },
  },
  {
    name: 'PumpFb',
    pouType: 'function-block',
    interface: {
      variables: [
        { ...variable('Running', { definition: 'base-type', value: 'BOOL' }), class: 'output' },
        { ...variable('Label', { definition: 'base-type', value: 'WSTRING' }), class: 'local' },
      ],
    },
    body: { language: 'st', value: '' },
  },
]

const SERVER = 'Telemetry'
// Rendering hundreds of selection rows in jsdom takes seconds on a loaded runner.
const LARGE_SELECTION_TIMEOUT_MS = 20000

let store: OpenPLCStore

const mqttOf = (name = SERVER): MqttProjectIntegrationV1 => {
  const config = (store.getState().project.data.servers ?? []).find((s) => s.name === name)?.mqttConfig
  if (!config) throw new Error(`${name} has no MQTT config`)
  return config
}

const mqttServer = (name: string, patch: Partial<MqttProjectIntegrationV1> = {}): PLCServer => ({
  name,
  protocol: 'mqtt',
  mqttConfig: { ...createDefaultMqttIntegration(name.toLowerCase()), ...patch },
})

function seed(options: { servers?: PLCServer[]; board?: string; ip?: string; connected?: boolean } = {}) {
  const state = store.getState()
  store.setState({
    editor: { type: 'plc-server', meta: { name: SERVER, protocol: 'mqtt' } },
    deviceAvailableOptions: {
      ...state.deviceAvailableOptions,
      availableBoards: new Map([
        [V4, board(true)],
        [V3, board(false)],
      ]),
    },
    deviceDefinitions: {
      ...state.deviceDefinitions,
      configuration: {
        ...state.deviceDefinitions.configuration,
        deviceBoard: options.board ?? V4,
        runtimeIpAddress: options.ip ?? '192.168.1.50',
      },
    },
    runtimeConnection: {
      ...state.runtimeConnection,
      connectionStatus: options.connected ? 'connected' : 'disconnected',
    },
    project: {
      ...state.project,
      meta: { ...state.project.meta, path: '/projects/mqtt' },
      data: {
        ...state.project.data,
        pous: POUS,
        dataTypes: [
          {
            name: 'TankT',
            derivation: 'structure',
            variable: [
              { name: 'Level', type: { definition: 'base-type', value: 'REAL' } },
              { name: 'Stamp', type: { definition: 'base-type', value: 'DT' } },
            ],
          },
          { name: 'ModeE', derivation: 'enumerated', values: [{ description: 'AUTO' }] },
        ],
        configurations: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 }],
            instances: [{ name: 'Line1', program: 'Main', task: 'task0' }],
            globalVariables: [],
          },
        },
        servers: options.servers ?? [mqttServer(SERVER)],
      },
    },
  })
  store.getState().fileActions.addFile({ name: SERVER, type: 'server', filePath: SERVER, isNew: false })
  store.getState().fileActions.updateFile({ name: SERVER, saved: true })
}

function makePorts(runtime: Partial<RuntimePort> = {}, mqttCredentials?: MqttCredentialStorePort): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort<RuntimePort>(runtime),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
    ...(mqttCredentials ? { mqttCredentials } : {}),
  }
}

/** A runtime port without the MQTT methods: the Proxy must not invent them. */
const runtimeWithoutMqtt = (): Partial<RuntimePort> => ({ getMqttStatus: undefined, getMqttCredentials: undefined })

const renderEditor = (ports: PlatformPorts = makePorts(runtimeWithoutMqtt())) =>
  render(<MqttClientEditor />, { wrapper: createStoreWrapper(store, ports) })

const openTab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }))

const commitText = (element: HTMLElement, value: string) => {
  fireEvent.change(element, { target: { value } })
  fireEvent.blur(element)
}

const isSaved = () => store.getState().fileActions.getSavedState({ name: SERVER })

beforeEach(() => {
  store = createTestStore()
})

describe('MqttClientEditor: creation and connection', () => {
  it('opens a server created through the protocol flow with the contract defaults', () => {
    seed({ servers: [] })
    const created = store.getState().serverActions.create({ name: 'Plant_MQTT', protocol: 'mqtt' })
    expect(created.ok).toBe(true)
    renderEditor()
    expect(screen.getByRole('heading', { name: 'MQTT client: Plant_MQTT' })).toBeTruthy()
    expect(screen.getByText(/connects to an external MQTT broker/)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Enable MQTT integration' })).toHaveProperty('checked', false)
    expect(screen.getByLabelText('Broker port')).toHaveProperty('value', '8883')
    expect(screen.getByLabelText('Client ID')).toHaveProperty('value', 'Plant_MQTT')
    expect(screen.getByTestId('mqtt-transport-badge').getAttribute('data-transport')).toBe('tls')
    expect(screen.getByRole('list', { name: 'Connection issues' }).textContent).toContain('project_host_invalid')
  })

  it('writes connection edits to the store and marks the file unsaved only on a real change', () => {
    seed()
    renderEditor()
    const host = screen.getByLabelText('Broker host')
    fireEvent.blur(host)
    expect(isSaved()).toBe(true)
    commitText(host, 'broker.plant.local')
    expect(mqttOf().connection.host).toBe('broker.plant.local')
    expect(isSaved()).toBe(false)
    expect(screen.queryByRole('list', { name: 'Connection issues' })).toBeNull()

    commitText(screen.getByLabelText('Broker port'), '18883')
    expect(mqttOf().connection.port).toBe(18883)
  })

  it('keeps text that is not a whole number out of the model', () => {
    seed()
    renderEditor()
    commitText(screen.getByLabelText('Broker port'), '88a3')
    expect(screen.getByRole('alert').textContent).toBe('Enter a whole number.')
    expect(mqttOf().connection.port).toBe(8883)
    commitText(screen.getByLabelText('Broker port'), '70000')
    expect(mqttOf().connection.port).toBe(70000)
    expect(screen.getByRole('list', { name: 'Connection issues' }).textContent).toContain('project_port_invalid')
  })

  it('refuses a second enabled integration and keeps it disabled', () => {
    seed({ servers: [mqttServer('Other', { enabled: true }), mqttServer(SERVER)] })
    renderEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable MQTT integration' }))
    expect(screen.getByRole('alert').textContent).toContain('"Other" is already enabled')
    expect(mqttOf().enabled).toBe(false)
  })

  it('shows a project-level conflict and an unsupported target as integration issues', () => {
    seed({
      board: V3,
      servers: [mqttServer('Other', { enabled: true }), mqttServer(SERVER, { enabled: true })],
    })
    renderEditor()
    const issues = screen.getByRole('list', { name: 'Integration issues' }).textContent ?? ''
    expect(issues).toContain('config_multiple_enabled')
    expect(issues).toContain('project_target_unsupported')
  })
})

describe('MqttClientEditor: security', () => {
  it('switches to plaintext with its default port and an explicit warning, and back', () => {
    seed()
    renderEditor()
    openTab(/Security/)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use TLS' }))
    expect(mqttOf().connection).toMatchObject({ port: 1883, tls: { enabled: false } })
    expect(screen.getByRole('note').textContent).toContain('not encrypted')
    expect(screen.getByTestId('mqtt-transport-badge').getAttribute('data-transport')).toBe('plaintext')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use TLS' }))
    expect(mqttOf().connection).toMatchObject({ port: 8883, tls: { enabled: true, trust: { source: 'system' } } })
    expect(screen.getByText(/there is\s+no option to skip that check/)).toBeTruthy()
  })

  it('stores a private CA, which is not secret, in the project', () => {
    seed()
    renderEditor()
    openTab(/Security/)
    fireEvent.click(screen.getByRole('radio', { name: 'Private CA (PEM)' }))
    const pem = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'
    commitText(screen.getByLabelText('CA certificate (PEM, not secret)'), pem)
    expect(mqttOf().connection.tls).toEqual({ enabled: true, trust: { source: 'pem', caPem: pem } })
    expect(screen.queryByRole('list', { name: 'Security issues' })).toBeNull()
    commitText(screen.getByLabelText('CA certificate (PEM, not secret)'), 'not a pem')
    expect(screen.getByRole('list', { name: 'Security issues' }).textContent).toContain('project_ca_pem_invalid')
  })

  it('flags client certificate authentication without TLS', () => {
    seed()
    renderEditor()
    openTab(/Security/)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use TLS' }))
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'client_certificate' } })
    expect(mqttOf().authMethod).toBe('client_certificate')
    expect(screen.getByRole('list', { name: 'Security issues' }).textContent).toContain('config_tls_required')
  })

  it('inserts, replaces and removes a password without ever showing or persisting it', async () => {
    const credentials = createSessionMqttCredentialStore()
    seed()
    store.getState().projectActions.updateMqttServerConfig(SERVER, {
      ...mqttOf(),
      authMethod: 'username_password',
      connection: { ...mqttOf().connection, host: 'broker.plant.local' },
    })
    const { container } = renderEditor(makePorts(runtimeWithoutMqtt(), credentials))
    openTab(/Security/)
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('missing'))
    expect(screen.getByRole('list', { name: 'Security issues' }).textContent).toContain('config_credential_missing')
    expect(screen.getByText(/Kept only in memory for this session/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Enter credential' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: USERNAME_MARKER } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter a password.')

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD_MARKER } })
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
    expect(screen.getByTestId('mqtt-credential-state').closest('section')?.textContent).not.toContain(PASSWORD_MARKER)
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }))
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('local'))
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Security issues' })).toBeNull()
    expect(container.innerHTML).not.toContain(PASSWORD_MARKER)
    expect(container.innerHTML).not.toContain(USERNAME_MARKER)
    const persisted = JSON.stringify(store.getState().project)
    expect(persisted).not.toContain(PASSWORD_MARKER)
    expect(persisted).not.toContain(USERNAME_MARKER)

    fireEvent.click(screen.getByRole('button', { name: 'Replace credential' }))
    expect(screen.getByLabelText('Username')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Password')).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Remove credential' }))
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('missing'))
  })

  it('does not reuse a credential entered for another broker', async () => {
    const credentials = createSessionMqttCredentialStore()
    seed()
    store.getState().projectActions.updateMqttServerConfig(SERVER, {
      ...mqttOf(),
      authMethod: 'username_password',
      connection: { ...mqttOf().connection, host: 'broker.plant.local' },
    })
    renderEditor(makePorts(runtimeWithoutMqtt(), credentials))
    openTab(/Security/)
    fireEvent.click(await screen.findByRole('button', { name: 'Enter credential' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'plc' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD_MARKER } })
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }))
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('local'))

    openTab(/Connection/)
    commitText(screen.getByLabelText('Broker host'), 'attacker.example')
    openTab(/Security/)
    expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('binding_mismatch')
    expect(screen.getByRole('list', { name: 'Security issues' }).textContent).toContain(
      'config_credential_binding_mismatch',
    )
  })

  it('keeps credentials per target and forgets the previous answer when the target changes', async () => {
    const credentials = createSessionMqttCredentialStore()
    const pendingPresence: Array<() => void> = []
    const gated: MqttCredentialStorePort = {
      persistence: credentials.persistence,
      put: (scope, secret, binding) => credentials.put(scope, secret, binding),
      remove: (scope) => credentials.remove(scope),
      getPresence: (scope) =>
        scope.targetKey === 'address:192.168.1.99'
          ? new Promise((resolve) => pendingPresence.push(() => void credentials.getPresence(scope).then(resolve)))
          : credentials.getPresence(scope),
    }
    seed()
    store.getState().projectActions.updateMqttServerConfig(SERVER, {
      ...mqttOf(),
      authMethod: 'username_password',
      connection: { ...mqttOf().connection, host: 'broker.plant.local' },
    })
    renderEditor(makePorts(runtimeWithoutMqtt(), gated))
    openTab(/Security/)
    fireEvent.click(await screen.findByRole('button', { name: 'Enter credential' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: USERNAME_MARKER } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD_MARKER } })
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }))
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('local'))

    const moveTo = (ip: string) =>
      act(() => {
        const state = store.getState()
        store.setState({
          deviceDefinitions: {
            ...state.deviceDefinitions,
            configuration: { ...state.deviceDefinitions.configuration, runtimeIpAddress: ip },
          },
        })
      })
    moveTo('192.168.1.99')
    expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('loading')
    await act(async () => {
      pendingPresence[0]()
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('missing'))
    moveTo('192.168.1.50')
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('local'))
  })

  it('says a transient credential is only kept until it is sent, and follows changes the store announces', async () => {
    const credentials = createSessionMqttCredentialStore()
    const listeners = new Set<() => void>()
    const transient: MqttCredentialStorePort = {
      persistence: 'transient',
      getPresence: (scope) => credentials.getPresence(scope),
      put: (scope, secret, binding) => credentials.put(scope, secret, binding),
      remove: (scope) => credentials.remove(scope),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    seed()
    store.getState().projectActions.updateMqttServerConfig(SERVER, {
      ...mqttOf(),
      authMethod: 'username_password',
      connection: { ...mqttOf().connection, host: 'broker.plant.local' },
    })
    const view = renderEditor(makePorts(runtimeWithoutMqtt(), transient))
    openTab(/Security/)
    expect(await screen.findByText(/unencrypted, until the next upload sends it to the runtime/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enter credential' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: USERNAME_MARKER } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD_MARKER } })
    fireEvent.click(screen.getByRole('button', { name: 'Save credential' }))
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('local'))
    expect(listeners.size).toBe(1)

    await credentials.remove({ projectKey: '/projects/mqtt', targetKey: 'address:192.168.1.50', serverName: SERVER })
    act(() => listeners.forEach((listener) => listener()))
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('missing'))
    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('asks for a target before accepting a credential', () => {
    seed({ ip: '' })
    store.getState().projectActions.updateMqttServerConfig(SERVER, { ...mqttOf(), authMethod: 'username_password' })
    renderEditor()
    openTab(/Security/)
    expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('no_target')
    expect(screen.getByRole('button', { name: 'Enter credential' })).toHaveProperty('disabled', true)
  })

  it('takes the credential the runtime already holds for the same binding', async () => {
    seed({ connected: true })
    store.getState().projectActions.updateMqttServerConfig(SERVER, {
      ...mqttOf(),
      authMethod: 'username_password',
      connection: { ...mqttOf().connection, host: 'broker.example.net', clientId: 'plc-linha1' },
    })
    const active = {
      active: {
        id: '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f',
        revision: 3,
        method: 'username_password',
        binding: {
          host: 'broker.example.net',
          port: 8883,
          tls_enabled: true,
          client_id: 'plc-linha1',
          method: 'username_password',
        },
        usernameSet: true,
        updatedAt: '2026-10-08T09:00:00.000Z',
        updatedBy: 'admin',
      },
      staged: [],
    }
    renderEditor(
      makePorts({
        getMqttStatus: () => Promise.resolve({ success: true, data: statusRetry }),
        getMqttCredentials: () => Promise.resolve({ success: true, data: active }),
      }),
    )
    openTab(/Security/)
    await waitFor(() => expect(screen.getByTestId('mqtt-credential-state').getAttribute('data-state')).toBe('runtime'))
    expect(screen.getByTestId('mqtt-credential-state').textContent).toContain('revision 3')
    expect(screen.getByRole('button', { name: 'Replace credential' })).toBeTruthy()
  })
})

describe('MqttClientEditor: publication', () => {
  it('edits generic publication and switches to Sparkplug fields without QoS or retain', () => {
    seed()
    renderEditor()
    openTab(/Publication/)
    fireEvent.change(screen.getByLabelText('Publish'), { target: { value: 'periodic' } })
    commitText(screen.getByLabelText('Publish interval (ms)'), '50')
    fireEvent.change(screen.getByLabelText('QoS'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Retain messages' }))
    commitText(screen.getByLabelText('Topic prefix'), 'plant/line1')
    expect(mqttOf().generic).toEqual({
      publishMode: 'periodic',
      sampleIntervalMs: 100,
      publishIntervalMs: 50,
      qos: 1,
      retain: true,
      topicPrefix: 'plant/line1',
    })
    expect(screen.getByRole('list', { name: 'Publication issues' }).textContent).toContain('project_interval_invalid')
    commitText(screen.getByLabelText('Topic prefix'), '')
    expect(mqttOf().generic.topicPrefix).toBeUndefined()

    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'sparkplug_b' } })
    expect(mqttOf().mode).toBe('sparkplug_b')
    expect(screen.queryByLabelText('QoS')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Retain messages' })).toBeNull()
    commitText(screen.getByLabelText('Group ID'), 'plant/1')
    expect(screen.getByRole('list', { name: 'Publication issues' }).textContent).toContain(
      'config_sparkplug_id_invalid',
    )
    commitText(screen.getByLabelText('Edge Node ID'), 'line1')
    expect(mqttOf().sparkplug.edgeNodeId).toBe('line1')
  })
})

describe('MqttClientEditor: variable selection', () => {
  const expand = (path: string) => fireEvent.click(screen.getByRole('button', { name: `Expand ${path}` }))

  it('selects scalar, structure, block and array leaves, with types, encodings and original indices', () => {
    seed()
    renderEditor()
    openTab(/Variables/)
    expand('Line1.Main')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Counter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Total' }))
    expand('Line1.Main.Tank')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Tank.Stamp' }))
    expand('Line1.Main.Pump')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Pump.Label' }))
    expand('Line1.Main.Levels')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Levels[-2]' }))

    expect(screen.getByTestId('mqtt-selected-count').textContent).toBe('5')
    const rows = screen.getAllByTestId('mqtt-selection-row')
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual([
      'Line1.Main.Counter',
      'Line1.Main.Total',
      'Line1.Main.Tank.Stamp',
      'Line1.Main.Pump.Label',
      'Line1.Main.Levels[-2]',
    ])
    expect(rows[1].textContent).toContain('Decimal string')
    expect(rows[2].textContent).toContain('YYYY-MM-DDTHH:mm:ss.fffffffffZ')
    expect(rows[3].textContent).toContain('Base64 of UTF-16LE')
    expect(mqttOf().selections[4].source.tokens).toEqual([
      { role: 'instance', name: 'Line1' },
      { role: 'program', name: 'Main' },
      { role: 'variable', name: 'Levels' },
      { role: 'index', indices: [-2] },
    ])

    const enumRow = screen.getByText('Mode').closest('li')
    expect(enumRow?.getAttribute('aria-disabled')).toBe('true')
    expect(enumRow?.textContent).toContain('Enumerations cannot be published.')
    expect(within(enumRow ?? document.body).queryByRole('checkbox')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Counter' }))
    expect(screen.getByTestId('mqtt-selected-count').textContent).toBe('4')
  })

  it(
    'selects and clears a whole structure, and refuses more than the limit as a whole',
    () => {
      seed({
        servers: [
          mqttServer(SERVER, {
            selections: Array.from({ length: 999 }, (_, i) => ({
              source: {
                tokens: [
                  { role: 'instance', name: 'Line1' },
                  { role: 'program', name: 'Main' },
                  { role: 'variable', name: 'Gone' },
                  { role: 'index', indices: [i] },
                ],
              },
            })),
          }),
        ],
      })
      renderEditor()
      openTab(/Variables/)
      expand('Line1.Main')
      fireEvent.click(screen.getByRole('button', { name: 'Select all leaves under Line1.Main.Tank' }))
      expect(screen.getByRole('alert').textContent).toContain('would exceed the limit of 1000')
      expect(mqttOf().selections).toHaveLength(999)

      act(() => {
        store.getState().projectActions.updateMqttServerConfig(SERVER, { ...mqttOf(), selections: [] })
      })
      fireEvent.click(screen.getByRole('button', { name: 'Select all leaves under Line1.Main.Tank' }))
      expect(mqttOf().selections).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: 'Clear selection under Line1.Main.Tank' }))
      expect(mqttOf().selections).toHaveLength(0)
    },
    LARGE_SELECTION_TIMEOUT_MS,
  )

  it(
    'pages a long selection list and filters it down to the selections with problems',
    () => {
      const at = (name: string, indices?: number[]) => ({
        source: {
          tokens: [
            { role: 'instance' as const, name: 'Line1' },
            { role: 'program' as const, name: 'Main' },
            { role: 'variable' as const, name },
            ...(indices ? [{ role: 'index' as const, indices }] : []),
          ],
        },
      })
      seed({
        servers: [
          mqttServer(SERVER, {
            selections: [at('Counter'), ...Array.from({ length: 120 }, (_, i) => at('Gone', [i]))],
          }),
        ],
      })
      renderEditor()
      openTab(/Variables/)
      expect(screen.getByTestId('mqtt-selection-shown').textContent).toBe('Showing 100 of 121')
      expect(screen.getAllByTestId('mqtt-selection-row')).toHaveLength(100)
      fireEvent.click(screen.getByRole('button', { name: 'Show more selections (21 hidden)' }))
      expect(screen.getAllByTestId('mqtt-selection-row')).toHaveLength(121)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Only selections with problems (120)' }))
      const rows = screen.getAllByTestId('mqtt-selection-row')
      expect(rows).toHaveLength(120)
      expect(rows.every((row) => row.getAttribute('data-invalid') === 'true')).toBe(true)
      expect(screen.queryByText('Line1.Main.Counter')).toBeNull()
    },
    LARGE_SELECTION_TIMEOUT_MS,
  )

  it('keeps a removed variable visible as invalid until it is repaired or removed', () => {
    const gone = {
      source: {
        tokens: [
          { role: 'instance' as const, name: 'Line1' },
          { role: 'program' as const, name: 'Main' },
          { role: 'variable' as const, name: 'Renamed' },
        ],
      },
    }
    seed({ servers: [mqttServer(SERVER, { enabled: true, selections: [gone] })] })
    renderEditor()
    openTab(/Variables/)
    const row = screen.getByTestId('mqtt-selection-row')
    expect(row.getAttribute('data-invalid')).toBe('true')
    expect(row.textContent).toContain('The variable or field no longer exists.')
    expect(row.textContent).toContain('Repair or remove it.')
    expect(mqttOf().selections).toEqual([gone])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Line1.Main.Renamed' }))
    expect(mqttOf().selections).toEqual([])
    expect(screen.getByRole('list', { name: 'Variable selection issues' }).textContent).toContain('config_no_leaves')
  })

  it('edits destinations, flags invalid and colliding ones, and shows the Sparkplug birth size', () => {
    seed()
    renderEditor()
    openTab(/Variables/)
    expand('Line1.Main')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Counter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line1.Main.Total' }))
    const topic = screen.getByRole('textbox', { name: 'Topic for Line1.Main.Counter' })
    expect(topic.getAttribute('placeholder')).toBe('openplc/telemetry/Line1/Main/Counter')
    commitText(topic, 'plant/+/counter')
    expect(mqttOf().selections[0].topic).toBe('plant/+/counter')
    expect(screen.getAllByTestId('mqtt-selection-row')[0].textContent).toContain('Topic is not valid.')

    commitText(screen.getByRole('textbox', { name: 'Topic for Line1.Main.Counter' }), 'plant/x')
    commitText(screen.getByRole('textbox', { name: 'Topic for Line1.Main.Total' }), 'plant/x')
    expect(screen.getAllByTestId('mqtt-selection-row')[1].textContent).toContain(
      'Destination collides with selection 1',
    )

    openTab(/Publication/)
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'sparkplug_b' } })
    openTab(/Variables/)
    expect(screen.getByRole('button', { name: 'Collapse Line1.Main' })).toBeTruthy()
    expect(screen.getByTestId('mqtt-birth-size').textContent).toMatch(/Birth message up to \d+ of 262144 bytes/)
    const metric = screen.getByRole('textbox', { name: 'Metric name for Line1.Main.Counter' })
    expect(metric.getAttribute('placeholder')).toBe('Line1.Main.Counter')
    expect(metric).toHaveProperty('value', '')
    expect(screen.getAllByTestId('mqtt-selection-row')[0].textContent).toContain('Int32')
  })
})

describe('MqttClientEditor: runtime status', () => {
  it('reports when the connection cannot read the runtime state', () => {
    seed({ connected: true })
    renderEditor()
    openTab(/Status/)
    expect(screen.getByTestId('mqtt-runtime-view').getAttribute('data-kind')).toBe('unsupported')
  })

  it('does not poll while disconnected', () => {
    let calls = 0
    seed({ connected: false })
    renderEditor(makePorts({ getMqttStatus: () => ((calls += 1), Promise.resolve({ success: true, data: {} })) }))
    openTab(/Status/)
    expect(screen.getByTestId('mqtt-runtime-view').getAttribute('data-kind')).toBe('offline')
    expect(calls).toBe(0)
  })

  it('shows the state and error category the runtime reports', async () => {
    seed({ connected: true })
    renderEditor(makePorts({ getMqttStatus: () => Promise.resolve({ success: true, data: statusRetry }) }))
    openTab(/Status/)
    await waitFor(() => expect(screen.getByTestId('mqtt-runtime-state').getAttribute('data-state')).toBe('retry_wait'))
    expect(screen.getByTestId('mqtt-runtime-error-category').textContent).toBe('Certificate')
    expect(screen.getByText(/Broker certificate does not match host/)).toBeTruthy()
    expect(screen.getByText(/attempt 4, next in 18 s/)).toBeTruthy()
  })

  it('shows the Sparkplug session and rejects a body outside the contract', async () => {
    seed({ connected: true })
    const { unmount } = renderEditor(
      makePorts({ getMqttStatus: () => Promise.resolve({ success: true, data: statusConnected }) }),
    )
    openTab(/Status/)
    await waitFor(() => expect(screen.getByTestId('mqtt-runtime-state').textContent).toBe('Connected'))
    expect(screen.getByText(/bdSeq 7, seq 42/)).toBeTruthy()
    unmount()

    renderEditor(
      makePorts({
        getMqttStatus: () => Promise.resolve({ success: true, data: { ...statusConnected, state: 'publishing' } }),
      }),
    )
    openTab(/Status/)
    await waitFor(() => expect(screen.getByTestId('mqtt-runtime-view').getAttribute('data-kind')).toBe('invalid'))
  })

  it('reports a failed or throwing read', async () => {
    seed({ connected: true })
    const { unmount } = renderEditor(
      makePorts({ getMqttStatus: () => Promise.resolve({ success: false, error: 'HTTP 401' }) }),
    )
    openTab(/Status/)
    await waitFor(() => expect(screen.getByTestId('mqtt-runtime-view').getAttribute('data-kind')).toBe('error'))
    expect(screen.getByText(/HTTP 401/)).toBeTruthy()
    unmount()
    renderEditor(makePorts({ getMqttStatus: () => Promise.reject(new Error('socket closed')) }))
    openTab(/Status/)
    await waitFor(() => expect(screen.getByText(/socket closed/)).toBeTruthy())
  })

  it('drops the answer of a previous target and starts over for the new one', async () => {
    const pending: Array<(value: { success: boolean; data?: unknown }) => void> = []
    seed({ connected: true })
    renderEditor(
      makePorts({
        getMqttStatus: () => new Promise((resolve) => pending.push(resolve)),
      }),
    )
    openTab(/Status/)
    await waitFor(() => expect(pending).toHaveLength(1))

    act(() => {
      const state = store.getState()
      store.setState({
        deviceDefinitions: {
          ...state.deviceDefinitions,
          configuration: { ...state.deviceDefinitions.configuration, runtimeIpAddress: '192.168.1.99' },
        },
      })
    })
    await waitFor(() => expect(pending).toHaveLength(2))
    await act(async () => {
      pending[0]({ success: true, data: statusRetry })
      await Promise.resolve()
    })
    expect(screen.getByTestId('mqtt-runtime-view').getAttribute('data-kind')).toBe('loading')
    await act(async () => {
      pending[1]({ success: true, data: statusConnected })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('mqtt-runtime-state').getAttribute('data-state')).toBe('connected'))
  })

  it('stops polling and clears the state when the project changes', async () => {
    let calls = 0
    seed({ connected: true })
    renderEditor(
      makePorts({
        getMqttStatus: () => {
          calls += 1
          return Promise.resolve({ success: true, data: statusRetry })
        },
      }),
    )
    openTab(/Status/)
    await waitFor(() => expect(screen.getByTestId('mqtt-runtime-state')).toBeTruthy())
    const before = calls
    act(() => {
      const state = store.getState()
      store.setState({ project: { ...state.project, meta: { ...state.project.meta, path: '/projects/other' } } })
    })
    await waitFor(() => expect(calls).toBe(before + 1))
  })
})
