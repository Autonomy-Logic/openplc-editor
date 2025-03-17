import z from 'zod'

export const _deviceConfigurationSchema = z.object({
  deviceBoard: z.string(),
  communicationPort: z.string(),
  communicationConfiguration: z.object({
    modbusRTU: z.object({
      rtuInterface: z.string(),
      rtuBaudrate: z.string(),
      rtuSlaveId: z.string(),
      rtuRS485TXPin: z.string(),
    }),
    modbusTCP: z.object({
      tcpInterface: z.string(), // Can be either 'wifi' or 'ethernet', this will differ the other attributes.
      tcpPort: z.string(),
      tcpSlaveId: z.string(),
      tcpRS485TXPin: z.string(),
    }),
  }),
})
