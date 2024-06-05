import { z } from 'zod'

const dataTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  derivation: z.discriminatedUnion('type', [
    /** This array needs to be reviewed */
    z.object({
      type: z.literal('array'),
      baseType: z.enum([
        'bool',
        'sint',
        'int',
        'dint',
        'lint',
        'usint',
        'uint',
        'udint',
        'ulint',
        'real',
        'lreal',
        'time',
        'date',
        'tod',
        'dt',
        'string',
        'byte',
        'word',
        'dword',
        'lword',
        'loglevel',
        /** Can also be a local datatype - created by the user */
      ]),
      /** This property needs to be updated to validate if the right number is higher than the left */
      dimensions: z.array(z.string().regex(/^(\d+)\.\.(\d+)$/)),
    }),
    /** This enumerated needs to be reviewed */
    z.object({
      type: z.literal('enumerated'),
      values: z.array(z.string()),
      /** The initial value must be one of the values created */
      initialValue: z.string(),
    }),
    /** This structure needs to be reviewed */
    z.object({
      type: z.literal('structure'),
      elements: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          type: z.discriminatedUnion('type', [
            z.object({
              type: z.literal('base-type'),
              value: z.enum([
                'bool',
                'sint',
                'int',
                'dint',
                'lint',
                'usint',
                'uint',
                'udint',
                'ulint',
                'real',
                'lreal',
                'time',
                'date',
                'tod',
                'dt',
                'string',
                'byte',
                'word',
                'dword',
                'lword',
                'loglevel',
              ]),
            }),
            z.object({
              type: z.literal('array'),
              value: z.object({
                baseType: z.enum([
                  'bool',
                  'sint',
                  'int',
                  'dint',
                  'lint',
                  'usint',
                  'uint',
                  'udint',
                  'ulint',
                  'real',
                  'lreal',
                  'time',
                  'date',
                  'tod',
                  'dt',
                  'string',
                  'byte',
                  'word',
                  'dword',
                  'lword',
                ]),
                /** This property needs to be updated to validate if the right number is higher than the left */
                dimensions: z.string().regex(/^(\d+)\.\.(\d+)$/),
              }),
            }),
          ]),
        }),
      ),
    }),
  ]),
})

type IDatatype = z.infer<typeof dataTypeSchema>
export { dataTypeSchema, IDatatype }
