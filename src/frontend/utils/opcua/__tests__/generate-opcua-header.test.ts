import { collectOpcUaNodes, generateOpcUaHeaderContent } from '../generate-opcua-header'

import type { OpcUaTargetProfile } from '@root/middleware/shared/utils/target-capabilities/types'

import type { ResolvedOpcUaConfig } from '../generate-opcua-config'

const PROFILE: OpcUaTargetProfile = {
  arenaBytes: 32768,
  maxSessions: 1,
  nodePoolSlots: 8,
  maxNodesPerRead: 20,
  maxNodesPerWrite: 20,
  maxNodesPerBrowse: 10,
  maxReferencesPerNode: 32,
  maxArrayLength: 4,
  security: 'none',
  certificates: false,
  subscriptions: false,
  kdfIterations: 100_000,
  passwordScheme: 'pbkdf2-sha256',
  hw: { sha256: false, aes: false, pk: false, trng: false, rtc: false },
}

const RW = { viewer: 'r', operator: 'rw', engineer: 'rw' } as const
const RO = { viewer: 'r', operator: 'r', engineer: 'r' } as const

const makeResolved = (space: Partial<ResolvedOpcUaConfig['runtime']['config']['address_space']>) =>
  ({
    server: {
      enabled: true,
      name: 'LOGO! 8.2',
      applicationUri: 'urn:openplc:logo8',
      productUri: 'urn:openplc:product',
      bindAddress: '0.0.0.0',
      port: 4840,
      endpointPath: '/openplc/opcua',
    },
    runtime: {
      name: 'opcua_server',
      protocol: 'OPC-UA',
      config: {
        format_version: 2,
        server: {} as never,
        security: {} as never,
        users: [],
        cycle_time_ms: 100,
        address_space: { namespace_uri: 'urn:openplc:ns', variables: [], structures: [], arrays: [], ...space },
      },
    },
  }) as unknown as ResolvedOpcUaConfig

