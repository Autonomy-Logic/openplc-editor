import z from 'zod'

const baudRateOptions = ['9600', '14400', '19200', '38400', '57600', '115200'] as const

const interfaceOptions = ['Serial', 'Serial 1', 'Serial 2', 'Serial 3'] as const

const staticHostConfigurationSchema = z.object({
  ipAddress: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  dns: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  gateway: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  subnet: z.string(), // This should have the format: XXX.XXX.XXX.XXX
})

const MAC_ADDRESS_REGEX = /^([0-9A-Fa-f]{2})([:\-,])(?:[0-9A-Fa-f]{2}\2){4}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/

type StaticHostConfiguration = z.infer<typeof staticHostConfigurationSchema>

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string(), // Can be one from the list of boards in the hals file.
  communicationPort: z.string(),
  communicationConfiguration: z.object({
    modbusRTU: z.object({
      rtuInterface: z.enum(interfaceOptions), // This will be an enumerated that will be associated with the device board selected - Validation will be added further.
      rtuBaudRate: z.enum(baudRateOptions), // This will be an enumerated that will be associated with the device board selected - Validation will be added further.
      rtuSlaveId: z.number().int().positive().lte(255).nullable(), // Can be any integer number from 0 to 255 - Validation will be added further.
      rtuRS485ENPin: z.string().nullable(), // Can be any integer number from 0 to 255 - Validation will be added further.Í
    }),
    modbusTCP: z.discriminatedUnion('tcpInterface', [
      z.object({
        tcpInterface: z.literal('Wi-Fi'),
        tcpMacAddress: z.string().regex(MAC_ADDRESS_REGEX).nullable(), // This should have the format: XX:XX:XX:XX:XX:XX
        tcpWifiSSID: z.string().nullable(),
        tcpWifiPassword: z.string().nullable(),
        tcpStaticHostConfiguration: staticHostConfigurationSchema, // When this is omitted the user has chosen DHCP.
      }),
      z.object({
        tcpInterface: z.literal('Ethernet'),
        tcpMacAddress: z.string().regex(MAC_ADDRESS_REGEX).nullable(),
        tcpStaticHostConfiguration: staticHostConfigurationSchema, // When this is omitted the user has chosen DHCP.
      }),
    ]),
    communicationPreferences: z.object({
      enabledRTU: z.boolean(),
      enabledTCP: z.boolean(),
      enabledDHCP: z.boolean(),
    }),
  }),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

const pinTypes = ['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput'] as const

type PinTypes = (typeof pinTypes)[number]

/**
 * TODO: Must be filled with the infos that comes from the hals file
 */
const _defaultPins = []
/**
 * The pin address obey the following name rules and is populated automatically by the editor.
 *
 * 1. For digital types:
 *    - The address must start with the prefix "%QX" or "%IX"
 *    - Following the prefix, the address must have a integer number starting with 0
 *    - Following the number, the address must have a dot "."
 *    - Following the dot, the address must have a integer number starting with 0 and ending with 7
 * 2. For analog types:
 *    - The address must start with the prefix "%QW" or "%IW"
 *    - Following the prefix, the address must have a integer number starting with 0
 */
const devicePinSchema = z.object({
  pin: z.string().max(6),
  pinType: z.enum(pinTypes),
  address: z.string(),
  name: z.string().optional(),
})

type DevicePin = z.infer<typeof devicePinSchema>

/**
 * The pin mapping is an unique structure that record the pins added by the user.
 * The structure contains an array of all pins and tracks the currently selected pin row.
 */
const devicePinMappingSchema = z.object({
  pins: z.array(devicePinSchema),
  currentSelectedPinTableRow: z.number(),
})

type DevicePinMapping = z.infer<typeof devicePinMappingSchema>

const availableBoardInfo = z.object({
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

const deviceAvailableOptionsSchema = z.object({
  availableBoards: z.map(z.string(), availableBoardInfo),
  availableCommunicationPorts: z.array(z.string()),
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
  }),
})

type DeviceState = z.infer<typeof deviceStateSchema>

const setRTUConfigParams = z.discriminatedUnion('rtuConfig', [
  z.object({ rtuConfig: z.literal('rtuInterface'), value: z.enum(interfaceOptions) }),
  z.object({ rtuConfig: z.literal('rtuBaudRate'), value: z.enum(baudRateOptions) }),
  z.object({ rtuConfig: z.literal('rtuSlaveId'), value: z.number() }),
  z.object({ rtuConfig: z.literal('rtuRS485ENPin'), value: z.string() }),
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
        availableCommunicationPorts: z.array(z.string()).optional(),
      }),
    )
    .returns(z.void()),
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
})

type DeviceActions = z.infer<typeof deviceActionSchema>

type DeviceSlice = DeviceState & {
  deviceActions: DeviceActions
}

export type {
  AvailableBoardInfo,
  DeviceActions,
  DeviceAvailableOptions,
  DeviceConfiguration,
  DevicePin,
  DevicePinMapping,
  DeviceSlice,
  DeviceState,
  PinTypes,
  StaticHostConfiguration,
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
  pinTypes,
}
