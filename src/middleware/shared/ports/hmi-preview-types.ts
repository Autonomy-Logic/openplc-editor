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
  /** `<Instance>.<Program>.<Name>`, a configuration global's name, or `<List>.<Name>` of a Global Variable List. */
  path: string
  /** Declared type: an elementary type, or STRING / STRING(n). */
  type: string
  /** Declared initial value as ST text; the preview starts from it when it is a literal, else from the type default. */
  initialValue?: string
  /** Declared CONSTANT: screens may read it, never write it. */
  constant?: true
  /** An output of a function block instance, or below one: screens may read it, never write it. */
  blockOutput?: true
  /** A configuration global, or a field or element below one. */
  scope?: 'global'
}

/** A STruC++ library archive, as the JSON text of its `.stlib`. */
export interface HmiLibraryArchive {
  name: string
  archiveJson: string
}

/** The project's HMI and what it may refer to. */
export interface HmiUnitSources {
  /** Screens in project order: page numbers and the HMI_SCREEN enumeration follow it. */
  screens: readonly HmiSourceFile[]
  widgets: readonly HmiSourceFile[]
  settings: HmiSettings
  plcVariables: readonly HmiPlcVariable[]
  /**
   * The PLC program's declarations, data types and configuration as ST, without bodies: what screens' instance paths
   * resolve against. Builds that show no project screens may leave it out.
   */
  plcDeclarations?: string
  /** The PLC's library archives, which `plcDeclarations` may use; only what screens themselves use is compiled in. */
  plcLibraries?: readonly HmiLibraryArchive[]
  /** Names of the project's POUs and data types, which screens and widget blocks may not reuse. */
  projectNames: readonly string[]
}

/** The project's HMI as a device build compiles it; the PLC libraries come from the program build. */
export type HmiBuildSources = Omit<HmiUnitSources, 'plcLibraries'>

/** A preview build of the project's screens, or of one widget block when `widgetPreview` names it. */
export interface HmiPreviewRequest extends HmiUnitSources {
  widgetPreview?: string
  /** Builds the palette gallery, every widget on one screen at natural size, in place of the project's screens. */
  gallery?: boolean
  /** Builds a sample screen drawn in this theme, in place of the project's screens. */
  themePreview?: string
}

/** The steps of a preview build, in order: the last one is starting the built module in a session. */
export const HMI_BUILD_STEPS = ['sources', 'generate', 'compile', 'start'] as const

export type HmiBuildStep = (typeof HMI_BUILD_STEPS)[number]

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
  /** A main BOOL output with `changed` set for one frame when it flips: a wired variable is written on those frames. */
  momentary?: { value: string; changed: string }
  /** BOOL outputs set for one frame when something happens (Clicked). */
  events: readonly string[]
  /** Data series the widget draws, each a value bound to a variable and a colour; the count says how many show. */
  series?: HmiWidgetSeries
}

/** A widget's series: inputs marked `hmi_series`, in declaration order; the first value is the main input. */
export interface HmiWidgetSeries {
  /** The input that says how many series show. */
  count: string
  /** One value input per series, as written. */
  values: readonly string[]
  /** One colour input per series, as written. */
  colors: readonly string[]
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

/** What the ST language service and the code view need for screens and widget blocks. */
export interface HmiCodeContext {
  /** The libraries screens use, as .stlib archive JSON; empty when StandardWidgets does not build. */
  libraries: HmiLibraryArchive[]
  /** ST of the navigation and theme declarations the HMI build generates for the project's screens. */
  glue: string
  /** Upper-case members of HmiScreen, which elements may not reuse. */
  screenMembers: string[]
}
