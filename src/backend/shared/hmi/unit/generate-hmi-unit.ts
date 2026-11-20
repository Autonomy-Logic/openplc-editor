/**
 * Builds the HMI unit: the project's screens and widget blocks with the glue the build generates, compiled by
 * STruC++ with the installed widget libraries into C++ in namespace `hmi`, plus the C glue every host links
 * (`resources/sources/hmi/unit/hmi_unit.h`): tag table, tag accessors, program instances and settings.
 *
 * Screens use PLC variables as `<POU>.<Name>` or `GVL.<Name>`; the unit reads each one through the host's access at
 * the moment a screen uses it. `Element.Value := <variable>;` on a two-way widget also writes the operator's change
 * back to the variable, converted to its type, through the host.
 */
import {
  checkHmiBlockElements,
  checkHmiBlockHeader,
  type HmiCheckBlock,
  hmiTextLiteral as textLiteral,
} from '@root/middleware/shared/utils/hmi/block-checks'
import { HMI_FEED_METHODS, type HmiSourceKind, hmiSourceKind } from '@root/middleware/shared/utils/hmi/data-sources'
import { isContainerType, widgetIsA as isA } from '@root/middleware/shared/utils/hmi/designer/designer-canvas'
import { HMI_ARRAY_ELEMENTS_MAX, HMI_NESTING_MAX } from '@root/middleware/shared/utils/hmi/plc-variables'
import { maskStComments } from '@root/middleware/shared/utils/hmi/references'
import { hmiReservedName } from '@root/middleware/shared/utils/hmi/reserved-names'
import {
  HMI_BUILTIN_THEMES,
  HMI_ROLES,
  HMI_THEME_TOKENS,
  HMI_TOUCH_CALIBRATION_MODES,
  type HmiSettings,
  hmiThemeId,
  screenGrant,
} from '@root/middleware/shared/utils/hmi/settings'
import { HMI_PROVIDED_HEADERS } from '@root/middleware/shared/utils/hmi/widget-libraries'
import type { CompileOptions, StlibArchive } from 'strucpp'

import type {
  HmiDiagnostic,
  HmiPlcVariable,
  HmiPreviewFactory,
  HmiPreviewSetter,
  HmiSourceFile,
  HmiUnitSources,
} from '../../../../middleware/shared/ports/hmi-preview-types'
import { loadStrucpp } from '../../library/strucpp-runtime'
import { HMI_ALL_FACES, hmiUsedFontFaces } from '../fonts/used-faces'
import { buildWidgetCatalog, type HmiWidgetCatalog, type HmiWidgetInfo } from '../lib/widget-catalog'
import {
  type HmiWidgetLibraryArchive,
  loadHmiWidgetLibraries,
  widgetLibraryNames,
  withSkippedLibraryCause,
  withWidgets,
} from '../lib/widget-libraries'
import { type HmiAstWalk, hmiBitAssignments, type HmiLimitOf, hmiPageAccess, type HmiTagWrite } from './page-access'
import { previewFactoryDispatch, type PreviewFactoryPart, previewFactoryTable, setterKind } from './preview-factory'
import { type HmiBlockModel, type HmiElementDecl, parseHmiBlock } from './screen-model'
import { type HmiElementLimit, hmiElementLimit, hmiLiteralOf, type HmiWriteLimit } from './write-limits'

export interface HmiTagAddress {
  arr: number
  elem: number
}

export type { HmiDiagnostic, HmiPlcVariable, HmiPreviewSetter, HmiSourceFile, HmiUnitSources }

export interface HmiUnitInput extends HmiUnitSources {
  /**
   * The archives of the libraries the project uses (bundled and listed), verbatim; the unit compiles against them and
   * takes its widgets from them.
   */
  projectLibraries: readonly unknown[]
  /**
   * Preview only: a widget block shown on an extra screen after the project's, at natural size and stretched, with a
   * test value on its main input. Product builds leave it out.
   */
  widgetPreview?: string
  /** Preview only: one screen showing every palette widget at natural size, in place of the project's screens. */
  gallery?: boolean
  /** Preview only: a sample screen drawn in this theme, in place of the project's screens. */
  themePreview?: string
  /** Preview build: the libraries are emitted whole, so their code does not change with the screens. */
  preview?: boolean
  /**
   * Preview only: the factory tables of the libraries compiled as their own units; the unit's factory routes their
   * widgets to them and has a table of the rest.
   */
  libraryFactories?: readonly LibraryFactoryTable[]
  /**
   * Build for a board's local panel: the unit then carries the panel PIN, relock time, touch calibration mode and build
   * id, and the PIN entry's face. Every other build (Runtime v4, previews) leaves them out entirely.
   */
  panel?: boolean
  /** PLC debug-table address of a variable; absent when building without a PLC program (preview). */
  resolve?: (path: string) => HmiTagAddress | null
  plcMd5?: string
  /**
   * The target's boolean capabilities, for a device build: an element whose widget requires one the target lacks
   * (`hmi_requires`) is refused. Previews leave it out and are not checked.
   */
  capabilities?: object
}

/** A library's factory table, as its own unit defines it. */
export type LibraryFactoryTable = PreviewFactoryPart & { library: string }

export interface HmiTag {
  path: string
  /** `hmi_tag_type` of hmi_unit.h. */
  type: number
  maxLength: number
  address: HmiTagAddress | null
}

/** What one screen reaches, for a host that serves a viewer only the tags of the screen it shows. */
export interface HmiPageTags {
  /** The screen's name. */
  name: string
  /** Indexes into `tags` the screen reads, ascending. */
  reads: number[]
  /** How the screen writes tags, by ascending tag: whole values and single bits. */
  writes: HmiTagWrite[]
  /** Roles that may open the screen, one bit per `hmi_role` (bit 0 admin, always set). */
  roles: number
}

export interface HmiUnitResult {
  ok: boolean
  errors: HmiDiagnostic[]
  warnings: HmiDiagnostic[]
  /** C++ files of the unit by name, headers included. */
  files: Record<string, string>
  /** Generated ST, by file name, as compiled. */
  sources: Record<string, string>
  tags: HmiTag[]
  /** Each screen's tags and roles, by page number. */
  pages: HmiPageTags[]
  /** Element of each bounds id the core reports, for designers. */
  elementIds: Array<{ id: number; screen: string; element: string }>
  /** Faces of the font table the unit needs. */
  fonts: { variant: HmiSettings['fontVariant']; faces: number[] }
  /** Literal text sizes of screen elements (a widget's `Size`), in screen units, for checks against a panel. */
  textSizes: Array<{ screen: string; element: string; size: number }>
  /** What only the editor's preview uses (`resources/sources/hmi/unit/hmi_preview.h`). */
  preview: HmiPreview
  /** How long STruC++ took, in ms: compiling the widget blocks, then the screens and glue. */
  timings: { widgetsMs: number; strucppMs: number }
}

export interface HmiPreview {
  /** Names of `files` grouped into translation units that change independently and can be cached apart. */
  units: {
    library: string[]
    widgets: string[]
    screens: Record<string, string[]>
    glue: string[]
    factory: string[]
  }
  /** Live setters by `Screen.Element.Property`, as written. */
  setters: Record<string, HmiPreviewSetter>
  /** The widget types the preview adds without a build (`hmi_preview_factory.h`); none unless built for the preview. */
  factory: HmiPreviewFactory
  /** C++ of the setters (one file per screen and the dispatcher) and, for the preview, of the factory table. */
  files: Record<string, string>
}

/**
 * STruC++ compile options plus `wholeLibraries` (emit the named libraries whole), which releases before it ignore; the
 * preview is then correct but recompiles the library when the set of widgets in use changes. `externalSources` names
 * the files whose programs, configuration and globals the host owns.
 */
type StrucppCompileOptions = Partial<CompileOptions> & { wholeLibraries?: string[]; externalSources?: string[] }

const UNIT = 'HMI'
const NAMESPACE = 'hmi'
const HEADER = 'hmi_unit.hpp'
/** The libraries header STruC++ writes next to `HEADER`. */
const LIBRARIES_HEADER = 'hmi_unit_libraries.hpp'
/** Suffix of the project table's factory functions. */
const PROJECT_FACTORY = '__project'
const GLUE_FILE = 'hmi_glue.st'
const PLC_FILE = 'hmi_plc.st'
const MAIN_FILE = 'hmi_main.st'
/** The generated feed blocks of a screen. */
const feedFile = (plan: { model: { name: string } }): string => `hmi_feed_${plan.model.name}.st`
/** C++ header with the program instance and the slot its shown screen is built in. */
const SLOT_HEADER = 'hmi_unit_slot.hpp'
const SLOT_OPEN = 'hmi_unit_screen_open'
const SLOT_BODY = 'hmi_unit_screen_body'
const SCREEN_CPP_BASE = 'HMISCREEN'
const FACTORY_FILE = 'hmi_preview_factory.cpp'
/** Marks the screens and the glue program so they reach the PLC's variables by instance path. */
const INSTANCE_PATHS = "{attribute 'instance_paths'}"
/** The configuration and resource every OpenPLC project compiles to, which paths may leave out. */
const CONFIG_PREFIXES = ['CONFIG0.RES0.', 'CONFIG0.']
const SCREENS_MAX = 64
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Properties that change the element tree; editing them needs a build. */
const DEFAULT_STRING_LENGTH = 254
/** Elementary tag types, in `hmi_tag_type` order from 1, then STRING. */
const TAG_TYPES = [
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'REAL',
  'LREAL',
] as const
const TAG_STRING = TAG_TYPES.length + 1
/** Time and date tag types, in `hmi_tag_type` order after STRING; every one is an 8-byte integer. */
const TIME_TAG_TYPES = ['TIME', 'LTIME', 'DATE', 'TOD', 'DT'] as const
/** Long names of time types, by the short name tags use. */
const TIME_ALIASES: Readonly<Record<string, string>> = { TIME_OF_DAY: 'TOD', DATE_AND_TIME: 'DT' }
/** Bytes of each elementary tag type's value. */
const TAG_WIDTH: Readonly<Record<string, number>> = {
  BOOL: 1,
  SINT: 1,
  USINT: 1,
  BYTE: 1,
  INT: 2,
  UINT: 2,
  WORD: 2,
  DINT: 4,
  UDINT: 4,
  DWORD: 4,
  REAL: 4,
  LINT: 8,
  ULINT: 8,
  LWORD: 8,
  LREAL: 8,
  TIME: 8,
  LTIME: 8,
  DATE: 8,
  TOD: 8,
  DT: 8,
}
const NUMERIC: ReadonlySet<string> = new Set<string>(TAG_TYPES.filter((t) => t !== 'BOOL'))
/** Range of each integer type. */
const INTEGER_RANGE: Readonly<Record<string, readonly [bigint, bigint]>> = {
  SINT: [-128n, 127n],
  INT: [-32768n, 32767n],
  DINT: [-2147483648n, 2147483647n],
  LINT: [-9223372036854775808n, 9223372036854775807n],
  USINT: [0n, 255n],
  BYTE: [0n, 255n],
  UINT: [0n, 65535n],
  WORD: [0n, 65535n],
  UDINT: [0n, 4294967295n],
  DWORD: [0n, 4294967295n],
  ULINT: [0n, 18446744073709551615n],
  LWORD: [0n, 18446744073709551615n],
}
/** Integer range bounds a REAL or LREAL can hold exactly without leaving the range, as ST literals. */
const FLOAT_BOUNDS: Readonly<Record<'REAL' | 'LREAL', Readonly<Record<string, readonly [string, string]>>>> = {
  REAL: {
    SINT: ['-128.0', '127.0'],
    INT: ['-32768.0', '32767.0'],
    DINT: ['-2147483648.0', '2147483520.0'],
    LINT: ['-9223372036854775808.0', '9223371487098961920.0'],
    USINT: ['0.0', '255.0'],
    UINT: ['0.0', '65535.0'],
    UDINT: ['0.0', '4294967040.0'],
    ULINT: ['0.0', '18446742974197923840.0'],
  },
  LREAL: {
    SINT: ['-128.0', '127.0'],
    INT: ['-32768.0', '32767.0'],
    DINT: ['-2147483648.0', '2147483647.0'],
    LINT: ['-9223372036854775808.0', '9223372036854774784.0'],
    USINT: ['0.0', '255.0'],
    UINT: ['0.0', '65535.0'],
    UDINT: ['0.0', '4294967295.0'],
    ULINT: ['0.0', '18446744073709549568.0'],
  },
}
const SIGNED_OF: Readonly<Record<string, string>> = { BYTE: 'USINT', WORD: 'UINT', DWORD: 'UDINT', LWORD: 'ULINT' }
const REAL_MAX = '3.4028234663852886E38'

