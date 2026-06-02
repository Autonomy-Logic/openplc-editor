import type { DebugResolverCapabilities, DebugResolverContext, DebugResolverState, DebugSpec } from '../debug-spec'
import { resolveDebugConnection } from '../debug-spec'

function makeContext(
  overrides: {
    state?: Partial<DebugResolverState>
    capabilities?: Partial<DebugResolverCapabilities>
  } = {},
): DebugResolverContext {
  return {
    state: {
      configuration: { deviceBoard: 'Arduino Mega' },
      screens: {},
      runtimeConnection: {},
      ...(overrides.state ?? {}),
    },
    capabilities: {
      runtimeConnected: false,
      jwtToken: false,
      ...(overrides.capabilities ?? {}),
    },
  }
}

describe('resolveDebugConnection', () => {
  describe('absent spec', () => {
    it('returns `unsupported` when the device has no debug block', () => {
      expect(resolveDebugConnection(undefined, makeContext())).toEqual({ kind: 'unsupported' })
    })
  })

  describe('preconditions', () => {
    const spec: DebugSpec = {
      preconditions: ['runtimeConnected'],
      channels: [{ label: 'WS', channel: 'websocket', enabledWhen: true, params: {} }],
    }

    it('errors with "Connection Required" when runtimeConnected is false', () => {
      const result = resolveDebugConnection(spec, makeContext({ capabilities: { runtimeConnected: false } }))
      expect(result.kind).toBe('error')
      if (result.kind === 'error') {
        expect(result.title).toBe('Connection Required')
      }
    })

    it('resolves the channel when runtimeConnected is true', () => {
      const result = resolveDebugConnection(spec, makeContext({ capabilities: { runtimeConnected: true } }))
      expect(result.kind).toBe('config')
    })

    it('errors with "Authentication Required" when jwtToken precondition fails', () => {
      const v4Spec: DebugSpec = {
        preconditions: ['runtimeConnected', 'jwtToken'],
        channels: [{ label: 'WS', channel: 'websocket', enabledWhen: true, params: {} }],
      }
      const result = resolveDebugConnection(
        v4Spec,
        makeContext({ capabilities: { runtimeConnected: true, jwtToken: false } }),
      )
      expect(result.kind).toBe('error')
      if (result.kind === 'error') {
        expect(result.title).toBe('Authentication Required')
      }
    })
  })

  describe('channel selection', () => {
    it('errors with `noneEnabled` message when no channel matches', () => {
      const spec: DebugSpec = {
        channels: [
          { label: 'RTU', channel: 'rtu', enabledWhen: { $ref: 'screens.modbus_rtu.enabled' }, params: {} },
          { label: 'TCP', channel: 'tcp', enabledWhen: { $ref: 'screens.modbus_tcp.enabled' }, params: {} },
        ],
        messages: { noneEnabled: { title: 'Modbus Required', body: 'Enable RTU or TCP.' } },
      }
      const result = resolveDebugConnection(spec, makeContext())
      expect(result).toEqual({ kind: 'error', title: 'Modbus Required', body: 'Enable RTU or TCP.' })
    })

    it('returns `pick` when multiple channels match', () => {
      const spec: DebugSpec = {
        channels: [
          { label: 'RTU', channel: 'rtu', enabledWhen: { $ref: 'screens.modbus_rtu.enabled' }, params: {} },
          { label: 'TCP', channel: 'tcp', enabledWhen: { $ref: 'screens.modbus_tcp.enabled' }, params: {} },
        ],
        messages: { pickProtocol: { title: 'Pick', body: 'Pick one.' } },
      }
      const result = resolveDebugConnection(
        spec,
        makeContext({
          state: { screens: { modbus_rtu: { enabled: true }, modbus_tcp: { enabled: true } } },
        }),
      )
      expect(result.kind).toBe('pick')
      if (result.kind === 'pick') {
        expect(result.channels).toEqual([
          { index: 0, label: 'RTU' },
          { index: 1, label: 'TCP' },
        ])
        expect(result.title).toBe('Pick')
      }
    })

    it('auto-resolves when exactly one channel matches', () => {
      const spec: DebugSpec = {
        channels: [
          { label: 'RTU', channel: 'rtu', enabledWhen: { $ref: 'screens.modbus_rtu.enabled' }, params: {} },
          { label: 'TCP', channel: 'tcp', enabledWhen: { $ref: 'screens.modbus_tcp.enabled' }, params: {} },
        ],
      }
      const result = resolveDebugConnection(
        spec,
        makeContext({ state: { screens: { modbus_rtu: { enabled: true } } } }),
      )
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionType).toBe('rtu')
        expect(result.channelLabel).toBe('RTU')
      }
    })

    it('honors `selectedChannelIndex` to force a specific channel', () => {
      const spec: DebugSpec = {
        channels: [
          { label: 'RTU', channel: 'rtu', enabledWhen: true, params: {} },
          { label: 'TCP', channel: 'tcp', enabledWhen: true, params: {} },
        ],
      }
      const result = resolveDebugConnection(spec, makeContext(), 1)
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionType).toBe('tcp')
      }
    })

    it('returns `error` for an out-of-range channel index', () => {
      const spec: DebugSpec = {
        channels: [{ label: 'RTU', channel: 'rtu', enabledWhen: true, params: {} }],
      }
      const result = resolveDebugConnection(spec, makeContext(), 5)
      expect(result.kind).toBe('error')
    })
  })

  describe('params resolution', () => {
    it('walks $ref into nested screen state', () => {
      const spec: DebugSpec = {
        channels: [
          {
            label: 'RTU',
            channel: 'rtu',
            enabledWhen: true,
            params: {
              port: { $ref: 'configuration.communicationPort' },
              baudRate: { $ref: 'screens.modbus_rtu.rtu_baud_rate' },
            },
          },
        ],
      }
      const result = resolveDebugConnection(
        spec,
        makeContext({
          state: {
            configuration: { deviceBoard: 'Arduino Mega', communicationPort: '/dev/cu.usb' },
            screens: { modbus_rtu: { rtu_baud_rate: '115200' } },
          },
        }),
      )
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionParams).toEqual({ port: '/dev/cu.usb', baudRate: '115200' })
      }
    })

    it('applies `default` when the ref resolves to undefined', () => {
      const spec: DebugSpec = {
        channels: [
          {
            label: 'RTU',
            channel: 'rtu',
            enabledWhen: true,
            params: { baudRate: { $ref: 'screens.modbus_rtu.rtu_baud_rate', default: '115200' } },
          },
        ],
      }
      const result = resolveDebugConnection(spec, makeContext())
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionParams.baudRate).toBe('115200')
      }
    })

    it('coerces strings to numbers via `as: number`', () => {
      const spec: DebugSpec = {
        channels: [
          {
            label: 'RTU',
            channel: 'rtu',
            enabledWhen: true,
            params: {
              baudRate: { $ref: 'screens.modbus_rtu.rtu_baud_rate', as: 'number' },
              slaveId: { $ref: 'screens.modbus_rtu.rtu_slave_id', as: 'number' },
            },
          },
        ],
      }
      const result = resolveDebugConnection(
        spec,
        makeContext({
          state: { screens: { modbus_rtu: { rtu_baud_rate: '57600', rtu_slave_id: 7 } } },
        }),
      )
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionParams.baudRate).toBe(57600)
        expect(result.config.connectionParams.slaveId).toBe(7)
      }
    })

    it('drops params whose ref resolves to undefined with no default', () => {
      const spec: DebugSpec = {
        channels: [
          {
            label: 'TCP',
            channel: 'tcp',
            enabledWhen: true,
            params: { ipAddress: { $ref: 'screens.modbus_tcp.ip_address' } },
          },
        ],
      }
      const result = resolveDebugConnection(spec, makeContext())
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionParams).toEqual({})
      }
    })

    it('errors with the `required` message when a required ref is missing', () => {
      const spec: DebugSpec = {
        channels: [
          {
            label: 'RTU',
            channel: 'rtu',
            enabledWhen: true,
            params: { port: { $ref: 'configuration.communicationPort', required: 'No serial port selected.' } },
          },
        ],
      }
      const result = resolveDebugConnection(spec, makeContext())
      expect(result).toEqual({ kind: 'error', title: 'Configuration Error', body: 'No serial port selected.' })
    })

    it('forwards literal param values verbatim', () => {
      const spec: DebugSpec = {
        channels: [{ label: 'S', channel: 'simulator', enabledWhen: true, params: { someFlag: true, count: 42 } }],
      }
      const result = resolveDebugConnection(spec, makeContext())
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionParams).toEqual({ someFlag: true, count: 42 })
      }
    })
  })

  describe('prompts', () => {
    const tcpSpec: DebugSpec = {
      channels: [
        {
          label: 'TCP',
          channel: 'tcp',
          enabledWhen: true,
          params: { ipAddress: { $ref: 'screens.modbus_tcp.ip_address' } },
          prompts: [
            {
              when: { $ref: 'screens.modbus_tcp.enable_dhcp' },
              field: 'ipAddress',
              title: 'Target IP',
              message: 'Enter the device IP.',
              cacheKey: 'lastDhcpIp',
            },
          ],
        },
      ],
    }

    it('surfaces a prompt when its `when` matches and cache is empty', () => {
      const result = resolveDebugConnection(
        tcpSpec,
        makeContext({ state: { screens: { modbus_tcp: { enable_dhcp: true } } } }),
      )
      expect(result.kind).toBe('prompt')
      if (result.kind === 'prompt') {
        expect(result.fields).toEqual([
          { field: 'ipAddress', title: 'Target IP', message: 'Enter the device IP.', cacheKey: 'lastDhcpIp' },
        ])
        expect(result.channelIndex).toBe(0)
      }
    })

    it('skips a prompt when the cache has its value', () => {
      const result = resolveDebugConnection(
        tcpSpec,
        makeContext({
          state: {
            screens: { modbus_tcp: { enable_dhcp: true } },
            promptCache: { lastDhcpIp: '192.168.1.50' },
          },
        }),
      )
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionParams.ipAddress).toBe('192.168.1.50')
      }
    })

    it('skips a prompt entirely when its `when` is false', () => {
      const result = resolveDebugConnection(
        tcpSpec,
        makeContext({
          state: { screens: { modbus_tcp: { enable_dhcp: false, ip_address: '10.0.0.5' } } },
        }),
      )
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionParams.ipAddress).toBe('10.0.0.5')
      }
    })

    it('runs unconditional prompts (no `when`) on every resolution until cached', () => {
      const spec: DebugSpec = {
        channels: [
          {
            label: 'TCP',
            channel: 'tcp',
            enabledWhen: true,
            params: {},
            prompts: [{ field: 'ipAddress', title: 'IP', message: 'Enter IP.', cacheKey: 'ip' }],
          },
        ],
      }
      const first = resolveDebugConnection(spec, makeContext())
      expect(first.kind).toBe('prompt')

      const second = resolveDebugConnection(spec, makeContext({ state: { promptCache: { ip: '1.2.3.4' } } }))
      expect(second.kind).toBe('config')
      if (second.kind === 'config') {
        expect(second.config.connectionParams.ipAddress).toBe('1.2.3.4')
      }
    })
  })

  describe('built-in target shapes', () => {
    it('Simulator: always-on simulator channel', () => {
      const spec: DebugSpec = {
        channels: [{ label: 'Simulator', channel: 'simulator', enabledWhen: true, params: {} }],
      }
      const result = resolveDebugConnection(spec, makeContext())
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config.connectionType).toBe('simulator')
      }
    })

    it('Runtime v3: tcp + runtimeConnected precondition', () => {
      const spec: DebugSpec = {
        preconditions: ['runtimeConnected'],
        channels: [
          {
            label: 'TCP',
            channel: 'tcp',
            enabledWhen: true,
            params: { ipAddress: { $ref: 'configuration.runtimeIpAddress' } },
          },
        ],
      }
      const result = resolveDebugConnection(
        spec,
        makeContext({
          state: { configuration: { deviceBoard: 'OpenPLC Runtime v3', runtimeIpAddress: '10.0.0.10' } },
          capabilities: { runtimeConnected: true },
        }),
      )
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config).toEqual({ connectionType: 'tcp', connectionParams: { ipAddress: '10.0.0.10' } })
      }
    })

    it('Runtime v4: websocket + both preconditions + jwt from runtimeConnection', () => {
      const spec: DebugSpec = {
        preconditions: ['runtimeConnected', 'jwtToken'],
        channels: [
          {
            label: 'WebSocket',
            channel: 'websocket',
            enabledWhen: true,
            params: {
              ipAddress: { $ref: 'configuration.runtimeIpAddress' },
              jwtToken: { $ref: 'runtimeConnection.jwtToken' },
            },
          },
        ],
      }
      const result = resolveDebugConnection(
        spec,
        makeContext({
          state: {
            configuration: { deviceBoard: 'OpenPLC Runtime v4', runtimeIpAddress: '10.0.0.20' },
            runtimeConnection: { jwtToken: 'abc.def.ghi' },
          },
          capabilities: { runtimeConnected: true, jwtToken: true },
        }),
      )
      expect(result.kind).toBe('config')
      if (result.kind === 'config') {
        expect(result.config).toEqual({
          connectionType: 'websocket',
          connectionParams: { ipAddress: '10.0.0.20', jwtToken: 'abc.def.ghi' },
        })
      }
    })
  })
})
