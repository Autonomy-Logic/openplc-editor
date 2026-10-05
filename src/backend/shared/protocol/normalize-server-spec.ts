/**
 * Author-shaped server spec → the `PLCServer` the project stores.
 *
 * Two stages on purpose. The spec is validated for typos by the CLI's own
 * `.strict()` schema before it gets here; this merges onto the same defaults
 * `createServer` seeds and then validates the RESULT against `PLCServerSchema`,
 * which is what the project loader will later have to accept. Validating only
 * the spec would let a config that parses as a spec fail to load as a project.
 */

import { isLegalIdentifier } from '../../../frontend/utils/keywords'
import {
  DEFAULT_MODBUS_SLAVE_CONFIG,
  DEFAULT_OPCUA_SERVER_CONFIG,
  DEFAULT_S7COMM_LOGGING,
  DEFAULT_S7COMM_PLC_IDENTITY,
  DEFAULT_S7COMM_SERVER_SETTINGS,
} from '../../../frontend/utils/protocol/server-defaults'
import type { OpcUaServerConfig, PLCServer, S7CommSlaveConfig } from '../types/PLC/open-plc'
import { PLCServerSchema } from '../types/PLC/open-plc'
import { mergeOverrides } from './merge'
import type { NormalizeResult, SpecServer } from './types'

const SERVER_PROTOCOLS = new Set(['modbus-tcp', 's7comm', 'opcua'])

/** The config key each protocol reads, so a spec naming the wrong one is caught. */
const CONFIG_KEY: Record<string, 'modbus' | 's7comm' | 'opcua'> = {
  'modbus-tcp': 'modbus',
  s7comm: 's7comm',
  opcua: 'opcua',
}

export function normalizeServerSpec(spec: SpecServer): NormalizeResult<PLCServer> {
  const errors: string[] = []
  const where = `server "${spec.name}"`

  if (!spec.name || spec.name.trim().length === 0) {
    return { ok: false, errors: ['A server needs a name.'] }
  }
  // The name becomes `devices/servers/<name>.json` and, for OPC-UA, part of
  // generated identifiers — so the identifier rule, not just "no slashes".
  const [legal, why] = isLegalIdentifier(spec.name)
  if (!legal) {
    errors.push(`${where}: "${spec.name}" is not a legal name — it ${why}.`)
  }

  if (!SERVER_PROTOCOLS.has(spec.protocol)) {
    errors.push(
      `${where}: protocol "${spec.protocol}" is not one the editor can configure. ` +
        `Use one of: ${[...SERVER_PROTOCOLS].join(', ')}.`,
    )
    return { ok: false, errors }
  }

  // A config block for a protocol this server is not is always a mistake, and
  // silently ignoring it means the author never learns the setting did nothing.
  const mine = CONFIG_KEY[spec.protocol]
  for (const key of ['modbus', 's7comm', 'opcua'] as const) {
    if (key !== mine && spec[key] !== undefined) {
      errors.push(`${where}: has a "${key}" block but its protocol is "${spec.protocol}" — that block is ignored.`)
    }
  }

  // The editor refuses `DB<n> already exists`; two blocks on one number would
  // otherwise reach the runtime and only one of them would answer.
  if (spec.protocol === 's7comm') {
    const seen = new Set<number>()
    for (const block of spec.s7comm?.dataBlocks ?? []) {
      if (seen.has(block.dbNumber)) {
        errors.push(`${where}: DB${block.dbNumber} is declared more than once.`)
      }
      seen.add(block.dbNumber)
    }
  }

  const enabled = spec.enabled ?? false
  const server = buildServer(spec, enabled)

  const parsed = PLCServerSchema.safeParse(server)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${where}: ${issue.path.join('.') || '(root)'} — ${issue.message}`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: parsed.success ? parsed.data : server }
}

function buildServer(spec: SpecServer, enabled: boolean): PLCServer {
  if (spec.protocol === 'modbus-tcp') {
    return {
      name: spec.name,
      protocol: 'modbus-tcp',
      modbusSlaveConfig: {
        ...mergeOverrides({ ...DEFAULT_MODBUS_SLAVE_CONFIG }, spec.modbus),
        enabled,
      },
    }
  }

  if (spec.protocol === 's7comm') {
    const base: S7CommSlaveConfig = {
      server: { ...DEFAULT_S7COMM_SERVER_SETTINGS },
      plcIdentity: { ...DEFAULT_S7COMM_PLC_IDENTITY },
      dataBlocks: [],
      logging: { ...DEFAULT_S7COMM_LOGGING },
    }
    const merged = mergeOverrides(base, spec.s7comm)
    return {
      name: spec.name,
      protocol: 's7comm',
      // The plugin reads this key itself (unlike Modbus, whose config file is
      // the switch), so a disabled S7comm server still ships a config.
      s7commSlaveConfig: { ...merged, server: { ...merged.server, enabled } },
    }
  }

  const base: OpcUaServerConfig = structuredClone(DEFAULT_OPCUA_SERVER_CONFIG)
  const merged = mergeOverrides(base, withDerivedOpcUaIds(spec))
  return {
    name: spec.name,
    protocol: 'opcua',
    opcuaServerConfig: { ...merged, server: { ...merged.server, enabled } },
  }
}

/**
 * Fill in the ids the GUI generates with uuids.
 *
 * A uuid would make every `describe → apply → describe` differ, so each id is
 * derived from something the author already wrote. They are opaque to the
 * runtime — `generate-opcua-config` keys on `nodeId`, not on these.
 */
function withDerivedOpcUaIds(spec: SpecServer): SpecServer['opcua'] {
  const opcua = spec.opcua
  if (!opcua) return opcua

  return {
    ...opcua,
    ...(opcua.securityProfiles
      ? { securityProfiles: opcua.securityProfiles.map((p) => ({ ...p, id: p.id ?? `profile-${p.name}` })) }
      : {}),
    ...(opcua.users
      ? {
          users: opcua.users.map((u) => ({
            ...u,
            id: u.id ?? `user-${u.username ?? 'anonymous'}`,
            // The stored shape requires the field. A redacted spec leaves it
            // out; `apply` puts the real value back before saving.
            passwordHash: u.passwordHash ?? null,
          })),
        }
      : {}),
    ...(opcua.addressSpace?.nodes
      ? {
          addressSpace: {
            ...opcua.addressSpace,
            nodes: opcua.addressSpace.nodes.map((n) => ({ ...n, id: n.id ?? `${n.pouName}.${n.variablePath}` })),
          },
        }
      : {}),
  }
}