/**
 * A numeric widget value converted to a tag's type, kept within the type's range so an out-of-range entry writes the
 * nearest value instead of wrapping. `guard` is a condition the write needs (a REAL that is a number).
 */
export function numericWriteBack(from: string, to: string, value: string): { expr: string; guard?: string } {
  if (from === to) return { expr: value }
  const float = from === 'REAL' || from === 'LREAL' ? from : undefined
  if (float && (to === 'REAL' || to === 'LREAL'))
    return to === 'REAL'
      ? { expr: `LREAL_TO_REAL(LIMIT(-${REAL_MAX}, ${value}, ${REAL_MAX}))`, guard: `${value} = ${value}` }
      : { expr: `REAL_TO_LREAL(${value})` }
  if (float) {
    const [lo, hi] = FLOAT_BOUNDS[float][SIGNED_OF[to] ?? to]
    return { expr: `${from}_TO_${to}(LIMIT(${lo}, ${value}, ${hi}))`, guard: `${value} = ${value}` }
  }
  if (to === 'REAL' || to === 'LREAL') return { expr: `${from}_TO_${to}(${value})` }
  const [srcLo, srcHi] = INTEGER_RANGE[from]
  const [dstLo, dstHi] = INTEGER_RANGE[to]
  if (srcLo >= dstLo && srcHi <= dstHi) return { expr: `${from}_TO_${to}(${value})` }
  const lo = srcLo > dstLo ? srcLo : dstLo
  const hi = srcHi < dstHi ? srcHi : dstHi
  return { expr: `${from}_TO_${to}(LIMIT(${lo}, ${value}, ${hi}))` }
}

interface TagType {
  /** Upper-case elementary name, or STRING. */
  base: string
  type: number
  maxLength: number
}

function tagType(declared: string): TagType | undefined {
  const upper = declared.trim().toUpperCase()
  const t = TIME_ALIASES[upper] ?? upper
  const elementary = TAG_TYPES.findIndex((x) => x === t)
  if (elementary >= 0) return { base: t, type: elementary + 1, maxLength: 0 }
  const time = TIME_TAG_TYPES.findIndex((x) => x === t)
  if (time >= 0) return { base: t, type: TAG_STRING + 1 + time, maxLength: 0 }
  const str = /^STRING\s*(?:[([]\s*(\d+)\s*[)\]])?$/.exec(t)
  if (!str) return undefined
  const maxLength = str[1] !== undefined ? Number(str[1]) : DEFAULT_STRING_LENGTH
  return maxLength >= 1 && maxLength <= 65535 ? { base: 'STRING', type: TAG_STRING, maxLength } : undefined
}

const hex = (rgb: string): string => `16#${rgb.slice(1).toUpperCase()}`

class Diagnostics {
  readonly errors: HmiDiagnostic[] = []
  readonly warnings: HmiDiagnostic[] = []
  error(file: string, message: string, line?: number): void {
    this.errors.push(line === undefined ? { file, message } : { file, line, message })
  }
  warn(file: string, message: string): void {
    this.warnings.push({ file, message })
  }
}

interface ScreenPlan {
  file: HmiSourceFile
  model: HmiBlockModel
  /** Elements in drawing order with their container (undefined for the screen's own stack). */
  attach: Array<{ element: HmiElementDecl; parent?: HmiElementDecl }>
  /** `Element.Input := Value;` for each type default (`typeDefaults`) the element's initializer leaves out. */
  defaults: string[]
  connects: Array<{ pipe: string; source: string; target: string; prior: string | null }>
  writeBacks: string[]
  /** Generated feed blocks of the screen's data elements: their type, instance and source, and the SetFeed call. */
  feeds: Array<{ type: string; instance: string; source: string; bind: string }>
  /** What each two-way element bound to a variable can write, by upper-case name; null when unbounded. */
  limits: Map<string, HmiElementLimit | null>
  theme: number
}

/** What the shared checks read from a parsed screen. */
const checkBlockOf = (model: HmiBlockModel): HmiCheckBlock => ({
  name: model.name,
  extends: model.extends,
  theme: model.theme ?? null,
  methods: model.methods,
  elements: model.elements.map((e) => ({ name: e.name, type: e.type, props: e.propList })),
})

/** Elements in drawing order, containers before what they hold, and the pipes' ends; the tree is checked before. */
function elementTree(plan: ScreenPlan, catalog: HmiWidgetCatalog): void {
  const { model } = plan
  const byName = new Map(model.elements.map((e) => [e.name.toUpperCase(), e]))
  const parentOf = new Map<HmiElementDecl, HmiElementDecl>()
  for (const e of model.elements) {
    const name = textLiteral(e.props.get('PARENT'))
    const parent = name ? byName.get(name.toUpperCase()) : undefined
    if (parent && isContainerType(catalog, parent.type)) parentOf.set(e, parent)
  }
  const visit = (parent: HmiElementDecl | undefined, depth: number): void => {
    for (const e of model.elements) {
      if (parentOf.get(e) !== parent || plan.attach.some((a) => a.element === e) || depth > model.elements.length)
        continue
      plan.attach.push(parent ? { element: e, parent } : { element: e })
      visit(e, depth + 1)
    }
  }
  visit(undefined, 0)
  for (const e of model.elements)
    for (const d of catalog.widgets.get(e.type.toUpperCase())?.typeDefaults ?? [])
      if (!e.props.has(d.name.toUpperCase())) plan.defaults.push(`${e.name}.${d.name} := ${d.value};`)
  const priorPipe = new Map<string, string>()
  for (const e of model.elements) {
    if (!isA(catalog, e.type, 'HMIPIPE')) continue
    const end = (prop: string): string | undefined => {
      const name = textLiteral(e.props.get(prop))
      return name === undefined ? undefined : byName.get(name.toUpperCase())?.name
    }
    const source = end('SOURCE')
    const target = end('TARGET')
    const parent = textLiteral(e.props.get('PARENT'))?.toUpperCase() ?? ''
    const prior = priorPipe.get(parent) ?? null
    priorPipe.set(parent, e.name)
    if (source !== undefined && target !== undefined) plan.connects.push({ pipe: e.name, source, target, prior })
  }
}

/** `Name : HmiStack` in code: the abstract base of the stacks, which a screen cannot declare. */
const STACK_BASE_DECLARATION = /\b([A-Za-z_]\w*)\s*:\s*HmiStack\b/gi

/** What a declaration of the stack base must become, one message per element. */
function stackBaseErrors(source: string): string[] {
  return [...maskStComments(source).matchAll(STACK_BASE_DECLARATION)].map(
    ([, name]) =>
      `${name}: HmiStack is the base of the stacks; declare ${name} as HmiVerticalStack (children side by side) or ` +
      'HmiHorizontalStack (children top to bottom), without Direction',
  )
}

/** A PLC path as the project's variable list names it, upper case: without the configuration and resource. */
function shortPath(path: string): string {
  const upper = path.replace(/\s+/g, '').toUpperCase()
  const prefix = CONFIG_PREFIXES.find((p) => upper.startsWith(p))
  return prefix ? upper.slice(prefix.length) : upper
}

/** Why a path the HMI's variable list leaves out is not there, as far as its shape tells. */
function unlistedReason(path: string): string {
  if (path.includes('['))
    return `arrays list their first ${HMI_ARRAY_ELEMENTS_MAX} elements, and only arrays with literal bounds`
  return `function blocks and structs are listed ${HMI_NESTING_MAX} levels deep, without in-outs and internal variables`
}

