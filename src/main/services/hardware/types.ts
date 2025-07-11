import { z } from 'zod/v4'

const BoardInfoSchema = z.object({
  board_manager_url: z.string().optional(),
  compiler: z.string(),
  core: z.string(),
  c_flags: z.array(z.string()).optional(),
  cxx_flags: z.array(z.string()).optional(),
  default_ain: z.string(),
  default_aout: z.string(),
  default_din: z.string(),
  default_dout: z.string(),
  define: z.string().or(z.array(z.string())).optional(),
  extra_libraries: z.array(z.string()).optional(),
  platform: z.string(),
  preview: z.string(),
  source: z.string(),
  specs: {
    CPU: z.string(),
    RAM: z.string(),
    Flash: z.string(),
    DigitalPins: z.string(),
    AnalogPins: z.string(),
    PWMPins: z.string(),
    WiFi: z.string(),
    Bluetooth: z.string(),
    Ethernet: z.string(),
  },
  user_ain: z.string().optional(),
  user_aout: z.string().optional(),
  user_din: z.string().optional(),
  user_dout: z.string().optional(),
})

type BoardInfo = z.infer<typeof BoardInfoSchema>

const HalsFileSchema = z.record(z.string(), BoardInfoSchema)

type HalsFile = z.infer<typeof HalsFileSchema>

export { BoardInfoSchema, HalsFileSchema }
export type { BoardInfo, HalsFile }
