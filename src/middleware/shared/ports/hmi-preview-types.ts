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
  /** The variable is a whole table, log, summary or array a data widget can be fed from; `type` is as declared. */
  source?: HmiPlcSource
}

/** The data an `hmi_source` input takes. */
export type HmiSourceKind = 'alarms' | 'events' | 'summary' | 'numbers'

/** What a PLC variable offers as a source: its kind, its bounds when an array, and its element type for numbers. */
export interface HmiPlcSource {
  kind: HmiSourceKind
  lower?: number
  upper?: number
  /** Elementary element type of a numeric array, upper case. */
  element?: string
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
  /** Names of the libraries the project uses (`projectLibraryNames`); a preview compiles against these only. */
  libraries: readonly string[]
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
  /** Setter number within the screen, or the factory setter of a live element. */
  index: number
  kind: 'num' | 'str'
  /** The id of the live element the setter applies to (`HmiLiveElement`); absent for elements the build compiled. */
  element?: number
}

/** A widget type a running preview creates without a build, and its live setters by upper-case property name. */
export interface HmiPreviewFactoryType {
  /** Its number in the module's factory table. */
  type: number
  setters: Record<string, { index: number; kind: 'num' | 'str' }>
}

/** What a running preview can add to the shown screen without a build: widget types by upper-case name. */
export interface HmiPreviewFactory {
  types: Record<string, HmiPreviewFactoryType>
}

/** The kind of container a live element goes into (`hmi_live_container`). */
export type HmiLiveContainer = 'stack' | 'diagram'

/**
 * An element a running preview adds to the shown screen without a build, placed where the next build attaches it:
 * created from the factory table, or, with `element`, one the module took off before (`HmiLiveDetach`) put back.
 */
export interface HmiLiveElement {
  /** Its widget type's number in the factory table; ignored with `element`. */
  type: number
  /** The id of a detached element to put back instead of creating one. */
  element?: number
  /** Its container: an element id of the shown screen (0: the screen's own stack), or one added earlier in the call. */
  parent: { id: number } | { added: number }
  parentKind: HmiLiveContainer
  /** The element id of the sibling it goes before; 0: last. */
  before: number
  /** The element id of the element it is drawn before; 0: last. */
  drawBefore: number
  /** Values of its inputs, by factory setter; none for an element put back. */
  numbers: ReadonlyArray<{ setter: number; value: number }>
  texts: ReadonlyArray<{ setter: number; value: string }>
}

/** An element a running preview takes off the shown screen: out of its container and its drawing list. */
export interface HmiLiveDetach {
  element: number
  /** Its container as the module has it: an element id, 0 for the screen's own stack. */
  parent: number
  parentKind: HmiLiveContainer
}

export interface HmiPreviewElementId {
  id: number
  screen: string
  element: string
}

/** How long each step of a preview build took, in ms. */
export interface HmiPreviewTimings {
  /** Reading the preview's files; 0 once they were read. */
  sourcesMs: number
  /** Generating the unit: checks, ST, STruC++ and the C++ glue. */
  generateMs: number
  /** STruC++ compiling the project's widget blocks, part of `generateMs`. */
  widgetsMs: number
  /** STruC++ compiling the screens and glue, part of `generateMs`. */
  strucppMs: number
  /** Building the font table. */
  fontsMs: number
  /** The toolchain call as the build saw it: compiling, linking and moving request and module. */
  toolchainMs: number
  totalMs: number
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
      /** The widget types the module can add without a build. */
      factory: HmiPreviewFactory
      warnings: HmiDiagnostic[]
      stats: WasmCompileStats
      timings: HmiPreviewTimings
    }
  | {
      ok: false
      errors: HmiDiagnostic[]
      warnings: HmiDiagnostic[]
      stats?: WasmCompileStats
      timings?: HmiPreviewTimings
    }

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
  | { id: number; type: 'setNumber'; screen: number; setter: number; value: number; element?: number }
  | { id: number; type: 'setText'; screen: number; setter: number; value: string; element?: number }
  | { id: number; type: 'change'; detach: HmiLiveDetach[]; elements: HmiLiveElement[] }

/**
 * The Worker's reply to one request; `fatal` when the module faulted and can no longer run. A `change` is answered with
 * `applied` and, when applied, `added`: the ids of its elements in order.
 */
export type HmiPreviewReply =
  | { id: number; ok: true; frame?: HmiPreviewFrame; applied?: boolean; added?: number[] }
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
  /** Default value as ST text: the widget type's own (`typeDefaults`) when it sets one, else the declared one. */
  defaultValue?: string
  /** BOOL property that must be TRUE for this one to take effect. */
  enabledBy?: string
  /** Value as ST text that previews and palette thumbnails give the property, from `hmi_preview`. */
  previewValue?: string
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
  twoWay?: {
    value: string
    changed: string
    newValue: string
    /**
     * What the widget's NewValue can be, from its `hmi_range` attribute: `<lo>..<hi>`, each a number, an input's name or
     * `last(<input>)` (the index of the last item of a `;` list).
     */
    range?: string
    /** The input that bounds a STRING NewValue's length, from its `hmi_max_length` attribute. */
    maxLength?: string
  }
  /** A main BOOL output with `changed` set for one frame when it flips: a wired variable is written on those frames. */
  momentary?: { value: string; changed: string }
  /** BOOL outputs set for one frame when something happens (Clicked). */
  events: readonly string[]
  /** Data series the widget draws, each a value bound to a variable and a colour; the count says how many show. */
  series?: HmiWidgetSeries
  /** Inherited inputs the type starts with another value: the build sets them on elements that do not set them. */
  typeDefaults?: ReadonlyArray<{ name: string; value: string }>
  /** Target capability the widget needs (`hmi_requires`), a boolean of `TargetCapabilities`. */
  requires?: string
  /** STRING inputs naming PLC data the build feeds the widget from (`hmi_source`), in declaration order. */
  sources?: readonly HmiWidgetSource[]
}

/** A widget input whose literal value names PLC data, and the kind of data it takes. */
export interface HmiWidgetSource {
  /** The input, as written. */
  name: string
  /** What it takes, as its `hmi_source` attribute says: `ARRAY OF HMI_ALARM_ROW`, `HMI_ALARM_SUMMARY`, ... */
  type: string
  /** Its feed slot (`SetFeed`): its position among the widget's sources. */
  slot: number
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
  /** The installed widget libraries screens use, as .stlib archive JSON. */
  libraries: HmiLibraryArchive[]
  /** ST of the navigation and theme declarations the HMI build generates for the project's screens. */
  glue: string
  /** Upper-case members of HmiScreen, which elements may not reuse. */
  screenMembers: string[]
}
