import { z } from 'zod'

import { zodFBDFlowSchema } from '../../renderer/store/slices/fbd/types'
import { zodLadderFlowSchema } from '../../renderer/store/slices/ladder/types'

const baseTypeSchema = z.enum([
  'bool',
  'sint',
  'int',
  'dint',
  'lint',
  'usint',
  'uint',
  'udint',
  'ulint',
  'real',
  'lreal',
  'time',
  'date',
  'tod',
  'dt',
  'string',
  'byte',
  'word',
  'dword',
  'lword',
])

type BaseType = z.infer<typeof baseTypeSchema>

const PLCArrayDatatypeSchema = z.object({
  name: z.string(),
  derivation: z.literal('array'),
  baseType: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('user-data-type'),
      value: z.string(),
    }),
  ]),
  initialValue: z.string().optional(),
  dimensions: z.array(z.object({ dimension: z.string() })),
})

const PLCEnumeratedDatatypeSchema = z.object({
  name: z.string(),
  derivation: z.literal('enumerated'),
  initialValue: z.string().optional(),
  values: z.array(z.object({ description: z.string() })),
})

const PLCStructureVariableSchema = z.object({
  name: z.string(),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('user-data-type'),
      value: z.string(),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.string(),
      data: z.object({
        /** This must also include the data types created by the user */
        baseType: z.discriminatedUnion('definition', [
          z.object({
            definition: z.literal('base-type'),
            value: baseTypeSchema,
          }),
          z.object({
            definition: z.literal('user-data-type'),
            value: z.string(),
          }),
        ]),
        dimensions: z.array(z.object({ dimension: z.string() })),
      }),
    }),
    z.object({
      /**
       * This should be omitted at variable table type options
       */
      definition: z.literal('derived'),
      value: z.string(),
    }),
  ]),
  initialValue: z
    .object({
      simpleValue: z.object({
        value: z.string(),
      }),
    })
    .optional(),
})
const PLCStructureDatatypeSchema = z.object({
  name: z.string(),
  derivation: z.literal('structure'),
  variable: z.array(PLCStructureVariableSchema),
})

type PLCEnumeratedDatatype = z.infer<typeof PLCEnumeratedDatatypeSchema>
type PLCArrayDatatype = z.infer<typeof PLCArrayDatatypeSchema>
type PLCStructureDatatype = z.infer<typeof PLCStructureDatatypeSchema>
type PLCStructureVariable = z.infer<typeof PLCStructureVariableSchema>

const PLCDataTypeSchema = z.discriminatedUnion('derivation', [
  PLCStructureDatatypeSchema,
  PLCEnumeratedDatatypeSchema,
  PLCArrayDatatypeSchema,
])

type PLCDataType = z.infer<typeof PLCDataTypeSchema>

const PLCVariableSchema = z.object({
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp', 'global']).optional(),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('user-data-type'),
      value: z.string(),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.string(),
      data: z.object({
        /** This must also include the data types created by the user */
        baseType: z.discriminatedUnion('definition', [
          z.object({
            definition: z.literal('base-type'),
            value: baseTypeSchema,
          }),
          z.object({
            definition: z.literal('user-data-type'),
            value: z.string(),
          }),
        ]),
        dimensions: z.array(z.object({ dimension: z.string() })),
      }),
    }),
    z.object({
      definition: z.literal('derived'),
      value: z.string(),
    }),
  ]),
  location: z.string(),
  initialValue: z.string().or(z.null()).optional(),
  documentation: z.string(),
  debug: z.boolean().optional(),
})

type PLCVariable = z.infer<typeof PLCVariableSchema>
const PLCGlobalVariableSchema = PLCVariableSchema
type PLCGlobalVariable = z.infer<typeof PLCGlobalVariableSchema>

const PLCTaskSchema = z.object({
  name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the task object.
  triggering: z.enum(['Cyclic', 'Interrupt']),
  interval: z.string(), // TODO: Must have a regex validation for this. Probably a new modal must be created to handle this.
  priority: z.number(), // TODO: implement this validation. This must be a positive integer from 0 to 100
})

type PLCTask = z.infer<typeof PLCTaskSchema>

