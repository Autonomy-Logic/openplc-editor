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
  compiler: z.enum(['arduino-cli', 'openplc-compiler', 'simulator']),
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
  ld_flags: z.array(z.string()).optional(),
  // Overrides arduino-cli's post-link `upload.maximum_data_size`
  // check.  Required when `ld_flags` extend the linker memory
  // map past the canonical SoC RAM (e.g. emulated boards) —
  // otherwise the link succeeds but the CLI rejects the binary
  // with "data section exceeds available space in board".
  max_data_size: z.number().optional(),
  arch: z.string().optional(),
})

type BoardInfo = z.infer<typeof BoardInfoSchema>

const HalsFileSchema = z.record(z.string(), BoardInfoSchema)

type HalsFile = z.infer<typeof HalsFileSchema>

/**
 * Subset of `arduino-cli compile --show-properties=expanded` output captured
 * by CompilerModule.extractToolchainProperties. We keep the full property map
 * for forward compatibility but surface the three recipes the pre-compile
 * pipeline actually consumes (cpp/c/ar). Both `recipeCpp` and `recipeAr` come
 * fully token-expanded by arduino-cli — only `{source_file}`, `{object_file}`,
 * `{archive_file_path}`, and `{includes}` remain unresolved, and those are
 * filled in by the editor when it invokes the toolchain directly.
 */
type ToolchainProperties = {
  fqbn: string
  properties: Record<string, string>
  recipeCpp: string
  recipeC: string
  recipeAr: string
}

export { ArduinoCliConfigSchema, ArduinoCoreControlSchema, BoardInfoSchema, HalsFileSchema }

export type { ArduinoCliConfig, ArduinoCoreControl, BoardInfo, HalsFile, ToolchainProperties }