describe('generateOpcUaHeaderContent', () => {
  it('emits a disabled header when the project has no OPC-UA server', () => {
    const header = generateOpcUaHeaderContent({ resolved: null, profile: PROFILE, buildEpochSeconds: 1_780_000_000 })

    // Disabled, but still a complete guarded header: the runtime includes it
    // unconditionally, so "no server" must still compile.
    expect(header).toContain('#define OPCUA_ENABLED 0')
    expect(header).toContain('#ifndef OPCUA_CONFIG_H')
    expect(header.trimEnd().endsWith('#endif // OPCUA_CONFIG_H')).toBe(true)
    expect(header).not.toContain('OPCUA_NODES')
  })

  it('emits server identity, VPP limits and hardware facts', () => {
    const header = generateOpcUaHeaderContent({
      resolved: makeResolved({}),
      profile: PROFILE,
      buildEpochSeconds: 1_780_000_000,
    })

    expect(header).toContain('#define OPCUA_ENABLED 1')
    // Self-contained: the node/user tables are typed on records from
    // opcua_types.h, so the header must not depend on its includer having
    // pulled that in first.
    expect(header).toContain('#include "opcua_types.h"')
    expect(header).toContain('#define OPCUA_PORT 4840')
    expect(header).toContain('#define OPCUA_SERVER_NAME "LOGO! 8.2"')
    expect(header).toContain('#define OPCUA_ENDPOINT_PATH "/openplc/opcua"')
    expect(header).toContain('#define OPCUA_ARENA_SIZE 32768u')
    expect(header).toContain('#define OPCUA_MAX_SESSIONS 1')
    expect(header).toContain('#define OPCUA_MAX_NODES_PER_READ 20')
    expect(header).toContain('#define OPCUA_SECURITY 0')
    expect(header).toContain('#define OPCUA_HAS_TRNG 0')
    expect(header).toContain('#define OPCUA_BUILD_EPOCH 1780000000u')
  })

  it('emits one node row per scalar with its (arr, elem) and packed permissions', () => {
    const header = generateOpcUaHeaderContent({
      resolved: makeResolved({
        variables: [
          { browse_name: 'Led', datatype: 'BOOL', arr: 0, elem: 21, permissions: RW } as never,
          { browse_name: 'Counter', datatype: 'DINT', arr: 1, elem: 7, permissions: RO } as never,
        ],
      }),
      profile: PROFILE,
      buildEpochSeconds: 0,
    })

    expect(header).toContain('#define OPCUA_NODE_COUNT 2')
    // BOOL -> TypeTag 0, DINT -> 5.
    // Permission byte is engineer:operator:viewer from the high bits down,
    // two bits each, read in the low bit of the pair. So r / rw / rw is
    // 0b11_11_01 = 0x3d, and r / r / r is 0b01_01_01 = 0x15.
    expect(header).toContain('{ 1, "Led", 0, 0, 21, 0x3d },')
    expect(header).toContain('{ 2, "Counter", 5, 1, 7, 0x15 },')
  })

  it('flattens nested struct fields into leaves and skips addressless parents', () => {
    const { nodes, dropped } = collectOpcUaNodes(
      makeResolved({
        structures: [
          {
            browse_name: 'Sensor',
            fields: [
              { name: 'id', datatype: 'INT', arr: 0, elem: 3, permissions: RW },
              // Complex parent: no address of its own, only its children are addressable.
              {
                name: 'inner',
                datatype: 'MyFB',
                arr: null,
                elem: null,
                permissions: RW,
                fields: [{ name: 'value', datatype: 'REAL', arr: 0, elem: 4, permissions: RW }],
              },
            ],
          } as never,
        ],
      }),
      PROFILE,
    )

    expect(nodes.map((n) => n.browseName)).toEqual(['Sensor.id', 'Sensor.inner.value'])
    expect(nodes[1]).toMatchObject({ tag: 9, arr: 0, elem: 4 }) // REAL
    expect(dropped).toEqual([])
  })

  it('expands arrays element-wise at consecutive elem offsets', () => {
    const { nodes } = collectOpcUaNodes(
      makeResolved({
        arrays: [{ browse_name: 'buf', datatype: 'INT', length: 3, arr: 2, elem: 10, permissions: RW } as never],
      }),
      PROFILE,
    )

    expect(nodes.map((n) => [n.browseName, n.elem])).toEqual([
      ['buf[0]', 10],
      ['buf[1]', 11],
      ['buf[2]', 12],
    ])
  })

  it('truncates an array at maxArrayLength and reports the remainder as dropped', () => {
    // maxArrayLength is 4 in PROFILE; the array asks for 6.
    const { nodes, dropped } = collectOpcUaNodes(
      makeResolved({
        arrays: [{ browse_name: 'big', datatype: 'INT', length: 6, arr: 0, elem: 0, permissions: RW } as never],
      }),
      PROFILE,
    )

    expect(nodes).toHaveLength(4)
    expect(dropped).toEqual([{ path: 'big[4..5]', reason: "exceeds the target's maxArrayLength of 4" }])
  })

  it('drops a node with an unrecognised datatype rather than guessing a tag', () => {
    // A wrong tag would hand the encoder the wrong byte width and the client
    // would receive plausible garbage; a dropped node is visible instead.
    const { nodes, dropped } = collectOpcUaNodes(
      makeResolved({
        variables: [{ browse_name: 'weird', datatype: 'NOT_A_TYPE', arr: 0, elem: 0, permissions: RW } as never],
      }),
      PROFILE,
    )

    expect(nodes).toEqual([])
    expect(dropped).toEqual([{ path: 'weird', reason: 'has an unrecognised datatype "NOT_A_TYPE"' }])
  })

  it('emits STRING and WSTRING, which the runtime now serves', () => {
    // STRING maps to UA_TYPES_STRING and WSTRING to UA_TYPES_BYTESTRING in
    // kTagToUaType[]; read_node serves both in place through handle_ptr.
    const { nodes, dropped } = collectOpcUaNodes(
      makeResolved({
        variables: [
          { browse_name: 'msg', datatype: 'STRING', arr: 0, elem: 0, permissions: RW },
          { browse_name: 'wmsg', datatype: 'WSTRING', arr: 0, elem: 1, permissions: RW },
        ] as never[],
      }),
      PROFILE,
    )

    expect(dropped).toEqual([])
    expect(nodes.map((n) => [n.browseName, n.tag])).toEqual([
      ['msg', 19],
      ['wmsg', 20],
    ])
  })

  it('reports every dropped leaf through the warn sink', () => {
    const warnings: string[] = []
    generateOpcUaHeaderContent({
      resolved: makeResolved({
        variables: [{ browse_name: 'msg', datatype: 'NOT_A_TYPE', arr: 0, elem: 0, permissions: RW }] as never[],
      }),
      profile: PROFILE,
      buildEpochSeconds: 0,
      warn: (message) => warnings.push(message),
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('msg')
    expect(warnings[0]).toContain('left out of the address space')
  })

  it('emits every node, with no ceiling on the table size', () => {
    // The old `maxNodes` cap silently truncated the tail: `overflowed` was
    // returned but no production caller read it, and nothing on the device read
    // `OPCUA_MAX_NODES` either. Flash tables cost no RAM until materialised.
    const many = Array.from({ length: 700 }, (_, i) => ({
      browse_name: `v${i}`,
      datatype: 'BOOL',
      arr: 0,
      elem: i,
      permissions: RW,
    })) as never[]

    const { nodes, dropped } = collectOpcUaNodes(makeResolved({ variables: many }), PROFILE)

    expect(nodes).toHaveLength(700)
    expect(dropped).toEqual([])

    const header = generateOpcUaHeaderContent({
      resolved: makeResolved({ variables: many }),
      profile: PROFILE,
      buildEpochSeconds: 0,
    })
    expect(header).toContain('#define OPCUA_NODE_COUNT 700')
    expect(header).not.toContain('#define OPCUA_MAX_NODES ')
  })

  it('emits only password users, with their role index', () => {
    const resolved = makeResolved({})
    resolved.runtime.config.users = [
      {
        type: 'password',
        username: 'eng',
        password_hash: 'pbkdf2:sha256:100000$s$h',
        certificate_id: null,
        role: 'engineer',
      },
      // Certificate users have no hash for the KDF path — excluded.
      { type: 'certificate', username: null, password_hash: null, certificate_id: 'c1', role: 'viewer' },
    ] as never
    const header = generateOpcUaHeaderContent({ resolved, profile: PROFILE, buildEpochSeconds: 0 })

    expect(header).toContain('#define OPCUA_USER_COUNT 1')
    expect(header).toContain('{ "eng", "pbkdf2:sha256:100000$s$h", 2 },')
  })
})

// makeResolved seeds users:[] and no security_profiles; these tests set both
// through the same `runtime.config` path the generator reads.
const withUsersAndProfiles = (
  users: Array<{ type: string; username?: string; password_hash?: string | null; role?: string }>,
  authMethods: string[],
  anonymousRole?: string,
): ResolvedOpcUaConfig => {
  const r = makeResolved({})
  ;(r as unknown as { runtime: { config: { users: unknown } } }).runtime.config.users = users
  ;(r as unknown as { runtime: { config: { server: { security_profiles: unknown } } } }).runtime.config.server = {
    security_profiles: [
      { name: 'p', enabled: true, auth_methods: authMethods, ...(anonymousRole ? { anonymous_role: anonymousRole } : {}) },
    ],
  }
  return r
}

describe('generateOpcUaHeaderContent — credentials and anonymous role', () => {
  it('no longer emits OPCUA_KDF_ITERATIONS (the count travels in the hash string)', () => {
    const header = generateOpcUaHeaderContent({
      resolved: withUsersAndProfiles([{ type: 'password', username: 'a', password_hash: 'pbkdf2:x' }], ['Username']),
      profile: PROFILE,
      buildEpochSeconds: 0,
    })
    expect(header).not.toContain('OPCUA_KDF_ITERATIONS')
  })

  it('warns and drops a password user that carries no credential', () => {
    const warnings: string[] = []
    const header = generateOpcUaHeaderContent({
      resolved: withUsersAndProfiles(
        [
          { type: 'password', username: 'good', password_hash: 'pbkdf2:x', role: 'engineer' },
          { type: 'password', username: 'blank', password_hash: null },
        ],
        ['Username'],
      ),
      profile: PROFILE,
      buildEpochSeconds: 0,
      warn: (m) => warnings.push(m),
    })
    expect(header).toContain('#define OPCUA_USER_COUNT 1')
    expect(warnings.some((w) => w.includes('blank') && w.includes('no password'))).toBe(true)
  })

  it('defaults the anonymous role to viewer when the profile does not set one', () => {
    // The role is now the PROJECT's explicit choice, defaulting to viewer (least
    // privilege) — the old heuristic that escalated anonymous to engineer
    // whenever no password user survived is gone. Anonymous offered, no role
    // set, no users -> viewer (0), not engineer.
    const header = generateOpcUaHeaderContent({
      resolved: withUsersAndProfiles([], ['Anonymous']),
      profile: PROFILE,
      buildEpochSeconds: 0,
    })
    expect(header).toContain('#define OPCUA_ALLOW_ANONYMOUS 1')
    expect(header).toContain('#define OPCUA_ANONYMOUS_ROLE 0')
  })

  it('honors an explicit engineer anonymous role, even alongside declared users', () => {
    // The user opting the insecure profile up to engineer must be respected:
    // anonymous carries engineer (2) even with a password user present.
    const header = generateOpcUaHeaderContent({
      resolved: withUsersAndProfiles(
        [{ type: 'password', username: 'eng', password_hash: 'pbkdf2:x', role: 'engineer' }],
        ['Anonymous', 'Username'],
        'engineer',
      ),
      profile: PROFILE,
      buildEpochSeconds: 0,
    })
    expect(header).toContain('#define OPCUA_ALLOW_ANONYMOUS 1')
    expect(header).toContain('#define OPCUA_ANONYMOUS_ROLE 2')
  })

  it('maps an explicit operator anonymous role to index 1', () => {
    const header = generateOpcUaHeaderContent({
      resolved: withUsersAndProfiles([], ['Anonymous'], 'operator'),
      profile: PROFILE,
      buildEpochSeconds: 0,
    })
    expect(header).toContain('#define OPCUA_ANONYMOUS_ROLE 1')
  })

  it('refuses anonymous (role irrelevant) when no profile offers it', () => {
    const header = generateOpcUaHeaderContent({
      resolved: withUsersAndProfiles(
        [{ type: 'password', username: 'a', password_hash: 'pbkdf2:x', role: 'viewer' }],
        ['Username'],
      ),
      profile: PROFILE,
      buildEpochSeconds: 0,
    })
    expect(header).toContain('#define OPCUA_ALLOW_ANONYMOUS 0')
    // Defaults to viewer (0) since no anonymous profile carries a role.
    expect(header).toContain('#define OPCUA_ANONYMOUS_ROLE 0')
  })
})
