/**
 * The `apply` spec — what an agent writes to author a project.
 *
 * `.strict()` on every object, deliberately. An agent that writes `"varables"`
 * gets `pous[0].varables: Unrecognized key` and can fix it; a permissive schema
 * would accept the typo, produce a POU with no variables, and the mistake would
 * only surface as a compile error in a file the agent never wrote.
 *
 * Shapes mirror the store's own types rather than inventing friendlier ones.
 * A ladder contact variant is `'risingEdge'`, not `'rising'`, because that is
 * the literal the ladder node carries — a nicer spelling here would be a second
 * vocabulary to keep in sync.
 */

import type { OpcUaFieldConfig } from '@root/middleware/shared/ports/types'
import { z } from 'zod'

/** Every language the transpiler supports. `sfc` is parsed and then refused. */
export const bodyLanguageSchema = z.enum(['st', 'il', 'ld', 'fbd', 'python', 'cpp', 'sfc'])

const variableTypeSchema = z
  .object({
    definition: z.enum(['base-type', 'user-data-type', 'derived', 'array', 'generic-type']),
    /**
     * The type's name — and for `array`, the name of its ELEMENT (`INT`), not
     * the rendered `ARRAY [0..3] OF INT`. The store keeps both that rendered
     * text and a structured copy of the bounds; `apply` derives them from
     * `dimensions` so the two cannot disagree.
     */
    value: z.string(),
    /** `array` only, and required there: `["0..3"]`, one entry per dimension. */
    dimensions: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((type) => (type.definition === 'array') === (type.dimensions !== undefined), {
    message: 'an array type needs "dimensions", and "dimensions" is only valid on an array type',
  })

const variableSchema = z
  .object({
    name: z.string().min(1),
    /**
     * Optional: the store itself allows a variable with no class, and a POU's
     * plain local is the common case. Absent becomes `local` on a POU and
     * `global` on the resource — see `toVariable` in `apply/plan.ts`.
     */
    class: z.enum(['input', 'output', 'inOut', 'local', 'temp', 'external', 'global']).optional(),
    type: variableTypeSchema,
    /** Alias name or a literal IEC address (`%IX0.0`). Empty = unlocated. */
    location: z.string().optional(),
    initialValue: z.string().nullable().optional(),
    documentation: z.string().optional(),
    debug: z.boolean().optional(),
    /**
     * The IEC block qualifier — the variables table's **Flags** column.
     *
     * Absent is a plain `VAR`, which is IEC's `NON_RETAIN`. `retain` keeps the
     * value across a power cycle and needs the project's `persistentStorage`
     * switched on to mean anything. One field because the two are mutually
     * exclusive; STruC++ rejects the combination.
     */
    flag: z.enum(['constant', 'retain']).optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

/** The literals the ladder nodes actually carry — see `ladder/utils/types.ts`. */
const contactVariantSchema = z.enum(['default', 'negated', 'risingEdge', 'fallingEdge'])
const coilVariantSchema = z.enum(['default', 'negated', 'risingEdge', 'fallingEdge', 'set', 'reset'])

const contactSchema = z
  .object({ contact: z.object({ variable: z.string().min(1), variant: contactVariantSchema }).strict() })
  .strict()

/**
 * A rung is a series-parallel two-terminal network, so a nested expression
 * describes it completely — no ids, no coordinates. Recursive, hence the
 * explicit type annotation zod needs for a lazy schema.
 */
export type LadderLogic = z.infer<typeof contactSchema> | { series: LadderLogic[] } | { parallel: LadderLogic[] }

const ladderLogicSchema: z.ZodType<LadderLogic> = z.lazy(() =>
  z.union([
    contactSchema,
    z.object({ series: z.array(ladderLogicSchema).min(1) }).strict(),
    z.object({ parallel: z.array(ladderLogicSchema).min(2) }).strict(),
  ]),
)

const ladderOutputSchema = z.union([
  z.object({ coil: z.object({ variable: z.string().min(1), variant: coilVariantSchema }).strict() }).strict(),
  z
    .object({
      block: z
        .object({
          /** `system/<library>/<pou>` or `user/<pou>`. */
          call: z.string().min(1),
          /** Instance variable name — required for a function block. */
          instance: z.string().optional(),
          /** Literal or variable name per pin, keyed by the pin's own name. */
          inputs: z.record(z.string(), z.string()).optional(),
          /**
           * Variable to receive each output pin. The pin carrying rung power
           * continues the rung and is not named here.
           */
          outputs: z.record(z.string(), z.string()).optional(),
          /**
           * Add EN/ENO and pass rung power through them instead of through the
           * block's first boolean input and output.
           *
           * Defaults to false, which is how a timer or counter is drawn — power
           * drives `IN` and leaves on `Q`. With EN/ENO the rung only gates the
           * call and `IN` is never driven, so the block does nothing. Forced on
           * for a block whose first input or output is not BOOL.
           */
          executionControl: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
])

const ladderBodySchema = z
  .object({
    rungs: z.array(
      z
        .object({
          comment: z.string().optional(),
          logic: ladderLogicSchema.optional(),
          outputs: z.array(ladderOutputSchema).min(1),
        })
        .strict(),
    ),
  })
  .strict()

// ---------------------------------------------------------------------------
// FBD
// ---------------------------------------------------------------------------

const fbdNodeSchema = z
  .object({
    /** Spec-local label. Never a store id — those are minted on apply. */
    label: z.string().min(1),
    kind: z.enum(['block', 'input-variable', 'output-variable', 'inout-variable', 'comment']),
    /** `block` only. */
    call: z.string().optional(),
    /** `block` only — the instance variable for a function block. */
    instance: z.string().optional(),
    /** Variable nodes only. */
    variable: z.string().optional(),
    /** `comment` only. */
    text: z.string().optional(),
    /**
     * `block` only — add EN/ENO so the block's execution can be gated. Forced on
     * regardless for a block whose first input or output is not BOOL.
     */
    executionControl: z.boolean().optional(),
    /**
     * `block` only — the order this block is evaluated in, as the Block
     * Properties dialog sets it. 0 leaves it unordered.
     */
    executionOrder: z.number().int().min(0).optional(),
  })
  .strict()

const fbdBodySchema = z
  .object({
    nodes: z.array(fbdNodeSchema),
    /** `from`/`to` are `label` or `label.PIN`; PIN is the pin's name verbatim. */
    connections: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()),
  })
  .strict()

// ---------------------------------------------------------------------------
// POUs
// ---------------------------------------------------------------------------

/** Textual languages carry their body verbatim — including Python and C/C++. */
const textBodySchema = z.object({ text: z.string() }).strict()

const pouSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(['program', 'function', 'function-block']),
    language: bodyLanguageSchema,
    /** `function` only. */
    returnType: z.string().optional(),
    documentation: z.string().optional(),
    variables: z.array(variableSchema).optional(),
    body: z.union([textBodySchema, ladderBodySchema, fbdBodySchema]).optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

const dataTypeSchema = z.discriminatedUnion('derivation', [
  z
    .object({
      derivation: z.literal('enumerated'),
      name: z.string().min(1),
      values: z.array(z.string().min(1)).min(1),
      initialValue: z.string().optional(),
    })
    .strict(),
  z
    .object({
      derivation: z.literal('structure'),
      name: z.string().min(1),
      variables: z
        .array(
          z
            .object({
              name: z.string().min(1),
              type: variableTypeSchema,
              initialValue: z.string().optional(),
              documentation: z.string().optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      derivation: z.literal('array'),
      name: z.string().min(1),
      baseType: variableTypeSchema,
      /** `0..9` per dimension. Empty means a scalar alias of `baseType`. */
      dimensions: z.array(z.string().min(1)),
      initialValue: z.string().optional(),
    })
    .strict(),
])

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const taskSchema = z
  .object({
    name: z.string().min(1),
    triggering: z.enum(['Cyclic', 'Interrupt']),
    /** IEC duration — `T#20ms`. A bare `20ms` produces a project that will not compile. */
    interval: z.string().min(1),
    /** 0-100, and LOWER is higher priority. The stored schema leaves it
     *  unbounded with a TODO; the documented rule is enforced here. */
    priority: z.number().int().min(0).max(100),
  })
  .strict()

const instanceSchema = z
  .object({ name: z.string().min(1), program: z.string().min(1), task: z.string().min(1) })
  .strict()

// ---------------------------------------------------------------------------
// Device and project settings
// ---------------------------------------------------------------------------

/**
 * The target a project builds for.
 *
 * Not part of `PLCProjectData` — it lives in the device slice and is persisted
 * separately — but it decides whether the project compiles at all, so a spec
 * that cannot set it cannot describe a working project.
 */
const deviceSchema = z
  .object({
    /** Board name exactly as `openplc-cli devices` reports it. */
    board: z.string().min(1).optional(),
    /** Serial port for a board flashed over USB. */
    communicationPort: z.string().optional(),
    /** Address of a runtime target. */
    runtimeIpAddress: z.string().optional(),
    /**
     * Where `retain` variables are kept, delivered to the device as
     * `retain.conf` with the program.
     *
     * Off by default, and a project that leaves it off uploads no `retain.conf`
     * at all — so a variable flagged `retain` retains nothing until this is on.
     */
    persistentStorage: z
      .object({
        enabled: z.boolean(),
        /** Absolute path ON THE DEVICE. Empty means the runtime's own default. */
        path: z.string().optional(),
        /**
         * Commit period in seconds, 1 to 3600.
         *
         * The runtime hands the store its blob every scan; this is what stops it
         * writing through at scan rate and wearing the flash out. Lower costs
         * less state on a power cut and works the storage harder. The runtime
         * refuses a value outside the range at install time.
         */
        flushSeconds: z.number().int().min(1).max(3600).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

/** Libraries the project compiles against, by name and version. */
const libraryRefSchema = z.object({ name: z.string().min(1), version: z.string().min(1) }).strict()

/**
 * A Global Variable List — what CODESYS calls a GVL.
 *
 * Distinct from `globalVariables`: a list carries its own `VAR_GLOBAL`
 * qualifier (CONSTANT, RETAIN, PERSISTENT) and is referenced as `List.Member`.
 */
const globalVariableListSchema = z
  .object({
    name: z.string().min(1),
    qualifier: z.enum(['CONSTANT', 'RETAIN', 'PERSISTENT', 'NON_RETAIN']).optional(),
    documentation: z.string().optional(),
    variables: z.array(variableSchema),
  })
  .strict()

// ---------------------------------------------------------------------------
// Protocols
// ---------------------------------------------------------------------------

/**
 * Server and remote-device specs mirror what the project stores, with two
 * differences: one `enabled` per server instead of a different nested flag per
 * protocol, and everything below the name optional. Derived fields are absent —
 * `ioPoints` and their IEC addresses are allocated by the editor, so a spec
 * that named them would fight the allocator.
 */

const modbusBufferMappingSchema = z
  .object({
    holdingRegisters: z
      .object({
        qwCount: z.number().int().min(0).optional(),
        mwCount: z.number().int().min(0).optional(),
        mdCount: z.number().int().min(0).optional(),
        mlCount: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    coils: z
      .object({ qxBits: z.number().int().min(0).optional(), mxBits: z.number().int().min(0).optional() })
      .strict()
      .optional(),
    discreteInputs: z
      .object({ ixBits: z.number().int().min(0).optional() })
      .strict()
      .optional(),
    inputRegisters: z
      .object({ iwCount: z.number().int().min(0).optional() })
      .strict()
      .optional(),
  })
  .strict()

const modbusSlaveSpecSchema = z
  .object({
    /** The address the runtime binds to; `0.0.0.0` is every interface. */
    networkInterface: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    bufferMapping: modbusBufferMappingSchema.optional(),
  })
  .strict()

const s7BufferMappingSchema = z
  .object({
    type: z.enum([
      'bool_input',
      'bool_output',
      'bool_memory',
      'byte_input',
      'byte_output',
      'int_input',
      'int_output',
      'int_memory',
      'dint_input',
      'dint_output',
      'dint_memory',
      'lint_input',
      'lint_output',
      'lint_memory',
    ]),
    startBuffer: z.number().int().min(0).max(1023),
    bitAddressing: z.boolean(),
  })
  .strict()

const s7SystemAreaSchema = z
  .object({
    enabled: z.boolean(),
    sizeBytes: z.number().int().min(1).max(65536),
    mapping: s7BufferMappingSchema.optional(),
  })
  .strict()

const s7commSpecSchema = z
  .object({
    server: z
      .object({
        bindAddress: z.string().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        maxClients: z.number().int().min(1).max(1024).optional(),
        workIntervalMs: z.number().int().min(1).max(10000).optional(),
        sendTimeoutMs: z.number().int().min(100).max(60000).optional(),
        recvTimeoutMs: z.number().int().min(100).max(60000).optional(),
        pingTimeoutMs: z.number().int().min(1000).max(300000).optional(),
        pduSize: z.number().int().min(240).max(960).optional(),
      })
      .strict()
      .optional(),
    plcIdentity: z
      .object({
        name: z.string().max(64).optional(),
        moduleType: z.string().max(64).optional(),
        serialNumber: z.string().max(64).optional(),
        copyright: z.string().max(64).optional(),
        moduleName: z.string().max(64).optional(),
      })
      .strict()
      .optional(),
    dataBlocks: z
      .array(
        z
          .object({
            dbNumber: z.number().int().min(1).max(65535),
            description: z.string().max(128),
            sizeBytes: z.number().int().min(1).max(65536),
            mapping: s7BufferMappingSchema,
          })
          .strict(),
      )
      .max(64)
      .optional(),
    systemAreas: z
      .object({
        peArea: s7SystemAreaSchema.optional(),
        paArea: s7SystemAreaSchema.optional(),
        mkArea: s7SystemAreaSchema.optional(),
      })
      .strict()
      .optional(),
    logging: z
      .object({
        logConnections: z.boolean().optional(),
        logDataAccess: z.boolean().optional(),
        logErrors: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const opcUaPermissionsSchema = z
  .object({ viewer: z.enum(['r', 'w', 'rw']), operator: z.enum(['r', 'w', 'rw']), engineer: z.enum(['r', 'w', 'rw']) })
  .strict()

/** Recursive: a structure node's fields carry their own fields. */
const opcUaFieldSchema: z.ZodType<OpcUaFieldConfig> = z.lazy(() =>
  z
    .object({
      fieldPath: z.string().min(1),
      displayName: z.string(),
      datatype: z.string().optional(),
      permissions: opcUaPermissionsSchema,
      fields: z.array(opcUaFieldSchema).optional(),
    })
    .strict(),
)

const opcUaSpecSchema = z
  .object({
    server: z
      .object({
        name: z.string().max(128).optional(),
        applicationUri: z.string().optional(),
        productUri: z.string().optional(),
        bindAddress: z.string().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        endpointPath: z.string().optional(),
      })
      .strict()
      .optional(),
    securityProfiles: z
      .array(
        z
          .object({
            /** Defaults to `profile-<name>`, so a round trip is stable. */
            id: z.string().optional(),
            name: z.string().min(1).max(64),
            enabled: z.boolean(),
            securityPolicy: z.enum(['None', 'Basic128Rsa15', 'Basic256', 'Basic256Sha256']),
            securityMode: z.enum(['None', 'Sign', 'SignAndEncrypt']),
            authMethods: z.array(z.enum(['Anonymous', 'Username', 'Certificate'])).min(1),
          })
          .strict(),
      )
      .optional(),
    security: z
      .object({
        serverCertificateStrategy: z.enum(['auto_self_signed', 'custom']).optional(),
        serverCertificateCustom: z.string().nullable().optional(),
        /** Redacted by `describe`; omitting it on apply keeps what is stored. */
        serverPrivateKeyCustom: z.string().nullable().optional(),
        trustedClientCertificates: z
          .array(
            z
              .object({
                id: z.string().min(1).max(64),
                pem: z.string(),
                subject: z.string().optional(),
                validFrom: z.string().optional(),
                validTo: z.string().optional(),
                fingerprint: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    users: z
      .array(
        z
          .object({
            /** Defaults to `user-<username>`. */
            id: z.string().optional(),
            type: z.enum(['password', 'certificate']),
            username: z.string().nullable(),
            /** Redacted by `describe`; omitting it on apply keeps what is stored. */
            passwordHash: z.string().nullable().optional(),
            certificateId: z.string().nullable(),
            role: z.enum(['viewer', 'operator', 'engineer']),
          })
          .strict(),
      )
      .optional(),
    cycleTimeMs: z.number().int().min(10).max(10000).optional(),
    addressSpace: z
      .object({
        namespaceUri: z.string().optional(),
        nodes: z
          .array(
            z
              .object({
                /** Defaults to `<pouName>.<variablePath>`. Internal; not the
                 *  OPC-UA Node ID. */
                id: z.string().optional(),
                pouName: z.string().min(1),
                variablePath: z.string().min(1),
                variableType: z.string(),
                /** The OPC-UA Node ID's IDENTIFIER, not a whole node id: the
                 *  server prefixes its own namespace. The editor generates
                 *  `PLC.<POU>.<path>` and caps it at 128 characters. */
                nodeId: z.string().min(1).max(128),
                browseName: z.string(),
                displayName: z.string(),
                description: z.string(),
                permissions: opcUaPermissionsSchema,
                nodeType: z.enum(['variable', 'structure', 'array']),
                fields: z.array(opcUaFieldSchema).optional(),
                arrayLength: z.number().int().optional(),
                elementType: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const serverSchema = z
  .object({
    name: z.string().min(1),
    /** `ethernet-ip` is refused: the editor stores it but nothing generates it. */
    protocol: z.enum(['modbus-tcp', 's7comm', 'opcua']),
    /**
     * One switch per server. Stored, it lives in a different place for each
     * protocol, which is three chances to set the wrong one. Absent is off,
     * matching what the GUI creates.
     */
    enabled: z.boolean().optional(),
    modbus: modbusSlaveSpecSchema.optional(),
    s7comm: s7commSpecSchema.optional(),
    opcua: opcUaSpecSchema.optional(),
  })
  .strict()

const ioGroupSchema = z
  .object({
    name: z.string().min(1),
    /** The Modbus function code, as the string the store keeps. */
    functionCode: z.enum(['1', '2', '3', '4', '5', '6', '15', '16']),
    cycleTime: z.number().int().min(1),
    /** First register/coil address, decimal or `0x`-prefixed. */
    offset: z.string().min(1),
    length: z.number().int().min(1),
    errorHandling: z.enum(['keep-last-value', 'set-to-zero']).optional(),
    /** One name per point, in order. A variable binds to a point by alias. */
    aliases: z.array(z.string().min(1)).optional(),
  })
  .strict()

const modbusMasterSpecSchema = z
  .object({
    transport: z.enum(['tcp', 'rtu']).optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    /** Required for `rtu`: the generator drops a device without one. */
    serialPort: z.string().optional(),
    baudRate: z.number().int().min(1).optional(),
    parity: z.enum(['N', 'E', 'O']).optional(),
    stopBits: z.number().int().min(1).max(2).optional(),
    dataBits: z.number().int().min(7).max(8).optional(),
    timeout: z.number().int().min(1).optional(),
    /** 0..255 over TCP, 1..247 over RTU — checked against the transport. */
    slaveId: z.number().int().min(0).max(255).optional(),
    ioGroups: z.array(ioGroupSchema).optional(),
  })
  .strict()

const ethercatSlaveSchema = z
  .object({
    /** Which ESI file, and which device inside it. `esi import` adds files. */
    esiDeviceRef: z
      .object({ repositoryItemId: z.string().min(1), deviceIndex: z.number().int().min(0).optional() })
      .strict(),
    /** Defaults to the ESI's own short name, made unique across the bus. */
    name: z.string().min(1).optional(),
    position: z.number().int().min(0).optional(),
    config: z
      .object({
        startupChecks: z
          .object({ checkVendorId: z.boolean().optional(), checkProductCode: z.boolean().optional() })
          .strict()
          .optional(),
        addressing: z
          .object({ ethercatAddress: z.number().int().min(0).max(65535) })
          .strict()
          .optional(),
        timeouts: z
          .object({
            sdoTimeoutMs: z.number().int().min(0).optional(),
            initToPreOpTimeoutMs: z.number().int().min(0).optional(),
            safeOpToOpTimeoutMs: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        watchdog: z
          .object({
            smWatchdogEnabled: z.boolean().optional(),
            smWatchdogMs: z.number().int().min(0).optional(),
            pdiWatchdogEnabled: z.boolean().optional(),
            pdiWatchdogMs: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        distributedClocks: z
          .object({
            dcEnabled: z.boolean().optional(),
            dcSyncUnitCycleUs: z.number().int().min(0).optional(),
            dcSync0Enabled: z.boolean().optional(),
            dcSync0CycleUs: z.number().int().min(0).optional(),
            dcSync0ShiftUs: z.number().int().min(0).optional(),
            dcSync1Enabled: z.boolean().optional(),
            dcSync1CycleUs: z.number().int().min(0).optional(),
            dcSync1ShiftUs: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** A CiA 402 drive is recognized from the ESI; this overrides the scaling. */
    cia402: z
      .object({
        enabled: z.boolean().optional(),
        scaleNum: z.number().optional(),
        scaleDenom: z.number().optional(),
        scaleFactor: z.number().optional(),
      })
      .strict()
      .optional(),
    /** Channel id → alias, for the channels you want named. */
    aliases: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict()

const ethercatSpecSchema = z
  .object({
    master: z
      .object({
        enabled: z.boolean().optional(),
        networkInterface: z.string().optional(),
        cycleTimeUs: z.number().int().min(100).max(100000).optional(),
        watchdogTimeoutCycles: z.number().int().min(1).max(100).optional(),
        taskPriority: z.number().int().min(1).max(31).optional(),
      })
      .strict()
      .optional(),
    slaves: z.array(ethercatSlaveSchema).optional(),
  })
  .strict()

const remoteDeviceSchema = z
  .object({
    name: z.string().min(1),
    /** `ethernet-ip` and `profinet` are refused: neither has a generator. */
    protocol: z.enum(['modbus-tcp', 'ethercat']),
    modbus: modbusMasterSpecSchema.optional(),
    ethercat: ethercatSpecSchema.optional(),
  })
  .strict()

export const applySpecSchema = z
  .object({
    specVersion: z.literal(1),
    device: deviceSchema.optional(),
    libraries: z.array(libraryRefSchema).optional(),
    dataTypes: z.array(dataTypeSchema).optional(),
    globalVariableLists: z.array(globalVariableListSchema).optional(),
    globalVariables: z.array(variableSchema).optional(),
    pous: z.array(pouSchema).optional(),
    tasks: z.array(taskSchema).optional(),
    instances: z.array(instanceSchema).optional(),
    servers: z.array(serverSchema).optional(),
    remoteDevices: z.array(remoteDeviceSchema).optional(),
  })
  .strict()

export type ApplySpec = z.infer<typeof applySpecSchema>
export type SpecPou = z.infer<typeof pouSchema>
export type SpecVariable = z.infer<typeof variableSchema>
export type SpecDataType = z.infer<typeof dataTypeSchema>
export type SpecTask = z.infer<typeof taskSchema>
export type SpecInstance = z.infer<typeof instanceSchema>
export type SpecLadderBody = z.infer<typeof ladderBodySchema>
export type SpecFbdBody = z.infer<typeof fbdBodySchema>
export type SpecLadderOutput = z.infer<typeof ladderOutputSchema>
export type SpecDevice = z.infer<typeof deviceSchema>
export type SpecGlobalVariableList = z.infer<typeof globalVariableListSchema>
export type SpecServer = z.infer<typeof serverSchema>
export type SpecRemoteDevice = z.infer<typeof remoteDeviceSchema>
export type SpecIOGroup = z.infer<typeof ioGroupSchema>
export type SpecEtherCATSlave = z.infer<typeof ethercatSlaveSchema>

/** `path: message`, one per issue — the shape the reporter's `details` renders. */
export function formatSpecIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
}

export function parseApplySpec(input: unknown): { ok: true; spec: ApplySpec } | { ok: false; issues: string[] } {
  const parsed = applySpecSchema.safeParse(input)
  return parsed.success ? { ok: true, spec: parsed.data } : { ok: false, issues: formatSpecIssues(parsed.error) }
}