const bodySchema = z.discriminatedUnion('language', [
  z.object({
    language: z.literal('il'),
    value: z.string(),
  }),
  z.object({
    language: z.literal('st'),
    value: z.string(),
  }),
  z.object({
    language: z.literal('ld'),
    value: zodLadderFlowSchema,
  }),
  z.object({
    language: z.literal('sfc'),
    value: z.string(),
  }),
  z.object({
    language: z.literal('fbd'),
    value: zodFBDFlowSchema,
  }),
  z.object({
    language: z.literal('python'),
    value: z.string(),
  }),
  z.object({
    language: z.literal('cpp'),
    value: z.string(),
  }),
])

type BodySchema = z.infer<typeof bodySchema>
//
const PLCFunctionSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd', 'python', 'cpp']),
  name: z.string(),
  returnType: z.union([baseTypeSchema, z.string()]),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: bodySchema,
  documentation: z.string(),
  /** Raw unparsed variables text - used to preserve user input even if it doesn't parse correctly */
  variablesText: z.string().optional(),
})

type PLCFunction = z.infer<typeof PLCFunctionSchema>

const PLCProgramSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd', 'python', 'cpp']),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: bodySchema,
  documentation: z.string(),
  /** Raw unparsed variables text - used to preserve user input even if it doesn't parse correctly */
  variablesText: z.string().optional(),
})

type PLCProgram = z.infer<typeof PLCProgramSchema>

const PLCInstanceSchema = z.object({
  name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the instance object.
  task: z.string(), // TODO: Implement this validation. This task must be one of the objects in the "tasks" array defined right above.
  program: z.string(), // TODO: Implement this validation. This program must be one of the user's defined pou of program type.
})

type PLCInstance = z.infer<typeof PLCInstanceSchema>

const PLCFunctionBlockSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd', 'python', 'cpp']),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: bodySchema,
  documentation: z.string(),
  /** Raw unparsed variables text - used to preserve user input even if it doesn't parse correctly */
  variablesText: z.string().optional(),
})

type PLCFunctionBlock = z.infer<typeof PLCFunctionBlockSchema>

const PLCPouSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('program'),
    data: PLCProgramSchema,
  }),
  z.object({
    type: z.literal('function'),
    data: PLCFunctionSchema,
  }),
  z.object({
    type: z.literal('function-block'),
    data: PLCFunctionBlockSchema,
  }),
])
type PLCPou = z.infer<typeof PLCPouSchema>

const PLCConfigurationSchema = z.object({
  resource: z.object({
    tasks: z.array(PLCTaskSchema),
    instances: z.array(PLCInstanceSchema),
    globalVariables: z.array(PLCVariableSchema.omit({ class: true })),
  }),
})
type PLCConfiguration = z.infer<typeof PLCConfigurationSchema>

const PLCServerProtocolSchema = z.enum(['modbus-tcp', 's7comm', 'ethernet-ip', 'opcua'])
type PLCServerProtocol = z.infer<typeof PLCServerProtocolSchema>

const ModbusSlaveBufferMappingSchema = z.object({
  holdingRegisters: z.object({
    qwCount: z.number(),
    mwCount: z.number(),
    mdCount: z.number(),
    mlCount: z.number(),
  }),
  coils: z.object({
    qxBits: z.number(),
    mxBits: z.number(),
  }),
  discreteInputs: z.object({
    ixBits: z.number(),
  }),
  inputRegisters: z.object({
    iwCount: z.number(),
  }),
})
type ModbusSlaveBufferMapping = z.infer<typeof ModbusSlaveBufferMappingSchema>

const ModbusSlaveConfigSchema = z.object({
  enabled: z.boolean(),
  networkInterface: z.string(),
  port: z.number(),
  bufferMapping: ModbusSlaveBufferMappingSchema.optional(),
})
type ModbusSlaveConfig = z.infer<typeof ModbusSlaveConfigSchema>

// S7Comm Buffer Type Enumeration
const S7CommBufferTypeSchema = z.enum([
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
])
type S7CommBufferType = z.infer<typeof S7CommBufferTypeSchema>

