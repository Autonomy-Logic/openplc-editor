import { z } from 'zod/v4'

const ArduinoCliConfigSchema = z.object({
  board_manager: z.object({
    additional_urls: z.array(z.string()),
  }),
  output: z.object({
    no_color: z.boolean(),
  }),
})

type ArduinoCliConfig = z.infer<typeof ArduinoCliConfigSchema>

const ArduinoCoreControlSchema = z.array(z.record(z.string(), z.string()))

type ArduinoCoreControl = z.infer<typeof ArduinoCoreControlSchema>

const BoardInfoSchema = z.object({
  compiler: z.enum(['arduino-cli', 'openplc-compiler']),
  core: z.string(),
  default_ain: z.string(),
  default_aout: z.string(),
  default_din: z.string(),
  default_dout: z.string(),
  updatedAt: z.number(),
  platform: z.string(),
  source: z.string(),
  version: z.string(),
  board_manager_url: z.string().optional(),
  extra_libraries: z.array(z.string()).optional(),
  define: z.union([z.string(), z.array(z.string())]).optional(),
  user_ain: z.string().optional(),
  user_aout: z.string().optional(),
  user_din: z.string().optional(),
  user_dout: z.string().optional(),
  c_flags: z.array(z.string()).optional(),
  cxx_flags: z.array(z.string()).optional(),
  arch: z.string().optional(),
})

type BoardInfo = z.infer<typeof BoardInfoSchema>

const HalsFileSchema = z.record(z.string(), BoardInfoSchema)

type HalsFile = z.infer<typeof HalsFileSchema>

export { ArduinoCliConfigSchema, ArduinoCoreControlSchema, BoardInfoSchema, HalsFileSchema }

export type { ArduinoCliConfig, ArduinoCoreControl, BoardInfo, HalsFile }
