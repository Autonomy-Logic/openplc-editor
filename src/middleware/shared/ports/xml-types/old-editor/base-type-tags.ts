import { baseTypes } from '@root/frontend/utils/plc-constants/types'
import { z } from 'zod'

/**
 * The `type` / `baseType` block of the old editor's XML: exactly one key, named
 * after an IEC base type, or `derived` for a user data type, or `array`. The
 * value's shape depends on which: the empty string, `{ '@name' }`, or the array
 * block. These schemas only derive the writer's types and nothing parses with
 * them, so the value stays open rather than repeating the writer's union.
 */
const baseTypeTagsSchema = z.object(
  [...baseTypes, 'derived', 'array'].reduce<Record<string, z.ZodOptional<z.ZodUnknown>>>(
    (shape, tag) => ({ ...shape, [tag]: z.unknown().optional() }),
    {},
  ),
)

export { baseTypeTagsSchema }
