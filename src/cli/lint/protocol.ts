/**
 * Protocol configurations that save, upload, and then half-exist.
 *
 * Same bargain as the program linter: every finding here is a project the
 * compiler accepts. The generators are forgiving by design — a Modbus device
 * with no I/O groups and an RTU device with no serial port are both dropped and
 * the compile succeeds, so the runtime simply never polls them. Nothing else in
 * the toolchain says so before a technician is standing next to the panel.
 *
 * Where a real validator already exists it is delegated to rather than
 * reimplemented: `validateOpcUaConfig` resolves every address-space node against
 * the debug map, which is the highest-value check in the set and impossible to
 * approximate.
 */

import { generateEthercatConfig } from '@root/backend/shared/ethercat/generate-ethercat-config'
import { validateEthercatConfig } from '@root/backend/shared/ethercat/validate-ethercat-config'
import { validateOpcUaConfig } from '@root/frontend/utils/opcua/generate-opcua-config'
import type { PLCInstanceInfo } from '@root/frontend/utils/opcua/types'
import type { PLCRemoteDevice, PLCServer, PLCVariable } from '@root/middleware/shared/ports/types'

import type { LintFinding } from './program'

export interface ProtocolLintInput {
  servers: readonly PLCServer[]
  remoteDevices: readonly PLCRemoteDevice[]
  /** STruC++'s `debug-map.json`; OPC-UA node resolution needs it. */
  debugMapContent: string
  instances: PLCInstanceInfo[]
  /** Resource globals, for the address-collision rule. */
  globals: readonly PLCVariable[]
}

/** The port each protocol listens on, for the conflict check. */
function serverPort(server: PLCServer): number | undefined {
  if (server.protocol === 'modbus-tcp') return server.modbusSlaveConfig?.port
  if (server.protocol === 's7comm') return server.s7commSlaveConfig?.server.port
  if (server.protocol === 'opcua') return server.opcuaServerConfig?.server.port
  return undefined
}

function isEnabled(server: PLCServer): boolean {
  if (server.protocol === 'modbus-tcp') return server.modbusSlaveConfig?.enabled === true
  if (server.protocol === 's7comm') return server.s7commSlaveConfig?.server.enabled === true
  if (server.protocol === 'opcua') return server.opcuaServerConfig?.server.enabled === true
  return false
}

export function lintProtocols(input: ProtocolLintInput): LintFinding[] {
  const findings: LintFinding[] = []
  const enabled = input.servers.filter(isEnabled)

  // Each generator takes ONE server of its protocol; a second is dropped, and
  // which one survives is decided by array order.
  const byProtocol = new Map<string, PLCServer[]>()
  for (const server of enabled) {
    byProtocol.set(server.protocol, [...(byProtocol.get(server.protocol) ?? []), server])
  }
  for (const [protocol, servers] of byProtocol) {
    if (servers.length < 2) continue
    findings.push({
      severity: 'error',
      pou: null,
      rule: 'duplicate-protocol-server',
      message:
        `${servers.length} enabled "${protocol}" servers (${servers.map((s) => s.name).join(', ')}). ` +
        `The runtime takes one config per protocol, so only "${servers[0].name}" would be used.`,
    })
  }

  // Two servers on one port bind in an order nothing here decides; the loser
  // fails at runtime, not at compile.
  const byPort = new Map<number, PLCServer[]>()
  for (const server of enabled) {
    const port = serverPort(server)
    if (port === undefined) continue
    byPort.set(port, [...(byPort.get(port) ?? []), server])
  }
  for (const [port, servers] of byPort) {
    if (servers.length < 2) continue
    findings.push({
      severity: 'error',
      pou: null,
      rule: 'server-port-conflict',
      message: `${servers.map((s) => `"${s.name}"`).join(' and ')} both listen on port ${port}.`,
    })
  }

  findings.push(...lintRemoteDevices(input.remoteDevices))
  findings.push(...lintOpcUa(input))
  findings.push(...lintEthercat(input.remoteDevices))
  findings.push(...lintAddressCollisions(input.remoteDevices, input.globals))
  return findings
}

