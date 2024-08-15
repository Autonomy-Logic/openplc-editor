interface Variable {
    name: string;
    type: string;
    documentation?: string;
}

interface BaseInterface {
    inputVars?: Variable[];
    outputVars?: Variable[];
    localVars?: Variable[];
}

interface InterfaceWithInputOutputVars extends BaseInterface {
    inputVars: Variable[];
    outputVars: Variable[];
}

  interface POU {
    name: string;
    pouType: string;
    interface: Interface;
    body: string;
    documentation?: string;
  }

  interface FunctionBlocks {
    fileHeader: {
      companyName: string;
      productName: string;
      productVersion: string;
      creationDateTime: string;
    };
    contentHeader: {
      name: string;
      author: string;
      modificationDateTime: string;
    };
    pous: POU[];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const arduino_Function_Blocks: FunctionBlocks = {
    fileHeader: {
      companyName: "OpenPLC",
      productName: "Arduino Function Blocks Library",
      productVersion: "1.0",
      creationDateTime: "2021-11-11T02:33:11",
    },
    contentHeader: {
      name: "Arduino Function Blocks",
      author: "Thiago Alves",
      modificationDateTime: "2021-11-11T02:33:11",
    },
    pous: [
      {
        name: "DS18B20",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "PIN",
              type: "SINT",
              documentation: "Arduino pin where sensor is connected to",
            },
          ],
          outputVars: [
            {
              name: "OUT",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
          ],
        },
        body: "OUT := 0.0;",
        documentation: "Reads temperature from one DS18B20 one-wire sensor connected to the pin specified in PIN",
      },
      {
        name: "DS18B20_2_OUT",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "PIN",
              type: "SINT",
              documentation: "Arduino pin where sensor is connected to",
            },
          ],
          outputVars: [
            {
              name: "OUT_0",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_1",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
          ],
        },
        body: "OUT := 0.0;",
        documentation: "Reads temperature from two DS18B20 one-wire sensors. Both sensors must be on the same bus connected to the pin specified in PIN",
      },
      {
        name: "DS18B20_3_OUT",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "PIN",
              type: "SINT",
              documentation: "Arduino pin where sensor is connected to",
            },
          ],
          outputVars: [
            {
              name: "OUT_0",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_1",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_2",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
          ],
        },
        body: "OUT := 0.0;",
        documentation: "Reads temperature from three DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN",
      },
      {
        name: "DS18B20_4_OUT",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "PIN",
              type: "SINT",
              documentation: "Arduino pin where sensor is connected to",
            },
          ],
          outputVars: [
            {
              name: "OUT_0",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_1",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_2",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_3",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
          ],
        },
        body: "OUT := 0.0;",
        documentation: "Reads temperature from four DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN",
      },
      {
        name: "DS18B20_5_OUT",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "PIN",
              type: "SINT",
              documentation: "Arduino pin where sensor is connected to",
            },
          ],
          outputVars: [
            {
              name: "OUT_0",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_1",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_2",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_3",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
            {
              name: "OUT_4",
              type: "REAL",
              documentation: "Temperature output in Celsius",
            },
          ],
        },
        body: "OUT := 0.0;",
        documentation: "Reads temperature from five DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN",
      },
      {
        name: "CLOUD_ADD_BOOL",
        pouType: "functionBlock",
        interface: {
            inputVars: [
                {
                    name: "VAR_NAME",
                    type: "string",
                },
                {
                    name: "BOOL_VAR",
                    type: "BOOL",
                },
            ],
            outputVars: []
        },
        body: "SSID := SSID;",
        documentation: "Add a BOOL variable to sync with the Arduino Cloud. VAR_NAME must have the same name as the variable set up in the Arduino IoT Cloud",
      },
      {
        name: "CLOUD_ADD_DINT",
        pouType: "functionBlock",
        interface: {
            inputVars: [
                {
                    name: "VAR_NAME",
                    type: "string",
                },
                {
                    name: "DINT_VAR",
                    type: "DINT",
                },
            ],
            outputVars: []
        },
        body: "SSID := SSID;",
        documentation: "Add an DINT variable (Arduino int) to sync with the Arduino Cloud. VAR_NAME must have the same name as the variable set up in the Arduino IoT Cloud",
      },
      {
        name: "CLOUD_ADD_REAL",
        pouType: "functionBlock",
        interface: {
            inputVars: [
                {
                    name: "VAR_NAME",
                    type: "string",
                },
                {
                    name: "REAL_VAR",
                    type: "REAL",
                },
            ],
            outputVars: []
        },
        body: "SSID := SSID;",
        documentation: "Add a REAL variable (Arduino float) to sync with the Arduino Cloud. VAR_NAME must have the same name as the variable set up in the Arduino IoT Cloud",
      },
      {
        name: "CLOUD_BEGIN",
        pouType: "functionBlock",
        interface: {
            inputVars: [
                {
                    name: "THING_ID",
                    type: "string",
                },
                {
                    name: "SSID",
                    type: "string",
                },
                {
                    name: "PASS",
                    type: "string",
                },
            ],
            outputVars: []
        },
        body: "SSID := SSID;",
        documentation: "Setup and initialize Arduino Cloud communication. Must be called before adding any variables (properties).",
      },
      {
        name: "PWM_CONTROLLER",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "CHANNEL",
              type: "SINT",
              documentation: "CHANNEL",
            },
            {
              name: "FREQ",
              type: "REAL",
              documentation: "FREQ",
            },
            {
              name: "DUTY",
              type: "REAL",
              documentation: "DUTY",
            },
          ],
          localVars: [
            {
              name: "internal_ch",
              type: "SINT",
              documentation: "internal_ch",
            },
            {
              name: "internal_freq",
              type: "REAL",
              documentation: "internal_freq",
            },
            {
              name: "internal_duty",
              type: "REAL",
              documentation: "internal_duty",
            },
          ],
          outputVars: [
            {
              name: "SUCCESS",
              type: "BOOL",
              documentation: "SUCCESS",
            },
          ],
        },
        body: `
          IF CHANNEL < 1 THEN
            SUCCESS := FALSE;
            RETURN;
          END_IF;

          IF (CHANNEL <> internal_ch) OR (FREQ <> internal_freq) OR (DUTY <> internal_duty) THEN
            SUCCESS := TRUE;
          END_IF;
        `,
        documentation: "Configures the CPU internal PWM peripheral to generate a PWM signal through hardware. If the CPU does not have a PWM peripheral, this block can be used to generate software-based PWM signal using the default_timer function.",
      },
      {
        name: "SERVO_CONTROLLER",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "PIN",
              type: "SINT",
              documentation: "Arduino pin where servo motor is connected to",
            },
            {
              name: "ANGLE",
              type: "REAL",
              documentation: "Desired servo angle",
            },
          ],
          localVars: [
            {
              name: "internal_pin",
              type: "SINT",
              documentation: "internal_pin",
            },
            {
              name: "internal_angle",
              type: "REAL",
              documentation: "internal_angle",
            },
          ],
          outputVars: [
            {
              name: "SUCCESS",
              type: "BOOL",
              documentation: "Set to true if the servo motor was successfully moved",
            },
          ],
        },
        body: `
          IF PIN < 0 THEN
            SUCCESS := FALSE;
            RETURN;
          END_IF;

          IF (PIN <> internal_pin) OR (ANGLE <> internal_angle) THEN
            SUCCESS := TRUE;
          END_IF;
        `,
        documentation: "Sets the angle of a standard servo motor connected to the Arduino pin defined in PIN.",
      },
      {
        name: "STEPPER_MOTOR",
        pouType: "functionBlock",
        interface: {
          inputVars: [
            {
              name: "STEP_PIN",
              type: "SINT",
              documentation: "Arduino pin where STEP is connected to",
            },
            {
              name: "DIR_PIN",
              type: "SINT",
              documentation: "Arduino pin where DIR is connected to",
            },
            {
              name: "ENABLE_PIN",
              type: "SINT",
              documentation: "Arduino pin where ENABLE is connected to",
            },
            {
              name: "STEPS",
              type: "DINT",
              documentation: "Number of steps to be taken",
            },
            {
              name: "DIR",
              type: "BOOL",
              documentation: "Direction of rotation (TRUE for clockwise, FALSE for counter-clockwise)",
            },
          ],
          outputVars: [
            {
              name: "SUCCESS",
              type: "BOOL",
              documentation: "Set to true if the stepper motor was successfully moved",
            },
          ],
        },
        body: `
          IF STEP_PIN < 0 OR DIR_PIN < 0 OR ENABLE_PIN < 0 THEN
            SUCCESS := FALSE;
            RETURN;
          END_IF;

          IF STEPS > 0 THEN
            SUCCESS := TRUE;
          END_IF;
        `,
        documentation: "Controls a stepper motor using the given step, direction, and enable pins. The number of steps to be taken and the direction are also specified.",
      },
    ],
  };
