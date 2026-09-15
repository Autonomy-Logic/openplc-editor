/**
 * Author the `src/opcua_config.h` content for a baremetal arduino-cli target
 * whose VPP declares `opcuaServer: true`.
 *
 * Runtime v4 loads `conf/opcua.json` at start-up; baremetal has no filesystem,
 * so configuration is baked into flash at compile time. The address space is
 * reused rather than re-derived: the caller passes the `ResolvedOpcUaConfig`
 * that `buildOpcUaRuntimeConfig` produced, so both runtimes resolve a variable
 * to the same `(arr, elem)`.
 *
 * Emits `OPCUA_*` scalar defines, `OPCUA_NODES[]` and `OPCUA_USERS[]`.
 * Structures and arrays are flattened into individual leaf nodes so no single
 * OPC-UA value is ever large.
 *
 * Pure function: no fs I/O, no DOM, no global state.
 */

import type { OpcUaTargetProfile } from '@root/middleware/shared/utils/target-capabilities/types'

import type { ResolvedOpcUaConfig, RuntimeStructureField, RuntimeVariablePermissions } from './generate-opcua-config'

/**
 * IEC type name -> `strucpp::debug::TypeTag`.
 *
 * An ABI: the values are the indices of the `TypeTag` enum in
 * `resources/strucpp/runtime/debug_table.hpp`, which `read_entry()` dispatches
 * on. Append only, never reorder, and keep in step with the runtime's
 * `opcua_types.h` and the Python plugin's `opcua_types.py`.
 *
 * The key is the compiler-canonical datatype string from `debug-map.json`
 * (upper-cased), never the project-model datatype.
 */
const TYPE_TAGS: Record<string, number> = {
  BOOL: 0,
  SINT: 1,
  USINT: 2,
  INT: 3,
  UINT: 4,
  DINT: 5,
  UDINT: 6,
  LINT: 7,
  ULINT: 8,
  REAL: 9,
  LREAL: 10,
  BYTE: 11,
  WORD: 12,
  DWORD: 13,
  LWORD: 14,
  TIME: 15,
  DATE: 16,
  TOD: 17,
  DT: 18,
  STRING: 19,
  WSTRING: 20,
}

/** Permission bits, matching `OPCUA_PERM_*` in the runtime's `opcua_types.h`. */
const PERM_READ = 1
const PERM_WRITE = 2

/** Role shift within the packed permission byte: viewer 0-1, operator 2-3,
 *  engineer 4-5. Two bits per role, read in the low bit. */
const ROLE_SHIFT = { viewer: 0, operator: 2, engineer: 4 } as const

export interface GenerateOpcUaHeaderInput {
  /** Resolved config from `buildOpcUaRuntimeConfig`. Pass `null` (or omit) for a
   *  project with no enabled OPC-UA server; the generator then emits a disabled
   *  header so the runtime's unconditional include still resolves. */
  resolved: ResolvedOpcUaConfig | null
  /** The target's OPC-UA profile, already defaulted by
   *  `resolveTargetCapabilities`. */
  profile: OpcUaTargetProfile
  /** Wall-clock base baked into the image, as a Unix timestamp in seconds. A
   *  part with no RTC has only uptime to derive a `DateTime` from, so baking the
   *  build time makes timestamps wrong by the device's downtime rather than by
   *  decades. Injected rather than read from the clock so the generator stays
   *  pure and its output reproducible. */
  buildEpochSeconds: number
}

/** A single emitted leaf, ready to become one `OPCUA_NODES[]` row. */
interface EmittedNode {
  nodeId: number
  browseName: string
  tag: number
  arr: number
  elem: number
  perms: number
}

/** Pack the three per-role r/w/rw strings into one byte. */
const packPermissions = (permissions: RuntimeVariablePermissions): number => {
  let bits = 0
  for (const [role, shift] of Object.entries(ROLE_SHIFT) as [keyof typeof ROLE_SHIFT, number][]) {
    const mode = permissions[role]
    let roleBits = 0
    if (mode.includes('r')) roleBits |= PERM_READ
    if (mode.includes('w')) roleBits |= PERM_WRITE
    bits |= roleBits << shift
  }
  return bits
}

/**
 * Resolve a datatype string to its `TypeTag`.
 *
 * Returns `null` for anything unrecognised, and the caller drops the node rather
 * than substituting a default: a wrong tag would hand the encoder the wrong
 * number of bytes, whereas a dropped node is visible in the build log.
 */
const typeTagFor = (datatype: string | null | undefined): number | null => {
  if (!datatype) return null
  const tag = TYPE_TAGS[datatype.toUpperCase()]
  return tag === undefined ? null : tag
}

