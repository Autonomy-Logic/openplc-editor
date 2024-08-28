const _additional_Function_Blocks = {
    fileHeader: {
      companyName: "Beremiz",
      productName: "Additional Function Blocks Library",
      productVersion: "1.0",
      creationDateTime: "2013-09-09T09:56:11"
    },
    contentHeader: {
      name: "Standard Function Blocks",
      author: "Laurent Bessard",
      modificationDateTime: "2013-09-10T22:45:31",
      coordinateInfo: {
        fbd: {
          scaling: {
            x: 0,
            y: 0
          }
        },
        ld: {
          scaling: {
            x: 0,
            y: 0
          }
        },
        sfc: {
          scaling: {
            x: 0,
            y: 0
          }
        }
      }
    },
    types: {
      dataTypes: {},
      pous: [
        {
          name: "RTC",
          pouType: "functionBlock",
          interface: {
            inputVars: [
              {
                name: "IN",
                type: "BOOL",
                documentation: "0 - current time, 1 - load time from PDT"
              },
              {
                name: "PDT",
                type: "DT",
                documentation: "Preset datetime"
              }
            ],
            outputVars: [
              {
                name: "Q",
                type: "BOOL",
                initialValue: "FALSE",
                documentation: "Copy of IN"
              },
              {
                name: "CDT",
                type: "DT",
                documentation: "Datetime, current or relative to PDT"
              }
            ],
            localVars: [
              {
                name: "PREV_IN",
                type: "BOOL",
                initialValue: "FALSE"
              },
              {
                name: "OFFSET",
                type: "TIME"
              },
              {
                name: "CURRENT_TIME",
                type: "DT"
              }
            ]
          },
          body: {
            ST: `{__SET_VAR(data__->,CURRENT_TIME,,__CURRENT_TIME)}

            IF IN
            THEN
              IF NOT PREV_IN
              THEN
                  OFFSET := PDT - CURRENT_TIME;
              END_IF;

              (* PDT + time since PDT was loaded *)
              CDT := CURRENT_TIME + OFFSET;
            ELSE
              CDT := CURRENT_TIME;
            END_IF;

            Q := IN;
            PREV_IN := IN;`
          },
          documentation: "The real time clock has many uses including time stamping, setting dates and times of day in batch reports, in alarm messages and so on."
        }
      ]
    }
  };