// S7Comm Server Settings Schema
const S7CommServerSettingsSchema = z.object({
  enabled: z.boolean(),
  bindAddress: z.string(),
  port: z.number().min(1).max(65535),
  maxClients: z.number().min(1).max(1024),
  workIntervalMs: z.number().min(1).max(10000),
  sendTimeoutMs: z.number().min(100).max(60000),
  recvTimeoutMs: z.number().min(100).max(60000),
  pingTimeoutMs: z.number().min(1000).max(300000),
  pduSize: z.number().min(240).max(960),
})
type S7CommServerSettings = z.infer<typeof S7CommServerSettingsSchema>

// S7Comm PLC Identity Schema
const S7CommPlcIdentitySchema = z.object({
  name: z.string().max(64),
  moduleType: z.string().max(64),
  serialNumber: z.string().max(64),
  copyright: z.string().max(64),
  moduleName: z.string().max(64),
})
type S7CommPlcIdentity = z.infer<typeof S7CommPlcIdentitySchema>

// S7Comm Buffer Mapping Schema
const S7CommBufferMappingSchema = z.object({
  type: S7CommBufferTypeSchema,
  startBuffer: z.number().min(0).max(1023),
  bitAddressing: z.boolean(),
})
type S7CommBufferMapping = z.infer<typeof S7CommBufferMappingSchema>

// S7Comm Data Block Schema
const S7CommDataBlockSchema = z.object({
  dbNumber: z.number().min(1).max(65535),
  description: z.string().max(128),
  sizeBytes: z.number().min(1).max(65536),
  mapping: S7CommBufferMappingSchema,
})
type S7CommDataBlock = z.infer<typeof S7CommDataBlockSchema>

// S7Comm System Area Schema
const S7CommSystemAreaSchema = z.object({
  enabled: z.boolean(),
  sizeBytes: z.number().min(1).max(65536),
  mapping: S7CommBufferMappingSchema.optional(),
})
type S7CommSystemArea = z.infer<typeof S7CommSystemAreaSchema>

// S7Comm System Areas Container Schema
const S7CommSystemAreasSchema = z.object({
  peArea: S7CommSystemAreaSchema.optional(),
  paArea: S7CommSystemAreaSchema.optional(),
  mkArea: S7CommSystemAreaSchema.optional(),
})
type S7CommSystemAreas = z.infer<typeof S7CommSystemAreasSchema>

// S7Comm Logging Schema
const S7CommLoggingSchema = z.object({
  logConnections: z.boolean(),
  logDataAccess: z.boolean(),
  logErrors: z.boolean(),
})
type S7CommLogging = z.infer<typeof S7CommLoggingSchema>

// Complete S7Comm Slave Config Schema
const S7CommSlaveConfigSchema = z.object({
  server: S7CommServerSettingsSchema,
  plcIdentity: S7CommPlcIdentitySchema.optional(),
  dataBlocks: z.array(S7CommDataBlockSchema).max(64),
  systemAreas: S7CommSystemAreasSchema.optional(),
  logging: S7CommLoggingSchema.optional(),
})
type S7CommSlaveConfig = z.infer<typeof S7CommSlaveConfigSchema>

// ═══════════════════════════════════════════════════════════════════════════
// OPC-UA Server Configuration Types
// ═══════════════════════════════════════════════════════════════════════════

// OPC-UA Security Policy Enumeration
const OpcUaSecurityPolicySchema = z.enum(['None', 'Basic128Rsa15', 'Basic256', 'Basic256Sha256'])
type OpcUaSecurityPolicy = z.infer<typeof OpcUaSecurityPolicySchema>

// OPC-UA Security Mode Enumeration
const OpcUaSecurityModeSchema = z.enum(['None', 'Sign', 'SignAndEncrypt'])
type OpcUaSecurityMode = z.infer<typeof OpcUaSecurityModeSchema>

// OPC-UA Authentication Method Enumeration
const OpcUaAuthMethodSchema = z.enum(['Anonymous', 'Username', 'Certificate'])
type OpcUaAuthMethod = z.infer<typeof OpcUaAuthMethodSchema>

// OPC-UA User Role Enumeration
const OpcUaUserRoleSchema = z.enum(['viewer', 'operator', 'engineer'])
type OpcUaUserRole = z.infer<typeof OpcUaUserRoleSchema>

