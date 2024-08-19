// eslint-disable-next-line @typescript-eslint/no-unused-vars
const P1AM = {
  fileHeader: {
    companyName: 'OpenPLC',
    productName: 'P1AM Function Blocks Library',
    productVersion: '1.0',
    creationDateTime: '2021-11-11T02:33:11',
  },
  contentHeader: {
    name: 'P1AM Function Blocks',
    author: 'Thiago Alves',
    modificationDateTime: '2021-11-11T02:33:11',
    coordinateInfo: {
      fbd: { scaling: { x: '0', y: '0' } },
      ld: { scaling: { x: '0', y: '0' } },
      sfc: { scaling: { x: '0', y: '0' } },
    },
  },
  types: {
    pous: [
      {
        name: 'P1AM_INIT',
        pouType: 'functionBlock',
        interface: {
          inputVars: [{ name: 'INIT', type: 'BOOL' }],
          outputVars: [{ name: 'SUCCESS', type: 'SINT' }],
        },
        body: {
          ST: {
            content: 'SUCCESS := 0;',
          },
        },
        documentation: {
          content:
            "Initialize P1AM Modules and return the number of initialized modules on SUCCESS. If SUCCESS is zero, an error has occurred, or there aren't any modules on the bus",
        },
      },
      {
        name: 'P1_16CDR',
        pouType: 'functionBlock',
        interface: {
          inputVars: [
            { name: 'SLOT', type: 'SINT' },
            { name: 'O1', type: 'BOOL' },
            { name: 'O2', type: 'BOOL' },
            { name: 'O3', type: 'BOOL' },
            { name: 'O4', type: 'BOOL' },
            { name: 'O5', type: 'BOOL' },
            { name: 'O6', type: 'BOOL' },
            { name: 'O7', type: 'BOOL' },
            { name: 'O8', type: 'BOOL' },
          ],
          outputVars: [
            { name: 'I1', type: 'BOOL' },
            { name: 'I2', type: 'BOOL' },
            { name: 'I3', type: 'BOOL' },
            { name: 'I4', type: 'BOOL' },
            { name: 'I5', type: 'BOOL' },
            { name: 'I6', type: 'BOOL' },
            { name: 'I7', type: 'BOOL' },
            { name: 'I8', type: 'BOOL' },
          ],
        },
        body: {
          ST: {
            content: 'I1 := 0;',
          },
        },
        documentation: {
          content:
            'Get all inputs and update all outputs from P1-16CDR module. Also works with P1-15CDD1 and P1-15CDD2',
        },
      },
      {
        name: 'P1_08N',
        pouType: 'functionBlock',
        interface: {
          inputVars: [{ name: 'SLOT', type: 'SINT' }],
          outputVars: [
            { name: 'I1', type: 'BOOL' },
            { name: 'I2', type: 'BOOL' },
            { name: 'I3', type: 'BOOL' },
            { name: 'I4', type: 'BOOL' },
            { name: 'I5', type: 'BOOL' },
            { name: 'I6', type: 'BOOL' },
            { name: 'I7', type: 'BOOL' },
            { name: 'I8', type: 'BOOL' },
          ],
        },
        body: {
          ST: {
            content: 'I1 := 0;',
          },
        },
        documentation: {
          content: 'Get all inputs from P1-08Nxx modules. Compatible with P1-08NA, P1-08ND3, P1-08NE3 and P1-08SIM',
        },
      },
      {
        name: 'P1_16N',
        pouType: 'functionBlock',
        interface: {
          inputVars: [{ name: 'SLOT', type: 'SINT' }],
          outputVars: [
            { name: 'I1', type: 'BOOL' },
            { name: 'I2', type: 'BOOL' },
            { name: 'I3', type: 'BOOL' },
            { name: 'I4', type: 'BOOL' },
            { name: 'I5', type: 'BOOL' },
            { name: 'I6', type: 'BOOL' },
            { name: 'I7', type: 'BOOL' },
            { name: 'I8', type: 'BOOL' },
            { name: 'I9', type: 'BOOL' },
            { name: 'I10', type: 'BOOL' },
            { name: 'I11', type: 'BOOL' },
            { name: 'I12', type: 'BOOL' },
            { name: 'I13', type: 'BOOL' },
            { name: 'I14', type: 'BOOL' },
            { name: 'I15', type: 'BOOL' },
            { name: 'I16', type: 'BOOL' },
          ],
        },
        body: {
          ST: {
            content: 'I1 := 0;',
          },
        },
        documentation: {
          content: 'Get all inputs from P1-16Nxx modules. Compatible with P1-16ND3 and P1-16NE3',
        },
      },
      {
        name: 'P1_08T',
        pouType: 'functionBlock',
        interface: {
          inputVars: [
            { name: 'SLOT', type: 'SINT' },
            { name: 'O1', type: 'BOOL' },
            { name: 'O2', type: 'BOOL' },
            { name: 'O3', type: 'BOOL' },
            { name: 'O4', type: 'BOOL' },
            { name: 'O5', type: 'BOOL' },
            { name: 'O6', type: 'BOOL' },
            { name: 'O7', type: 'BOOL' },
            { name: 'O8', type: 'BOOL' },
          ],
          localVars: [{ name: 'DUMMY', type: 'SINT' }],
        },
        body: {
          ST: {
            content: 'DUMMY := SLOT;',
          },
        },
        documentation: {
          content: 'Set all outputs on P1-08Txx modules. Compatible with P1-08TA, P1-08TD1, P1-08TD2 and P1-08TRS',
        },
      },
      {
        name: 'P1_16TR',
        pouType: 'functionBlock',
        interface: {
          inputVars: [
            { name: 'SLOT', type: 'SINT' },
            { name: 'O1', type: 'BOOL' },
            { name: 'O2', type: 'BOOL' },
            { name: 'O3', type: 'BOOL' },
            { name: 'O4', type: 'BOOL' },
            { name: 'O5', type: 'BOOL' },
            { name: 'O6', type: 'BOOL' },
            { name: 'O7', type: 'BOOL' },
            { name: 'O8', type: 'BOOL' },
            { name: 'O9', type: 'BOOL' },
            { name: 'O10', type: 'BOOL' },
            { name: 'O11', type: 'BOOL' },
            { name: 'O12', type: 'BOOL' },
            { name: 'O13', type: 'BOOL' },
            { name: 'O14', type: 'BOOL' },
            { name: 'O15', type: 'BOOL' },
            { name: 'O16', type: 'BOOL' },
          ],
        },
        body: {
          ST: {
            content: 'I1 := 0;',
          },
        },
        documentation: {
          content:
            'Get all inputs and update all outputs from P1-16CDR module. Also works with P1-15CDD1 and P1-15CDD2',
        },
      },
    ],
  },
  instances: {
    configurations: [],
  },
}
