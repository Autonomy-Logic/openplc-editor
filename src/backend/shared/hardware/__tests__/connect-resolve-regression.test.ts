/**
 * The Connect flow and the debugger resolve the SAME debug spec.
 *
 * `use-device-connect.ts` calls `resolveDebugConnection` to derive the serial
 * port / baud / slave id it needs to OPEN the connection, with nothing connected
 * yet — that is the whole point of Connect. So a precondition on a baremetal
 * board's spec gates Connect as well as the debugger, and Connect can then never
 * succeed: it would need a connection to establish one. The user-visible symptom
 * was "Select a communication port for this device first" with a port already
 * selected, because the resolver returned `error` instead of `config`.
 *
 * A debugger-only requirement therefore cannot be expressed as a spec
 * precondition; it belongs in the debugger entry point. These tests pin both
 * halves of that.
 */
import { resolveDebugConnection, type DebugResolverContext, type DebugSpec } from '../debug-spec'

/** Mirrors what `buildUsbResolverContext` builds: nothing is connected.
 *  `port === undefined` models "no port selected", which is how the store looks
 *  before the user picks one — the builder omits the key entirely. */
const disconnectedUsbContext = (port?: string): DebugResolverContext => ({
  state: {
    configuration: { deviceBoard: 'AutomationDirect P1AM-100', ...(port !== undefined ? { communicationPort: port } : {}) },
    screens: { modbus_rtu: { enabled: true, rtu_baud_rate: '115200', rtu_slave_id: 1 } },
    runtimeConnection: {},
    promptCache: {},
  },
  capabilities: { runtimeConnected: false, jwtToken: false },
})

/** Shaped like the P1AM package's `debug` block: an RTU channel whose params
 *  come from the selected port and the Modbus screen. */
const baremetalSpec: DebugSpec = {
  channels: [
    {
      label: 'Modbus RTU',
      channel: 'rtu',
      enabledWhen: { $ref: 'screens.modbus_rtu.enabled' },
      params: {
        port: { $ref: 'configuration.communicationPort', required: 'No serial port selected.' },
        baudRate: { $ref: 'screens.modbus_rtu.rtu_baud_rate', default: '115200', as: 'number' },
        slaveId: { $ref: 'screens.modbus_rtu.rtu_slave_id', default: 1, as: 'number' },
      },
    },
  ],
}

describe('Connect resolves a baremetal debug spec while disconnected', () => {
  it('returns an rtu config carrying the selected port', () => {
    const result = resolveDebugConnection(baremetalSpec, disconnectedUsbContext('/dev/cu.usbmodem11101'), undefined)

    // `kind: 'config'` + rtu is exactly what use-device-connect requires before
    // it will call device.connect(); anything else becomes "Select a
    // communication port for this device first".
    expect(result.kind).toBe('config')
    if (result.kind === 'config') {
      expect(result.config.connectionType).toBe('rtu')
      expect(String(result.config.connectionParams.port)).toBe('/dev/cu.usbmodem11101')
      expect(Number(result.config.connectionParams.baudRate)).toBe(115200)
    }
  })

  it('still reports a genuinely missing port, so that message is not lost', () => {
    // The store omits `communicationPort` until one is picked; that is what the
    // spec's `required` message exists for, and it must survive the fix above.
    const result = resolveDebugConnection(baremetalSpec, disconnectedUsbContext(), undefined)
    expect(result.kind).toBe('error')
    expect(result).toMatchObject({ body: 'No serial port selected.' })
  })

  it('shows why a precondition cannot express a debugger-only requirement', () => {
    // Adding ANY precondition to the spec above breaks Connect, because Connect
    // resolves this same spec with nothing connected.
    const gated: DebugSpec = { ...baremetalSpec, preconditions: ['runtimeConnected'] }

    const result = resolveDebugConnection(gated, disconnectedUsbContext('/dev/cu.usbmodem11101'), undefined)
    expect(result.kind).toBe('error')
  })
})
