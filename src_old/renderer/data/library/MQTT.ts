import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema } from '@root/types/PLC'
import { z } from 'zod'

const MQTTVariablesSchema = BaseLibraryVariableSchema

const MQTTPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(MQTTVariablesSchema),
})

export const MQTTLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(MQTTPouSchema),
})

type MQTTLibrary = z.infer<typeof MQTTLibrarySchema>

const MQTT: MQTTLibrary = {
  name: 'MQTT',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'src/renderer/data/library/mqtt/st',
  cPath: 'src/renderer/data/library/mqtt/c',
  pous: [
    {
      name: 'MQTT_RECEIVE',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'RECEIVE', class: 'input', type: { definition: 'base-type', value: 'BOOL' }, documentation: 'RECEIVE' },
        { name: 'TOPIC', class: 'input', type: { definition: 'base-type', value: 'STRING' }, documentation: 'TOPIC' },
        {
          name: 'RECEIVED',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'RECEIVED',
        },
        {
          name: 'MESSAGE',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
          documentation: 'MESSAGE',
        },
      ],
      body: 'RECEIVED := 0;',
      documentation:
        'Receive MQTT messages for a particular TOPIC when RECEIVE is active. You must subscribe to a topic first before you can start receiving messages for that particular topic. Once a message is received, RECEIVED output is triggered, and MESSAGE will contain the received message as a STRING.',
    },
    {
      name: 'MQTT_SEND',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SEND', class: 'input', type: { definition: 'base-type', value: 'BOOL' }, documentation: 'SEND' },
        { name: 'TOPIC', class: 'input', type: { definition: 'base-type', value: 'STRING' }, documentation: 'TOPIC' },
        {
          name: 'MESSAGE',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
          documentation: 'MESSAGE',
        },
        {
          name: 'SUCCESS',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUCCESS',
        },
      ],
      body: 'SUCCESS := 0;',
      documentation:
        'Sends a MESSAGE to a particular TOPIC when SEND input is triggered. Keep in mind that SEND is not configured as a rising edge input, which means that MQTT_SEND will continuously send messages every scan cycle while SEND is TRUE. If the message was sent without errors, SUCCESS will be TRUE.',
    },
    {
      name: 'MQTT_CONNECT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CONNECT', class: 'input', type: { definition: 'base-type', value: 'BOOL' }, documentation: 'CONNECT' },
        { name: 'BROKER', class: 'input', type: { definition: 'base-type', value: 'STRING' }, documentation: 'BROKER' },
        { name: 'PORT', class: 'input', type: { definition: 'base-type', value: 'UINT' }, documentation: 'PORT' },
        {
          name: 'SUCCESS',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUCCESS',
        },
      ],
      body: 'SUCCESS := 0;',
      documentation:
        'Connect to a BROKER at a given PORT when CONNECT is triggered. If a successful connection is made, SUCCESS is set to TRUE',
    },
    {
      name: 'MQTT_CONNECT_AUTH',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CONNECT', class: 'input', type: { definition: 'base-type', value: 'BOOL' }, documentation: 'CONNECT' },
        { name: 'BROKER', class: 'input', type: { definition: 'base-type', value: 'STRING' }, documentation: 'BROKER' },
        { name: 'PORT', class: 'input', type: { definition: 'base-type', value: 'UINT' }, documentation: 'PORT' },
        { name: 'USER', class: 'input', type: { definition: 'base-type', value: 'STRING' }, documentation: 'USER' },
        {
          name: 'PASSWORD',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
          documentation: 'PASSWORD',
        },
        {
          name: 'SUCCESS',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUCCESS',
        },
      ],
      body: 'SUCCESS := 0;',
      documentation:
        'Connect to an authenticated BROKER at a given PORT using the credentials from USER and PASSWORD when CONNECT is triggered. If a successful connection is made, SUCCESS is set to TRUE',
    },
    {
      name: 'MQTT_SUBSCRIBE',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'SUBSCRIBE',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUBSCRIBE',
        },
        { name: 'TOPIC', class: 'input', type: { definition: 'base-type', value: 'STRING' }, documentation: 'TOPIC' },
        {
          name: 'SUCCESS',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUCCESS',
        },
      ],
      body: 'SUCCESS := 0;',
      documentation:
        'Subscribe to a given TOPIC when SUBSCRIBE input is triggered. Upon a successful subscription, SUCCESS is set to TRUE. Keep in mind that once you subscribe to a topic, OpenPLC will start receiving messages sent to that topic and storing them in a message pool. You must use the MQTT_RECEIVE block to retrieve messages from the pool and free up space to receive more messages. The maximum pool size is currently limited to 10 messages. If you let messages accumulate in the pool you will start loosing messages once the pool is full.',
    },
    {
      name: 'MQTT_UNSUBSCRIBE',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'UNSUBSCRIBE',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'UNSUBSCRIBE',
        },
        { name: 'TOPIC', class: 'input', type: { definition: 'base-type', value: 'STRING' }, documentation: 'TOPIC' },
        {
          name: 'SUCCESS',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUCCESS',
        },
      ],
      body: 'SUCCESS := 0;',
      documentation:
        'Unsubscribe to a given TOPIC when UNSUBSCRIBE input is triggered. Upon a successful unsubscription, SUCCESS is set to TRUE. Keep in mind that once you unsubscribe to a topic, OpenPLC will stop storing messages sent to that topic in the message pool. However, messages received previously and not captured with a MQTT_RECEIVE block will remain in the pool using up pool space.',
    },
    {
      name: 'MQTT_DISCONNECT',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'DISCONNECT',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'DISCONNECT',
        },
        {
          name: 'SUCCESS',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'SUCCESS',
        },
      ],
      body: 'SUCCESS := 0;',
      documentation:
        'Disconnects from the current broker when DISCONNECT is set to TRUE. Upon a successful disconnection, SUCCESS is set to TRUE.',
    },
  ],
}

export { MQTT }
