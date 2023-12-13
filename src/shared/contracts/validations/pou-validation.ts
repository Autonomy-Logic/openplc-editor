import { z } from 'zod';

import { CONSTANTS } from '../../data';

const { types } = CONSTANTS;

/* eslint-disable @typescript-eslint/no-unused-vars */
// eslint-disable-next-line import/prefer-default-export
export const PouSchema = z.object({
  '@name': z.string(),
  '@pouType': z.string().refine((t) => Object.values(types).includes(t), {
    message: 'Invalid POU type',
  }),
  interface: z
    .object({
      returnType: z.enum(['BOOL', 'INT', 'DINT']),
      localVars: z.object({
        variables: z.array(
          z.object({
            '@name': z.string(),
            type: z.enum(['BOOL', 'INT', 'DINT']),
            initialValue: z.any(),
          })
        ),
      }),
    })
    .optional(),
  body: z.record(
    z.enum(['IL', 'ST']),
    z.object({
      'xhtml:p': z.object({
        $: z.string(),
      }),
    })
  ),
  documentation: z
    .object({
      'xhtml:p': z.string(),
    })
    .optional(),
});

const LDPouAttributesSchema = {}; // TODO: Add attributes to LDPou schema.
const FBDPouAttributesSchema = {}; // TODO: Add attributes to FBDPou schema.
const SFCPouAttributesSchema = {}; // TODO: Add attributes to SFCPou schema.
const GraphicalPOUBodySchema = {
  LD: {},
  FBD: {},
  SFC: {},
}; // TODO: Add body data to GraphicalPou schema.
const ILPouAttributesSchema = {
  interface: {
    returnType: ['BOOL', 'INT', 'DINT'],
  },
}; // TODO: Add attributes to ILPou schema.
const STPouAttributesSchema = {}; // TODO: Add attributes to STPou schema.
const TextualPOUBodySchema = {
  IL: {
    'xhtml:p': {
      $: '', // REVIEW: Must turn this node into a CDATA tag with xmlbuilder
    },
  },
  ST: {
    'xhtml:p': '<![CDATA[Dummy body data for pou mock]]>',
  },
}; // TODO: Add body data to TextualPou schema.