// OPC-UA Security Profile Schema
const OpcUaSecurityProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(64),
  enabled: z.boolean(),
  securityPolicy: OpcUaSecurityPolicySchema,
  securityMode: OpcUaSecurityModeSchema,
  authMethods: z.array(OpcUaAuthMethodSchema).min(1),
})
type OpcUaSecurityProfile = z.infer<typeof OpcUaSecurityProfileSchema>

// OPC-UA Trusted Certificate Schema
const OpcUaTrustedCertificateSchema = z.object({
  id: z.string().min(1).max(64),
  pem: z.string(),
  subject: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  fingerprint: z.string().optional(),
})
type OpcUaTrustedCertificate = z.infer<typeof OpcUaTrustedCertificateSchema>

// OPC-UA User Schema
const OpcUaUserSchema = z.object({
  id: z.string(),
  type: z.enum(['password', 'certificate']),
  username: z.string().nullable(),
  passwordHash: z.string().nullable(),
  certificateId: z.string().nullable(),
  role: OpcUaUserRoleSchema,
})
type OpcUaUser = z.infer<typeof OpcUaUserSchema>

// OPC-UA Permissions Schema (per-variable access control)
const OpcUaPermissionsSchema = z.object({
  viewer: z.enum(['r', 'w', 'rw']),
  operator: z.enum(['r', 'w', 'rw']),
  engineer: z.enum(['r', 'w', 'rw']),
})
type OpcUaPermissions = z.infer<typeof OpcUaPermissionsSchema>

// OPC-UA Field Configuration Schema (for structure fields)
// Uses z.lazy() to support recursive nested fields for complex types (FBs, structs)
interface OpcUaFieldConfig {
  fieldPath: string
  displayName: string
  /** Data type of the field. Optional for backward compatibility with existing projects. */
  datatype?: string
  initialValue: boolean | number | string
  permissions: OpcUaPermissions
  /** Nested fields for complex types (FB instances, nested structs). Undefined or empty for leaf fields. */
  fields?: OpcUaFieldConfig[]
}
const OpcUaFieldConfigSchema: z.ZodType<OpcUaFieldConfig> = z.lazy(() =>
  z.object({
    fieldPath: z.string(),
    displayName: z.string(),
    datatype: z.string().optional(), // Optional for backward compatibility
    initialValue: z.union([z.boolean(), z.number(), z.string()]),
    permissions: OpcUaPermissionsSchema,
    fields: z.array(OpcUaFieldConfigSchema).optional(),
  }),
)

// OPC-UA Node Configuration Schema (variable/structure/array)
const OpcUaNodeConfigSchema = z.object({
  id: z.string(),
  pouName: z.string(),
  variablePath: z.string(),
  variableType: z.string(),
  nodeId: z.string(),
  browseName: z.string(),
  displayName: z.string(),
  description: z.string(),
  initialValue: z.union([z.boolean(), z.number(), z.string()]),
  permissions: OpcUaPermissionsSchema,
  nodeType: z.enum(['variable', 'structure', 'array']),
  fields: z.array(OpcUaFieldConfigSchema).optional(),
  arrayLength: z.number().optional(),
  elementType: z.string().optional(),
})
type OpcUaNodeConfig = z.infer<typeof OpcUaNodeConfigSchema>

// OPC-UA Server Settings Schema
const OpcUaServerSettingsSchema = z.object({
  enabled: z.boolean(),
  name: z.string().max(128),
  applicationUri: z.string(),
  productUri: z.string(),
  bindAddress: z.string(),
  port: z.number().int().min(1).max(65535),
  endpointPath: z.string(),
})
type OpcUaServerSettings = z.infer<typeof OpcUaServerSettingsSchema>

// OPC-UA Security Configuration Schema
const OpcUaSecurityConfigSchema = z.object({
  serverCertificateStrategy: z.enum(['auto_self_signed', 'custom']),
  serverCertificateCustom: z.string().nullable(),
  serverPrivateKeyCustom: z.string().nullable(),
  trustedClientCertificates: z.array(OpcUaTrustedCertificateSchema),
})
type OpcUaSecurityConfig = z.infer<typeof OpcUaSecurityConfigSchema>

