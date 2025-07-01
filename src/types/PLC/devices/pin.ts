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
 */
const devicePinSchema = z.object({
  pin: z.string().max(6),
  pinType: z.enum(pinTypes),
  address: z.string(),
  name: z.string().optional(),
})
type DevicePin = z.infer<typeof devicePinSchema>

export { DevicePin, devicePinSchema, PinTypes, pinTypes }
