import { z } from 'zod'

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string(),
  communicationPort: z.string(),
  runtimeIpAddress: z.string().optional(),
  compileOnly: z.boolean().default(false),
  vendorScreenData: z.record(z.string(), z.unknown()).optional(),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

export { deviceConfigurationSchema }
export type { DeviceConfiguration }