/** Typed write-back of `Element.Value := Variable;` for two-way widgets. */
function writeBacks(
  plan: ScreenPlan,
  catalog: HmiWidgetCatalog,
  variables: ReadonlyMap<string, HmiPlcVariable>,
  d: Diagnostics,
): void {
  const elements = new Map(plan.model.elements.map((e) => [e.name.toUpperCase(), e]))
  for (const b of plan.model.bindings) {
    const element = elements.get(b.element.toUpperCase())
    const widget: HmiWidgetInfo | undefined = element ? catalog.widgets.get(element.type.toUpperCase()) : undefined
    const twoWay = widget?.twoWay
    if (!twoWay || twoWay.value.toUpperCase() !== b.property.toUpperCase()) continue
    const variable = variables.get(shortPath(b.variable))
    if (!variable) {
      d.error(
        plan.file.name,
        `${b.element}.${b.property}: ${b.variable} is not in the HMI's variable list (${unlistedReason(b.variable)}); ` +
          'a two-way widget cannot write it',
      )
      continue
    }
    const type = tagType(variable.type)
    if (!type) continue
    if (variable.constant) {
      d.error(plan.file.name, `${b.element}.${b.property}: ${b.variable} is a CONSTANT; the operator cannot change it`)
      continue
    }
    if (variable.blockOutput) {
      d.error(
        plan.file.name,
        `${b.element}.${b.property}: ${b.variable} is an output of a function block; a two-way widget cannot write it`,
      )
      continue
    }
    const source = widget.outputs.find((o) => o.name.toUpperCase() === twoWay.newValue.toUpperCase())
    const from = (source?.type ?? '').toUpperCase()
    const value = `${b.element}.${twoWay.newValue}`
    let converted: { expr: string; guard?: string } | undefined
    if (from === type.base) converted = { expr: value }
    else if (NUMERIC.has(from) && NUMERIC.has(type.base)) converted = numericWriteBack(from, type.base, value)
    if (converted === undefined) {
      d.error(
        plan.file.name,
        `${b.element}.${b.property}: a ${from} widget value cannot be written to ${b.variable} (${variable.type})`,
      )
      continue
    }
    const condition = converted.guard
      ? `${b.element}.${twoWay.changed} AND ${converted.guard}`
      : `${b.element}.${twoWay.changed}`
    plan.writeBacks.push(`IF ${condition} THEN ${b.variable} := ${converted.expr}; END_IF;`)
    if (element) plan.limits.set(element.name.toUpperCase(), hmiElementLimit(element, widget, plan.file.source))
  }
  const code = maskStComments(plan.file.source)
  for (const element of plan.model.elements) {
    const twoWay = catalog.widgets.get(element.type.toUpperCase())?.twoWay
    if (!twoWay) continue
    const assigned = new RegExp(`\\b${element.name}\\s*\\.\\s*${twoWay.value}\\s*:=`, 'i').test(code)
    if (!assigned)
      plan.writeBacks.push(
        `IF ${element.name}.${twoWay.changed} THEN ${element.name}.${twoWay.value} := ${element.name}.${twoWay.newValue}; END_IF;`,
      )
  }
}

/** The ST conversion of a numeric element type to REAL. */
const toReal = (element: string | undefined, value: string): string =>
  element === undefined || element === 'REAL' ? value : `${element}_TO_REAL(${value})`

/** One generated feed method: a constant-index read of the source per row, or of the summary. */
function feedMethod(kind: HmiSourceKind, path: string, rows: readonly number[], element?: string): string[] {
  return HMI_FEED_METHODS[kind].map((m) => {
    const head = `  METHOD OVERRIDE ${m.method} : ${m.result}`
    if (kind === 'summary') {
      const read = `${m.method} := ${path}.${m.field};`
      return m.indexed
        ? `${head}\n    VAR_INPUT I : DINT; END_VAR\n    ${read}\n  END_METHOD`
        : `${head}\n    ${read}\n  END_METHOD`
    }
    const cases = rows.map((index, row) => {
      const at = `${path}[${index}]`
      const value = kind === 'numbers' ? toReal(element, at) : `${at}.${m.field}`
      return `      ${row}: ${m.method} := ${value};`
    })
    return `${head}\n    VAR_INPUT I : DINT; END_VAR\n    CASE I OF\n${cases.join('\n')}\n    END_CASE;\n  END_METHOD`
  })
}

/**
 * The feeds of a screen's data elements: for each `hmi_source` input set to a literal, the PLC source it names is
 * checked and a feed block is generated that reads every row with constant indexes, with the element's
 * acknowledgements written back to the source.
 */
function feeds(
  plan: ScreenPlan,
  catalog: HmiWidgetCatalog,
  variables: ReadonlyMap<string, HmiPlcVariable>,
  d: Diagnostics,
): void {
  for (const element of plan.model.elements) {
    const widget = catalog.widgets.get(element.type.toUpperCase())
    for (const source of widget?.sources ?? []) {
      const name = textLiteral(element.props.get(source.name.toUpperCase()))
      if (name === undefined || name.trim() === '') continue
      const where = `${element.name}.${source.name}`
      const kind = hmiSourceKind(source.type)
      if (kind === null) {
        d.error(plan.file.name, `${where}: ${source.type} is not data the HMI build can feed`)
        continue
      }
      const variable = variables.get(shortPath(name))
      if (!variable?.source) {
        d.error(
          plan.file.name,
          `${where}: '${name}' is not a table, log, summary or array of the PLC program; it takes ${source.type}`,
        )
        continue
      }
      if (variable.source.kind !== kind) {
        d.error(plan.file.name, `${where} takes ${source.type}; '${name}' is ${variable.type}`)
        continue
      }
      const { lower = 0, upper = -1 } = variable.source
      const indexes = kind === 'summary' ? [] : Array.from({ length: upper - lower + 1 }, (_, i) => lower + i)
      const type = `HMI__Feed_${plan.model.name}_${element.name}_${source.slot}`
      const instance = `HMI__F_${element.name}_${source.slot}`
      const methods = feedMethod(kind, variable.path, indexes, variable.source.element)
      if (kind !== 'summary')
        methods.unshift(`  METHOD OVERRIDE Count : DINT\n    Count := ${indexes.length};\n  END_METHOD`)
      plan.feeds.push({
        type,
        instance,
        source: `${INSTANCE_PATHS}\nFUNCTION_BLOCK ${type} EXTENDS HmiFeed\n${methods.join('\n')}\nEND_FUNCTION_BLOCK\n`,
        bind: `${element.name}.SetFeed(${source.slot}, ADR(${instance}));`,
      })
      const output = (out: string): boolean => (widget?.outputs ?? []).some((o) => o.name.toUpperCase() === out)
      if (kind === 'alarms' && output('ACKROW'))
        plan.writeBacks.push(
          `CASE ${element.name}.AckRow OF ${indexes.map((index, row) => `${row}: ${variable.path}[${index}].AckReq := TRUE;`).join(' ')} END_CASE;`,
        )
      if (kind === 'summary')
        for (const request of ['AckTop', 'AckAll'])
          if (output(request.toUpperCase()))
            plan.writeBacks.push(`IF ${element.name}.${request} THEN ${variable.path}.${request} := TRUE; END_IF;`)
    }
  }
}

/** Elements whose widget needs a capability the target lacks (`hmi_requires`), as errors. */
function requiredCapabilities(plan: ScreenPlan, catalog: HmiWidgetCatalog, capabilities: object, d: Diagnostics): void {
  const granted = new Set(Object.entries(capabilities).flatMap(([name, value]) => (value === true ? [name] : [])))
  for (const element of plan.model.elements) {
    const widget = catalog.widgets.get(element.type.toUpperCase())
    if (widget?.requires && !granted.has(widget.requires))
      d.error(
        plan.file.name,
        `${element.name}: ${widget.name} needs a target with ${widget.requires}, and the selected board does not have it`,
      )
  }
}

/** The screen's source with Build and WriteBack added on the line where its declarations end. */
function screenSource(plan: ScreenPlan): string {
  const build = [
    `UseTheme(${plan.theme});`,
    ...plan.defaults,
    ...plan.attach.map((a) => `Attach(ADR(${a.element.name}), ${a.parent ? `ADR(${a.parent.name})` : '0'});`),
    ...plan.connects.map(
      (c) => `Connect(ADR(${c.pipe}), ADR(${c.source}), ADR(${c.target}), ${c.prior ? `ADR(${c.prior})` : '0'});`,
    ),
    ...plan.feeds.map((f) => f.bind),
  ]
  const feeds =
    plan.feeds.length > 0 ? ` VAR ${plan.feeds.map((f) => `${f.instance} : ${f.type};`).join(' ')} END_VAR` : ''
  const generated =
    feeds +
    ` METHOD PROTECTED OVERRIDE Build : BOOL ${build.join(' ')} Build := TRUE; END_METHOD` +
    ` METHOD PROTECTED OVERRIDE WriteBack : BOOL ${plan.writeBacks.join(' ')} WriteBack := TRUE; END_METHOD `
  const { source } = plan.file
  return `${source.slice(0, plan.model.insertAt)}${generated}${source.slice(plan.model.insertAt)}`
}

function glueSource(names: readonly string[], settings: HmiSettings): string {
  const themes = [...HMI_BUILTIN_THEMES, ...settings.themes.map((t) => t.name)]
  return [
    '(* Generated by the HMI build: screens by name, navigation and theme ids. *)',
    `TYPE HMI_SCREEN : (${names.map((n, i) => `${n} := ${i}`).join(', ')}); END_TYPE`,
    'VAR_GLOBAL',
    '  HMI__Request : DINT := -1;',
    '  HMI__Page : DINT := -1;',
    'END_VAR',
    'VAR_GLOBAL CONSTANT',
    ...themes.map((t, i) => `  HMI_THEME_${t} : DINT := ${i};`),
    'END_VAR',
    '(* Shows a screen from the next frame; ignored when the viewer may not open it. *)',
    'FUNCTION HMI_Show : BOOL',
    '  VAR_INPUT Screen : HMI_SCREEN; END_VAR',
    '  CASE Screen OF',
    ...names.map((n, i) => `    HMI_SCREEN#${n}: HMI__Request := ${i};`),
    '  END_CASE;',
    '  HMI_Show := TRUE;',
    'END_FUNCTION',
    'FUNCTION HMI_CurrentScreen : HMI_SCREEN',
    '  CASE HMI__Page OF',
    ...names.map((n, i) => `    ${i}: HMI_CurrentScreen := HMI_SCREEN#${n};`),
    '  END_CASE;',
    'END_FUNCTION',
    '(* Destroys the screen of page Previous in the slot at address Slot and builds the screen of page Page there. *)',
    'FUNCTION HMI__ScreenOpen : POINTER TO HmiScreen',
    '  VAR_INPUT Slot : LWORD; Page, Previous : DINT; END_VAR',
    '  {external',
    `    ${SCREEN_CPP_BASE} *${SLOT_OPEN}(uint64_t slot, int32_t page, int32_t previous);`,
    `    HMI__SCREENOPEN_result = ${SLOT_OPEN}(SLOT.get(), PAGE.get(), PREVIOUS.get());`,
    '  }',
    'END_FUNCTION',
    '(* Runs the body of the screen of page Page, built in the slot at address Slot. *)',
    'FUNCTION HMI__ScreenBody : BOOL',
    '  VAR_INPUT Slot : LWORD; Page : DINT; END_VAR',
    '  {external',
    `    void ${SLOT_BODY}(uint64_t slot, int32_t page);`,
    `    ${SLOT_BODY}(SLOT.get(), PAGE.get());`,
    '    HMI__SCREENBODY_result.set(true);',
    '  }',
    'END_FUNCTION',
    '',
  ].join('\n')
}