/**
 * A global whose address a remote device also got.
 *
 * The allocator builds its pool from the pin mapping, the VPP entries and the
 * remote devices — never from a global's hand-written `location`. So a project
 * that writes `gRunCmd AT %IX0.0` and then adds a Modbus master gets the
 * master's first coil at `%IX0.0` too, and the poll overwrites the input every
 * scan. Both halves compile, save and upload.
 *
 * Only same-class addresses collide: the runtime keeps `bool_input`,
 * `int_input`, `dint_input` and `lint_input` as separate arrays
 * (`core/src/plc_app/image_tables.h`), so `%IX0.0` and `%IW0` are different
 * storage and not a conflict.
 */
function lintAddressCollisions(
  remoteDevices: readonly PLCRemoteDevice[],
  /** As STORED. A global bound by alias carries the alias name here, which
   *  `normalizeAddress` rejects — a deliberate binding is not a collision. */
  globals: readonly PLCVariable[],
): LintFinding[] {
  const byAddress = new Map<string, string>()
  for (const global of globals) {
    const address = normalizeAddress(global.location)
    if (address) byAddress.set(address, global.name)
  }
  if (byAddress.size === 0) return []

  const findings: LintFinding[] = []
  const report = (address: string, claimant: string) => {
    const global = byAddress.get(address)
    if (!global) return
    findings.push({
      severity: 'error',
      pou: null,
      rule: 'located-global-collides-with-remote-io',
      message:
        `Global "${global}" is bound to ${address}, and ${claimant} was allocated the same address. ` +
        'The device overwrites the global every poll — move the global to an address no device claims.',
    })
  }

  for (const device of remoteDevices) {
    for (const group of device.modbusTcpConfig?.ioGroups ?? []) {
      for (const point of group.ioPoints ?? []) {
        const address = normalizeAddress(point.iecLocation)
        if (address) report(address, `"${device.name}.${group.name}"`)
      }
    }
    for (const slave of device.ethercatConfig?.devices ?? []) {
      for (const mapping of slave.channelMappings ?? []) {
        const address = normalizeAddress(mapping.iecLocation)
        if (address) report(address, `EtherCAT slave "${device.name}.${slave.name}"`)
      }
    }
  }

  return findings
}

/** `%IX0.0` → `%IX0.0`; a bitless bit address is bit 0. Anything else is an alias. */
function normalizeAddress(location: string | undefined): string | null {
  const match = /^%([IQM])([XBWDL])(\d+)(?:\.(\d+))?$/i.exec((location ?? '').trim())
  if (!match) return null
  const [, space, width, index, bit] = match
  const upper = `%${space.toUpperCase()}${width.toUpperCase()}${index}`
  return width.toUpperCase() === 'X' ? `${upper}.${bit ?? '0'}` : upper
}

function lintRemoteDevices(remoteDevices: readonly PLCRemoteDevice[]): LintFinding[] {
  const findings: LintFinding[] = []

  for (const device of remoteDevices) {
    if (device.protocol !== 'modbus-tcp') continue
    const config = device.modbusTcpConfig
    if (!config) continue

    if ((config.ioGroups ?? []).length === 0) {
      findings.push({
        severity: 'error',
        pou: null,
        rule: 'modbus-device-without-io-groups',
        message:
          `Remote device "${device.name}" has no I/O groups, so the generator drops it: ` +
          'it uploads cleanly and then polls nothing.',
      })
    }

    if ((config.transport ?? 'tcp') === 'rtu' && !config.serialPort) {
      findings.push({
        severity: 'error',
        pou: null,
        rule: 'modbus-rtu-without-serial-port',
        message: `Remote device "${device.name}" uses RTU with no serial port, so the generator drops it.`,
      })
    }
  }

  // Two Modbus masters on one serial line cannot both drive it.
  const bySerialPort = new Map<string, string[]>()
  for (const device of remoteDevices) {
    const port = device.modbusTcpConfig?.serialPort
    if (!port || (device.modbusTcpConfig?.transport ?? 'tcp') !== 'rtu') continue
    bySerialPort.set(port, [...(bySerialPort.get(port) ?? []), device.name])
  }
  for (const [port, names] of bySerialPort) {
    if (names.length < 2) continue
    findings.push({
      severity: 'warning',
      pou: null,
      rule: 'modbus-rtu-serial-port-shared',
      message: `${names.map((name) => `"${name}"`).join(' and ')} share serial port ${port}.`,
    })
  }

  return findings
}

/**
 * Every enabled OPC-UA server, through the generator's own validator.
 *
 * This is the one rule that needs the debug map: a node naming a variable the
 * program does not have resolves to nothing, and the server serves an address
 * space with a hole in it.
 */
