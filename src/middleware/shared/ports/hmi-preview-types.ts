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
  /** Builds the palette gallery, every widget on one screen at natural size, in place of the project's screens. */
  gallery?: boolean
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

export type HmiPropertyGroup = 'data' | 'display' | 'layout'

export type HmiPropertyKind = 'bool' | 'number' | 'string' | 'color' | 'enum' | 'elementRef' | 'other'

export interface HmiWidgetProperty {
  /** Name as written. */
  name: string
  /** Declared type, as written for library types. */
  type: string
  kind: HmiPropertyKind
  group: HmiPropertyGroup
  /** Default value as ST text. */
  defaultValue?: string
  /** Length of a STRING(n) property. */
  maxLength?: number
  /** Members of an enumerated property, as written. */
  enumMembers?: readonly string[]
  /** Block that declares the property. */
  declaredBy: string
}

export interface HmiWidgetOutput {
  name: string
  type: string
}

export interface HmiWidgetBinding {
  name: string
  direction: 'input' | 'output'
  type: string
}

export interface HmiWidgetInfo {
  /** Name as written. */
  name: string
  /** Name of the manifest that declares it. */
  library: string
  /** Base block, as written. */
  extends: string
  /** Palette group, when the block declares one. */
  palette?: string
  /** Inputs, the base block's first. */
  properties: readonly HmiWidgetProperty[]
  outputs: readonly HmiWidgetOutput[]
  /** What a variable dropped on the widget is wired to. */
  main?: HmiWidgetBinding
  /** The operator's change of the main input: `changed` is set for one frame with the value in `newValue`. */
  twoWay?: { value: string; changed: string; newValue: string }
  /** BOOL outputs set for one frame when something happens (Clicked). */
  events: readonly string[]
}

export interface HmiWidgetCatalog {
  /** Widgets by upper-case name. */
  widgets: ReadonlyMap<string, HmiWidgetInfo>
  /** Fields of the COLOR constant, as written: theme colors first, then fixed colors. */
  colors: readonly string[]
}

/** A widget as the core draws it, cropped from the palette gallery, as RGBA bytes. */
export interface HmiThumbnail {
  /** Widget name as written. */
  widget: string
  width: number
  height: number
  rgba: Uint8ClampedArray
}

/** The palette's thumbnails; on errors, the thumbnails of the library widgets only, or none. */
export interface HmiThumbnailResult {
  thumbnails: HmiThumbnail[]
  errors: HmiDiagnostic[]
}

/** The widget catalogue of a project, with its widget blocks' errors (the catalogue then has the library only). */
export interface HmiCatalogResult {
  catalog: HmiWidgetCatalog
  errors: HmiDiagnostic[]
}
