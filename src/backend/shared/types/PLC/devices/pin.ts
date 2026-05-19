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

export { devicePinSchema, pinTypes }
export type { DevicePin, PinTypes }