function lintOpcUa(input: ProtocolLintInput): LintFinding[] {
  const findings: LintFinding[] = []

  for (const server of input.servers) {
    const config = server.opcuaServerConfig
    if (!config?.server.enabled) continue

    const result = validateOpcUaConfig(config, input.debugMapContent, input.instances)
    for (const error of result.errors) {
      findings.push({
        severity: 'error',
        pou: null,
        rule: 'opcua-config-invalid',
        message: `OPC-UA server "${server.name}": ${error}`,
      })
    }

    // The shipped default profile is `None`/`None` with Anonymous auth, and it
    // is inert in the editor because a new server starts disabled. A spec that
    // says `enabled: true` without naming a profile inherits it and opens an
    // unauthenticated server on every interface. A warning, not an error: this
    // is a legitimate choice on a closed network, and a rule that fails a
    // correct configuration teaches the reader to stop reading.
    const open = config.securityProfiles.filter(
      (profile) =>
        profile.enabled &&
        profile.securityPolicy === 'None' &&
        profile.securityMode === 'None' &&
        profile.authMethods.includes('Anonymous'),
    )
    if (open.length > 0 && config.securityProfiles.every((profile) => !profile.enabled || open.includes(profile))) {
      findings.push({
        severity: 'warning',
        pou: null,
        rule: 'opcua-server-unauthenticated',
        message:
          `OPC-UA server "${server.name}" is enabled on ${config.server.bindAddress}:${config.server.port} and ` +
          'every enabled security profile is None/None with Anonymous auth, so any client that can reach it can ' +
          'read and write. Add a profile with a policy and an authentication method, or bind it to one interface.',
      })
    }

    // `nodeId` is the IDENTIFIER, which the plugin wraps as `ns=<idx>;s=<id>`
    // (`opcua/address_space.py`). Writing a whole node id here produces
    // `ns=2;s=ns=1;s=Thing`, which browses fine and cannot be read by the id
    // the author wrote.
    for (const node of config.addressSpace.nodes) {
      if (!/^ns=\d+;[isgb]=/i.test(node.nodeId)) continue
      findings.push({
        severity: 'error',
        pou: null,
        rule: 'opcua-node-id-is-an-identifier',
        message:
          `OPC-UA server "${server.name}": node "${node.browseName}" has nodeId "${node.nodeId}". ` +
          'That field is the identifier only — the server adds its own namespace, so this becomes ' +
          `"ns=<n>;s=${node.nodeId}". Use just the identifier (e.g. "${node.pouName}.${node.variablePath}").`,
      })
    }
  }

  return findings
}

function lintEthercat(remoteDevices: readonly PLCRemoteDevice[]): LintFinding[] {
  const findings: LintFinding[] = []

  for (const device of remoteDevices) {
    if (device.protocol !== 'ethercat') continue
    const config = device.ethercatConfig
    if (!config || config.masterConfig?.enabled === false) continue

    if ((config.devices ?? []).length === 0) {
      findings.push({
        severity: 'warning',
        pou: null,
        rule: 'ethercat-master-without-slaves',
        message: `EtherCAT master "${device.name}" has no slaves, so no config is generated for it.`,
      })
      continue
    }

    for (const slave of config.devices) {
      if ((slave.channelMappings ?? []).length > 0) continue
      findings.push({
        severity: 'warning',
        pou: null,
        rule: 'ethercat-slave-without-channels',
        message: `EtherCAT slave "${device.name}.${slave.name}" has no channel mappings, so it exchanges no data.`,
      })
    }
  }

  // The generator's own validator, against the JSON it produces — it takes the
  // generated string, not the project. The cast is the one `generateRuntimeConfs`
  // makes: the generator's shape requires fields the port type leaves optional.
  //
  // Wrapped because the generator dereferences a slave's `config` without a
  // guard: a project missing one takes `check` down with a TypeError instead of
  // reporting anything. A linter that crashes is worse than one that misses.
  try {
    const generated = generateEthercatConfig([...remoteDevices] as Parameters<typeof generateEthercatConfig>[0])
    for (const error of validateEthercatConfig(generated)) {
      findings.push({ severity: 'error', pou: null, rule: 'ethercat-config-invalid', message: error })
    }
  } catch (error) {
    findings.push({
      severity: 'error',
      pou: null,
      rule: 'ethercat-config-invalid',
      message: `The EtherCAT config could not be generated: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  return findings
}
