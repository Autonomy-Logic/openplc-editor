/**
 * Describing a Runtime v3/v4 target's debug channel — through the SAME resolver
 * Connect uses, with the target's declared transports deciding what is eligible.
 *
 * The regression these pin: eligibility used to be a hardcoded serial-then-TCP list
 * inside the resolver, so a `websocket` channel was never a candidate. No runtime
 * session was ever opened, and every command then answered "not connected" on a
 * target the user had connected to and uploaded a program to. The fix is not a
 * second code path for runtimes — it is asking the target which media it speaks.
 */
const mockAddLog = jest.fn()

const mockState: Record<string, unknown> = {
  deviceDefinitions: { configuration: { deviceBoard: 'OpenPLC Runtime v4', runtimeIpAddress: '192.168.0.42' } },
  runtimeConnection: { connectionStatus: 'connected', jwtToken: 'jwt-token' },
  consoleActions: { addLog: mockAddLog },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))

import type { DebugSpec } from '../../../backend/shared/hardware/debug-spec'
import type { BoardInfo } from '../../../middleware/shared/ports/types'
import { resolveRuntimeDebugChannel } from '../device-link-resolution'

/** A board carries BOTH halves: the spec says how a channel is built, the
 *  capability matrix says which channels the target can actually speak. */
const boardWith = (spec: DebugSpec, transports: string[]): BoardInfo =>
  ({ debug: spec, capabilities: { debuggerTransports: transports } }) as unknown as BoardInfo

/** The shape a Runtime v4 board declares — an SLM-RP4's, verbatim. */
const v4Spec: DebugSpec = {
  preconditions: ['runtimeConnected', 'jwtToken'],
  channels: [
    {
      label: 'WebSocket',
      channel: 'websocket',
      enabledWhen: true,
      params: {
        ipAddress: { $ref: 'configuration.runtimeIpAddress', required: 'Runtime IP address is not configured.' },
        jwtToken: { $ref: 'runtimeConnection.jwtToken', required: 'JWT token missing. Reconnect to the runtime.' },
      },
    },
  ],
}

/** Runtime v3: same shape, debugged over Modbus TCP instead. */
const v3Spec: DebugSpec = {
  preconditions: ['runtimeConnected'],
  channels: [
    {
      label: 'Modbus TCP',
      channel: 'tcp',
      enabledWhen: true,
      params: { ipAddress: { $ref: 'configuration.runtimeIpAddress', required: 'Runtime IP address is not set.' } },
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockState.runtimeConnection = { connectionStatus: 'connected', jwtToken: 'jwt-token' }
})

describe('resolveRuntimeDebugChannel', () => {
  it('describes a v4 target as its WebSocket channel', () => {
    const config = resolveRuntimeDebugChannel('OpenPLC Runtime v4', boardWith(v4Spec, ['websocket']))

    expect(config).not.toBeNull()
    expect(config?.connectionType).toBe('websocket')
    expect(config?.connectionParams.ipAddress).toBe('192.168.0.42')
    expect(config?.connectionParams.jwtToken).toBe('jwt-token')
  })

  it('describes a v3 target as its Modbus TCP channel', () => {
    const config = resolveRuntimeDebugChannel('OpenPLC Runtime v3', boardWith(v3Spec, ['modbus-tcp']))

    expect(config?.connectionType).toBe('tcp')
    expect(config?.connectionParams.ipAddress).toBe('192.168.0.42')
  })

  it('returns null and SAYS SO when a board declares no debug spec', () => {
    // Failing quietly is what hid the bug above until it reached hardware.
    expect(resolveRuntimeDebugChannel('Some Board', undefined)).toBeNull()
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('no debug spec') }),
    )
  })

  it('returns null and says why when the spec cannot be satisfied', () => {
    // v4 requires a JWT; without one the resolver refuses, and the user should be
    // able to see that rather than meet "not connected" later.
    mockState.runtimeConnection = { connectionStatus: 'connected', jwtToken: null }

    expect(resolveRuntimeDebugChannel('OpenPLC Runtime v4', boardWith(v4Spec, ['websocket']))).toBeNull()
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('could NOT describe a debug channel') }),
    )
  })

  it('traces the channel it settled on', () => {
    resolveRuntimeDebugChannel('OpenPLC Runtime v4', boardWith(v4Spec, ['websocket']))
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('debug channel is websocket') }),
    )
  })
})
