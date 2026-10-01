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
  /** Build-log sink for leaves that could not be exposed. Optional so the
   *  generator stays callable from a test with no plumbing, but the compile
   *  pipeline always passes one: a dropped variable is silent otherwise, and
   *  "my variable is missing in UaExpert" is the symptom that reaches us. */
  warn?: (message: string) => void
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
 * Tags the firmware has no OPC-UA mapping for.
 *
 * `kTagToUaType[]` in `opcua_nodes.cpp` is indexed by tag, and every index into
 * it is guarded by `tag >= kTagCount`. So an unmapped tag is not a memory
 * hazard -- it is worse than that in practice: the row ships to flash,
 * `opcua_nodes_materialise` skips it, and the node is simply absent from the
 * address space with nothing said. Refusing it here makes it a build warning
 * naming the variable instead.
 *
 * Empty today: STRING and WSTRING were the only entries, and the runtime now
 * serves both (STRING as a UA String, WSTRING as a UA ByteString of UTF-16LE
 * code units). Kept, rather than deleted, because it is the seam that keeps
 * `TYPE_TAGS` and `kTagToUaType[]` honest -- a tag added on this side before
 * the firmware side is a warning, not a vanished variable.
 */
const UNEXPOSABLE_TAGS = new Map<number, string>()

/** Why a leaf did not make it into the table. */
export interface DroppedNode {
  path: string
  reason: string
}

/**
 * Resolve a datatype string to a `TypeTag`, or say why it cannot be exposed.
 *
 * Never substitutes a default: a wrong tag would hand the encoder the wrong
 * number of bytes, whereas a dropped node is visible in the build log.
 */
