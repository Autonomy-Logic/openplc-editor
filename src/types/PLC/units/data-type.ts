import { z } from 'zod'

const dataTypeSchema = z.object({
  dataTypeName: z.string(),
  derivationType: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('directly'),
      baseType: z.enum([
        'BOOL',
        'SINT',
        'INT',
        'DINT',
        'LINT',
        'USINT',
        'UINT',
        'UDINT',
        'ULINT',
        'REAL',
        'LREAL',
        'TIME',
        'DATE',
        'TOD',
        'DT',
        'STRING',
        'BYTE',
        'WORD',
        'DWORD',
        'LWORD',
        'LOGLEVEL',
        /** Can also be a local datatype - created by the user */
      ]),
    }),
    /** This sub range needs to be created/reviewed */
    z.object({
      type: z.literal('subRange'),
      baseType: z.string().default('Will be created later'),
    }),
    /** This enumerated needs to be created/reviewed */
    z.object({
      type: z.literal('enumerated'),
      baseType: z.string().default('Will be created later'),
    }),
    /** This array needs to be created/reviewed */
    z.object({
      type: z.literal('array'),
      baseType: z.string().default('Will be created later'),
    }),
    /** This structure needs to be created/reviewed */
    z.object({
      type: z.literal('structure'),
      baseType: z.string().default('Will be created later'),
    }),
  ]),
  initialValue: z.string().default('Will be created later'),
})

type IDatatype = z.infer<typeof dataTypeSchema>
export { dataTypeSchema, IDatatype }
