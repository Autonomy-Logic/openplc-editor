import { z } from 'zod';

const dataTypeSchema = z.object({
  '@name': z.string(),
  baseType: z.array(
    z.object({
      derivationType: z.object({
        directly: z.object({
          type: z.enum(['BOOL', 'INT', 'DINT']),
        }),
        subrange: z.object({
          subrangeUnsigned: z.object({
            range: z.array(
              z.object({
                '@lower': z.string().default('0'),
                '@upper': z.string().default('0'),
                baseType: z.object({
                  type: z.enum(['BOOL', 'INT', 'DINT']),
                }),
              }),
            ),
          }),
        }),
        enumerated: z.object({
          enum: z.object({
            values: z.object({
              value: z.object({
                '@name': z.string(),
              }),
            }),
          }),
        }),
        array: z.object({
          array: z.object({
            dimension: z.array(
              z.object({
                '@lower': z.string(),
                '@upper': z.string(),
                baseType: z.object({
                  derived: z.object({
                    '@name': z.string(),
                  }),
                }),
              }),
            ),
          }),
        }),
        struct: z.object({
          struct: z.object({
            variable: z.array(
              z.object({
                '@name': z.string(),
                type: z.enum(['BOOL', 'INT', 'DINT']),
              }),
            ),
          }),
        }),
      }),
    }),
  ),
  initialValue: z
    .object({
      simpleValue: z.any(),
    })
    .optional(),
});

export type DataTypeShape = z.infer<typeof dataTypeSchema>;
