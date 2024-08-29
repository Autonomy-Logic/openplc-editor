type Variable = {
  name: string
  type: string
  documentation?: string
}

type Interface = {
  inputVars?: Variable[]
  outputVars?: Variable[]
  localVars?: Variable[]
}

type POU = {
  name: string
  pouType: string
  interface: Interface
  body: string
  documentation?: string
}

type FileHeader = {
  companyName: string
  productName: string
  productVersion: string
  creationDateTime: string
}

type ContentHeader = {
  name: string
  author: string
  modificationDateTime: string
}

type FunctionBlocks = {
  fileHeader: FileHeader
  contentHeader: ContentHeader
  pous: POU[]
}

const _arduinoFunctionBlocks: FunctionBlocks = {
  fileHeader: {
    companyName: 'OpenPLC',
    productName: 'Arduino Function Blocks Library',
    productVersion: '1.0',
    creationDateTime: '2021-11-11T02:33:11',
  },
  contentHeader: {
    name: 'Arduino Function Blocks',
    author: 'Thiago Alves',
    modificationDateTime: '2021-11-11T02:33:11',
  },
  pous: [
    {
      name: 'DS18B20',
      pouType: 'functionBlock',
      interface: {
        inputVars: [
          {
            name: 'PIN',
            type: 'SINT',
            documentation: 'Arduino pin where sensor is connected to',
          },
        ],
        outputVars: [
          {
            name: 'OUT',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
        ],
      },
      body: 'OUT := 0.0;',
      documentation: 'Reads temperature from one DS18B20 one-wire sensor connected to the pin specified in PIN',
    },
    {
      name: 'DS18B20_2_OUT',
      pouType: 'functionBlock',
      interface: {
        inputVars: [
          {
            name: 'PIN',
            type: 'SINT',
            documentation: 'Arduino pin where sensor is connected to',
          },
        ],
        outputVars: [
          {
            name: 'OUT_0',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
          {
            name: 'OUT_1',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
        ],
      },
      body: 'OUT := 0.0;',
      documentation:
        'Reads temperature from two DS18B20 one-wire sensors. Both sensors must be on the same bus connected to the pin specified in PIN',
    },
    {
      name: 'DS18B20_3_OUT',
      pouType: 'functionBlock',
      interface: {
        inputVars: [
          {
            name: 'PIN',
            type: 'SINT',
            documentation: 'Arduino pin where sensor is connected to',
          },
        ],
        outputVars: [
          {
            name: 'OUT_0',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
          {
            name: 'OUT_1',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
          {
            name: 'OUT_2',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
        ],
      },
      body: 'OUT := 0.0;',
      documentation:
        'Reads temperature from three DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN',
    },
    {
      name: 'DS18B20_4_OUT',
      pouType: 'functionBlock',
      interface: {
        inputVars: [
          {
            name: 'PIN',
            type: 'SINT',
            documentation: 'Arduino pin where sensor is connected to',
          },
        ],
        outputVars: [
          {
            name: 'OUT_0',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
          {
            name: 'OUT_1',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
          {
            name: 'OUT_2',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
          {
            name: 'OUT_3',
            type: 'REAL',
            documentation: 'Temperature output in Celsius',
          },
        ],
      },
      body: 'OUT := 0.0;',
      documentation:
        'Reads temperature from four DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN',
    },
    {
      name: 'PWM_CONTROLLER',
      pouType: 'functionBlock',
      interface: {
        inputVars: [
          {
            name: 'CHANNEL',
            type: 'SINT',
            documentation: 'PWM channel',
          },
          {
            name: 'FREQ',
            type: 'REAL',
            documentation: 'PWM frequency',
          },
          {
            name: 'DUTY',
            type: 'REAL',
            documentation: 'PWM duty cycle',
          },
        ],
        localVars: [
          {
            name: 'internal_ch',
            type: 'SINT',
            documentation: 'Internal channel',
          },
          {
            name: 'internal_freq',
            type: 'REAL',
            documentation: 'Internal frequency',
          },
          {
            name: 'internal_duty',
            type: 'REAL',
            documentation: 'Internal duty cycle',
          },
        ],
        outputVars: [
          {
            name: 'SUCCESS',
            type: 'BOOL',
            documentation: 'Indicates if PWM setup was successful',
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
      documentation:
        'Configures the PWM peripheral to generate a signal. If the hardware does not support it, the signal is generated via software.',
    },
    {
      name: 'LED_CONTROLLER',
      pouType: 'functionBlock',
      interface: {
        inputVars: [
          {
            name: 'PIN',
            type: 'SINT',
            documentation: 'Arduino pin connected to the LED',
          },
          {
            name: 'STATE',
            type: 'BOOL',
            documentation: 'LED state (ON/OFF)',
          },
        ],
      },
      body: `
        IF STATE THEN
          // Code to turn the LED on
        ELSE
          // Code to turn the LED off
        END_IF;
      `,
      documentation: 'Controls an LED connected to the specified Arduino pin.',
    },
    {
      name: 'MOTOR_CONTROLLER',
      pouType: 'functionBlock',
      interface: {
        inputVars: [
          {
            name: 'SPEED',
            type: 'REAL',
            documentation: 'Motor speed control',
          },
        ],
        outputVars: [
          {
            name: 'MOTOR_STATE',
            type: 'BOOL',
            documentation: 'Current state of the motor',
          },
        ],
      },
      body: `
        IF SPEED > 0 THEN
          MOTOR_STATE := TRUE;
        ELSE
          MOTOR_STATE := FALSE;
        END_IF;
      `,
      documentation: 'Controls the speed and state of a motor.',
    },
  ],
}
