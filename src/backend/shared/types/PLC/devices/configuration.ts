import { z } from 'zod'

const persistentStorageSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().default(''),
  flushSeconds: z.number().int().default(5),
})

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
  // Persistent storage (RETAIN) for the runtime's built-in file store.
  //
  // A PROJECT property, not a device one. It travels with the project, is
  // configurable offline, and reaches the device as `retain.conf` in the upload
  // — the same shape as VPP plugin config. Optional so every project written
  // before this field still validates; absent means "this project does not use
  // persistent storage", which is also what tells the runtime's built-in store
  // to stay switched off.
  //
  // An empty `path` means "use the runtime's default". The editor deliberately
  // does not hardcode a device filesystem layout — the runtime fills it in.
  persistentStorage: persistentStorageSchema.optional(),
  // Per-board archive, mirroring `vendorScreenDataByBoard`: a storage path is a
  // property of the target box, not of the program, so retargeting must not
  // silently carry one device's path onto another.
  persistentStorageByBoard: z.record(z.string(), persistentStorageSchema).optional(),
  // User picks from VPP `target.platformOptions` (e.g. Nano cpu=atmega328old).
  // Keyed by option `key`, value is the chosen `values[].id`. The compile and
  // upload pipelines fall back to each manifest option's `default` when a key
  // is missing here.
  selectedPlatformOptions: z.record(z.string(), z.string()).default({}),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>

export { deviceConfigurationSchema, persistentStorageSchema }
export type { DeviceConfiguration }
