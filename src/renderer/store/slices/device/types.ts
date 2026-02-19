import {
  baudRateOptions,
  deviceConfigurationSchema,
  devicePinSchema,
  interfaceOptions,
  staticHostConfigurationSchema,
} from '@root/types/PLC/devices'
import { z } from 'zod'

/**
 * The pin mapping is an unique structure that record the pins added by the user.
 * The structure contains an array of all pins and tracks the currently selected pin row.
 */
const devicePinMappingSchema = z.object({
  pins: z.array(devicePinSchema),
  currentSelectedPinTableRow: z.number(),
})

type DevicePinMapping = z.infer<typeof devicePinMappingSchema>

/**
 * Timing statistics returned by OpenPLC Runtime v4 status API.
 * Defined as plain TypeScript type to avoid z.infer type resolution issues.
 */
type TimingStats = {
  scan_count: number
  scan_time_min: number | null
  scan_time_max: number | null
  scan_time_avg: number | null
  cycle_time_min: number | null
  cycle_time_max: number | null
  cycle_time_avg: number | null
  cycle_latency_min: number | null
  cycle_latency_max: number | null
  cycle_latency_avg: number | null
  overruns: number
}

const timingStatsSchema = z.object({
  scan_count: z.number(),
  scan_time_min: z.number().nullable(),
  scan_time_max: z.number().nullable(),
  scan_time_avg: z.number().nullable(),
  cycle_time_min: z.number().nullable(),
  cycle_time_max: z.number().nullable(),
  cycle_time_avg: z.number().nullable(),
  cycle_latency_min: z.number().nullable(),
  cycle_latency_max: z.number().nullable(),
  cycle_latency_avg: z.number().nullable(),
  overruns: z.number(),
})

const runtimeConnectionSchema = z.object({
  jwtToken: z.string().nullable(),
  connectionStatus: z.enum(['disconnected', 'connecting', 'connected', 'error']),
  plcStatus: z.enum(['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN']).nullable(),
  ipAddress: z.string().nullable(),
  timingStats: timingStatsSchema.nullable(),
  // Flag to include timing stats in status polling (set by board.tsx when visible)
  includeTimingStatsInPolling: z.boolean(),
})

type RuntimeConnection = z.infer<typeof runtimeConnectionSchema>

const availableBoardInfo = z.object({
  compiler: z.enum(['arduino-cli', 'openplc-compiler', 'simulator']),
  core: z.string(),
  preview: z.string(),
  specs: z.object({
    CPU: z.string(),
    RAM: z.string(),
    Flash: z.string(),
    DigitalPins: z.string(),
    AnalogPins: z.string(),
    PWMPins: z.string(),
    WiFi: z.string(),
    Bluetooth: z.string(),
    Ethernet: z.string(),
  }),
  coreVersion: z.string().optional(),
  pins: z.object({
    defaultAin: z.array(z.string()).optional(), // Default analog input pins
    defaultAout: z.array(z.string()).optional(), // Default analog output pins
    defaultDin: z.array(z.string()).optional(), // Default digital input pins
    defaultDout: z.array(z.string()).optional(), // Default digital output pins
  }),
})

type AvailableBoardInfo = z.infer<typeof availableBoardInfo>

const serialPortSchema = z.object({
  name: z.string(),
  address: z.string(),
})

const deviceAvailableOptionsSchema = z.object({
  availableBoards: z.map(z.string(), availableBoardInfo),
  availableCommunicationPorts: z.array(serialPortSchema),
  availableRTUInterfaces: z.array(z.string()),
  availableRTUBaudRates: z.array(z.string()),
  availableTCPInterfaces: z.array(z.string()),
})

type DeviceAvailableOptions = z.infer<typeof deviceAvailableOptionsSchema>

const deviceStateSchema = z.object({
  deviceAvailableOptions: deviceAvailableOptionsSchema,
  deviceDefinitions: z.object({
    configuration: deviceConfigurationSchema,
    pinMapping: devicePinMappingSchema,
    temporaryDhcpIp: z.string().optional(),
  }),
  deviceUpdated: z.object({
    updated: z.boolean(),
  }),
  runtimeConnection: runtimeConnectionSchema,
})

type DeviceState = z.infer<typeof deviceStateSchema>

