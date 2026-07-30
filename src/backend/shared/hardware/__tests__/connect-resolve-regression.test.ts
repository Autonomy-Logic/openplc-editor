/**
 * The Connect flow and the debugger resolve the SAME debug spec.
 *
 * `use-device-connect.ts` resolves it (via `resolveDeviceLinkCandidates`) to derive
 * the ways it can OPEN a connection, with nothing connected
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
import {
  resolveDebugConnection,
  resolveDeviceLinkCandidates,
  type DebugResolverContext,
  type DebugSpec,
} from '../debug-spec'

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

  it('offers BOTH transports, Modbus TCP first, when the project enables it', () => {
    // The connection is transport-agnostic, so Connect does not pick — it gets an
    // ordered list and the manager keeps the first that answers. TCP leads because
    // it needs no cable and survives an upload; serial follows as the fallback,
    // which is what makes preferring TCP safe when an address is stale.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext())

    expect(result.kind).toBe('candidates')
    if (result.kind !== 'candidates') return
    expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['tcp', 'rtu'])
    expect(String(result.candidates[1].config.connectionParams.port)).toBe('/dev/cu.usbmodem11101')
  })

  it('offers serial even with Modbus RTU turned off', () => {
    // Modbus RTU disabled does not mean serial is unreachable: the always-on
    // debugger keeps the serial protocol compiled into every baremetal firmware.
    // Requiring `enabledWhen` here is what made Connect refuse a Modbus-TCP-only
    // project with "select a communication port" while one was plainly selected.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext())
    if (result.kind !== 'candidates') throw new Error('expected candidates')
    expect(result.candidates.some((candidate) => candidate.config.connectionType === 'rtu')).toBe(true)
  })

  it('offers serial ALONE when Modbus TCP is not enabled', () => {
    const rtuOnly = resolveDeviceLinkCandidates(bothChannelsSpec, disconnectedUsbContext('/dev/cu.usbmodem11101'))
    if (rtuOnly.kind !== 'candidates') throw new Error('expected candidates')
    expect(rtuOnly.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['rtu'])
  })

  it('asks for the address when Modbus TCP is on DHCP', () => {
    // Requirement: prompt for the IP when DHCP is enabled. The spec declares that
    // prompt; this is the resolver bubbling it so Connect can surface the dialog —
    // which it could not do at all while it resolved a single channel itself.
    const dhcp = tcpOnlyContext()
    dhcp.state.screens.modbus_tcp = { enabled: true, enable_dhcp: true }
    const spec: DebugSpec = {
      channels: [
        {
          label: 'Modbus TCP',
          channel: 'tcp',
          enabledWhen: { $ref: 'screens.modbus_tcp.enabled' },
          params: { ipAddress: { $ref: 'screens.modbus_tcp.tcp_ip' } },
          prompts: [
            {
              when: { $ref: 'screens.modbus_tcp.enable_dhcp' },
              field: 'ipAddress',
              title: 'Target IP Address',
              message: 'Enter the DHCP-assigned address.',
              cacheKey: 'lastDhcpIp',
            },
          ],
        },
        ...baremetalSpec.channels,
      ],
    }

    const result = resolveDeviceLinkCandidates(spec, dhcp)
    expect(result.kind).toBe('prompt')
  })

  it('lets a caller skip a channel it has decided against', () => {
    // A cancelled address dialog must leave the user with the cable, not nothing.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext(), { skipChannels: [0] })
    if (result.kind !== 'candidates') throw new Error('expected candidates')
    expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['rtu'])
  })

  it('still reports a missing port when serial is the only candidate', () => {
    // Candidate resolution must not swallow a channel's own `required` message.
    const result = resolveDeviceLinkCandidates(baremetalSpec, disconnectedUsbContext())
    expect(result).toMatchObject({ kind: 'error', body: 'No serial port selected.' })
  })

  it('reports unsupported when the board declares nothing reachable', () => {
    const malformed = {} as unknown as DebugSpec
    expect(resolveDeviceLinkCandidates(malformed, tcpOnlyContext()).kind).toBe('unsupported')
    expect(resolveDeviceLinkCandidates(undefined, tcpOnlyContext()).kind).toBe('unsupported')
  })

  it('shows why a precondition cannot express a debugger-only requirement', () => {
    // Adding ANY precondition to the spec above breaks Connect, because Connect
    // resolves this same spec with nothing connected.
    const gated: DebugSpec = { ...baremetalSpec, preconditions: ['runtimeConnected'] }

    const result = resolveDebugConnection(gated, disconnectedUsbContext('/dev/cu.usbmodem11101'), undefined)
    expect(result.kind).toBe('error')
  })
})
