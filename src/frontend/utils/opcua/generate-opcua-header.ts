/**
 * Author the `src/opcua_config.h` content for a baremetal arduino-cli target
 * whose VPP declares `opcuaServer: true`.
 *
 * Runtime v4 gets its OPC-UA configuration as `conf/opcua.json`, loaded at
 * start-up. Baremetal has no filesystem, so every byte of configuration has
 * to be baked into flash at compile time — exactly as `vpp_config.h` and
 * `defines.h` already are. This module is that contract.
 *
 * The address space is reused, not re-derived: the caller passes the
 * `ResolvedOpcUaConfig` that `buildOpcUaRuntimeConfig` already produced, so a
 * baremetal target and a v4 target resolve `%I` / `%Q` / `%M`, nested struct
 * fields and array bases through the same code against the same
 * `debug-map.json`. That matters beyond tidiness — two resolvers would be two
 * chances to disagree about which `(arr, elem)` a variable lives at, and the
 * symptom would be a device serving the wrong value for the right name.
 *
 * Shape:
 *
 *   - `OPCUA_*` scalar defines for the server identity and every dimension
 *     the VPP declared (arena, session and operation limits, security level,
 *     hardware facts).
 *   - `OPCUA_NODES[]` — one `const` record per leaf, carrying the `(arr, elem)`
 *     pair the runtime feeds to `strucpp::debug::handle_read` / `handle_write`,
 *     the `TypeTag` for dispatch, and a packed permission bitmap.
 *   - `OPCUA_USERS[]` — username + PBKDF2 hash + role, for the chunked KDF.
 *
 * Structures and arrays are FLATTENED into individual leaf nodes here rather
 * than being emitted as composite types. That is not a simplification, it is
 * the design: a struct exposed as a folder of child nodes means no single
 * OPC-UA value is ever large, so a client reading a whole struct issues a Read
 * of N nodes which `maxNodesPerRead` already chunks — no `ExtensionObject`
 * encoder and no multi-kilobyte `UA_Variant` on a part with tens of KB to
 * spare. Array elements are flattened for the same reason.
 *
 * Pure function: no fs I/O, no DOM, no global state. Caller writes the
 * returned string to `src/opcua_config.h` in the firmware bundle. Mirrors the
 * style of `generate-vpp-config.ts`.
 */

import type { OpcUaTargetProfile } from '@root/middleware/shared/utils/target-capabilities/types'

import type { ResolvedOpcUaConfig, RuntimeStructureField, RuntimeVariablePermissions } from './generate-opcua-config'

/**
 * IEC type name → `strucpp::debug::TypeTag`.
 *
 * This table is an ABI, not a convenience: the values are the indices of the
 * `TypeTag` enum in `resources/strucpp/runtime/debug_table.hpp`, which is what
 * `read_entry()` dispatches on. Append only, never reorder — and keep it in
 * step with the runtime's `opcua_types.h` mirror and with the Python plugin's
 * `opcua_types.py`, so both runtimes agree about what a `TIME` is.
 *
 * The key is the compiler-canonical datatype string from `debug-map.json`
 * (upper-cased), never the project-model datatype, which can drift.
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
  /** Resolved config from `buildOpcUaRuntimeConfig`. Pass `null` (or omit)
   *  for a project with no enabled OPC-UA server — the generator then emits a
   *  disabled header rather than nothing, so the runtime's unconditional
   *  `#include "opcua_config.h"` still resolves. */
  resolved: ResolvedOpcUaConfig | null
  /** The target's OPC-UA profile, already defaulted by
   *  `resolveTargetCapabilities`. */
  profile: OpcUaTargetProfile
  /** Wall-clock base baked into the image, as a Unix timestamp in seconds.
   *
   *  OPC-UA stamps every value with a `DateTime`, and a part with no RTC has
   *  nothing to derive one from but uptime. Baking the build time gives
   *  timestamps that are wrong by the device's downtime rather than wrong by
   *  24 years, which is the difference between a client showing a stale date
   *  and a client rejecting the response. Injected rather than read from the
   *  clock here so the generator stays pure and its output reproducible. */
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
 * Returns `null` for anything unrecognised, and the caller DROPS the node
 * rather than substituting a default. A wrong tag is worse than a missing
 * node: `read_entry` would hand the wrong number of bytes to the encoder and
 * the client would receive plausible garbage, whereas a dropped node is
 * visible in the build log and in the client's browse tree.
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
 * Flatten one structure field subtree into leaves.
 *
 * Complex parents (a nested struct or FB instance) carry no address of their
 * own — `arr` / `elem` are null and only their children are addressable — so
 * they contribute nothing but a browse-name prefix.
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
 * Build the leaf table from a resolved address space.
 *
 * Also returns what it had to drop, so the caller can surface it: silently
 * shipping a smaller address space than the user configured is the kind of
 * thing that gets discovered by a SCADA integrator, not by us.
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
  // single oversized array is reported as such instead of appearing as a
  // mysterious node-count overflow.
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
  // cannot serve. The caller turns `overflowed` into a build warning; the
  // editor's Address Space tab is where this should be prevented, and this is
  // the backstop for a project that arrives from elsewhere.
  const overflowed = Math.max(0, nodes.length - profile.maxNodes)
  return { nodes: nodes.slice(0, profile.maxNodes), dropped, overflowed }
}

const SECURITY_LEVELS = { none: 0, sign: 1, 'sign-and-encrypt': 2 } as const

/**
 * Render `opcua_config.h`.
 *
 * Always emits the include guard, `OPCUA_ENABLED`, and a trailing `#endif`, so
 * the header is safe to `#include` unconditionally on every target — the
 * runtime's OPC-UA translation units compile to nothing when
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
  // opcua_user_t, and this header is pulled in by several TUs in whatever
  // order they happen to include it. Relying on the includer to have declared
  // the records first is the sort of ordering dependency that compiles for
  // months and then breaks when someone adds an include.
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
  // How often the server MUST be serviced, from the project's OPC-UA screen.
  //
  // This is the same `cycleTimeMs` Runtime v4 uses as its subscription push
  // cycle. The baremetal server has no subscriptions, so it means the plainer
  // thing here: the longest the server may go unserviced. It is a GUARANTEE,
  // not a cap -- opcuatask() also runs opportunistically whenever the scan
  // cycle has slack, exactly as Modbus does.
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