// OPC-UA Address Space Configuration Schema
const OpcUaAddressSpaceConfigSchema = z.object({
  namespaceUri: z.string(),
  nodes: z.array(OpcUaNodeConfigSchema),
})
type OpcUaAddressSpaceConfig = z.infer<typeof OpcUaAddressSpaceConfigSchema>

// Complete OPC-UA Server Configuration Schema
const OpcUaServerConfigSchema = z.object({
  server: OpcUaServerSettingsSchema,
  securityProfiles: z.array(OpcUaSecurityProfileSchema),
  security: OpcUaSecurityConfigSchema,
  users: z.array(OpcUaUserSchema),
  cycleTimeMs: z.number().int().min(10).max(10000),
  addressSpace: OpcUaAddressSpaceConfigSchema,
})
type OpcUaServerConfig = z.infer<typeof OpcUaServerConfigSchema>

const PLCServerSchema = z.object({
  name: z.string(),
  protocol: PLCServerProtocolSchema,
  modbusSlaveConfig: ModbusSlaveConfigSchema.optional(),
  s7commSlaveConfig: S7CommSlaveConfigSchema.optional(),
  opcuaServerConfig: OpcUaServerConfigSchema.optional(),
})
type PLCServer = z.infer<typeof PLCServerSchema>

// Remote Device (Modbus Master) types
const ModbusFunctionCodeSchema = z.enum(['1', '2', '3', '4', '5', '6', '15', '16'])
type ModbusFunctionCode = z.infer<typeof ModbusFunctionCodeSchema>

const ModbusErrorHandlingSchema = z.enum(['keep-last-value', 'set-to-zero'])
type ModbusErrorHandling = z.infer<typeof ModbusErrorHandlingSchema>

// Modbus transport type: TCP/IP or RTU (serial)
const ModbusTransportTypeSchema = z.enum(['tcp', 'rtu'])
type ModbusTransportType = z.infer<typeof ModbusTransportTypeSchema>

// Modbus RTU parity settings
const ModbusParitySchema = z.enum(['N', 'E', 'O'])
type ModbusParity = z.infer<typeof ModbusParitySchema>

const ModbusIOPointSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  iecLocation: z.string(),
  alias: z.string().optional(),
})
type ModbusIOPoint = z.infer<typeof ModbusIOPointSchema>

const ModbusIOGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  functionCode: ModbusFunctionCodeSchema,
  cycleTime: z.number(),
  offset: z.string(),
  length: z.number(),
  errorHandling: ModbusErrorHandlingSchema,
  ioPoints: z.array(ModbusIOPointSchema),
})
type ModbusIOGroup = z.infer<typeof ModbusIOGroupSchema>

const ModbusTcpConfigSchema = z.object({
  // Transport type: 'tcp' (default) or 'rtu' (serial)
  transport: ModbusTransportTypeSchema.optional(),
  // TCP-specific fields (optional when using RTU)
  host: z.string().optional(),
  port: z.number().optional(),
  // RTU-specific fields (optional when using TCP)
  serialPort: z.string().optional(),
  baudRate: z.number().optional(),
  parity: ModbusParitySchema.optional(),
  stopBits: z.number().int().min(1).max(2).optional(),
  dataBits: z.number().int().min(7).max(8).optional(),
  // Common fields
  timeout: z.number(),
  slaveId: z.number().int().min(0).max(255).optional(),
  ioGroups: z.array(ModbusIOGroupSchema),
})
type ModbusTcpConfig = z.infer<typeof ModbusTcpConfigSchema>

const PLCRemoteDeviceProtocolSchema = z.enum(['modbus-tcp', 'ethernet-ip', 'ethercat', 'profinet'])
type PLCRemoteDeviceProtocol = z.infer<typeof PLCRemoteDeviceProtocolSchema>

// ---- EtherCAT Configuration Schemas ----

const EtherCATChannelMappingSchema = z.object({
  channelId: z.string(),
  iecLocation: z.string(),
  userEdited: z.boolean(),
})

const ESIDeviceRefSchema = z.object({
  repositoryItemId: z.string(),
  deviceIndex: z.number(),
})