const resolveTag = (datatype: string | null | undefined): { tag: number } | { reason: string } => {
  if (!datatype) return { reason: 'has no declared datatype' }
  const tag = TYPE_TAGS[datatype.toUpperCase()]
  if (tag === undefined) return { reason: `has an unrecognised datatype "${datatype}"` }
  const unexposable = UNEXPOSABLE_TAGS.get(tag)
  if (unexposable !== undefined)
    return { reason: `is a ${unexposable}, which the runtime cannot serve over OPC-UA yet (DOPE-645)` }
  return { tag }
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
  dropped: DroppedNode[],
  nextId: () => number,
): void => {
  for (const field of fields) {
    const path = `${prefix}.${field.name}`
    if (field.fields && field.fields.length > 0) {
      flattenFields(field.fields, path, out, dropped, nextId)
      continue
    }
    const resolved = resolveTag(field.datatype)
    if ('reason' in resolved) {
      dropped.push({ path, reason: resolved.reason })
      continue
    }
    if (field.arr === null || field.elem === null) {
      dropped.push({ path, reason: 'has no address in the debug table' })
      continue
    }
    out.push({
      nodeId: nextId(),
      browseName: path,
      tag: resolved.tag,
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
): { nodes: EmittedNode[]; dropped: DroppedNode[] } => {
  const nodes: EmittedNode[] = []
  const dropped: DroppedNode[] = []
  let id = 0
  const nextId = () => ++id

  const space = resolved.runtime.config.address_space

  for (const variable of space.variables) {
    const resolvedTag = resolveTag(variable.datatype)
    if ('reason' in resolvedTag) {
      dropped.push({ path: variable.browse_name, reason: resolvedTag.reason })
      continue
    }
    nodes.push({
      nodeId: nextId(),
      browseName: variable.browse_name,
      tag: resolvedTag.tag,
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
    const resolvedTag = resolveTag(array.datatype)
    if ('reason' in resolvedTag) {
      dropped.push({ path: array.browse_name, reason: resolvedTag.reason })
      continue
    }
    if (array.length > profile.maxArrayLength) {
      dropped.push({
        path: `${array.browse_name}[${profile.maxArrayLength}..${array.length - 1}]`,
        reason: `exceeds the target's maxArrayLength of ${profile.maxArrayLength}`,
      })
    }
    const perms = packPermissions(array.permissions)
    for (let index = 0; index < length; index++) {
      nodes.push({
        nodeId: nextId(),
        browseName: `${array.browse_name}[${index}]`,
        tag: resolvedTag.tag,
        arr: array.arr,
        elem: array.elem + index,
        perms,
      })
    }
  }

  // No ceiling on the table size. The nodes live in `const` flash tables, and
  // what costs RAM is how many are materialised at once -- bounded by
  // `nodePoolSlots` and the per-request operation limits, both of which the
  // device enforces on its own. The `maxNodes` cap truncated the table silently
  // from the caller's point of view (`overflowed` had no production consumer),
  // so a project that grew past it lost its tail of variables with no diagnostic
  // and nothing on the device ever read `OPCUA_MAX_NODES`.
  return { nodes, dropped }
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
  const warn = input.warn ?? (() => undefined)
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

  const { nodes, dropped } = collectOpcUaNodes(resolved, profile)
  for (const drop of dropped) warn(`OPC-UA: ${drop.path} ${drop.reason}; it was left out of the address space.`)
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
  // OPCUA_KDF_ITERATIONS is deliberately NOT emitted. `profile.kdfIterations`
  // is a BUILD-side number — it says how many rounds `deriveOpcUaCredential`
  // should spend when it derives the hash that goes into OPCUA_USERS[]. The
  // count then travels inside the hash string itself
  // (`pbkdf2:sha256:<iterations>$salt$hash`), which is what both verifiers read:
  // `opcua_auth.cpp` parses it out of the stored string, and Runtime v4's
  // `user_manager.py` does the same. Nothing ever read the define, and emitting
  // it invited the reading that it configures the device — it does not, and it
  // disagreed with the firmware's own OPCUA_KDF_MAX_ITERATIONS ceiling.
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

  // A password user that carries no credential is DROPPED here, and dropping
  // the last one flips `anonymousRole` to engineer below. That has to be loud:
  // silently trading every credential on the server for anonymous write access
  // is the opposite of what the person who configured those users asked for.
  for (const user of users) {
    if (user.type === 'password' && !user.password_hash) {
      warn?.(
        `OPC-UA user "${user.username || '(unnamed)'}" has no password and is NOT being exposed on ` +
          `the device. Set a password for it, or remove it.`,
      )
    }
  }
  // Whether anonymous is allowed, and the role an anonymous session carries,
  // are both the PROJECT's answer — carried on the security profile that offers
  // Anonymous, and until now neither reached the firmware. `opcua_auth.cpp`
  // inferred allowance from `OPCUA_USER_COUNT == 0` and the role was escalated
  // to engineer whenever no password user survived, silently trading every
  // credential for full anonymous write the moment one went missing. The
  // profile now says both: the explicit `anonymous_role` (default viewer, least
  // privilege) exactly as Runtime v4 does — `generate-opcua-config.ts` emits
  // `anonymous_role` and `user_manager.py` enforces it — while `opcua_auth.cpp`
  // enforces OPCUA_ANONYMOUS_ROLE per session on baremetal.
  const ROLE_TO_INDEX: Record<string, number> = { viewer: 0, operator: 1, engineer: 2 }
  const anonymousProfile = (resolved.runtime.config.server.security_profiles ?? []).find(
    (sp) => sp.enabled !== false && (sp.auth_methods ?? []).includes('Anonymous'),
  )
  const allowAnonymous = anonymousProfile !== undefined
  const anonymousRole = ROLE_TO_INDEX[anonymousProfile?.anonymous_role ?? 'viewer'] ?? 0

  lines.push(`#define OPCUA_ALLOW_ANONYMOUS ${allowAnonymous ? 1 : 0}`)
  lines.push(`#define OPCUA_ANONYMOUS_ROLE ${anonymousRole} // 0=viewer 1=operator 2=engineer`)
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
