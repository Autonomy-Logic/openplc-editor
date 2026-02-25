/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEnum,
  ZodLiteral,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodString,
  ZodTuple,
  ZodTypeAny,
  ZodUnion,
} from 'zod'

export const getDefaultSchemaValues = (schema: ZodTypeAny): unknown => {
  if (schema instanceof ZodDefault) return schema._def.defaultValue()
  if (schema instanceof ZodObject) {
    const shape = schema.shape
    return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, getDefaultSchemaValues(v as ZodTypeAny)]))
  }
  if (schema instanceof ZodArray) return []
  if (schema instanceof ZodString) return ''
  if (schema instanceof ZodNumber) return 0
  if (schema instanceof ZodBoolean) return false
  if (schema instanceof ZodEnum) return schema.options[0]
  if (schema instanceof ZodLiteral) return schema._def.value
  if (schema instanceof ZodRecord) return {}
  if (schema instanceof ZodNullable) return null
  if (schema instanceof ZodOptional) return getDefaultSchemaValues(schema._def.innerType as ZodTypeAny)
  if (schema instanceof ZodUnion) return getDefaultSchemaValues(schema._def.options[0] as ZodTypeAny)
  if (schema instanceof ZodDiscriminatedUnion) return getDefaultSchemaValues(schema._def.options[0] as ZodTypeAny)
  if (schema instanceof ZodTuple) return (schema.items as ZodTypeAny[]).map(getDefaultSchemaValues)
  return null
}