const EtherCATStartupChecksSchema = z.object({
  checkVendorId: z.boolean(),
  checkProductCode: z.boolean(),
  checkRevisionNumber: z.boolean(),
  downloadPdoConfig: z.boolean(),
})

const EtherCATAddressingSchema = z.object({
  ethercatAddress: z.number(),
  optionalSlave: z.boolean(),
})

const EtherCATTimeoutsSchema = z.object({
  sdoTimeoutMs: z.number(),
  initToPreOpTimeoutMs: z.number(),
  safeOpToOpTimeoutMs: z.number(),
})

const EtherCATWatchdogSchema = z.object({
  smWatchdogEnabled: z.boolean(),
  smWatchdogMs: z.number(),
  pdiWatchdogEnabled: z.boolean(),
  pdiWatchdogMs: z.number(),
})

const EtherCATDistributedClocksSchema = z.object({
  dcEnabled: z.boolean(),
  dcSyncUnitCycleUs: z.number(),
  dcSync0Enabled: z.boolean(),
  dcSync0CycleUs: z.number(),
  dcSync0ShiftUs: z.number(),
  dcSync1Enabled: z.boolean(),
  dcSync1CycleUs: z.number(),
  dcSync1ShiftUs: z.number(),
})

const EtherCATSlaveConfigSchema = z.object({
  startupChecks: EtherCATStartupChecksSchema,
  addressing: EtherCATAddressingSchema,
  timeouts: EtherCATTimeoutsSchema,
  watchdog: EtherCATWatchdogSchema,
  distributedClocks: EtherCATDistributedClocksSchema,
})

const ConfiguredEtherCATDeviceSchema = z.object({
  id: z.string(),
  position: z.number().optional(),
  name: z.string(),
  esiDeviceRef: ESIDeviceRefSchema,
  vendorId: z.string(),
  productCode: z.string(),
  revisionNo: z.string(),
  addedFrom: z.enum(['repository', 'scan']),
  config: EtherCATSlaveConfigSchema,
  channelMappings: z.array(EtherCATChannelMappingSchema),
})

const EthercatConfigSchema = z.object({
  devices: z.array(ConfiguredEtherCATDeviceSchema),
})
type EthercatConfig = z.infer<typeof EthercatConfigSchema>

const PLCRemoteDeviceSchema = z.object({
  name: z.string(),
  protocol: PLCRemoteDeviceProtocolSchema,
  modbusTcpConfig: ModbusTcpConfigSchema.optional(),
  ethercatConfig: EthercatConfigSchema.optional(),
})
type PLCRemoteDevice = z.infer<typeof PLCRemoteDeviceSchema>

/**
 * Schema for storing debug variable flags.
 * Since POU variables are saved as text files (IEC 61131-3 format) which don't support debug flags,
 * we store the debug flags separately in project.json.
 */
const PLCDebugVariablesSchema = z
  .object({
    global: z.array(z.string()).optional(),
    pous: z.record(z.string(), z.array(z.string())).optional(),
  })
  .optional()

type PLCDebugVariables = z.infer<typeof PLCDebugVariablesSchema>

const PLCProjectDataSchema = z.object({
  dataTypes: z.array(PLCDataTypeSchema),
  pous: z.array(PLCPouSchema),
  configuration: PLCConfigurationSchema,
  servers: z.array(PLCServerSchema).optional(),
  remoteDevices: z.array(PLCRemoteDeviceSchema).optional(),
  debugVariables: PLCDebugVariablesSchema,
  deletedPous: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['program', 'function', 'function-block']),
        language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd', 'python', 'cpp']),
      }),
    )
    .optional(),
  deletedServers: z
    .array(
      z.object({
        name: z.string(),
        protocol: PLCServerProtocolSchema,
      }),
    )
    .optional(),
  deletedRemoteDevices: z
    .array(
      z.object({
        name: z.string(),
        protocol: PLCRemoteDeviceProtocolSchema,
      }),
    )
    .optional(),
})

type PLCProjectData = z.infer<typeof PLCProjectDataSchema>

const PLCProjectMetaSchema = z.object({
  name: z.string(),
  type: z.enum(['plc-project', 'plc-library']),
})
type PLCProjectMeta = z.infer<typeof PLCProjectMetaSchema>

