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

/** What an Arduino target declares: serial always, TCP when an ethernet shield is
 *  configured. The ORDER is the capability matrix's, not the resolver's. */
const ARDUINO_TRANSPORTS = ['modbus-serial', 'modbus-tcp'] as const

/** Mirrors what `buildUsbResolverContext` builds: nothing is connected.
 *  `port === undefined` models "no port selected", which is how the store looks
 *  before the user picks one — the builder omits the key entirely. */
const disconnectedUsbContext = (port?: string): DebugResolverContext => ({
  state: {
    configuration: {
      deviceBoard: 'AutomationDirect P1AM-100',
      ...(port !== undefined ? { communicationPort: port } : {}),
    },
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

  it('offers BOTH transports, SERIAL first, when the project enables Modbus TCP', () => {
    // Serial leads: it is the direct, local path, with no address to be stale and
    // nothing to ask the user. Modbus TCP is the remote fallback.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext(), {
      transports: [...ARDUINO_TRANSPORTS],
    })

    expect(result.kind).toBe('candidates')
    if (result.kind !== 'candidates') return
    expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['rtu', 'tcp'])
    expect(String(result.candidates[0].config.connectionParams.port)).toBe('/dev/cu.usbmodem11101')
  })

  it('offers serial even with Modbus RTU turned off', () => {
    // Modbus RTU disabled does not mean serial is unreachable: the always-on
    // debugger keeps the serial protocol compiled into every baremetal firmware.
    // Requiring `enabledWhen` here is what made Connect refuse a Modbus-TCP-only
    // project with "select a communication port" while one was plainly selected.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext(), {
      transports: [...ARDUINO_TRANSPORTS],
    })
    if (result.kind !== 'candidates') throw new Error('expected candidates')
    expect(result.candidates.some((candidate) => candidate.config.connectionType === 'rtu')).toBe(true)
  })

  it('offers serial ALONE when Modbus TCP is not enabled', () => {
    const rtuOnly = resolveDeviceLinkCandidates(bothChannelsSpec, disconnectedUsbContext('/dev/cu.usbmodem11101'), {
      transports: [...ARDUINO_TRANSPORTS],
    })
    if (rtuOnly.kind !== 'candidates') throw new Error('expected candidates')
    expect(rtuOnly.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['rtu'])
  })

  it('resolves a Runtime v4 target, whose only transport is a WebSocket', () => {
    // The regression that broke every v4 target: with eligibility hardcoded to
    // serial-then-TCP, a `websocket` channel was never a candidate, so no session
    // was opened and every command answered "not connected" on a target the user
    // had connected to and uploaded to. Eligibility comes from the TARGET's
    // declared transports, so this needs no special case — only the right facts.
    const v4Spec: DebugSpec = {
      preconditions: ['runtimeConnected', 'jwtToken'],
      channels: [
        {
          label: 'WebSocket',
          channel: 'websocket',
          enabledWhen: true,
          params: {
            ipAddress: { $ref: 'configuration.runtimeIpAddress', required: 'Runtime IP address is not configured.' },
            jwtToken: { $ref: 'runtimeConnection.jwtToken', required: 'JWT token missing.' },
          },
        },
      ],
    }
    const connectedRuntime: DebugResolverContext = {
      state: {
        configuration: { deviceBoard: 'OpenPLC Runtime v4', runtimeIpAddress: '192.168.0.42' },
        screens: {},
        runtimeConnection: { connectionStatus: 'connected', jwtToken: 'jwt' },
        promptCache: {},
      },
      capabilities: { runtimeConnected: true, jwtToken: true },
    }

    const result = resolveDeviceLinkCandidates(v4Spec, connectedRuntime, { transports: ['websocket'] })

    expect(result.kind).toBe('candidates')
    if (result.kind !== 'candidates') return
    expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['websocket'])
    expect(result.candidates[0].config.connectionParams.jwtToken).toBe('jwt')
  })

  it('resolves a Runtime v3 target over Modbus TCP', () => {
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
    const connectedRuntime: DebugResolverContext = {
      state: {
        configuration: { deviceBoard: 'OpenPLC Runtime v3', runtimeIpAddress: '192.168.0.9' },
        screens: {},
        runtimeConnection: { connectionStatus: 'connected' },
        promptCache: {},
      },
      capabilities: { runtimeConnected: true, jwtToken: false },
    }

    const result = resolveDeviceLinkCandidates(v3Spec, connectedRuntime, { transports: ['modbus-tcp'] })

    if (result.kind !== 'candidates') throw new Error('expected candidates')
    expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['tcp'])
  })

  it('ignores a channel the target cannot actually speak', () => {
    // A spec may declare more than the target supports; the capability matrix wins.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext(), { transports: ['modbus-serial'] })

    if (result.kind !== 'candidates') throw new Error('expected candidates')
    expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['rtu'])
  })

  it('lets a caller skip a channel it has decided against', () => {
    // Channel 0 in this spec is the TCP one.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext(), {
      transports: [...ARDUINO_TRANSPORTS],
      skipChannels: [0],
    })
    if (result.kind !== 'candidates') throw new Error('expected candidates')
    expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['rtu'])
  })

  describe('a DHCP address is asked for LAST, and only if needed', () => {
    const dhcpSpec: DebugSpec = {
      channels: [
        {
          label: 'Modbus TCP',
          channel: 'tcp',
          enabledWhen: { $ref: 'screens.modbus_tcp.enabled' },
          params: { ipAddress: { $ref: 'screens.modbus_tcp.ip_address' } },
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
    const dhcpContext = (): DebugResolverContext => {
      const context = tcpOnlyContext()
      context.state.screens.modbus_tcp = { enabled: true, enable_dhcp: true }
      return context
    }

    it('sets the DHCP channel aside instead of asking, when prompts are deferred', () => {
      // The user's report: with DHCP on, Connect hung on a dialog before trying
      // anything. With a cable attached, that question is pure interruption.
      const result = resolveDeviceLinkCandidates(dhcpSpec, dhcpContext(), {
        transports: [...ARDUINO_TRANSPORTS],
        deferPrompts: true,
      })

      expect(result.kind).toBe('candidates')
      if (result.kind !== 'candidates') return
      expect(result.candidates.map((candidate) => candidate.config.connectionType)).toEqual(['rtu'])
      expect(result.awaitingInput).toHaveLength(1)
    })

    it('asks once the caller resolves that channel on its own', () => {
      // The second pass, run only after everything silent has failed.
      const deferred = resolveDeviceLinkCandidates(dhcpSpec, dhcpContext(), {
        transports: [...ARDUINO_TRANSPORTS],
        deferPrompts: true,
      })
      if (deferred.kind !== 'candidates') throw new Error('expected candidates')

      const result = resolveDeviceLinkCandidates(dhcpSpec, dhcpContext(), {
        transports: [...ARDUINO_TRANSPORTS],
        onlyChannels: deferred.awaitingInput,
      })
      expect(result.kind).toBe('prompt')
    })

    it('reports candidates even when ONLY a prompting channel is eligible', () => {
      // No serial port selected and DHCP on: there is nothing to try silently, but
      // the attempt must not be reported as impossible — the address dialog is
      // exactly what is missing.
      const context = dhcpContext()
      delete context.state.configuration.communicationPort
      const result = resolveDeviceLinkCandidates(dhcpSpec, context, {
        transports: [...ARDUINO_TRANSPORTS],
        deferPrompts: true,
      })

      expect(result.kind).toBe('candidates')
      if (result.kind !== 'candidates') return
      expect(result.candidates).toHaveLength(0)
      expect(result.awaitingInput).toHaveLength(1)
    })
  })

  it('still reports a missing port when serial is the only candidate', () => {
    // Candidate resolution must not swallow a channel's own `required` message.
    const result = resolveDeviceLinkCandidates(baremetalSpec, disconnectedUsbContext(), {
      transports: [...ARDUINO_TRANSPORTS],
    })
    expect(result).toMatchObject({ kind: 'error', body: 'No serial port selected.' })
  })

  it('reports unsupported when the board declares nothing reachable', () => {
    const malformed = {} as unknown as DebugSpec
    expect(resolveDeviceLinkCandidates(malformed, tcpOnlyContext(), { transports: [...ARDUINO_TRANSPORTS] }).kind).toBe(
      'unsupported',
    )
    expect(resolveDeviceLinkCandidates(undefined, tcpOnlyContext(), { transports: [...ARDUINO_TRANSPORTS] }).kind).toBe(
      'unsupported',
    )
  })

  it('reports an error when no declared channel matches a transport the target speaks', () => {
    // A target whose capability matrix says `['websocket']` cannot use a spec that
    // only declares serial and TCP — nothing is eligible. Reported as an error, not
    // silently as an empty candidate list, because an empty list downstream reads as
    // "connected to nothing" and every later command then times out unexplained.
    const result = resolveDeviceLinkCandidates(bothChannelsSpec, tcpOnlyContext(), { transports: ['websocket'] })

    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.body).toBeTruthy()
  })

  it('prefers the spec-supplied noneEnabled message when it has one', () => {
    const withMessage: DebugSpec = {
      ...bothChannelsSpec,
      messages: { noneEnabled: { title: 'Nope', body: 'This board needs an ethernet shield.' } },
    }
    const result = resolveDeviceLinkCandidates(withMessage, tcpOnlyContext(), { transports: ['websocket'] })
    expect(result).toMatchObject({ kind: 'error', title: 'Nope', body: 'This board needs an ethernet shield.' })
  })

  it('shows why a precondition cannot express a debugger-only requirement', () => {
    // Adding ANY precondition to the spec above breaks Connect, because Connect
    // resolves this same spec with nothing connected.
    const gated: DebugSpec = { ...baremetalSpec, preconditions: ['runtimeConnected'] }

    const result = resolveDebugConnection(gated, disconnectedUsbContext('/dev/cu.usbmodem11101'), undefined)
    expect(result.kind).toBe('error')
  })
})
