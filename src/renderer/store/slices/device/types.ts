import z from 'zod'

const staticHostConfigurationSchema = z.object({
  ipAddress: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  dns: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  gateway: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  subnet: z.string(), // This should have the format: XXX.XXX.XXX.XXX
})

type StaticHostConfiguration = z.infer<typeof staticHostConfigurationSchema>

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string(), // Can be one from the list of boards in the hals file.
  communicationPort: z.string(),
  communicationConfiguration: z.object({
    modbusRTU: z.object({
      rtuInterface: z.string(), // This will be an enumerated that will be associated with the device board selected - Validation will be added further.
      rtuBaudrate: z.string(), // This will be an enumerated that will be associated with the device board selected - Validation will be added further.
      rtuSlaveId: z.string(), // Can be any integer number from 0 to 255 - Validation will be added further.
      rtuRS485TXPin: z.string(), // Can be any integer number from 0 to 255 - Validation will be added further.Í
    }),
    modbusTCP: z.discriminatedUnion('tcpInterface', [
      z.object({
        tcpInterface: z.literal('wifi'),
        tcpMacAddress: z.string(), // This should have the format: XX:XX:XX:XX:XX:XX
        tcpWifiSSID: z.string(),
        tcpWifiPassword: z.string(),
        tcpStaticHostConfiguration: staticHostConfigurationSchema.optional(), // When this is omitted the user has chosen DHCP.
      }),
      z.object({
        tcpInterface: z.literal('ethernet'),
        tcpMacAddress: z.string(),
        tcpStaticHostConfiguration: staticHostConfigurationSchema.optional(), // When this is omitted the user has chosen DHCP.
      }),
    ]),
  }),
})
type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

const devicePinSchema = z.object({
  pin: z.string().max(6),
  type: z.enum(['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput']),
  address: z.string(), // This will be populated automatically
  name: z.string().optional(),
})

type DevicePin = z.infer<typeof devicePinSchema>

const devicePinMappingSchema = z.array(devicePinSchema)

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
})

type AvailableBoardInfo = z.infer<typeof availableBoardInfo>

const deviceAvailableOptionsSchema = z.object({
  availableBoards: z.map(z.string(), availableBoardInfo),
  availableCommunicationPorts: z.array(z.string()),
  availableRTUInterfaces: z.array(z.string()),
  availableRTUBaudrates: z.array(z.string()),
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
  addPin: z.function().args(z.string().optional()).returns(z.void()),
  setDeviceBoard: z.function().args(z.string()).returns(z.void()),
  setCommunicationPort: z.function().args(z.string()).returns(z.void()),
  setRTUSettings: z
    .function()
    .args(deviceConfigurationSchema.shape.communicationConfiguration.shape.modbusRTU.partial())
    .returns(z.void()),
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
  StaticHostConfiguration,
}
export {
  deviceActionSchema,
  deviceAvailableOptionsSchema,
  deviceConfigurationSchema,
  devicePinMappingSchema,
  devicePinSchema,
  deviceStateSchema,
}