const setRTUConfigParams = z.discriminatedUnion('rtuConfig', [
  z.object({ rtuConfig: z.literal('rtuInterface'), value: z.enum(interfaceOptions) }),
  z.object({ rtuConfig: z.literal('rtuBaudRate'), value: z.enum(baudRateOptions) }),
  z.object({ rtuConfig: z.literal('rtuSlaveId'), value: z.number() }),
  z.object({ rtuConfig: z.literal('rtuRS485ENPin'), value: z.string().nullable() }),
])

const setTCPConfigParams = z.discriminatedUnion('tcpConfig', [
  z.object({ tcpConfig: z.literal('tcpInterface'), value: z.enum(['Wi-Fi', 'Ethernet']) }),
  z.object({ tcpConfig: z.literal('tcpMacAddress'), value: z.string() }),
])

const deviceActionSchema = z.object({
  setAvailableOptions: z
    .function()
    .args(
      z.object({
        availableBoards: z.map(z.string(), availableBoardInfo).optional(),
        availableCommunicationPorts: z.array(serialPortSchema).optional(),
      }),
    )
    .returns(z.void()),
  setDeviceDefinitions: z
    .function()
    .args(
      z.object({
        configuration: deviceConfigurationSchema.optional(),
        pinMapping: devicePinSchema.array().optional(),
      }),
    )
    .returns(z.void()),
  clearDeviceDefinitions: z.function().args().returns(z.void()),
  resetDeviceUpdated: z.function().args().returns(z.void()),
  selectPinTableRow: z.function().args(z.number()).returns(z.void()),
  createNewPin: z.function().args().returns(z.void()),
  removePin: z.function().args().returns(z.void()),
  updatePin: z
    .function()
    .args(
      devicePinSchema.partial().refine((obj) => Object.keys(obj).length > 0, {
        message: 'At least one pin property must be provided',
      }),
    )
    .returns(
      z.object({
        ok: z.boolean(),
        title: z.string(),
        message: z.string(),
        data: z.unknown().optional(),
      }),
    ),
  setDeviceBoard: z.function().args(z.string()).returns(z.void()),
  setCommunicationPort: z.function().args(z.string()).returns(z.void()),
  setCommunicationPreferences: z
    .function()
    .args(z.object({ enableRTU: z.boolean(), enableTCP: z.boolean(), enableDHCP: z.boolean() }).partial())
    .returns(z.void()),
  setRTUConfig: z.function().args(setRTUConfigParams).returns(z.void()),
  setTCPConfig: z.function().args(setTCPConfigParams).returns(z.void()),
  setWifiConfig: z
    .function()
    .args(z.object({ tcpWifiSSID: z.string(), tcpWifiPassword: z.string() }).partial())
    .returns(z.void()),
  setStaticHostConfiguration: z.function().args(staticHostConfigurationSchema.partial()).returns(z.void()),
  setCompileOnly: z.function().args(z.boolean()).returns(z.void()),
  setRuntimeIpAddress: z.function().args(z.string()).returns(z.void()),
  setRuntimeJwtToken: z.function().args(z.string().nullable()).returns(z.void()),
  setRuntimeConnectionStatus: z
    .function()
    .args(z.enum(['disconnected', 'connecting', 'connected', 'error']))
    .returns(z.void()),
  setPlcRuntimeStatus: z
    .function()
    .args(z.enum(['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN']).nullable())
    .returns(z.void()),
  setTimingStats: z.function().args(timingStatsSchema.nullable()).returns(z.void()),
  setIncludeTimingStatsInPolling: z.function().args(z.boolean()).returns(z.void()),
  setTemporaryDhcpIp: z.function().args(z.string().optional()).returns(z.void()),
})

type DeviceActions = Omit<z.infer<typeof deviceActionSchema>, 'setTimingStats'> & {
  setTimingStats: (stats: TimingStats | null) => void
  setIncludeTimingStatsInPolling: (include: boolean) => void
}

type DeviceSlice = DeviceState & {
  deviceActions: DeviceActions
}

export type {
  AvailableBoardInfo,
  DeviceActions,
  DeviceAvailableOptions,
  DevicePinMapping,
  DeviceSlice,
  DeviceState,
  RuntimeConnection,
  TimingStats,
}
export {
  baudRateOptions,
  deviceActionSchema,
  deviceAvailableOptionsSchema,
  deviceConfigurationSchema,
  devicePinMappingSchema,
  devicePinSchema,
  deviceStateSchema,
  interfaceOptions,
  runtimeConnectionSchema,
  timingStatsSchema,
}
