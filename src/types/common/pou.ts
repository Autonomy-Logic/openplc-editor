/* eslint-disable @typescript-eslint/no-unused-vars */
const DefaultPOUShape = {
  '@name': 'program0',
  '@pouType': 'program',
  interface: {
    returnType: 'BOOL',
    localVars: {
      variable: {
        '@name': 'LocalVar0',
        type: 'INT',
        initialValue: { simpleValue: { '@value': '0' } },
      },
    },
  },
  body: {
    IL: {
      'xhtml:p': '<![CDATA[]]>',
    },
  },
  documentation: {
    'xhtml:p': '<![CDATA[]]>',
  },
};

export type PouShape = typeof DefaultPOUShape;

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