/** Numbers, based and typed literals, TRUE/FALSE and single-quoted strings: what a mirror field may start from. */
const ST_LITERAL =
  /^(?:[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:E[+-]?\d+)?|\d+#[0-9A-F_]+|TRUE|FALSE|[A-Z_]\w*#[\w.]+|'(?:[^'$\n]|\$[^\n])*')$/i

/**
 * Preview only, where the unit's own storage stands in for the PLC: statements starting each variable screens may use
 * from its declared initial value, when that is a literal; the others keep their type's default.
 */
function previewStarts(variables: readonly HmiPlcVariable[]): string[] {
  return variables.flatMap((v) => {
    if (v.constant) return []
    const initial = v.initialValue?.trim()
    return initial !== undefined && tagType(v.type) && ST_LITERAL.test(initial) ? [`    ${v.path} := ${initial};`] : []
  })
}

function mainSource(
  screens: readonly ScreenPlan[],
  firstIds: readonly number[],
  settings: HmiSettings,
  start: number,
  starts: string[],
): string {
  const access = (role: (typeof HMI_ROLES)[number] | null): string[] =>
    screens.map(
      (s, i) =>
        `      Rt.SetAccess(${i}, ${role === null ? 'FALSE' : String(screenGrant(settings, s.model.name)[role]).toUpperCase()});`,
    )
  const themes = settings.themes.flatMap((t, i) => {
    const id = HMI_BUILTIN_THEMES.length + i
    return [
      `    Rt.CopyTheme(${id}, ${HMI_BUILTIN_THEMES.indexOf(t.base)});`,
      ...Object.entries(t.colors).map(
        ([token, rgb]) =>
          `    Rt.SetThemeColor(${id}, ${HMI_THEME_TOKENS.findIndex((x) => x === token) + 1}, ${hex(rgb)});`,
      ),
    ]
  })
  return [
    '(* Generated by the HMI build: one instance per viewer; the host sets Role before the first frame. *)',
    INSTANCE_PATHS,
    'PROGRAM HmiMain',
    '  VAR_INPUT',
    '    Role : DINT;',
    '  END_VAR',
    '  VAR',
    '    Rt : HmiRuntime;',
    '    (* Address of the slot the shown screen is built in; the unit glue sets it. *)',
    '    Slot : LWORD;',
    '    Want, Was : DINT;',
    '    Started : BOOL;',
    '    (* TRUE when the next frame builds a screen; the unit glue reads it. *)',
    '    MountNext : BOOL := TRUE;',
    '  END_VAR',
    '  IF NOT Started THEN',
    ...starts,
    ...themes,
    ...firstIds.map((id) => `    Rt.AddPage(${id});`),
    `    Rt.SetStart(${start});`,
    '    CASE Role OF',
    '      0: ;',
    ...HMI_ROLES.flatMap((role, r) => [`      ${r + 1}:`, ...access(role)]),
    '    ELSE',
    ...access(null),
    '    END_CASE;',
    '    Started := TRUE;',
    '  END_IF;',
    '  HMI__Request := -1;',
    '  HMI__Page := Rt.CurrentPage();',
    '  Want := Rt.Wanted();',
    '  IF Want >= 0 AND Want <> Rt.Mounted() THEN',
    '    Was := Rt.Mounted();',
    '    Rt.Release();',
    '    Rt.Mount(Want, HMI__ScreenOpen(Slot, Want, Was));',
    '  END_IF;',
    '  HMI__Page := Rt.BeginFrame();',
    '  IF HMI__Page >= 0 THEN',
    '    HMI__ScreenBody(Slot, HMI__Page);',
    '  END_IF;',
    '  Rt.EndFrame();',
    '  IF HMI__Request >= 0 THEN',
    '    Rt.Show(HMI__Request);',
    '  END_IF;',
    '  Want := Rt.Wanted();',
    '  MountNext := Want >= 0 AND Want <> Rt.Mounted();',
    'END_PROGRAM',
    '',
    'CONFIGURATION HmiConfig',
    '  RESOURCE HmiResource ON PLC',
    `    TASK HmiTask(INTERVAL := T#${settings.framePeriodMs}ms, PRIORITY := 1);`,
    '    PROGRAM HmiInstance WITH HmiTask : HmiMain;',
    '  END_RESOURCE',
    'END_CONFIGURATION',
    '',
  ].join('\n')
}

const cString = (s: string): string => JSON.stringify(s)

/** 64-bit FNV-1a of text, as 16 hex digits. */
function fnv64(text: string): string {
  let h = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn
  return h.toString(16).padStart(16, '0')
}

/** Identity of a build: changes whenever the PLC program, a screen, a widget block or the settings change. */
export function hmiBuildId(input: HmiUnitInput): string {
  const files = [...input.screens, ...input.widgets].map((f) => `${f.name}\u0000${f.source}`)
  return fnv64([input.plcMd5 ?? '', JSON.stringify(input.settings), ...files].join('\u0001'))
}

/** A PLC variable the unit's screens use, by the id STruC++ gave its path. */
interface UnitTag {
  /** Canonical path, upper case. */
  path: string
  type: TagType
  address: HmiTagAddress | null
}

/** C++ type of a tag's variable, as STruC++ declares it. */
const cppTypeOf = (t: TagType): string =>
  t.base === 'STRING' ? `strucpp::IECStringVar<${t.maxLength}>` : `strucpp::IEC_${t.base}`

/**
 * The program instance with its screen slot: one per viewer, so viewers can show different screens. The slot holds
 * the shown page's screen and is as large as the largest one.
 */
function slotHeader(classes: readonly string[]): string {
  const types = classes.map((c) => `${NAMESPACE}::${c}`)
  return [
    '/* Generated by the HMI build: a program instance and the slot its shown screen is built in. */',
    '#pragma once',
    '#include <algorithm>',
    '#include <cstddef>',
    '',
    `#include "${HEADER}"`,
    '',
    `constexpr std::size_t kHmiSlotSize = std::max<std::size_t>({1, ${types.map((t) => `sizeof(${t})`).join(', ')}});`,
    `constexpr std::size_t kHmiSlotAlign = std::max<std::size_t>({alignof(std::max_align_t), ${types.map((t) => `alignof(${t})`).join(', ')}});`,
    '',
    'struct HmiUnit {',
    `    ${NAMESPACE}::Program_HMIMAIN program;`,
    '    alignas(kHmiSlotAlign) unsigned char slot[kHmiSlotSize];',
    '};',
    '',
  ].join('\n')
}

function glueCpp(tags: readonly UnitTag[], input: HmiUnitInput, classes: readonly string[]): string {
  const sizeOf = (t: TagType): number => (t.base === 'STRING' ? t.maxLength + 1 : (TAG_WIDTH[t.base] ?? 0))
  const read = tags.map(({ type }, i) => {
    const v = `static_cast<const ${cppTypeOf(type)} *>(variable)`
    return type.base === 'STRING'
      ? `    case ${i}: { const auto s = ${v}->get(); size_t n = std::min<size_t>(s.length(), ${type.maxLength}); std::memcpy(buf, s.c_str(), n); static_cast<char *>(buf)[n] = 0; return 0; }`
      : type.base === 'BOOL'
        ? `    case ${i}: { uint8_t b = ${v}->get() ? 1 : 0; std::memcpy(buf, &b, 1); return 0; }`
        : `    case ${i}: { auto x = ${v}->get(); std::memcpy(buf, &x, sizeof x); return 0; }`
  })
  const write = tags.map(({ type }, i) => {
    const v = `static_cast<${cppTypeOf(type)} *>(variable)`
    return type.base === 'STRING'
      ? `    case ${i}: { const char *b = static_cast<const char *>(buf); size_t n = 0; while (n < ${type.maxLength} && b[n] != 0) n++; char s[${type.maxLength + 1}]; std::memcpy(s, b, n); s[n] = 0; ${v}->set(s); return 0; }`
      : type.base === 'BOOL'
        ? `    case ${i}: { uint8_t b; std::memcpy(&b, buf, 1); ${v}->set(b != 0); return 0; }`
        : `    case ${i}: { auto x = ${v}->get(); std::memcpy(&x, buf, sizeof x); ${v}->set(x); return 0; }`
  })
  const rows = tags.map(
    ({ path, type, address }) =>
      `    {${address?.arr ?? 0}u, ${address?.elem ?? 0}u, ${type.type}, ${type.maxLength}, ${cString(path)}},`,
  )
  /* A panel always reads its PLC through the host, so its variables without one are the read copies themselves. */
  const own = input.panel ? 'g_read' : 'g_own'
  const stores = tags.map(
    ({ type }, i) =>
      `    case ${i}: *static_cast<${cppTypeOf(type)} *>(${own}[${i}]) = *static_cast<const ${cppTypeOf(type)} *>(value); return;`,
  )
  const { settings } = input
  return [
    '/* Generated by the HMI build: the C side of hmi_unit.h. */',
    '#include <algorithm>',
    '#include <cstdint>',
    '#include <cstring>',
    '#include <new>',
    '',
    '#include "hmi_unit.h"',
    `#include "${HEADER}"`,
    `#include "${SLOT_HEADER}"`,
    '#include "iec_external.hpp"',
    '#include "iec_fault.hpp"',
    '',
    `namespace ${NAMESPACE} {`,
    `${SCREEN_CPP_BASE} *${SLOT_OPEN}(uint64_t slot, int32_t page, int32_t previous) {`,
    '    void *at = reinterpret_cast<void *>(static_cast<std::uintptr_t>(slot));',
    '    if (!at) return nullptr;',
    '    switch (previous) {',
    ...classes.map((c, i) => `    case ${i}: static_cast<${c} *>(at)->~${c}(); break;`),
    '    default: break;',
    '    }',
    '    switch (page) {',
    ...classes.map((c, i) => `    case ${i}: return new (at) ${c}();`),
    '    default: return nullptr;',
    '    }',
    '}',
    `void ${SLOT_BODY}(uint64_t slot, int32_t page) {`,
    '    void *at = reinterpret_cast<void *>(static_cast<std::uintptr_t>(slot));',
    '    if (!at) return;',
    '    switch (page) {',
    ...classes.map((c, i) => `    case ${i}: (*static_cast<${c} *>(at))(); break;`),
    '    default: break;',
    '    }',
    '}',
    '}',
    '',
    '/* Gives a new instance its slot. */',
    'static HmiUnit *hmi_unit_start(HmiUnit *u) {',
    '    u->program.SLOT.set(static_cast<uint64_t>(reinterpret_cast<std::uintptr_t>(u->slot)));',
    '    return u;',
    '}',
    '/* Destroys the screen built in the slot, if any. */',
    'static void hmi_unit_close_screen(HmiUnit *u) {',
    `    ${NAMESPACE}::${SLOT_OPEN}(u->program.SLOT.get(), -1, u->program.RT.MOUNTED().get());`,
    '}',
    '',
    'namespace {',
    'const hmi_tag_access_t *g_access = nullptr;',
    ...(input.panel
      ? []
      : [
          '/* The variables when no host serves them: the preview, where no PLC runs. */',
          ...tags.map((t, i) => `${cppTypeOf(t.type)} g_own_${i}{};`),
          `void *const g_own[${Math.max(tags.length, 1)}] = {${tags.length > 0 ? tags.map((_, i) => `&g_own_${i}`).join(', ') : 'nullptr'}};`,
          '',
        ]),
    "/* The host's values as screens last read them; a failed read keeps the previous value. */",
    ...tags.map((t, i) => `${cppTypeOf(t.type)} g_read_${i}{};`),
    `void *const g_read[${Math.max(tags.length, 1)}] = {${tags.length > 0 ? tags.map((_, i) => `&g_read_${i}`).join(', ') : 'nullptr'}};`,
    `constexpr size_t kTagBufferSize = ${Math.max(1, ...tags.map(({ type }) => sizeOf(type)))};`,
    '',
    'void *tag_variable(uint32_t id) {',
    `    if (id >= ${tags.length}u) return nullptr;`,
    `    if (!g_access) return ${own}[id];`,
    '    alignas(8) unsigned char buf[kTagBufferSize];',
    '    if (g_access->read(g_access->ctx, static_cast<int>(id), buf)) hmi_tag_write(static_cast<int>(id), g_read[id], buf);',
    '    return g_read[id];',
    '}',
    '}',
    '',
    'namespace strucpp {',
    'void *external_variable(uint32_t id) { return tag_variable(id); }',
    'void external_store(uint32_t id, const void *value) {',
    '    if (g_access) {',
    '        alignas(8) unsigned char buf[kTagBufferSize];',
    '        if (hmi_tag_read(static_cast<int>(id), value, buf) == 0) g_access->write(g_access->ctx, static_cast<int>(id), buf);',
    '        return;',
    '    }',
    '    switch (id) {',
    ...stores,
    '    default: return;',
    '    }',
    '}',
    '}',
    '',
    'extern "C" {',
    `const hmi_tag_t hmi_tags[${Math.max(tags.length, 1)}] = {`,
    ...(rows.length > 0 ? rows : ['    {0u, 0u, 0, 0, ""},']),
    '};',
    `const int hmi_tag_count = ${tags.length};`,
    `const char hmi_plc_md5[] = ${cString(input.plcMd5 ?? '')};`,
    `const uint32_t hmi_frame_ms = ${settings.framePeriodMs};`,
    ...(input.panel
      ? [
          `const char hmi_panel_pin[] = ${cString(settings.pin.enabled ? settings.pin.value : '')};`,
          `const uint32_t hmi_relock_minutes = ${settings.relock.mode === 'idle' ? settings.relock.minutes : 0};`,
          `const uint8_t hmi_touch_cal_mode = ${HMI_TOUCH_CALIBRATION_MODES.indexOf(settings.touchCalibration.mode)};`,
          `const char hmi_build_id[] = ${cString(hmiBuildId(input))};`,
        ]
      : []),
    '',
    'void hmi_set_tag_access(const hmi_tag_access_t *access) {',
    '    g_access = access && access->read && access->write ? access : nullptr;',
    '}',
    '',
    '}',
    '',
    '/* A bit assignment of screen code: through the host when it applies bits, else a read-modify-write of the tag. */',
    'void hmi_bit_store(unsigned id, unsigned bit, bool value) {',
    `    if (id >= ${tags.length}u || bit / 8u >= hmi_tag_size(static_cast<int>(id))) return;`,
    '    if (g_access && g_access->write_bit) {',
    '        g_access->write_bit(g_access->ctx, static_cast<int>(id), bit, value);',
    '        return;',
    '    }',
    '    alignas(8) unsigned char buf[kTagBufferSize];',
    '    if (hmi_tag_read(static_cast<int>(id), nullptr, buf) != 0) return;',
    '    const unsigned char mask = static_cast<unsigned char>(1u << (bit % 8u));',
    '    buf[bit / 8u] = static_cast<unsigned char>(value ? buf[bit / 8u] | mask : buf[bit / 8u] & ~mask);',
    '    if (g_access) g_access->write(g_access->ctx, static_cast<int>(id), buf);',
    '    else hmi_tag_write(static_cast<int>(id), nullptr, buf);',
    '}',
    '',
    'extern "C" {',
    'size_t hmi_tag_size(int tag) {',
    '    switch (tag) {',
    ...tags.map(({ type }, i) => `    case ${i}: return ${sizeOf(type)};`),
    '    default: return 0;',
    '    }',
    '}',
    '',
    'int hmi_tag_read(int tag, const void *variable, void *buf) {',
    '    if (tag < 0 || tag >= hmi_tag_count) return -1;',
    '    if (!variable) variable = tag_variable(static_cast<uint32_t>(tag));',
    '    switch (tag) {',
    ...read,
    '    default: return -1;',
    '    }',
    '}',
    '',
    'int hmi_tag_write(int tag, void *variable, const void *buf) {',
    '    if (tag < 0 || tag >= hmi_tag_count) return -1;',
    `    if (!variable) variable = ${own}[tag];`,
    '    switch (tag) {',
    ...write,
    '    default: return -1;',
    '    }',
    '}',
    '',
    'size_t hmi_unit_size(void) { return sizeof(HmiUnit); }',
    '#if defined(HMI_STATIC_MEMORY)',
    'alignas(HmiUnit) static unsigned char g_unit_storage[sizeof(HmiUnit)];',
    'static bool g_unit_live = false;',
    'void *hmi_unit_create(void) {',
    '    if (g_unit_live) return nullptr;',
    '    g_unit_live = true;',
    '    return hmi_unit_start(new (g_unit_storage) HmiUnit());',
    '}',
    'void hmi_unit_destroy(void *unit) {',
    '    if (!unit) return;',
    '    hmi_unit_close_screen(static_cast<HmiUnit *>(unit));',
    '    static_cast<HmiUnit *>(unit)->~HmiUnit();',
    '    g_unit_live = false;',
    '}',
    '#else',
    'void *hmi_unit_create(void) {',
    '    HmiUnit *u = new (std::nothrow) HmiUnit();',
    '    return u ? hmi_unit_start(u) : nullptr;',
    '}',
    'void hmi_unit_destroy(void *unit) {',
    '    if (!unit) return;',
    '    hmi_unit_close_screen(static_cast<HmiUnit *>(unit));',
    '    delete static_cast<HmiUnit *>(unit);',
    '}',
    '#endif',
    'void hmi_unit_set_role(void *unit, int role) {',
    '    if (unit) static_cast<HmiUnit *>(unit)->program.ROLE.set(role);',
    '}',
    'bool hmi_unit_mount_pending(void *unit) {',
    '    return unit && static_cast<HmiUnit *>(unit)->program.MOUNTNEXT.get();',
    '}',
    'bool hmi_unit_frame(void *unit) {',
    '    if (!unit) return true;',
    '#if STRUCPP_HAS_EXCEPTIONS',
    '    try {',
    '        static_cast<HmiUnit *>(unit)->program.run();',
    '    } catch (...) {',
    '        return false;',
    '    }',
    '#else',
    '    static_cast<HmiUnit *>(unit)->program.run();',
    '#endif',
    '    return true;',
    '}',
    '}',
    '',
  ].join('\n')
}

/** How the preview sets a property live: as a number (numbers, BOOL, colours) or as text; undefined when it cannot. */
/** A bit assignment to a PLC variable as STruC++ compiles it: a read-modify-write of the whole variable. */
const BIT_STORE =
  /strucpp::external_write<([\w:]+)>\((\d+), static_cast<[\w:]+>\(\(static_cast<uint64_t>\(strucpp::external_read<\1>\(\2\)\) & ~\(1ULL << (\d+)\)\) \| \(\((.+?) \? 1ULL : 0ULL\) << \3\)\)\);/g
const BIT_STORE_DECLARATION = 'void hmi_bit_store(unsigned id, unsigned bit, bool value);'

/**
 * Routes every bit assignment to a PLC variable through `hmi_bit_store`, so a host can apply it to the one bit against
 * the variable's current value instead of writing the whole variable from the screen's copy. Returns how many it
 * routed.
 */
function routeBitStores(files: Record<string, string>): number {
  let count = 0
  for (const [name, text] of Object.entries(files)) {
    if (!name.endsWith('.cpp')) continue
    let here = 0
    const routed = text.replace(BIT_STORE, (_all, _type: string, id: string, bit: string, value: string) => {
      here++
      return `::hmi_bit_store(${id}u, ${bit}u, static_cast<bool>(${value}));`
    })
    if (here === 0) continue
    const at = routed.search(/^namespace /m)
    files[name] =
      at < 0
        ? `${BIT_STORE_DECLARATION}\n${routed}`
        : `${routed.slice(0, at)}${BIT_STORE_DECLARATION}\n\n${routed.slice(at)}`
    count += here
  }
  return count
}

/** Setters of each screen's literal numeric, BOOL and STRING properties, and their C++. */
function previewSetters(
  plans: readonly ScreenPlan[],
  catalog: HmiWidgetCatalog,
  classes: readonly string[],
): Pick<HmiPreview, 'setters' | 'files'> {
  const setters: Record<string, HmiPreviewSetter> = {}
  const files: Record<string, string> = {}
  plans.forEach((plan, i) => {
    const num: string[] = []
    const str: string[] = []
    for (const element of plan.model.elements) {
      for (const p of catalog.widgets.get(element.type.toUpperCase())?.properties ?? []) {
        const kind = setterKind(p)
        if (kind === undefined) continue
        const list = kind === 'num' ? num : str
        const member = `s->${element.name.toUpperCase()}.${p.name.toUpperCase()}`
        setters[`${plan.model.name}.${element.name}.${p.name}`] = { screen: i, index: list.length, kind }
        list.push(
          kind === 'num'
            ? `    case ${list.length}: { auto &m = ${member}; m.set(static_cast<std::decay_t<decltype(m.get())>>(value)); return 0; }`
            : `    case ${list.length}: ${member}.set(value); return 0;`,
        )
      }
    }
    files[`hmi_preview_${i}.cpp`] = [
      `/* Generated by the HMI build: live setters of screen ${plan.model.name}, for the preview. */`,
      '#include <type_traits>',
      '',
      `#include "${HEADER}"`,
      '',
      'extern "C" void *hmi_preview_screen(void *unit, int page);',
      '',
      `/* The screen of page ${i} when it is the one built in the slot, else null. */`,
      `static ${NAMESPACE}::${classes[i]} *hmi_preview_screen_${i}(void *unit) {`,
      `    return static_cast<${NAMESPACE}::${classes[i]} *>(hmi_preview_screen(unit, ${i}));`,
      '}',
      '',
      `extern "C" int hmi_preview_set_num_${i}(void *unit, int setter, double value) {`,
      `    auto *s = hmi_preview_screen_${i}(unit);`,
      '    if (!s) return -1;',
      '    switch (setter) {',
      ...num,
      '    default: return -1;',
      '    }',
      '}',
      '',
      `extern "C" int hmi_preview_set_str_${i}(void *unit, int setter, const char *value) {`,
      `    auto *s = hmi_preview_screen_${i}(unit);`,
      '    if (!s) return -1;',
      '    switch (setter) {',
      ...str,
      '    default: return -1;',
      '    }',
      '}',
      '',
    ].join('\n')
  })
  const dispatch = (kind: 'num' | 'str', type: string): string[] => [
    `int hmi_unit_set_${kind}(void *unit, int screen, int setter, ${type} value) {`,
    '    if (!unit) return -1;',
    '    switch (screen) {',
    ...plans.map((_, i) => `    case ${i}: return hmi_preview_set_${kind}_${i}(unit, setter, value);`),
    '    default: return -1;',
    '    }',
    '}',
  ]
  files['hmi_preview.cpp'] = [
    '/* Generated by the HMI build: the preview setters of hmi_preview.h. */',
    '#include "hmi_preview.h"',
    `#include "${HEADER}"`,
    `#include "${SLOT_HEADER}"`,
    '',
    'extern "C" {',
    '/* The slot of the instance when it holds the screen of page `page`, else null. */',
    'void *hmi_preview_screen(void *unit, int page) {',
    '    auto *u = static_cast<HmiUnit *>(unit);',
    '    if (!u || u->program.RT.MOUNTED().get() != page) return nullptr;',
    '    return u->slot;',
    '}',
    '}',
    '',
    '/* The page whose screen is built in the slot, -1 when none is. */',
    'int hmi_preview_mounted_page(void *unit) {',
    '    auto *u = static_cast<HmiUnit *>(unit);',
    '    return u ? static_cast<int>(u->program.RT.MOUNTED().get()) : -1;',
    '}',
    '',
    '/* The screen built in the slot, whichever it is, else null. */',
    `${NAMESPACE}::HMISCREEN *hmi_preview_mounted_screen(void *unit) {`,
    '    auto *u = static_cast<HmiUnit *>(unit);',
    '    if (!u) return nullptr;',
    '    switch (u->program.RT.MOUNTED().get()) {',
    ...classes.map((c, i) => `    case ${i}: return reinterpret_cast<${NAMESPACE}::${c} *>(u->slot);`),
    '    default: return nullptr;',
    '    }',
    '}',
    '',
    'extern "C" {',
    ...plans.flatMap((_, i) => [
      `int hmi_preview_set_num_${i}(void *unit, int setter, double value);`,
      `int hmi_preview_set_str_${i}(void *unit, int setter, const char *value);`,
    ]),
    '',
    ...dispatch('num', 'double'),
    '',
    ...dispatch('str', 'const char *'),
    '}',
    '',
  ].join('\n')
  return { setters, files }
}

/**
 * The preview factory: the given library tables, then a table of the catalogue's other widgets (the project's widget
 * blocks) declared by the unit's libraries header, joined by the dispatcher.
 */
function projectFactory(
  catalog: HmiWidgetCatalog,
  libraries: readonly LibraryFactoryTable[],
): { file: string; factory: HmiPreviewFactory } {
  const covered = (name: string, info: HmiWidgetInfo): boolean =>
    libraries.some((t) => t.library === info.library && t.types[name] !== undefined)
  const own = [...catalog.widgets].filter(([name, info]) => !covered(name, info)).map(([, info]) => info)
  const table = previewFactoryTable(own, PROJECT_FACTORY, LIBRARIES_HEADER, NAMESPACE)
  const dispatch = previewFactoryDispatch([...libraries, table], catalog)
  return { file: `${dispatch.source}\n${table.source}`, factory: dispatch.factory }
}

/**
 * Groups unit and setter files into translation units that change together: the library, the project widgets, each
 * screen with its setters, and the rest.
 */
function previewUnits(
  files: readonly string[],
  plans: readonly ScreenPlan[],
  libraries: readonly HmiWidgetLibraryArchive[],
): HmiPreview['units'] {
  const libraryFiles = new Set(libraries.map((l) => `lib_${l.name.replace(/[^A-Za-z0-9_]/g, '_')}.cpp`))
  const units: HmiPreview['units'] = { library: [], widgets: [], screens: {}, glue: [], factory: [] }
  const screens = new Map<string, string>()
  plans.forEach((p, i) => {
    screens.set(`pou_${p.model.name.toUpperCase()}.cpp`, p.model.name)
    screens.set(`hmi_preview_${i}.cpp`, p.model.name)
    for (const f of p.feeds) screens.set(`pou_${f.type.toUpperCase()}.cpp`, p.model.name)
  })
  for (const f of files.filter((n) => n.endsWith('.cpp'))) {
    const screen = screens.get(f)
    if (f === FACTORY_FILE) units.factory.push(f)
    else if (libraryFiles.has(f)) units.library.push(f)
    else if (f === 'lib_project_widgets.cpp') units.widgets.push(f)
    else if (screen !== undefined) units.screens[screen] = [...(units.screens[screen] ?? []), f]
    else units.glue.push(f)
  }
  return units
}

/** Names the library declares, upper-case: screens and widget blocks may not reuse them. */
function libraryNames(archive: StlibArchive): Set<string> {
  const m = archive.manifest
  return new Set(
    [...m.functions, ...m.functionBlocks, ...m.types, ...(m.globals ?? []), ...(m.interfaces ?? [])].map((x) =>
      x.name.toUpperCase(),
    ),
  )
}

function checkNames(input: HmiUnitInput, library: ReadonlySet<string>, d: Diagnostics): void {
  const project = new Set(input.projectNames.map((n) => n.toUpperCase()))
  const seen = new Set<string>()
  for (const [kind, files] of [
    ['Screen', input.screens],
    ['Widget block', input.widgets],
  ] as const) {
    for (const f of files) {
      const key = f.name.toUpperCase()
      if (!IDENTIFIER.test(f.name)) d.error(f.name, `${kind} name '${f.name}' is not an identifier`)
      else if (library.has(key) || hmiReservedName(f.name) !== null)
        d.error(f.name, `${kind} name '${f.name}' is taken by the HMI library`)
      else if (project.has(key)) d.error(f.name, `${kind} name '${f.name}' is taken by a POU or data type`)
      else if (seen.has(key)) d.error(f.name, `${kind} name '${f.name}' is used twice`)
      seen.add(key)
    }
  }
}

/** The library archives and the widget catalogue a project's widget blocks give, with their errors. */
export interface HmiWidgetLibrary {
  archives: StlibArchive[]
  catalog: HmiWidgetCatalog
  errors: HmiDiagnostic[]
}

/** Name of the library a project's widget blocks compile into. */
const PROJECT_WIDGETS = 'project-widgets'

/**
 * Compiles a project's widget blocks against the project's libraries and builds the catalogue of all of them: the
 * libraries' widgets, then the project's blocks. Errors leave the catalogue with the library widgets only.
 */
export function compileHmiWidgets(
  widgets: readonly HmiSourceFile[],
  libraries: readonly HmiWidgetLibraryArchive[],
  libraryCatalog: HmiWidgetCatalog,
): HmiWidgetLibrary {
  const strucpp = loadStrucpp()
  const archives: StlibArchive[] = libraries.map((l) => l.archive)
  const errors: HmiDiagnostic[] = widgets.flatMap((w) =>
    stackBaseErrors(w.source).map((message) => ({ file: w.name, message })),
  )
  if (widgets.length > 0 && errors.length === 0) {
    const compiled = strucpp.compileStlib(
      widgets.map((w) => ({ fileName: w.name, source: w.source })),
      {
        name: PROJECT_WIDGETS,
        version: '1.0.0',
        namespace: 'hmi_project_widgets',
        dependencies: [...archives],
      },
    )
    for (const e of compiled.errors) errors.push({ file: e.file ?? UNIT, message: e.message, line: e.line })
    if (errors.length === 0)
      archives.push(strucpp.loadStlibFromString(JSON.stringify(compiled.archive), PROJECT_WIDGETS))
  }
  const project = archives.some((a) => a.manifest.name === PROJECT_WIDGETS) ? buildWidgetCatalog(archives) : null
  const projectWidgets = new Map(
    [...(project?.widgets ?? [])].filter(([, widget]) => widget.library === PROJECT_WIDGETS),
  )
  const catalog = withWidgets(libraryCatalog, projectWidgets)
  if (errors.length === 0)
    for (const w of widgets)
      if (!catalog.widgets.has(w.name.toUpperCase()))
        errors.push({
          file: w.name,
          message: `${w.name} must be a FUNCTION_BLOCK that extends HmiElement or another widget`,
        })
  return { archives, catalog, errors }
}

/** The catalogue of the project's libraries and its widget blocks, for the designer. */
export function buildHmiWidgetCatalog(
  widgets: readonly HmiSourceFile[],
  projectLibraries: readonly unknown[],
): HmiWidgetLibrary {
  const loaded = loadHmiWidgetLibraries(projectLibraries)
  const compiled = compileHmiWidgets(widgets, loaded.libraries, loaded.catalog)
  return { ...compiled, errors: [...loaded.errors, ...compiled.errors] }
}

/** Name of the screen a widget preview adds; the HMI__ prefix is refused for project names. */
export const WIDGET_PREVIEW_SCREEN = 'HMI__WidgetPreview'

const PREVIEW_INTEGER_TYPES = new Set(['SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT'])
const PREVIEW_REAL_TYPES = new Set(['REAL', 'LREAL'])

/**
 * A value that shows a widget at work: its main input's `hmi_preview`, else TRUE, 60 % of its MaxValue (else 42), or
 * its name without the Hmi prefix as text.
 */
function previewTestValue(info: HmiWidgetInfo): string | undefined {
  const type = info.main?.direction === 'input' ? info.main.type.toUpperCase() : undefined
  if (type === undefined) return undefined
  const own = info.properties.find((p) => p.name.toUpperCase() === info.main?.name.toUpperCase())?.previewValue
  if (own !== undefined) return own
  if (type === 'BOOL') return 'TRUE'
  if (type.startsWith('STRING')) return `'${info.name.replace(/^Hmi/i, '')}'`
  const max = Number(info.properties.find((p) => p.name.toUpperCase() === 'MAXVALUE')?.defaultValue)
  const value = Number.isFinite(max) && max > 0 ? max * 0.6 : 42
  if (PREVIEW_REAL_TYPES.has(type)) return value.toFixed(1)
  return PREVIEW_INTEGER_TYPES.has(type) ? String(Math.round(value)) : undefined
}

/** The screen a widget preview adds: the block at natural size beside a spacer, then stretched over the rest. */
function widgetPreviewSource(info: HmiWidgetInfo): string {
  const value = previewTestValue(info)
  const assign =
    info.main && value !== undefined
      ? [`  Natural.${info.main.name} := ${value};`, `  Stretched.${info.main.name} := ${value};`]
      : []
  return [
    `FUNCTION_BLOCK ${WIDGET_PREVIEW_SCREEN} EXTENDS HmiScreen`,
    '  VAR',
    '    HMI__Column : HmiHorizontalStack := (Gap := 16, Padding := 16);',
    "    HMI__Row : HmiVerticalStack := (Parent := 'HMI__Column', GrowAuto := FALSE);",
    `    Natural : ${info.name} := (Parent := 'HMI__Row', GrowAuto := FALSE);`,
    "    HMI__Spacer : HmiVerticalStack := (Parent := 'HMI__Row');",
    `    Stretched : ${info.name} := (Parent := 'HMI__Column', GrowAuto := TRUE);`,
    '  END_VAR',
    ...assign,
    'END_FUNCTION_BLOCK',
    '',
  ].join('\n')
}

/** Name of the palette gallery's screen. */
export const HMI_GALLERY_SCREEN = 'HMI__Gallery'
const GALLERY_ELEMENT = 'W_'

/** The widget a palette gallery element shows, or null for the gallery's own stacks. */
export function hmiGalleryWidget(element: string): string | null {
  return element.startsWith(GALLERY_ELEMENT) ? element.slice(GALLERY_ELEMENT.length) : null
}

/** The widgets the palette gallery draws: every palette widget and project widget block that is not a stack or a pipe. */
function galleryWidgets(catalog: HmiWidgetCatalog, projectWidgets: readonly HmiSourceFile[]): HmiWidgetInfo[] {
  const project = new Set(projectWidgets.map((w) => w.name.toUpperCase()))
  return [...catalog.widgets.values()].filter(
    (info) =>
      (info.palette !== undefined || project.has(info.name.toUpperCase())) &&
      !['HMISTACK', 'HMIDIAGRAM', 'HMIPIPE'].some((base) => isA(catalog, info.name, base)),
  )
}

/** The palette gallery's screen: each widget alone in a row, at natural size, with its test value. */
function gallerySource(widgets: readonly HmiWidgetInfo[]): string {
  const declarations = widgets.flatMap((info) => [
    `    HMI__R_${info.name} : HmiVerticalStack := (Parent := 'HMI__Column', GrowAuto := FALSE);`,
    `    ${GALLERY_ELEMENT}${info.name} : ${info.name} := (Parent := 'HMI__R_${info.name}', GrowAuto := FALSE);`,
  ])
  const values = widgets.flatMap((info) => {
    const value = previewTestValue(info)
    return info.main && value !== undefined ? [`  ${GALLERY_ELEMENT}${info.name}.${info.main.name} := ${value};`] : []
  })
  return [
    `FUNCTION_BLOCK ${HMI_GALLERY_SCREEN} EXTENDS HmiScreen`,
    '  VAR',
    '    HMI__Column : HmiHorizontalStack := (Gap := 12, Padding := 8, GrowAuto := FALSE);',
    ...declarations,
    '  END_VAR',
    ...values,
    'END_FUNCTION_BLOCK',
    '',
  ].join('\n')
}

/** Name of the theme preview's screen. */
export const HMI_THEME_PREVIEW_SCREEN = 'HMI__ThemePreview'

/** The theme preview's screen: controls and values on surface cards, then the fixed colors, in `theme`. */
function themePreviewSource(theme: string): string {
  const card = (name: string) =>
    `    ${name} : HmiVerticalStack := (Parent := 'HMI__Column', Gap := 12, Padding := 12, Fill := COLOR.Surface, GrowAuto := FALSE);`
  const fixed = ['Red', 'Green', 'Blue', 'Yellow', 'Orange', 'Gray'].map(
    (c) =>
      `    HMI__${c} : HmiRect := (Parent := 'HMI__Fixed', Fill := COLOR.${c}, PrefWidth := 36, PrefHeight := 20);`,
  )
  return [
    `{attribute 'hmi_theme' := '${theme}'}`,
    `FUNCTION_BLOCK ${HMI_THEME_PREVIEW_SCREEN} EXTENDS HmiScreen`,
    '  VAR',
    '    HMI__Column : HmiHorizontalStack := (Gap := 12, Padding := 16);',
    `    HMI__Title : HmiLabel := (Parent := 'HMI__Column', Text := 'Plant overview', Size := 20, Font := HMI_FONT#Bold);`,
    card('HMI__Controls'),
    `    HMI__Start : HmiButton := (Parent := 'HMI__Controls', Text := 'Start');`,
    `    HMI__Pump : HmiSwitch := (Parent := 'HMI__Controls', Caption := 'Pump', Value := TRUE);`,
    `    HMI__Running : HmiLamp := (Parent := 'HMI__Controls', Caption := 'Running', Value := TRUE);`,
    `    HMI__Speed : HmiSlider := (Parent := 'HMI__Controls', Caption := 'Speed', Value := 60.0, Unit := '%');`,
    card('HMI__Values'),
    `    HMI__Level : HmiGauge := (Parent := 'HMI__Values', Caption := 'Level', Value := 62.0);`,
    `    HMI__Tank : HmiTank := (Parent := 'HMI__Values', Caption := 'Tank', Value := 45.0, Unit := '%');`,
    `    HMI__Flow : HmiValue := (Parent := 'HMI__Values', Caption := 'Flow', Value := 42.5, Unit := 'm3/h');`,
    `    HMI__Fixed : HmiVerticalStack := (Parent := 'HMI__Column', Gap := 8, GrowAuto := FALSE);`,
    ...fixed,
    '  END_VAR',
    'END_FUNCTION_BLOCK',
    '',
  ].join('\n')
}

/** The navigation and theme declarations the HMI build generates for these screens; empty without screens. */
export function hmiGlueSource(screens: readonly string[], settings: HmiSettings): string {
  return screens.length === 0 ? '' : glueSource(screens, settings)
}

/** Upper-case names of HmiScreen's inputs, variables and methods in a StandardWidgets archive. */
export function hmiScreenMembers(archive: StlibArchive): ReadonlySet<string> {
  const base = archive.manifest.functionBlocks.find((fb) => fb.name.toUpperCase() === 'HMISCREEN')
  return new Set(
    [...(base?.inputs ?? []), ...(base?.locals ?? []), ...(base?.methods ?? [])].map((m) => m.name.toUpperCase()),
  )
}

/** StandardWidgets blocks that draw only after a call opens them. */
const GATED_BLOCKS: ReadonlyMap<string, RegExp> = new Map([['HMIKEYBOARD', /\bKeyboardOpen\s*\(/i]])

/** Face the panel's PIN entry draws with (`hmi_lock_draw` in the core). */
const PIN_ENTRY_FACE = 0

/**
 * Faces the build compiles in: those the screens can reach through the widget libraries' ST sources, plus the PIN
 * entry's when a PIN is set; every face for previews, whose values change live, and when a library ships no ST source.
 */
function buildFaces(
  input: HmiUnitInput,
  sources: Record<string, string>,
  libraries: readonly HmiWidgetLibraryArchive[],
): number[] {
  if (input.preview || input.gallery || input.themePreview !== undefined || input.widgetPreview !== undefined)
    return [...HMI_ALL_FACES]
  const librarySources = libraries.flatMap((l) => (l.archive.sources ?? []).filter((f) => f.fileName.endsWith('.st')))
  if (libraries.some((l) => !(l.archive.sources ?? []).some((f) => f.fileName.endsWith('.st'))))
    return [...HMI_ALL_FACES]
  const faces = hmiUsedFontFaces({
    roots: Object.entries(sources)
      .filter(([name]) => name !== PLC_FILE)
      .map(([name, source]) => ({ name, source })),
    pool: [...librarySources.map((f) => ({ name: f.fileName, source: f.source })), ...input.widgets],
    gates: GATED_BLOCKS,
  })
  if (!input.panel || !input.settings.pin.enabled || faces.includes(PIN_ENTRY_FACE)) return faces
  return [...faces, PIN_ENTRY_FACE].sort((a, b) => a - b)
}

/** A limit in the variable's own values: integers rounded outwards and clamped to the type, REAL as the float it is. */
function inTagDomain(type: TagType, min: number, max: number, fromReal: boolean): HmiWriteLimit | null {
  const integers = INTEGER_RANGE[type.base]
  if (integers) {
    const lo = Number(integers[0])
    const hi = Number(integers[1])
    const clamp = (v: number) => Math.min(Math.max(v, lo), hi)
    return { min: clamp(Math.floor(min)), max: clamp(Math.ceil(max)) }
  }
  if (type.base === 'REAL' || (type.base === 'LREAL' && fromReal))
    return { min: Math.fround(min), max: Math.fround(max) }
  if (type.base === 'LREAL') return { min, max }
  return null
}

/**
 * The limit of each whole write the unit makes: a write-back of a two-way element takes the element's range, an
 * assignment of a literal that literal, anything else no limit.
 */
function writeLimitOf(plans: readonly ScreenPlan[], tags: readonly UnitTag[], walk: HmiAstWalk): HmiLimitOf {
  const byScreen = new Map(plans.map((p) => [p.model.name.toUpperCase(), p.limits]))
  return (value, tag, site) => {
    const type = tags[tag]?.type
    if (!type) return null
    if (site.method === 'WRITEBACK' && site.block) {
      const limits = byScreen.get(site.block)
      let found: HmiElementLimit | null | undefined
      walk(value, (node) => {
        if (
          found === undefined &&
          node.kind === 'VariableExpression' &&
          'name' in node &&
          typeof node.name === 'string'
        )
          found = limits?.get(node.name.toUpperCase())
      })
      if (found) {
        if (found.kind === 'length')
          return type.base === 'STRING' ? { min: 0, max: Math.min(found.max, type.maxLength) } : null
        return inTagDomain(type, found.min, found.max, true)
      }
    }
    const literal = hmiLiteralOf(value)
    if (!literal) return null
    if (literal.kind === 'string') return type.base === 'STRING' ? { min: literal.bytes, max: literal.bytes } : null
    if (type.base === 'BOOL') return { min: literal.value, max: literal.value }
    return inTagDomain(type, literal.value, literal.value, false)
  }
}

/** Builds and compiles the HMI unit. */
export function generateHmiUnit(input: HmiUnitInput): HmiUnitResult {
  const d = new Diagnostics()
  const result: HmiUnitResult = {
    ok: false,
    errors: d.errors,
    warnings: d.warnings,
    files: {},
    sources: {},
    tags: [],
    pages: [],
    elementIds: [],
    fonts: { variant: input.settings.fontVariant, faces: [...HMI_ALL_FACES] },
    textSizes: [],
    preview: {
      units: { library: [], widgets: [], screens: {}, glue: [], factory: [] },
      setters: {},
      factory: { types: {} },
      files: {},
    },
    timings: { widgetsMs: 0, strucppMs: 0 },
  }
  const {
    libraries,
    catalog: libraryCatalog,
    errors: libraryErrors,
    warnings,
    skipped,
  } = loadHmiWidgetLibraries(input.projectLibraries)
  for (const w of warnings) d.warn(w.file, w.message)
  for (const e of libraryErrors) d.error(e.file, e.message, e.line)
  if (d.errors.length > 0) return result
  if (input.screens.length === 0 && input.widgetPreview === undefined && !input.gallery && !input.themePreview)
    d.error(UNIT, 'the project has no HMI screens')
  if (input.screens.length > SCREENS_MAX) d.error(UNIT, `${input.screens.length} screens; at most ${SCREENS_MAX}`)
  checkNames(input, new Set(libraries.flatMap((l) => [...libraryNames(l.archive)])), d)
  if (d.errors.length > 0) return result

  const strucpp = loadStrucpp()
  const widgetsStart = performance.now()
  const widgetLibrary = compileHmiWidgets(input.widgets, libraries, libraryCatalog)
  result.timings.widgetsMs = performance.now() - widgetsStart
  for (const e of widgetLibrary.errors) d.error(e.file, withSkippedLibraryCause(e.message, skipped), e.line)
  if (d.errors.length > 0) return result
  const { archives, catalog } = widgetLibrary

  const screenMembers = new Set(libraries.flatMap((l) => [...hmiScreenMembers(l.archive)]))
  const variables = new Map(input.plcVariables.map((v) => [shortPath(v.path), v]))
  const plans: ScreenPlan[] = []
  const screenFiles = input.gallery
    ? [{ name: HMI_GALLERY_SCREEN, source: gallerySource(galleryWidgets(catalog, input.widgets)) }]
    : input.themePreview !== undefined
      ? [{ name: HMI_THEME_PREVIEW_SCREEN, source: themePreviewSource(input.themePreview) }]
      : [...input.screens]
  if (input.widgetPreview !== undefined) {
    const widget = input.widgets.find((w) => w.name.toUpperCase() === input.widgetPreview?.toUpperCase())
    const info = widget ? catalog.widgets.get(widget.name.toUpperCase()) : undefined
    if (info) screenFiles.push({ name: WIDGET_PREVIEW_SCREEN, source: widgetPreviewSource(info) })
    else d.error(UNIT, `${input.widgetPreview} is not a widget block of the project`)
  }
  for (const file of screenFiles) {
    const parsed = parseHmiBlock(file.source, (t) => catalog.widgets.has(t.toUpperCase()))
    if (!parsed.ok) {
      for (const e of parsed.errors) d.error(file.name, e)
      continue
    }
    const { model } = parsed
    for (const message of stackBaseErrors(file.source)) d.error(file.name, message)
    const block = checkBlockOf(model)
    const checks = { kind: 'screen' as const, fileName: file.name, catalog, settings: input.settings, screenMembers }
    for (const f of checkHmiBlockHeader(block, checks)) d.error(file.name, f.message)
    const theme = hmiThemeId(input.settings, model.theme ?? input.settings.defaultTheme)
    for (const f of checkHmiBlockElements(block, checks)) d.error(file.name, f.message)
    const plan: ScreenPlan = {
      file,
      model,
      attach: [],
      defaults: [],
      connects: [],
      writeBacks: [],
      feeds: [],
      limits: new Map(),
      theme,
    }
    elementTree(plan, catalog)
    plans.push(plan)
  }
  for (const plan of plans) {
    writeBacks(plan, catalog, variables, d)
    feeds(plan, catalog, variables, d)
    if (input.capabilities) requiredCapabilities(plan, catalog, input.capabilities, d)
  }
  const start =
    input.widgetPreview !== undefined || input.gallery || input.themePreview !== undefined
      ? plans.length - 1
      : input.settings.startScreen === ''
        ? 0
        : plans.findIndex((p) => p.model.name.toUpperCase() === input.settings.startScreen.toUpperCase())
  if (start < 0) d.error(UNIT, `start screen '${input.settings.startScreen}' is not a screen`)
  if (d.errors.length > 0) return result

  let nextId = 1
  const firstIds: number[] = []
  for (const plan of plans) {
    firstIds.push(nextId)
    for (const a of plan.attach)
      result.elementIds.push({ id: nextId++, screen: plan.model.name, element: a.element.name })
    for (const e of plan.model.elements) {
      const size = /^\s*(\d+)\s*$/.exec(e.props.get('SIZE') ?? '')
      const sized = catalog.widgets.get(e.type.toUpperCase())?.properties.some((p) => p.name.toUpperCase() === 'SIZE')
      if (size && sized) result.textSizes.push({ screen: plan.model.name, element: e.name, size: Number(size[1]) })
    }
  }
  const sources: Record<string, string> = {
    [GLUE_FILE]: glueSource(
      plans.map((p) => p.model.name),
      input.settings,
    ),
    [PLC_FILE]: input.plcDeclarations ?? '',
  }
  for (const plan of plans) {
    sources[`${plan.model.name}.st`] = `${INSTANCE_PATHS} ${screenSource(plan)}`
    if (plan.feeds.length > 0) sources[feedFile(plan)] = plan.feeds.map((f) => f.source).join('\n')
  }
  sources[MAIN_FILE] = mainSource(
    plans,
    firstIds,
    input.settings,
    start,
    input.preview ? previewStarts(input.plcVariables) : [],
  )
  result.sources = sources
  const widgetLibraries = widgetLibraryNames(catalog)
  result.fonts = {
    variant: input.settings.fontVariant,
    faces: buildFaces(
      input,
      sources,
      libraries.filter((l) => widgetLibraries.has(l.name)),
    ),
  }
  const [first, ...rest] = Object.entries(sources)
  if (d.errors.length > 0) return result
  const options: StrucppCompileOptions = {
    fileName: first[0],
    additionalSources: rest.map(([fileName, source]) => ({ fileName, source })),
    libraries: archives,
    namespace: NAMESPACE,
    headerFileName: HEADER,
    separateLibraryFiles: true,
    externalInstancePaths: true,
    externalSources: [PLC_FILE],
    providedHeaders: [...HMI_PROVIDED_HEADERS],
    ...(input.preview
      ? { wholeLibraries: archives.map((a) => a.manifest.name).filter((name) => widgetLibraries.has(name)) }
      : {}),
  }
  const strucppStart = performance.now()
  const compiled = strucpp.compile(first[1], options)
  result.timings.strucppMs = performance.now() - strucppStart
  for (const e of compiled.errors) {
    const file = (e.file ?? UNIT).replace(/\.st$/, '')
    const where = sources[e.file ?? ''] !== undefined && !e.file?.startsWith('hmi_') ? file : UNIT
    d.error(where, withSkippedLibraryCause(e.message, skipped), e.line)
  }
  if (d.errors.length > 0) return result
  result.files[HEADER] = compiled.headerCode
  if (compiled.libraryHeader) result.files[compiled.libraryHeader.name] = compiled.libraryHeader.content
  for (const f of compiled.cppFiles) result.files[f.name] = f.content
  const tags: UnitTag[] = []
  for (const entry of [...(compiled.instancePaths ?? [])].sort((a, b) => a.id - b.id)) {
    const named = variables.get(shortPath(entry.path))?.path ?? shortPath(entry.path)
    const type = tagType(entry.type === 'STRING' ? `STRING(${entry.maxLength ?? DEFAULT_STRING_LENGTH})` : entry.type)
    if (!type) {
      d.error(UNIT, `${named}: ${entry.type} variables cannot be used on screens`)
      continue
    }
    const address = input.resolve ? input.resolve(entry.path) : null
    if (input.resolve && address === null) {
      d.error(UNIT, `${named} has no debug address in the compiled PLC program, so the HMI cannot reach it`)
      continue
    }
    tags.push({ path: entry.path, type, address })
  }
  if (d.errors.length > 0) return result
  const classes = plans.map((p) => p.model.name.toUpperCase())
  result.files[SLOT_HEADER] = slotHeader(classes)
  result.files['hmi_unit_glue.cpp'] = glueCpp(tags, input, classes)
  result.tags = tags.map(({ path, type, address }) => ({ path, type: type.type, maxLength: type.maxLength, address }))
  if (!compiled.ast) {
    d.error(UNIT, 'STruC++ returned no syntax tree, so the tags each screen reaches are unknown')
    return result
  }
  const limitOf = writeLimitOf(plans, tags, strucpp.walkAST)
  const owners = new Map(plans.flatMap((plan, page) => plan.feeds.map((f) => [f.type.toUpperCase(), page] as const)))
  const access = hmiPageAccess(compiled.ast, classes, strucpp.walkAST, limitOf, owners)
  result.pages = plans.map((plan, i) => {
    const grant = screenGrant(input.settings, plan.model.name)
    const roles = HMI_ROLES.reduce((bits, role, r) => (grant[role] ? bits | (1 << (r + 1)) : bits), 1)
    return { name: plan.model.name, reads: access[i].reads, writes: access[i].writes, roles }
  })
  const routed = routeBitStores(result.files)
  const bitAssignments = hmiBitAssignments(compiled.ast, strucpp.walkAST)
  if (routed !== bitAssignments) {
    d.error(
      UNIT,
      `${bitAssignments} bit assignment(s) to PLC variables, ${routed} compiled as bit writes: this STruC++ output is ` +
        'not supported, so the HMI is not built',
    )
    return result
  }
  const setters = previewSetters(plans, catalog, classes)
  const factory = input.preview
    ? projectFactory(catalog, input.libraryFactories ?? [])
    : { file: null, factory: { types: {} } }
  const previewFiles = factory.file === null ? setters.files : { ...setters.files, [FACTORY_FILE]: factory.file }
  result.preview = {
    units: previewUnits([...Object.keys(result.files), ...Object.keys(previewFiles)], plans, libraries),
    setters: setters.setters,
    factory: factory.factory,
    files: previewFiles,
  }
  result.ok = true
  return result
}
