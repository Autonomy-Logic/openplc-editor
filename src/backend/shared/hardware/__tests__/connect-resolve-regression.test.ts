/**
 * The Connect flow and the debugger resolve the SAME debug spec.
 *
 * `use-device-connect.ts` resolves it (via `resolveSerialLink`) to derive the
 * serial port / baud / slave id it needs to OPEN the connection, nothing connected
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
import { resolveDebugConnection, resolveSerialLink, type DebugResolverContext, type DebugSpec } from '../debug-spec'

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

/** A P1AM-shaped spec with BOTH transports declared — the real package shape.
 *  Which one is eligible is decided by the project's Modbus screens. */
const bothChannelsSpec: DebugSpec = {
  channels: [
    {
      label: 'Modbus TCP',
      channel: 'tcp',
      enabledWhen: { $ref: 'screens.modbus_tcp.enabled' },
      params: { host: { $ref: 'screens.modbus_tcp.tcp_ip' }, port: 502 },
    },
    ...baremetalSpec.channels,
  ],
}

/** Only Modbus TCP enabled, with a serial port selected in the dropdown. */
const tcpOnlyContext = (): DebugResolverContext => ({
  state: {
    configuration: { deviceBoard: 'AutomationDirect P1AM-100', communicationPort: '/dev/cu.usbmodem11101' },
    screens: {
      modbus_tcp: { enabled: true, tcp_ip: '192.168.0.50' },
      modbus_rtu: { enabled: false, rtu_baud_rate: '115200', rtu_slave_id: 1 },
    },
    runtimeConnection: {},
    promptCache: {},
  },
  capabilities: { runtimeConnected: false, jwtToken: false },
})

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

  it('auto-selects TCP in a Modbus-TCP-only project, which Connect cannot use', () => {
    // Second regression, same misleading dialog. A project with ONLY Modbus TCP
    // enabled leaves exactly one eligible channel — tcp — so auto-select returns
    // a tcp config. Connect opens serial and nothing else, so it rejected that
    // config and reported "Select a communication port" with a port selected.
    const result = resolveDebugConnection(bothChannelsSpec, tcpOnlyContext(), undefined)

    expect(result.kind).toBe('config')
    if (result.kind === 'config') expect(result.config.connectionType).toBe('tcp')
  })

  it('resolves serial anyway through resolveSerialLink', () => {
    // The fix: the serial flows name the rtu channel. Naming it bypasses
    // `enabledWhen`, which is correct — the always-on debugger keeps the serial
    // protocol compiled into the firmware even with Modbus RTU turned off, so
    // serial is connectable regardless of which transports the project enables.
    const result = resolveSerialLink(bothChannelsSpec, tcpOnlyContext())

    expect(result.kind).toBe('config')
    if (result.kind === 'config') {
      expect(result.config.connectionType).toBe('rtu')
      expect(String(result.config.connectionParams.port)).toBe('/dev/cu.usbmodem11101')
    }
  })

  it('still reports a missing port through resolveSerialLink', () => {
    // Naming the channel must not swallow the channel's own `required` messages.
    const result = resolveSerialLink(baremetalSpec, disconnectedUsbContext())
    expect(result).toMatchObject({ kind: 'error', body: 'No serial port selected.' })
  })

  it('reports unsupported when the board has no serial channel at all', () => {
    const tcpOnlySpec: DebugSpec = { channels: [bothChannelsSpec.channels[0]] }
    expect(resolveSerialLink(tcpOnlySpec, tcpOnlyContext()).kind).toBe('unsupported')
  })

  it('does not throw on a spec with no channels array', () => {
    // `channels` comes from a VPP manifest; a malformed package must produce a
    // dialog, not an exception inside a click handler.
    const malformed = {} as unknown as DebugSpec
    expect(resolveSerialLink(malformed, tcpOnlyContext()).kind).toBe('unsupported')
    expect(resolveSerialLink(undefined, tcpOnlyContext()).kind).toBe('unsupported')
  })

  it('shows why a precondition cannot express a debugger-only requirement', () => {
    // Adding ANY precondition to the spec above breaks Connect, because Connect
    // resolves this same spec with nothing connected.
    const gated: DebugSpec = { ...baremetalSpec, preconditions: ['runtimeConnected'] }

    const result = resolveDebugConnection(gated, disconnectedUsbContext('/dev/cu.usbmodem11101'), undefined)
    expect(result.kind).toBe('error')
  })
})
