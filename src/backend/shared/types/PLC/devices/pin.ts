import { z } from 'zod'

const pinTypes = ['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput'] as const
type PinTypes = (typeof pinTypes)[number]

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
 *
 * The `alias` field is the user-supplied label for the pin. It participates
 * in the alias registry along with VPP / Modbus / EtherCAT aliases, so
 * variables in the program can bind to a stable name regardless of the
 * underlying address. Used to be called `name`; loading older projects
 * transparently upgrades `name` to `alias` via the preprocess below.
 */
const devicePinSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === 'object' && 'name' in raw && !('alias' in raw)) {
      const { name, ...rest } = raw as { name: unknown; [k: string]: unknown }
      return { ...rest, alias: typeof name === 'string' ? name : '' }
    }
    return raw
  },
  z.object({
    pin: z.string().min(1),
    pinType: z.enum(pinTypes),
    address: z.string(),
    alias: z.string().optional(),
  }),
)
type DevicePin = z.infer<typeof devicePinSchema>

/**
 * On-disk schema for `devices/pin-mapping.json`. Accepts both shapes
 * the codebase has historically emitted so older projects keep
 * loading without manual migration:
 *
 *  - **Per-board dict** (`Record<string, DevicePin[]>`) — the
 *    canonical post-migration shape. Each entry's key is a
 *    `BoardInfo.name` (the value of `configuration.deviceBoard`).
 *    Pin configuration is preserved per target so switching
 *    Mega ↔ MKR ↔ back doesn't lose work.
 *  - **Legacy flat array** (`DevicePin[]`) — what the editor wrote
 *    before per-board scoping landed. The store-side reload action
 *    (`setDeviceDefinitions`) takes the array verbatim and keys it
 *    under whatever `configuration.deviceBoard` names as the active
 *    target on first load; once the user saves again the file is
 *    rewritten in the dict shape.
 *
 * The legacy branch is kept as a union member rather than wrapped in
 * preprocess so consumers can introspect which shape was on disk
 * (the project-files parser doesn't need that today, but the
 * cleaner contract avoids a "what did this just become?" footgun
 * if a migration tool needs the distinction later).
 */
const pinMappingFileSchema = z.union([z.record(z.string(), devicePinSchema.array()), devicePinSchema.array()])

export { devicePinSchema, pinMappingFileSchema, pinTypes }
export type { DevicePin, PinTypes }
