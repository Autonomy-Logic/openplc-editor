import { z } from 'zod'

import { MQTT_PROJECT_FORMAT_VERSION, type MqttProjectIntegrationV1 } from '../contract/contract'

// Shapes only: ranges and names are validated separately so an invalid selection survives load/save.
const MqttSourceTokenSchema = z.union([
  z.object({ role: z.enum(['instance', 'program', 'variable', 'field']), name: z.string() }),
  z.object({ role: z.literal('index'), indices: z.array(z.number().int()) }),
])

const MqttProjectSelectionSchema = z.object({
  source: z.object({ tokens: z.array(MqttSourceTokenSchema) }),
  topic: z.string().optional(),
  metricName: z.string().optional(),
})

const MqttProjectTlsSchema = z.union([
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    trust: z.union([
      z.object({ source: z.literal('system') }),
      z.object({ source: z.literal('pem'), caPem: z.string() }),
    ]),
  }),
])

export const MqttProjectIntegrationSchema = z.object({
  formatVersion: z.literal(MQTT_PROJECT_FORMAT_VERSION),
  enabled: z.boolean(),
  mode: z.enum(['generic', 'sparkplug_b']),
  connection: z.object({
    host: z.string(),
    port: z.number(),
    clientId: z.string(),
    tls: MqttProjectTlsSchema,
  }),
  authMethod: z.enum(['anonymous', 'username_password', 'client_certificate']),
  generic: z.object({
    publishMode: z.enum(['on_change', 'periodic']),
    sampleIntervalMs: z.number(),
    publishIntervalMs: z.number(),
    qos: z.union([z.literal(0), z.literal(1)]),
    retain: z.boolean(),
    topicPrefix: z.string().optional(),
  }),
  sparkplug: z.object({
    groupId: z.string(),
    edgeNodeId: z.string(),
    sampleIntervalMs: z.number(),
  }),
  selections: z.array(MqttProjectSelectionSchema),
}) satisfies z.ZodType<MqttProjectIntegrationV1, z.ZodTypeDef, unknown>
