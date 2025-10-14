import z from 'zod'

const pouTypesSchema = z.enum(['program', 'function', 'function-block'])
const pouTypesArr = pouTypesSchema.options
type PouType = z.infer<typeof pouTypesSchema>

export type { PouType }
export { pouTypesArr, pouTypesSchema }
