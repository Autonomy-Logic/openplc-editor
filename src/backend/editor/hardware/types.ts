import { z } from 'zod/v4'

const SerialPortSchema = z.object({
  name: z.string(),
  address: z.string(),
})

type SerialPort = z.infer<typeof SerialPortSchema>

const BoardInfoSchema = z.object({
  board_manager_url: z.string().optional(),
  compiler: z.string(),
  core: z.string(),
  c_flags: z.array(z.string()).optional(),
  cxx_flags: z.array(z.string()).optional(),
  ld_flags: z.array(z.string()).optional(),
  max_data_size: z.number().optional(),
  default_ain: z.string(),
  default_aout: z.string(),
  default_din: z.string(),
  default_dout: z.string(),
  define: z.string().or(z.array(z.string())).optional(),
  extra_libraries: z.array(z.string()).optional(),
  platform: z.string(),
  preview: z.string(),
  source: z.string(),
  specs: z.object({
    CPU: z.string(),
    RAM: z.string(),
    Flash: z.string(),
    DigitalPins: z.string(),
    AnalogPins: z.string(),
    PWMPins: z.string(),
    WiFi: z.string(),
    Bluetooth: z.string(),
    Ethernet: z.string(),
  }),
  user_ain: z.string().optional(),
  user_aout: z.string().optional(),
  user_din: z.string().optional(),
  user_dout: z.string().optional(),
})

type BoardInfo = z.infer<typeof BoardInfoSchema>

const HalsFileSchema = z.record(z.string(), BoardInfoSchema)

type HalsFile = z.infer<typeof HalsFileSchema>

const availableBoardsSchema = z.map(
  z.string(),
  z.object({
    coreVersion: z.string().optional(),
    pins: z.object({
      defaultAin: z.array(z.string()).optional(),
      defaultAout: z.array(z.string()).optional(),
      defaultDin: z.array(z.string()).optional(),
      defaultDout: z.array(z.string()).optional(),
    }),
    ...BoardInfoSchema.pick({ compiler: true, core: true, preview: true, specs: true }),
  }),
)

// VPP module definition — describes an I/O module in a vendor backplane system
type VppModuleDefinition = {
  id: string
  name: string
  image?: string
  io: {
    digitalInputs: number
    digitalOutputs: number
    analogInputs: number
    analogOutputs: number
  }
  parameters?: Array<{
    id: string
    name: string
    type: string
    options?: string[]
    default?: unknown
    min?: number
    max?: number
  }>
  addressMapping?: unknown
}

// VPP metadata attached to boards that come from installed VPP packages
type VppMetadata = {
  packageId: string
  deviceId: string
  packagePath: string
  screens: Record<string, unknown>
  moduleSystem: {
    enabled: boolean
    maxSlots: number
    modules: VppModuleDefinition[]
  } | null
}

// !! We're not able to infer the type of the Map directly from the schema, so we define it manually.
// !! This is a workaround to ensure type safety when using the schema.
type AvailableBoards = Map<
  string,
  {
    compiler: string
    core: string
    preview: string
    specs: Record<string, string>
    // Optional properties
    coreVersion?: string
    pins: {
      defaultAin?: string[]
      defaultAout?: string[]
      defaultDin?: string[]
      defaultDout?: string[]
    }
    vpp?: VppMetadata
  }
>

export { availableBoardsSchema, BoardInfoSchema, HalsFileSchema, SerialPortSchema }
export type { AvailableBoards, BoardInfo, HalsFile, SerialPort, VppMetadata, VppModuleDefinition }
