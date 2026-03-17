import { z } from 'zod'

/* eslint-disable @typescript-eslint/no-unused-vars */
const pouSchema = z.object({
  '@name': z.string(),
  '@pouType': z.enum(['program', 'function']),
  interface: z.object({
    returnType: z.enum(['BOOL', 'INT', 'DINT']),
    localVars: z
      .object({
        variables: z.array(
          z.object({
            '@name': z.string(),
            type: z.enum(['BOOL', 'INT', 'DINT']),
            initialValue: z.any(),
          }),
        ),
      })
      .optional(),
  }),
  body: z.object({
    IL: z
      .object({
        'xhtml:p': z.string(),
      })
      .optional(),
    ST: z
      .object({
        'xhtml:p': z.string(),
      })
      .optional(),
  }),
  documentation: z
    .object({
      'xhtml:p': z.string(),
    })
    .optional(),
})

export type PouShape = z.infer<typeof pouSchema>

const ILPouAttributes = {
  interface: {
    returnType: ['BOOL', 'INT', 'DINT'],
  },
}
const STPouAttributes = {}
const DefaultGraphicalPOUBody = {
  LD: {},
  FBD: {},
  SFC: {},
}
const DefaultTextualPOUBody = {
  IL: {
    'xhtml:p': {
      $: '', // REVIEW: Must turn this node into a CDATA tag with xmlbuilder
    },
  },
  ST: {
    'xhtml:p': '<![CDATA[Dummy body data for pou mock]]>',
  },
}
// interface: {
//   returnType: { BOOL: {} },
//   localVars: {
//     variable: {
//       '@name': 'LocalVar0',
//       type: { DINT: {} },
//       initialValue: { simpleValue: { '@value': '0' } },
//     },
//   },
// },

// documentation: {
//   'xhtml:p': '<![CDATA[Dummy description for pou mock]]>',
// },
