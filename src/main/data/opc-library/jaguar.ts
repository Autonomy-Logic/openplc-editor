interface FileHeader {
    companyName: string;
    productName: string;
    productVersion: string;
    creationDateTime: string;
  }

  interface CoordinateScaling {
    x: number;
    y: number;
  }

  interface CoordinateInfo {
    fbd: {
      scaling: CoordinateScaling;
    };
    ld: {
      scaling: CoordinateScaling;
    };
    sfc: {
      scaling: CoordinateScaling;
    };
  }

  interface SINTType {
    SINT: object;
  }

  interface BOOLType {
    BOOL: object;
  }

  type VariableType = SINTType | BOOLType;

  interface Variable {
    name: string;
    type: VariableType;
    documentation?: {
      xhtml: {
        p: string;
      };
    };
  }

  interface Interface {
    inputVars?: Variable[];
    localVars?: Variable[];
    outputVars?: Variable[];
  }

  interface Body {
    ST: {
      xhtml: {
        p: string;
      };
    };
  }

  interface Documentation {
    xhtml: {
      p: string;
    };
  }

  interface Pou {
    name: string;
    pouType: string;
    interface: Interface;
    body: Body;
    documentation: Documentation;
  }

  interface Types {
    dataTypes: object; // If you have specific types for dataTypes, replace this with a proper type
    pous: Pou[];
  }

  interface Instances {
    configurations: object; // If you have specific types for configurations, replace this with a proper type
  }

  interface JaguarProject {
    fileHeader: FileHeader;
    contentHeader: {
      name: string;
      author: string;
      modificationDateTime: string;
      coordinateInfo: CoordinateInfo;
    };
    types: Types;
    instances: Instances;
  }

  const jaguarProject: JaguarProject = {
    fileHeader: {
      companyName: "OpenPLC",
      productName: "Jaguar",
      productVersion: "1.0",
      creationDateTime: "2023-04-26T04:54:00",
    },
    contentHeader: {
      name: "Jaguar",
      author: "OpenPLC Lib Writter",
      modificationDateTime: "2023-04-26T04:54:00",
      coordinateInfo: {
        fbd: {
          scaling: {
            x: 0,
            y: 0,
          },
        },
        ld: {
          scaling: {
            x: 0,
            y: 0,
          },
        },
        sfc: {
          scaling: {
            x: 0,
            y: 0,
          },
        },
      },
    },
    types: {
      dataTypes: {},
      pous: [
        {
          name: "ADC_CONFIG",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "ADC_CH",
                type: { SINT: {} },
                documentation: {
                  xhtml: {
                    p: "ADC_CH",
                  },
                },
              },
              {
                name: "ADC_TYPE",
                type: { SINT: {} },
                documentation: {
                  xhtml: {
                    p: "ADC_TYPE",
                  },
                },
              },
            ],
            localVars: [
              {
                name: "ADC_CH_LOCAL",
                type: { SINT: {} },
                documentation: {
                  xhtml: {
                    p: "ADC_CH_LOCAL",
                  },
                },
              },
              {
                name: "ADC_TYPE_LOCAL",
                type: { SINT: {} },
                documentation: {
                  xhtml: {
                    p: "ADC_TYPE_LOCAL",
                  },
                },
              },
            ],
            outputVars: [
              {
                name: "SUCCESS",
                type: { BOOL: {} },
                documentation: {
                  xhtml: {
                    p: "SUCCESS",
                  },
                },
              },
            ],
          },
          body: {
            ST: {
              xhtml: {
                p: `
    IF ADC_CH <> ADC_CH_LOCAL OR ADC_TYPE <> ADC_TYPE_LOCAL THEN
      ADC_CH_LOCAL := ADC_CH;
      ADC_TYPE_LOCAL := ADC_TYPE;
      SUCCESS := TRUE;
    ELSE
      SUCCESS := FALSE;
    END_IF;
  `,
              },
            },
          },
          documentation: {
            xhtml: {
              p: `Configures the analog channel inputs on the Jaguar board. ADC_CH must be between 0 - 3. ADC_TYPE must be between 0 - 3, where 0 = unipolar 10V, 1 = bipolar 10V, 2 = unipolar 5V, and 3 = bipolar 5V. Upon successful configuration of the ADC, SUCCESS is set to TRUE.`,
            },
          },
        },
      ],
    },
    instances: {
      configurations: {},
    },
  };

  export default jaguarProject;
