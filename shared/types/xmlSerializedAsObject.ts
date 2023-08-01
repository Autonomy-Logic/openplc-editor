import { z } from 'zod'

type XMLSerialized = {
  [key: string]: XMLSerialized | string
}

export const xmlSerializedSchema: z.ZodSchema<XMLSerialized> = z.lazy(() =>
  z.record(z.union([z.string(), xmlSerializedSchema])),
)

export type XMLSerializedAsObjectProps = z.infer<typeof xmlSerializedSchema>
