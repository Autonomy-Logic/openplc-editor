import { z } from 'zod'

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string().default('OpenPLC Simulator'),
  communicationPort: z.string().default(''),
  runtimeIpAddress: z.string().optional(),
  compileOnly: z.boolean().default(false),
  vendorScreenData: z.record(z.string(), z.unknown()).optional(),
  // User picks from VPP `target.platformOptions` (e.g. Nano cpu=atmega328old).
  // Keyed by option `key`, value is the chosen `values[].id`. The compile and
  // upload pipelines fall back to each manifest option's `default` when a key
  // is missing here.
  selectedPlatformOptions: z.record(z.string(), z.string()).default({}),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

export { deviceConfigurationSchema }
export type { DeviceConfiguration }
