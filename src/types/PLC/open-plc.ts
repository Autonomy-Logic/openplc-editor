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

const PLCServerProtocolSchema = z.enum(['modbus-tcp', 's7comm', 'ethernet-ip'])
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

const PLCServerSchema = z.object({
  name: z.string(),
  protocol: PLCServerProtocolSchema,
  modbusSlaveConfig: ModbusSlaveConfigSchema.optional(),
})
type PLCServer = z.infer<typeof PLCServerSchema>

// Remote Device (Modbus Master) types
const ModbusFunctionCodeSchema = z.enum(['1', '2', '3', '4', '5', '6', '15', '16'])
type ModbusFunctionCode = z.infer<typeof ModbusFunctionCodeSchema>

const ModbusErrorHandlingSchema = z.enum(['keep-last-value', 'set-to-zero'])
type ModbusErrorHandling = z.infer<typeof ModbusErrorHandlingSchema>

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
  host: z.string(),
  port: z.number(),
  timeout: z.number(),
  ioGroups: z.array(ModbusIOGroupSchema),
})
type ModbusTcpConfig = z.infer<typeof ModbusTcpConfigSchema>

const PLCRemoteDeviceProtocolSchema = z.enum(['modbus-tcp', 'ethernet-ip', 'ethercat', 'profinet'])
type PLCRemoteDeviceProtocol = z.infer<typeof PLCRemoteDeviceProtocolSchema>

const PLCRemoteDeviceSchema = z.object({
  name: z.string(),
  protocol: PLCRemoteDeviceProtocolSchema,
  modbusTcpConfig: ModbusTcpConfigSchema.optional(),
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
  ModbusErrorHandlingSchema,
  ModbusFunctionCodeSchema,
  ModbusIOGroupSchema,
  ModbusIOPointSchema,
  ModbusSlaveBufferMappingSchema,
  ModbusSlaveConfigSchema,
  ModbusTcpConfigSchema,
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
}

export type {
  BaseType,
  BodySchema,
  ModbusErrorHandling,
  ModbusFunctionCode,
  ModbusIOGroup,
  ModbusIOPoint,
  ModbusSlaveBufferMapping,
  ModbusSlaveConfig,
  ModbusTcpConfig,
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
}
