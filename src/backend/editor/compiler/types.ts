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

// Re-exported from hardware/types so existing import paths under
// backend/editor/compiler keep working — the schema itself lives next to
// the resolver that owns the hals.json contract.
export type { BoardInfo, HalsFile } from '../hardware/types'
export { BoardInfoSchema, HalsFileSchema } from '../hardware/types'

export { ArduinoCliConfigSchema, ArduinoCoreControlSchema }

export type { ArduinoCliConfig, ArduinoCoreControl, ToolchainProperties }
