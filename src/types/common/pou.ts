/* eslint-disable @typescript-eslint/no-unused-vars */
const DefaultPOUShape = {
  pou: {
    '@name': 'program0',
    '@pouType': 'program',
    body: {},
  },
};
const ILPouAttributes = {
  interface: {
    returnType: ['BOOL', 'INT', 'DINT'],
  },
};
const STPouAttributes = {};
const DefaultGraphicalPOUBody = {
  LD: {},
  FBD: {},
  SFC: {},
};
const DefaultTextualPOUBody = {
  IL: {
    'xhtml:p': '<![CDATA[Dummy body data for pou mock]]>',
  },
  ST: {
    'xhtml:p': '<![CDATA[Dummy body data for pou mock]]>',
  },
};

export type PouDTO = typeof DefaultPOUShape;

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