/** C string literal — escapes what can legally appear in a browse name. */
const cString = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`

/**
 * Flatten one structure field subtree into leaves. Complex parents (a nested
 * struct or FB instance) carry no address of their own, so they contribute
 * nothing but a browse-name prefix.
 */
const flattenFields = (
  fields: RuntimeStructureField[],
  prefix: string,
  out: EmittedNode[],
  dropped: string[],
  nextId: () => number,
): void => {
  for (const field of fields) {
    const path = `${prefix}.${field.name}`
    if (field.fields && field.fields.length > 0) {
      flattenFields(field.fields, path, out, dropped, nextId)
      continue
    }
    const tag = typeTagFor(field.datatype)
    if (tag === null || field.arr === null || field.elem === null) {
      dropped.push(path)
      continue
    }
    out.push({
      nodeId: nextId(),
      browseName: path,
      tag,
      arr: field.arr,
      elem: field.elem,
      perms: packPermissions(field.permissions),
    })
  }
}

/**
 * Build the leaf table from a resolved address space, and return what it had to
 * drop so the caller can surface it.
 */
export const collectOpcUaNodes = (
  resolved: ResolvedOpcUaConfig,
  profile: OpcUaTargetProfile,
): { nodes: EmittedNode[]; dropped: string[]; overflowed: number } => {
  const nodes: EmittedNode[] = []
  const dropped: string[] = []
  let id = 0
  const nextId = () => ++id

  const space = resolved.runtime.config.address_space

  for (const variable of space.variables) {
    const tag = typeTagFor(variable.datatype)
    if (tag === null) {
      dropped.push(variable.browse_name)
      continue
    }
    nodes.push({
      nodeId: nextId(),
      browseName: variable.browse_name,
      tag,
      arr: variable.arr,
      elem: variable.elem,
      perms: packPermissions(variable.permissions),
    })
  }

  for (const structure of space.structures) {
    flattenFields(structure.fields, structure.browse_name, nodes, dropped, nextId)
  }

  // Array elements become individual leaves at consecutive `elem` offsets.
  // `maxArrayLength` is enforced per array, not against the node budget, so a
  // single oversized array is reported as such.
  for (const array of space.arrays) {
    const length = Math.min(array.length, profile.maxArrayLength)
    const tag = typeTagFor(array.datatype)
    if (tag === null) {
      dropped.push(array.browse_name)
      continue
    }
    if (array.length > profile.maxArrayLength) {
      dropped.push(`${array.browse_name}[${profile.maxArrayLength}..${array.length - 1}] (exceeds maxArrayLength)`)
    }
    const perms = packPermissions(array.permissions)
    for (let index = 0; index < length; index++) {
      nodes.push({
        nodeId: nextId(),
        browseName: `${array.browse_name}[${index}]`,
        tag,
        arr: array.arr,
        elem: array.elem + index,
        perms,
      })
    }
  }

  // Truncate to the declared ceiling rather than emitting a table the arena
  // cannot serve. The caller turns `overflowed` into a build warning; this is
  // the backstop for a project that arrives from elsewhere.
  const overflowed = Math.max(0, nodes.length - profile.maxNodes)
  return { nodes: nodes.slice(0, profile.maxNodes), dropped, overflowed }
}

const SECURITY_LEVELS = { none: 0, sign: 1, 'sign-and-encrypt': 2 } as const

/**
 * Render `opcua_config.h`. Always emits the include guard, `OPCUA_ENABLED` and a
 * trailing `#endif`, so the header is safe to include unconditionally on every
 * target: the OPC-UA translation units compile to nothing when
 * `OPCUA_ENABLED == 0`.
 */