const PLCProjectSchema = z.object({
  meta: PLCProjectMetaSchema,
  data: PLCProjectDataSchema,
})

type PLCProject = z.infer<typeof PLCProjectSchema>

export {
  baseTypeSchema,
  bodySchema,
  ConfiguredEtherCATDeviceSchema,
  EthercatConfigSchema,
  ModbusErrorHandlingSchema,
  ModbusFunctionCodeSchema,
  ModbusIOGroupSchema,
  ModbusIOPointSchema,
  ModbusParitySchema,
  ModbusSlaveBufferMappingSchema,
  ModbusSlaveConfigSchema,
  ModbusTcpConfigSchema,
  ModbusTransportTypeSchema,
  OpcUaAddressSpaceConfigSchema,
  OpcUaAuthMethodSchema,
  OpcUaFieldConfigSchema,
  OpcUaNodeConfigSchema,
  OpcUaPermissionsSchema,
  OpcUaSecurityConfigSchema,
  OpcUaSecurityModeSchema,
  OpcUaSecurityPolicySchema,
  OpcUaSecurityProfileSchema,
  OpcUaServerConfigSchema,
  OpcUaServerSettingsSchema,
  OpcUaTrustedCertificateSchema,
  OpcUaUserRoleSchema,
  OpcUaUserSchema,
  PLCArrayDatatypeSchema,
  PLCConfigurationSchema,
  PLCDataTypeSchema,
  PLCDebugVariablesSchema,
  PLCEnumeratedDatatypeSchema,
  PLCFunctionBlockSchema,
  PLCFunctionSchema,
  PLCGlobalVariableSchema,
  PLCInstanceSchema,
  PLCPouSchema,
  PLCProgramSchema,
  PLCProjectDataSchema,
  PLCProjectMetaSchema,
  PLCProjectSchema,
  PLCRemoteDeviceProtocolSchema,
  PLCRemoteDeviceSchema,
  PLCServerProtocolSchema,
  PLCServerSchema,
  PLCStructureDatatypeSchema,
  PLCStructureVariableSchema,
  PLCTaskSchema,
  PLCVariableSchema,
  S7CommBufferMappingSchema,
  S7CommBufferTypeSchema,
  S7CommDataBlockSchema,
  S7CommLoggingSchema,
  S7CommPlcIdentitySchema,
  S7CommServerSettingsSchema,
  S7CommSlaveConfigSchema,
  S7CommSystemAreaSchema,
  S7CommSystemAreasSchema,
}

export type {
  BaseType,
  BodySchema,
  EthercatConfig,
  ModbusErrorHandling,
  ModbusFunctionCode,
  ModbusIOGroup,
  ModbusIOPoint,
  ModbusParity,
  ModbusSlaveBufferMapping,
  ModbusSlaveConfig,
  ModbusTcpConfig,
  ModbusTransportType,
  OpcUaAddressSpaceConfig,
  OpcUaAuthMethod,
  OpcUaFieldConfig,
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaSecurityConfig,
  OpcUaSecurityMode,
  OpcUaSecurityPolicy,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  OpcUaServerSettings,
  OpcUaTrustedCertificate,
  OpcUaUser,
  OpcUaUserRole,
  PLCArrayDatatype,
  PLCConfiguration,
  PLCDataType,
  PLCDebugVariables,
  PLCEnumeratedDatatype,
  PLCFunction,
  PLCFunctionBlock,
  PLCGlobalVariable,
  PLCInstance,
  PLCPou,
  PLCProgram,
  PLCProject,
  PLCProjectData,
  PLCProjectMeta,
  PLCRemoteDevice,
  PLCRemoteDeviceProtocol,
  PLCServer,
  PLCServerProtocol,
  PLCStructureDatatype,
  PLCStructureVariable,
  PLCTask,
  PLCVariable,
  S7CommBufferMapping,
  S7CommBufferType,
  S7CommDataBlock,
  S7CommLogging,
  S7CommPlcIdentity,
  S7CommServerSettings,
  S7CommSlaveConfig,
  S7CommSystemArea,
  S7CommSystemAreas,
}
