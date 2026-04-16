import { z } from 'zod'

const baudRateOptions = ['9600', '14400', '19200', '38400', '57600', '115200'] as const

const interfaceOptions = ['Serial', 'Serial1', 'Serial2', 'Serial3'] as const

const staticHostConfigurationSchema = z.object({
  ipAddress: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  dns: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  gateway: z.string(), // This should have the format: XXX.XXX.XXX.XXX
  subnet: z.string(), // This should have the format: XXX.XXX.XXX.XXX
})
type StaticHostConfiguration = z.infer<typeof staticHostConfigurationSchema>

const MAC_ADDRESS_REGEX = /^([0-9A-Fa-f]{2})([:\-,])(?:[0-9A-Fa-f]{2}\2){4}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/
const BYTE_MAC_ADDRESS_REGEX = /^(?:0x[0-9a-f]{2}\s*,\s*){5}0x[0-9a-f]{2}$/i

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string().default('OpenPLC Simulator'),
  communicationPort: z.string().default(''),
  runtimeIpAddress: z.string().optional(),
  compileOnly: z.boolean().default(false),
  communicationConfiguration: z
    .object({
      modbusRTU: z
        .object({
          rtuInterface: z.enum(interfaceOptions).default('Serial'),
          rtuBaudRate: z.enum(baudRateOptions).default('115200'),
          rtuSlaveId: z.number().int().gte(0).lte(255).nullable().default(null),
          rtuRS485ENPin: z.string().nullable().default(null),
        })
        .default({}),
      modbusTCP: z
        .discriminatedUnion('tcpInterface', [
          z.object({
            tcpInterface: z.literal('Wi-Fi'),
            tcpMacAddress: z.string().regex(MAC_ADDRESS_REGEX, 'Invalid MAC address format').nullable(),
            tcpWifiSSID: z.string().nullable(),
            tcpWifiPassword: z.string().nullable(),
            tcpStaticHostConfiguration: staticHostConfigurationSchema,
          }),
          z.object({
            tcpInterface: z.literal('Ethernet'),
            tcpMacAddress: z.string().regex(MAC_ADDRESS_REGEX, 'Invalid MAC address format').nullable(),
            tcpStaticHostConfiguration: staticHostConfigurationSchema,
          }),
        ])
        .default({
          tcpInterface: 'Ethernet' as const,
          tcpMacAddress: null,
          tcpStaticHostConfiguration: { ipAddress: '', dns: '', gateway: '', subnet: '' },
        }),
      communicationPreferences: z
        .object({
          enabledRTU: z.boolean().default(false),
          enabledTCP: z.boolean().default(false),
          enabledDHCP: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

export {
  baudRateOptions,
  BYTE_MAC_ADDRESS_REGEX,
  deviceConfigurationSchema,
  interfaceOptions,
  MAC_ADDRESS_REGEX,
  staticHostConfigurationSchema,
}
export type { DeviceConfiguration, StaticHostConfiguration }
