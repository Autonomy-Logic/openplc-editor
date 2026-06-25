import { z } from 'zod'

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string().default('OpenPLC Simulator'),
  communicationPort: z.string().default(''),
  runtimeIpAddress: z.string().optional(),
  // Active board's vendor-screen data — the flat view consumers and the
  // compile pipeline read. Always mirrors vendorScreenDataByBoard[deviceBoard].
  vendorScreenData: z.record(z.string(), z.unknown()).optional(),
  // Per-board archive of vendor-screen data. VPP screens are board-specific,
  // so each target keeps its own bucket and switching boards swaps the active
  // view rather than bleeding stale modules across targets. Legacy projects
  // (flat vendorScreenData only) are migrated on load.
  vendorScreenDataByBoard: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  // User picks from VPP `target.platformOptions` (e.g. Nano cpu=atmega328old).
  // Keyed by option `key`, value is the chosen `values[].id`. The compile and
  // upload pipelines fall back to each manifest option's `default` when a key
  // is missing here.
  selectedPlatformOptions: z.record(z.string(), z.string()).default({}),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

export { deviceConfigurationSchema }
export type { DeviceConfiguration }
