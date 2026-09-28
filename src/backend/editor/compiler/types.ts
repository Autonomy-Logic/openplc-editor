import { z } from 'zod/v4'

const ArduinoCoreControlSchema = z.array(z.record(z.string(), z.string()))

type ArduinoCoreControl = z.infer<typeof ArduinoCoreControlSchema>

// Re-exported from hardware/types so existing import paths under
// backend/editor/compiler keep working — the schema itself lives next to
// the resolver that owns the hals.json contract.
export type { BoardInfo, HalsFile } from '../hardware/types'
export { BoardInfoSchema, HalsFileSchema } from '../hardware/types'

export { ArduinoCoreControlSchema }

export type { ArduinoCoreControl }

/**
 * What the compile pipeline needs from the channel it reports progress on.
 *
 * The pipeline is handed an Electron `MessagePortMain` by the main process and
 * only ever calls these three methods on it. Naming the narrow contract lets a
 * headless caller (the CLI) drive the SAME pipeline with a plain object:
 * `MessagePortMain` satisfies this structurally, so the Electron call sites are
 * unchanged and neither side needs a type assertion.
 */
export interface CompileProgressChannel {
  start(): void
  postMessage(message: unknown): void
  close(): void
}
