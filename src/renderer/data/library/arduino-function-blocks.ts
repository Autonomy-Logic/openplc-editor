import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema } from '@root/types/PLC/library'
import { z } from 'zod'

const ArduinoFunctionBlocksVariableSchema = BaseLibraryVariableSchema

const ArduinoFunctionBlocksPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(ArduinoFunctionBlocksVariableSchema),
})

export const ArduinoFunctionBlocksLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(ArduinoFunctionBlocksPouSchema),
})

type ArduinoFunctionBlocksLibrary = z.infer<typeof ArduinoFunctionBlocksLibrarySchema>

const ArduinoFunctionBlocks: ArduinoFunctionBlocksLibrary = {
  name: 'Arduino Function Blocks',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'src/renderer/data/library/arduino-function-blocks/st',
  cPath: 'src/renderer/data/library/arduino-function-blocks/c',
  pous: [
    {
      name: 'DS18B20',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'PIN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
          documentation: 'Arduino pin where sensor is connected to',
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
      ],
      body: 'OUT := 0.0;',
      documentation: 'Reads temperature from one DS18B20 one-wire sensor connected to the pin specified in PIN',
    },
    {
      name: 'DS18B20_2_OUT',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'PIN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
          documentation: 'Arduino pin where sensor is connected to',
        },
        {
          name: 'OUT_0',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_1',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
      ],
      body: 'OUT := 0.0;',
      documentation:
        'Reads temperature from two DS18B20 one-wire sensors. Both sensors must be on the same bus connected to the pin specified in PIN',
    },
    {
      name: 'DS18B20_3_OUT',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'PIN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
          documentation: 'Arduino pin where sensor is connected to',
        },
        {
          name: 'OUT_0',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_1',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_2',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
      ],
      body: 'OUT := 0.0;',
      documentation:
        'Reads temperature from three DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN',
    },
    {
      name: 'DS18B20_4_OUT',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'PIN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
          documentation: 'Arduino pin where sensor is connected to',
        },
        {
          name: 'OUT_0',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_1',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_2',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_3',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
      ],
      body: 'OUT := 0.0;',
      documentation:
        'Reads temperature from four DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN',
    },
    {
      name: 'DS18B20_5_OUT',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'PIN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
          documentation: 'Arduino pin where sensor is connected to',
        },
        {
          name: 'OUT_0',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_1',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_2',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_3',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
        {
          name: 'OUT_4',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Temperature output in Celsius',
        },
      ],
      body: 'OUT := 0.0;',
      documentation:
        'Reads temperature from five DS18B20 one-wire sensors. All sensors must be on the same bus connected to the pin specified in PIN',
    },
    {
      name: 'CLOUD_ADD_BOOL',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'VAR_NAME', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
        { name: 'BOOL_VAR', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'SSID := SSID;',
      documentation:
        'Add a BOOL variable to sync with the Arduino Cloud. VAR_NAME must have the same name as the variable set up in the Arduino IoT Cloud',
    },
    {
      name: 'CLOUD_ADD_DINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'VAR_NAME', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
        { name: 'DINT_VAR', class: 'input', type: { definition: 'base-type', value: 'DINT' } },
      ],
      body: 'SSID := SSID;',
      documentation:
        'Add an DINT variable (Arduino int) to sync with the Arduino Cloud. VAR_NAME must have the same name as the variable set up in the Arduino IoT Cloud',
    },
    {
      name: 'CLOUD_ADD_REAL',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'VAR_NAME', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
        { name: 'REAL_VAR', class: 'input', type: { definition: 'base-type', value: 'REAL' } },
      ],
      body: 'SSID := SSID;',
      documentation:
        'Add a REAL variable (Arduino float) to sync with the Arduino Cloud. VAR_NAME must have the same name as the variable set up in the Arduino IoT Cloud',
    },
    {
      name: 'CLOUD_BEGIN',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'THING_ID', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
        { name: 'SSID', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
        { name: 'PASS', class: 'input', type: { definition: 'base-type', value: 'STRING' } },
      ],
      body: 'SSID := SSID;',
      documentation:
        'Setup and initialize Arduino Cloud communication. Must be called before adding any variables (properties).',
    },
    {
      name: 'PWM_CONTROLLER',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CHANNEL', class: 'input', type: { definition: 'base-type', value: 'SINT' }, documentation: 'CHANNEL' },
        { name: 'FREQ', class: 'input', type: { definition: 'base-type', value: 'REAL' }, documentation: 'FREQ' },
        { name: 'DUTY', class: 'input', type: { definition: 'base-type', value: 'REAL' }, documentation: 'DUTY' },
        {
          name: 'internal_ch',
          class: 'local',
          type: { definition: 'base-type', value: 'SINT' },
          documentation: 'internal_ch',
        },
        {
          name: 'internal_freq',
          class: 'local',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'internal_freq',
        },
        {
          name: 'internal_duty',
          class: 'local',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'internal_duty',
        },
        {
          name: 'SUCCESS',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUCCESS',
        },
      ],
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
        'Configures the CPU internal PWM peripheral to generate a PWM signal through hardware. If the CPU does not have a PWM peripheral, compiling this block will result in a compilation error. CHANNEL is the PWM channel number. For most Arduino boards that number is the pin number for the PWM capable pin. FREQ is the desired PWM frequency in Hz. DUTY is the PWM duty cycle (between 0 and 100).',
    },
    {
      name: 'ARDUINOCAN_CONF',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'EN_PIN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
          documentation: 'Arduino CAN Enable pin',
        },
        {
          name: 'BR',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
          documentation: 'Arduino CAN Baudrate',
        },
        {
          name: 'DONE',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'Arduino CAN configuration Done flag',
        },
      ],
      body: 'DONE := FALSE;',
      documentation: 'Configure Arduino CAN communication',
    },
    {
      name: 'ARDUINOCAN_WRITE',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'ID',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
          documentation: 'Arduino CAN message ID',
        },
        {
          name: 'D0',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN first payload byte',
        },
        {
          name: 'D1',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN second payload byte',
        },
        {
          name: 'D2',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN third payload byte',
        },
        {
          name: 'D3',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN fourth payload byte',
        },
        {
          name: 'D4',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN fifth payload byte',
        },
        {
          name: 'D5',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN sixth payload byte',
        },
        {
          name: 'D6',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN seventh payload byte',
        },
        {
          name: 'D7',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
          documentation: 'Arduino CAN eighth payload byte',
        },
        {
          name: 'DONE',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'Arduino CAN write done flag',
        },
      ],
      body: 'DONE := FALSE;',
      documentation: 'Write data to Arduino CAN bus',
    },
    {
      name: 'ARDUINOCAN_WRITE_WORD',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'ID',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
          documentation: 'Arduino CAN message ID',
        },
        {
          name: 'DATA',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
          documentation: 'Arduino CAN payload',
        },
        {
          name: 'DONE',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'Arduino CAN write done flag',
        },
      ],
      body: 'DONE := FALSE;',
      documentation: 'Write word data to Arduino CAN bus',
    },
    {
      name: 'ARDUINOCAN_READ',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'DATA',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
          documentation: 'Arduino CAN readed data from arduino can message',
        },
      ],
      body: 'DATA := 0;',
      documentation: 'CAN READ',
    },
  ],
}

export { ArduinoFunctionBlocks }
