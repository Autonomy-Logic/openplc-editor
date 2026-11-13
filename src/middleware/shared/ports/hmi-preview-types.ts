/**
 * The HMI preview as callers and platform boundaries see it: what a build takes and returns, and the messages between
 * a preview session and the Worker that runs its module.
 */
import type { HmiSettings } from '../utils/hmi/settings'
import type { WasmCompileStats } from './wasm-toolchain-types'

export interface HmiSourceFile {
  /** Name as written; the file declares FUNCTION_BLOCK <name>. */
  name: string
  source: string
}

/** A PLC variable screens may use. */
export interface HmiPlcVariable {
  /** `<POU>.<Name>` or `GVL.<Name>`. */
  path: string
  /** Declared type: an elementary type, or STRING / STRING(n). */
  type: string
  /** Declared initial value as ST text; the mirror starts from it when it is a literal, else from the type default. */
  initialValue?: string
}

/** The project's HMI and what it may refer to. */
export interface HmiUnitSources {
  /** Screens in project order: page numbers and the HMI_SCREEN enumeration follow it. */
  screens: readonly HmiSourceFile[]
  widgets: readonly HmiSourceFile[]
  settings: HmiSettings
  plcVariables: readonly HmiPlcVariable[]
  /** Names of the project's POUs and data types, which screens and widget blocks may not reuse. */
  projectNames: readonly string[]
}

/** A preview build of the project's screens, or of one widget block when `widgetPreview` names it. */
export interface HmiPreviewRequest extends HmiUnitSources {
  widgetPreview?: string
}

export interface HmiDiagnostic {
  /** Screen or widget block, or `HMI` for the unit as a whole. */
  file: string
  line?: number
  message: string
}

export interface HmiPreviewSetter {
  /** Page number of the screen. */
  screen: number
  /** Setter number within the screen. */
  index: number
  kind: 'num' | 'str'
}

export interface HmiPreviewElementId {
  id: number
  screen: string
  element: string
}

export type HmiPreviewBuild =
  | {
      ok: true
      wasm: Uint8Array
      /** Page number of each screen the module holds, by name as written. */
      pages: Record<string, number>
      /** Live setters by `Screen.Element.Property`, as written. */
      setters: Record<string, HmiPreviewSetter>
      /** The element each bounds id stands for. */
      elementIds: HmiPreviewElementId[]
      warnings: HmiDiagnostic[]
      stats: WasmCompileStats
    }
  | { ok: false; errors: HmiDiagnostic[]; warnings: HmiDiagnostic[]; stats?: WasmCompileStats }

/** An element's bounds in logical units. */
export interface HmiPreviewBounds {
  id: number
  x: number
  y: number
  width: number
  height: number
}

/** Rows of a frame that changed since the previous render, as RGBA bytes. */
export interface HmiPreviewPixels {
  width: number
  height: number
  y0: number
  rows: number
  rgba: Uint8ClampedArray
}

export type HmiPointerKind = 'down' | 'move' | 'up'

/** How a frame is rasterized: device pixels and device pixels per logical unit. */
export interface HmiPreviewSurface {
  width: number
  height: number
  scale: number
}

/** A frame the Worker ran: the page it showed, its HMI_STATUS_* flags, changed pixels (null: none) and bounds. */
export interface HmiPreviewFrame {
  page: number
  status: number
  pixels: HmiPreviewPixels | null
  bounds: HmiPreviewBounds[]
}

/** Messages a preview session sends its Worker; each gets one reply with the same id. */
export type HmiPreviewRequestMessage =
  | { id: number; type: 'load'; wasm: Uint8Array; width: number; height: number; page: number; design: boolean }
  | { id: number; type: 'frame'; timeMs: number; surface: HmiPreviewSurface }
  | { id: number; type: 'show'; page: number }
  | { id: number; type: 'resize'; width: number; height: number }
  | { id: number; type: 'pointer'; kind: HmiPointerKind; x: number; y: number }
  | { id: number; type: 'key'; code: number }
  | { id: number; type: 'setNumber'; screen: number; setter: number; value: number }
  | { id: number; type: 'setText'; screen: number; setter: number; value: string }

/** The Worker's reply to one request; `fatal` when the module faulted and can no longer run. */
export type HmiPreviewReply =
  | { id: number; ok: true; frame?: HmiPreviewFrame; applied?: boolean }
  | { id: number; ok: false; error: string; fatal?: boolean }
