import { z } from 'zod/v4'

import type { DebugSpec } from '../../../middleware/shared/ports/debug-spec-types'
import type { PlatformOption, TargetCapabilities } from '../../../middleware/shared/ports/types'

const SerialPortSchema = z.object({
  name: z.string(),
  address: z.string(),
})

type SerialPort = z.infer<typeof SerialPortSchema>

const BoardInfoSchema = z.object({
  // Toolchain selector. Enum is closed: VPP devices that need a different
  // compiler should declare a new entry here rather than passing a free string.
  compiler: z.enum(['arduino-cli', 'openplc-compiler', 'simulator']),
  core: z.string(),
  platform: z.string(),
  source: z.string(),
  preview: z.string(),
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
  default_ain: z.string(),
  default_aout: z.string(),
  default_din: z.string(),
  default_dout: z.string(),
  user_ain: z.string().optional(),
  user_aout: z.string().optional(),
  user_din: z.string().optional(),
  user_dout: z.string().optional(),
  board_manager_url: z.string().optional(),
  extra_libraries: z.array(z.string()).optional(),
  define: z.string().or(z.array(z.string())).optional(),
  c_flags: z.array(z.string()).optional(),
  cxx_flags: z.array(z.string()).optional(),
  ld_flags: z.array(z.string()).optional(),
  // Overrides arduino-cli's post-link `upload.maximum_data_size` check —
  // required when `ld_flags` extend the linker memory map past canonical
  // SoC RAM (e.g. emulated boards).
  max_data_size: z.number().optional(),
  arch: z.string().optional(),
  // Declarative debug-channel resolver spec.  Schema validation is
  // intentionally loose (`z.any()`) — the canonical shape lives in
  // `backend/shared/hardware/debug-spec.ts` as a TS interface, and
  // the resolver does its own structural checks at runtime.  Zod here
  // just guards against shape drift in `hals.json`.
  debug: z.any().optional(),
  // Tracking metadata — not present in shipped hals.json today; optional
  // so downstream entries that do carry them still validate.
  updatedAt: z.number().optional(),
  version: z.string().optional(),
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
  /** Human-readable vendor name from the package manifest's
   *  `package.vendor.name` field.  Used by the device-dropdown to
   *  group boards under their vendor heading (e.g. all boards from
   *  `com.openplc.arduino` cluster under "Arduino"). */
  vendor: string
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
    /** VPP-declared FQBN sub-options (e.g. Nano cpu=atmega328old). Absent
     *  when the manifest doesn't expose variants — see ports/types.ts. */
    platformOptions?: PlatformOption[]
    /** Manifest-declared capability overrides (e.g. a runtime-v4 GPIO board
     *  setting `pinMapping: true`). Merged over the preset by
     *  `resolveTargetCapabilities`. */
    capabilities?: Partial<TargetCapabilities>
    /** Declarative debug-channel resolver spec carried through to the
     *  renderer.  Same shape on both catalogs (`hals.json` builtins
     *  and VPP manifest devices) — see
     *  `backend/shared/hardware/debug-spec.ts`. */
    debug?: DebugSpec
  }
>

export { availableBoardsSchema, BoardInfoSchema, HalsFileSchema, SerialPortSchema }
export type { AvailableBoards, BoardInfo, HalsFile, SerialPort, VppMetadata, VppModuleDefinition }
