import { createEditorMqttCredentialAdapter } from '../mqtt-credential-adapter'

type MqttCredentialBridge = Pick<
  typeof window.bridge,
  'mqttCredentialsGetPersistence' | 'mqttCredentialsGetPresence' | 'mqttCredentialsPut' | 'mqttCredentialsRemove'
>

const bridge: { [Method in keyof MqttCredentialBridge]: jest.MockedFunction<MqttCredentialBridge[Method]> } = {
  mqttCredentialsGetPersistence: jest.fn(),
  mqttCredentialsGetPresence: jest.fn(),
  mqttCredentialsPut: jest.fn(),
  mqttCredentialsRemove: jest.fn(),
}

const SCOPE = { projectKey: '/p', targetKey: 'address:10.0.0.2', serverName: 'Telemetry' }
const BINDING = {
  host: 'broker.plant.local',
  port: 8883,
  tlsEnabled: true,
  clientId: 'line-1',
  method: 'username_password' as const,
}
const SECRET = { method: 'username_password' as const, username: 'u', password: 'p' }
const PRESENCE = { present: true, method: 'username_password' as const, binding: BINDING, usernameSet: true }

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  jest.clearAllMocks()
  bridge.mqttCredentialsGetPersistence.mockResolvedValue('protected')
  Object.assign(window, { bridge })
})

describe('persistence', () => {
  it('shows session until main confirms protected storage', async () => {
    let confirm: (value: 'protected') => void = () => undefined
    bridge.mqttCredentialsGetPersistence.mockReturnValue(new Promise((resolve) => (confirm = resolve)))
    const adapter = createEditorMqttCredentialAdapter()

    expect(adapter.persistence).toBe('session')
    confirm('protected')
    await flush()
    expect(adapter.persistence).toBe('protected')
  })

  it('stays session when main cannot answer', async () => {
    bridge.mqttCredentialsGetPersistence.mockRejectedValue(new Error('no handler'))
    const adapter = createEditorMqttCredentialAdapter()
    await flush()
    expect(adapter.persistence).toBe('session')
  })

  it('follows the persistence reported with each reply', async () => {
    const adapter = createEditorMqttCredentialAdapter()
    await flush()
    bridge.mqttCredentialsPut.mockResolvedValue({ ok: true, persistence: 'session', presence: PRESENCE })

    await adapter.put(SCOPE, SECRET, BINDING)
    expect(adapter.persistence).toBe('session')
  })
})

describe('operations', () => {
  it('maps presence and forwards the scope untouched', async () => {
    bridge.mqttCredentialsGetPresence.mockResolvedValue({ ok: true, persistence: 'protected', presence: PRESENCE })
    const adapter = createEditorMqttCredentialAdapter()

    await expect(adapter.getPresence(SCOPE)).resolves.toEqual(PRESENCE)
    expect(bridge.mqttCredentialsGetPresence).toHaveBeenCalledWith(SCOPE)
  })

  it('rejects instead of reporting absence when main refused the request', async () => {
    bridge.mqttCredentialsGetPresence.mockResolvedValue({
      ok: false,
      code: 'credential_invalid_format',
      message: 'The credential request is malformed.',
    })
    await expect(createEditorMqttCredentialAdapter().getPresence(SCOPE)).rejects.toThrow('malformed')
  })

  it('returns the write result in the port shape, without the persistence field', async () => {
    const adapter = createEditorMqttCredentialAdapter()
    bridge.mqttCredentialsPut.mockResolvedValueOnce({ ok: true, persistence: 'protected', presence: PRESENCE })
    await expect(adapter.put(SCOPE, SECRET, BINDING)).resolves.toEqual({ ok: true, presence: PRESENCE })
    expect(bridge.mqttCredentialsPut).toHaveBeenCalledWith(SCOPE, SECRET, BINDING)

    bridge.mqttCredentialsPut.mockResolvedValueOnce({
      ok: false,
      code: 'credential_too_large',
      message: 'Password must be at most 1024 bytes.',
      persistence: 'protected',
    })
    await expect(adapter.put(SCOPE, SECRET, BINDING)).resolves.toEqual({
      ok: false,
      code: 'credential_too_large',
      message: 'Password must be at most 1024 bytes.',
    })
  })

  it('removes, and rejects when main could not', async () => {
    const adapter = createEditorMqttCredentialAdapter()
    bridge.mqttCredentialsRemove.mockResolvedValueOnce({ ok: true, persistence: 'protected' })
    await expect(adapter.remove(SCOPE)).resolves.toBeUndefined()
    expect(bridge.mqttCredentialsRemove).toHaveBeenCalledWith(SCOPE)

    bridge.mqttCredentialsRemove.mockResolvedValueOnce({
      ok: false,
      code: 'credential_store_unavailable',
      message: 'The local credential store could not be used.',
    })
    await expect(adapter.remove(SCOPE)).rejects.toThrow('could not be used')
  })
})