export const generateOpcUaHeaderContent = (input: GenerateOpcUaHeaderInput): string => {
  const { resolved, profile, buildEpochSeconds } = input
  const lines: string[] = []

  lines.push('// opcua_config.h — auto-generated, do not edit by hand.')
  lines.push('//')
  lines.push("// Carries this build's OPC-UA server configuration as C preprocessor")
  lines.push('// #defines plus two flash-resident tables. Generated by the editor from')
  lines.push("// the project's OPC-UA screen and the target's VPP capability block.")
  lines.push('')
  lines.push('#ifndef OPCUA_CONFIG_H')
  lines.push('#define OPCUA_CONFIG_H')
  lines.push('')

  if (!resolved) {
    lines.push('// No enabled OPC-UA server in this project — the server compiles out.')
    lines.push('#define OPCUA_ENABLED 0')
    lines.push('')
    lines.push('#endif // OPCUA_CONFIG_H')
    return `${lines.join('\n')}\n`
  }

  const { nodes } = collectOpcUaNodes(resolved, profile)
  const server = resolved.server
  const users = resolved.runtime.config.users

  lines.push('#define OPCUA_ENABLED 1')
  lines.push('')
  // Self-contained on purpose: the tables below are typed on opcua_node_t /
  // opcua_user_t and this header is pulled in by several TUs in whatever order
  // they include it, so it must not depend on the includer declaring them first.
  lines.push('#include "opcua_types.h"')
  lines.push('')
  lines.push('// ---- Server identity ----')
  lines.push(`#define OPCUA_SERVER_NAME ${cString(server.name)}`)
  lines.push(`#define OPCUA_APPLICATION_URI ${cString(server.applicationUri)}`)
  lines.push(`#define OPCUA_PRODUCT_URI ${cString(server.productUri)}`)
  lines.push(`#define OPCUA_BIND_ADDRESS ${cString(server.bindAddress)}`)
  lines.push(`#define OPCUA_PORT ${server.port}`)
  lines.push(`#define OPCUA_ENDPOINT_PATH ${cString(server.endpointPath)}`)
  lines.push(`#define OPCUA_NAMESPACE_URI ${cString(resolved.runtime.config.address_space.namespace_uri)}`)
  // How often the server must be serviced, from the project's OPC-UA screen.
  // The same `cycleTimeMs` Runtime v4 uses as its subscription push cycle. A
  // guarantee, not a cap: opcuatask() also runs whenever the scan has slack.
  lines.push(`#define OPCUA_SYNC_INTERVAL_MS ${resolved.runtime.config.cycle_time_ms}u`)
  lines.push('')
  lines.push('// ---- Declared by the VPP: memory and protocol limits ----')
  lines.push(`#define OPCUA_ARENA_SIZE ${profile.arenaBytes}u`)
  lines.push(`#define OPCUA_MAX_NODES ${profile.maxNodes}`)
  lines.push(`#define OPCUA_MAX_SESSIONS ${profile.maxSessions}`)
  lines.push(`#define OPCUA_NODE_POOL_SLOTS ${profile.nodePoolSlots}`)
  lines.push(`#define OPCUA_MAX_NODES_PER_READ ${profile.maxNodesPerRead}`)
  lines.push(`#define OPCUA_MAX_NODES_PER_WRITE ${profile.maxNodesPerWrite}`)
  lines.push(`#define OPCUA_MAX_NODES_PER_BROWSE ${profile.maxNodesPerBrowse}`)
  lines.push(`#define OPCUA_MAX_REFERENCES_PER_NODE ${profile.maxReferencesPerNode}`)
  lines.push(`#define OPCUA_MAX_ARRAY_LENGTH ${profile.maxArrayLength}`)
  lines.push('')
  lines.push('// ---- Declared by the VPP: what the silicon can sustain ----')
  lines.push(`#define OPCUA_SECURITY ${SECURITY_LEVELS[profile.security]} // 0=None 1=Sign 2=SignAndEncrypt`)
  lines.push(`#define OPCUA_CERTIFICATES ${profile.certificates ? 1 : 0}`)
  lines.push(`#define OPCUA_SUBSCRIPTIONS ${profile.subscriptions ? 1 : 0}`)
  lines.push(`#define OPCUA_KDF_ITERATIONS ${profile.kdfIterations}u`)
  lines.push(`#define OPCUA_HAS_HW_SHA256 ${profile.hw.sha256 ? 1 : 0}`)
  lines.push(`#define OPCUA_HAS_HW_AES ${profile.hw.aes ? 1 : 0}`)
  lines.push(`#define OPCUA_HAS_HW_PK ${profile.hw.pk ? 1 : 0}`)
  lines.push(`#define OPCUA_HAS_TRNG ${profile.hw.trng ? 1 : 0}`)
  lines.push(`#define OPCUA_HAS_RTC ${profile.hw.rtc ? 1 : 0}`)
  lines.push('')
  lines.push('// Wall-clock base for DateTime stamps on a part with no RTC.')
  lines.push(`#define OPCUA_BUILD_EPOCH ${buildEpochSeconds}u`)
  lines.push('')

  lines.push('// ---- Address space ----')
  lines.push('// One row per addressable leaf. `arr` / `elem` index the strucpp debug')
  lines.push('// table, so a read is a direct handle_read(arr, elem) with no mirroring.')
  lines.push(`#define OPCUA_NODE_COUNT ${nodes.length}`)
  if (nodes.length === 0) {
    lines.push('static const opcua_node_t OPCUA_NODES[1] = { { 0, "", 0, 0, 0, 0 } }; // unused')
  } else {
    lines.push(`static const opcua_node_t OPCUA_NODES[${nodes.length}] = {`)
    for (const node of nodes) {
      lines.push(
        `    { ${node.nodeId}, ${cString(node.browseName)}, ${node.tag}, ` +
          `${node.arr}, ${node.elem}, 0x${node.perms.toString(16).padStart(2, '0')} },`,
      )
    }
    lines.push('};')
  }
  lines.push('')

  lines.push('// ---- Users ----')
  const passwordUsers = users.filter((user) => user.type === 'password' && user.username && user.password_hash)
  lines.push(`#define OPCUA_USER_COUNT ${passwordUsers.length}`)
  if (passwordUsers.length === 0) {
    lines.push('static const opcua_user_t OPCUA_USERS[1] = { { "", "", 0 } }; // unused')
  } else {
    lines.push(`static const opcua_user_t OPCUA_USERS[${passwordUsers.length}] = {`)
    for (const user of passwordUsers) {
      const role = user.role === 'engineer' ? 2 : user.role === 'operator' ? 1 : 0
      lines.push(`    { ${cString(user.username as string)}, ${cString(user.password_hash as string)}, ${role} },`)
    }
    lines.push('};')
  }
  lines.push('')
  lines.push('#endif // OPCUA_CONFIG_H')

  return `${lines.join('\n')}\n`
}
