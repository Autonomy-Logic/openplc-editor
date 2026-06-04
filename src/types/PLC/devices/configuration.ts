import { z } from 'zod'

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string(),
  communicationPort: z.string(),
  runtimeIpAddress: z.string().optional(),
  vendorScreenData: z.record(z.string(), z.unknown()).optional(),
  // Mirror of backend/shared schema — keep both in sync. See sibling file
  // for the longer explainer; this duplicate exists because the IPC contract
  // and the parse pipeline reference distinct schema files today.
  selectedPlatformOptions: z.record(z.string(), z.string()).default({}),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

export { deviceConfigurationSchema }
export type { DeviceConfiguration }
