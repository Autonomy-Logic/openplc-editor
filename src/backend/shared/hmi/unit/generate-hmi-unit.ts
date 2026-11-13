/**
 * Builds the HMI unit: the project's screens and widget blocks with the glue the build generates, compiled by
 * STruC++ with the StandardWidgets library into C++ in namespace `hmi`, plus the C glue every host links
 * (`resources/sources/hmi/unit/hmi_unit.h`): tag table, tag accessors, program instances and settings.
 *
 * Screens use PLC variables as `<POU>.<Name>` or `GVL.<Name>`; the unit holds a mirror of the ones they use, which
 * hosts keep in step with the PLC. `Element.Value := <variable>;` on a two-way widget also writes the operator's
 * change back to the variable, converted to its type.
 */
import {
  HMI_BUILTIN_THEMES,
  HMI_ROLES,
  HMI_THEME_TOKENS,
  type HmiSettings,
  hmiThemeId,
  screenGrant,
} from '@root/middleware/shared/utils/hmi/settings'
import type { StlibArchive } from 'strucpp'

import { loadStrucpp } from '../../library/strucpp-runtime'
import { buildStandardWidgets } from '../lib/build-standard-widgets'
import { buildWidgetCatalog, type HmiWidgetCatalog, type HmiWidgetInfo } from '../lib/widget-catalog'
import { type HmiBlockModel, type HmiElementDecl, parseHmiBlock } from './screen-model'

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
}

export interface HmiTagAddress {
  arr: number
  elem: number
}

export interface HmiUnitInput {
  /** Screens in project order: page numbers and the HMI_SCREEN enumeration follow it. */
  screens: readonly HmiSourceFile[]
  widgets: readonly HmiSourceFile[]
  settings: HmiSettings
  plcVariables: readonly HmiPlcVariable[]
  /** Names of the project's POUs and data types, which screens and widget blocks may not reuse. */
  projectNames: readonly string[]
  /** PLC debug-table address of a variable; absent when building without a PLC program (preview). */
  resolve?: (path: string) => HmiTagAddress | null
  plcMd5?: string
}

export interface HmiDiagnostic {
  /** Screen or widget block, or `HMI` for the unit as a whole. */
  file: string
  line?: number
  message: string
}

export interface HmiTag {
  path: string
  /** `hmi_tag_type` of hmi_unit.h. */
  type: number
  maxLength: number
  address: HmiTagAddress | null
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
  /** Element of each bounds id the core reports, for designers. */
  elementIds: Array<{ id: number; screen: string; element: string }>
  /** Faces of the font table the unit needs. */
  fonts: { variant: HmiSettings['fontVariant']; faces: number[] }
  /** What only the editor's preview uses (`resources/sources/hmi/unit/hmi_preview.h`). */
  preview: HmiPreview
}

export interface HmiPreviewSetter {
  /** Page number of the screen. */
  screen: number
  /** Setter number within the screen. */
  index: number
  kind: 'num' | 'str'
}

export interface HmiPreview {
  /** Names of `files` grouped into translation units that change independently and can be cached apart. */
  units: { library: string[]; widgets: string[]; screens: Record<string, string[]>; glue: string[] }
  /** Live setters by `Screen.Element.Property`, as written. */
  setters: Record<string, HmiPreviewSetter>
  /** C++ of the setters: one file per screen and the dispatcher. */
  files: Record<string, string>
}

const UNIT = 'HMI'
const NAMESPACE = 'hmi'
const HEADER = 'hmi_unit.hpp'
const GLUE_FILE = 'hmi_glue.st'
const MIRROR_FILE = 'hmi_tags.st'
const MAIN_FILE = 'hmi_main.st'
const SCREEN_CAPACITY = 256
const STACK_CAPACITY = 64
const DIAGRAM_CAPACITY = 256
const SCREENS_MAX = 64
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Properties that change the element tree; editing them needs a build. */
const STRUCTURAL = new Set(['PARENT', 'FLOATING'])
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
/** Names the generated glue declares; screens and widget blocks may not take them. */
const RESERVED = [
  'HMI_SCREEN',
  'HMI_SHOW',
  'HMI_CURRENTSCREEN',
  'HMIMAIN',
  'HMICONFIG',
  'HMIRESOURCE',
  'HMITASK',
  'HMIINSTANCE',
  'GVL',
  'HMI_GLUE',
  'HMI_TAGS',
  'HMI_MAIN',
]
/** Prefixes of generated names: internals and theme constants. */
const RESERVED_PREFIXES = ['HMI__', 'HMI_THEME_']

interface TagType {
  /** Upper-case elementary name, or STRING. */
  base: string
  type: number
  maxLength: number
}

function tagType(declared: string): TagType | undefined {
  const t = declared.trim().toUpperCase()
  const elementary = TAG_TYPES.findIndex((x) => x === t)
  if (elementary >= 0) return { base: t, type: elementary + 1, maxLength: 0 }
  const str = /^STRING\s*(?:[([]\s*(\d+)\s*[)\]])?$/.exec(t)
  if (!str) return undefined
  const maxLength = str[1] !== undefined ? Number(str[1]) : DEFAULT_STRING_LENGTH
  return maxLength >= 1 && maxLength <= 65535 ? { base: 'STRING', type: TAG_STRING, maxLength } : undefined
}

/** A plain ST text literal's content, or undefined. */
function textLiteral(text: string | undefined): string | undefined {
  const m = text === undefined ? null : /^'([^'$]*)'$/.exec(text.trim())
  return m ? m[1] : undefined
}

function isA(catalog: HmiWidgetCatalog, type: string, base: string): boolean {
  const seen = new Set<string>()
  for (let t: string | undefined = type.toUpperCase(); t !== undefined && !seen.has(t); ) {
    if (t === base) return true
    seen.add(t)
    t = catalog.widgets.get(t)?.extends.toUpperCase()
  }
  return false
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
  /** Elements in drawing order with their container (undefined for the screen's column). */
  attach: Array<{ element: HmiElementDecl; parent?: HmiElementDecl }>
  connects: Array<{ pipe: string; source: string; target: string }>
  writeBacks: string[]
  theme: number
}

/** Elements in drawing order, containers before what they hold, with capacity and Parent checks. */
function elementTree(plan: ScreenPlan, catalog: HmiWidgetCatalog, d: Diagnostics): void {
  const { model, file } = plan
  const byName = new Map(model.elements.map((e) => [e.name.toUpperCase(), e]))
  const parentOf = new Map<HmiElementDecl, HmiElementDecl>()
  for (const e of model.elements) {
    const text = e.props.get('PARENT')
    if (text === undefined) continue
    const name = textLiteral(text)
    if (name === undefined) {
      d.error(file.name, `${e.name}: Parent must be a text literal naming a container`)
      continue
    }
    if (name === '') continue
    const parent = byName.get(name.toUpperCase())
    if (!parent) d.error(file.name, `${e.name}: Parent '${name}' is not an element of this screen`)
    else if (!isA(catalog, parent.type, 'HMISTACK'))
      d.error(file.name, `${e.name}: Parent '${name}' is not a container`)
    else parentOf.set(e, parent)
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
    if (!plan.attach.some((a) => a.element === e)) d.error(file.name, `${e.name}: its Parent chain is a cycle`)
  if (model.elements.length > SCREEN_CAPACITY)
    d.error(file.name, `${model.elements.length} elements; a screen holds at most ${SCREEN_CAPACITY}`)
  const held = new Map<HmiElementDecl, number>()
  for (const a of plan.attach) if (a.parent) held.set(a.parent, (held.get(a.parent) ?? 0) + 1)
  for (const [container, n] of held) {
    const cap = isA(catalog, container.type, 'HMIDIAGRAM') ? DIAGRAM_CAPACITY : STACK_CAPACITY
    if (n > cap) d.error(file.name, `${container.name} holds ${n} elements; at most ${cap}`)
  }
  for (const e of model.elements) {
    if (!isA(catalog, e.type, 'HMIPIPE')) continue
    const end = (prop: string): string | undefined => {
      const name = textLiteral(e.props.get(prop))
      const found = name === undefined ? undefined : byName.get(name.toUpperCase())
      if (!found)
        d.error(file.name, `${e.name}: ${prop === 'SOURCE' ? 'Source' : 'Target'} must name an element of this screen`)
      return found?.name
    }
    const source = end('SOURCE')
    const target = end('TARGET')
    if (source !== undefined && target !== undefined) plan.connects.push({ pipe: e.name, source, target })
  }
}

/** Typed write-back of `Element.Value := Variable;` for two-way widgets. */
function writeBacks(
  plan: ScreenPlan,
  catalog: HmiWidgetCatalog,
  tags: ReadonlyMap<string, { variable: HmiPlcVariable; type: TagType }>,
  d: Diagnostics,
): void {
  const elements = new Map(plan.model.elements.map((e) => [e.name.toUpperCase(), e]))
  for (const b of plan.model.bindings) {
    const element = elements.get(b.element.toUpperCase())
    const widget: HmiWidgetInfo | undefined = element ? catalog.widgets.get(element.type.toUpperCase()) : undefined
    const twoWay = widget?.twoWay
    if (!twoWay || twoWay.value.toUpperCase() !== b.property.toUpperCase()) continue
    const tag = tags.get(b.variable.toUpperCase())
    if (!tag) continue
    const source = widget.outputs.find((o) => o.name.toUpperCase() === twoWay.newValue.toUpperCase())
    const from = (source?.type ?? '').toUpperCase()
    const value = `${b.element}.${twoWay.newValue}`
    let converted: { expr: string; guard?: string } | undefined
    if (from === tag.type.base) converted = { expr: value }
    else if (NUMERIC.has(from) && NUMERIC.has(tag.type.base)) converted = numericWriteBack(from, tag.type.base, value)
    if (converted === undefined) {
      d.error(
        plan.file.name,
        `${b.element}.${b.property}: a ${from} widget value cannot be written to ${b.variable} (${tag.variable.type})`,
      )
      continue
    }
    const condition = converted.guard
      ? `${b.element}.${twoWay.changed} AND ${converted.guard}`
      : `${b.element}.${twoWay.changed}`
    plan.writeBacks.push(`IF ${condition} THEN ${b.variable} := ${converted.expr}; END_IF;`)
  }
}

/** The screen's source with Build and WriteBack added on the line where its declarations end. */
function screenSource(plan: ScreenPlan): string {
  const build = [
    `UseTheme(${plan.theme});`,
    ...plan.attach.map((a) => `Attach(ADR(${a.element.name}), ${a.parent ? `ADR(${a.parent.name})` : '0'});`),
    ...plan.connects.map((c) => `Connect(ADR(${c.pipe}), ADR(${c.source}), ADR(${c.target}));`),
  ]
  const generated =
    ` METHOD PROTECTED OVERRIDE Build : BOOL ${build.join(' ')} Build := TRUE; END_METHOD` +
    ` METHOD PROTECTED OVERRIDE WriteBack : BOOL ${plan.writeBacks.join(' ')} WriteBack := TRUE; END_METHOD `
  const { source } = plan.file
  return `${source.slice(0, plan.model.insertAt)}${generated}${source.slice(plan.model.insertAt)}`
}

function glueSource(screens: readonly ScreenPlan[], settings: HmiSettings): string {
  const names = screens.map((s) => s.model.name)
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
    '',
  ].join('\n')
}

function mirrorSource(tags: ReadonlyArray<{ variable: HmiPlcVariable; type: TagType }>): string {
  const byPou = new Map<string, { pou: string; fields: string[] }>()
  for (const { variable, type } of tags) {
    const [pou, name] = variable.path.split('.')
    const entry = byPou.get(pou.toUpperCase()) ?? { pou, fields: [] }
    entry.fields.push(`    ${name} : ${type.base === 'STRING' ? `STRING(${type.maxLength})` : type.base};`)
    byPou.set(pou.toUpperCase(), entry)
  }
  const lines = ['(* Generated by the HMI build: mirror of the PLC variables the screens use. *)']
  for (const { pou, fields } of byPou.values())
    lines.push(`TYPE HMI__PLC_${pou} :`, '  STRUCT', ...fields, '  END_STRUCT;', 'END_TYPE')
  if (byPou.size > 0) {
    lines.push('VAR_GLOBAL')
    for (const { pou } of byPou.values()) lines.push(`  ${pou} : HMI__PLC_${pou};`)
    lines.push('END_VAR')
  }
  return `${lines.join('\n')}\n`
}

function mainSource(screens: readonly ScreenPlan[], settings: HmiSettings, start: number): string {
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
    'PROGRAM HmiMain',
    '  VAR_INPUT',
    '    Role : DINT;',
    '  END_VAR',
    '  VAR',
    '    Rt : HmiRuntime;',
    ...screens.map((s, i) => `    Scr${i} : ${s.model.name};`),
    '    Started : BOOL;',
    '  END_VAR',
    '  IF NOT Started THEN',
    ...themes,
    ...screens.map((_, i) => `    Rt.AddScreen(ADR(Scr${i}));`),
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
    '  HMI__Page := Rt.BeginFrame();',
    '  CASE HMI__Page OF',
    ...screens.map((_, i) => `    ${i}: Scr${i}();`),
    '  END_CASE;',
    '  Rt.EndFrame();',
    '  IF HMI__Request >= 0 THEN',
    '    Rt.Show(HMI__Request);',
    '  END_IF;',
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

function glueCpp(
  tags: ReadonlyArray<{ variable: HmiPlcVariable; type: TagType; address: HmiTagAddress | null }>,
  input: HmiUnitInput,
): string {
  const member = (v: HmiPlcVariable): string => {
    const [pou, name] = v.path.split('.')
    return `${NAMESPACE}::${pou.toUpperCase()}.${name.toUpperCase()}`
  }
  const sizeOf = (t: TagType): number => (t.base === 'STRING' ? t.maxLength + 1 : (TAG_WIDTH[t.base] ?? 0))
  const read = tags.map(({ variable, type }, i) =>
    type.base === 'STRING'
      ? `    case ${i}: { const auto s = ${member(variable)}.get(); size_t n = std::min<size_t>(s.length(), ${type.maxLength}); std::memcpy(buf, s.c_str(), n); static_cast<char *>(buf)[n] = 0; return 0; }`
      : type.base === 'BOOL'
        ? `    case ${i}: { uint8_t v = ${member(variable)}.get() ? 1 : 0; std::memcpy(buf, &v, 1); return 0; }`
        : `    case ${i}: { auto v = ${member(variable)}.get(); std::memcpy(buf, &v, sizeof v); return 0; }`,
  )
  const write = tags.map(({ variable, type }, i) =>
    type.base === 'STRING'
      ? `    case ${i}: { const char *b = static_cast<const char *>(buf); size_t n = 0; while (n < ${type.maxLength} && b[n] != 0) n++; char s[${type.maxLength + 1}]; std::memcpy(s, b, n); s[n] = 0; ${member(variable)}.set(s); return 0; }`
      : type.base === 'BOOL'
        ? `    case ${i}: { uint8_t v; std::memcpy(&v, buf, 1); ${member(variable)}.set(v != 0); return 0; }`
        : `    case ${i}: { auto v = ${member(variable)}.get(); std::memcpy(&v, buf, sizeof v); ${member(variable)}.set(v); return 0; }`,
  )
  const rows = tags.map(
    ({ variable, type, address }) =>
      `    {${address?.arr ?? 0}u, ${address?.elem ?? 0}u, ${type.type}, ${type.maxLength}, ${cString(variable.path)}},`,
  )
  const { settings } = input
  return [
    '/* Generated by the HMI build: the C side of hmi_unit.h. */',
    '#include <algorithm>',
    '#include <cstring>',
    '#include <new>',
    '',
    '#include "hmi_unit.h"',
    `#include "${HEADER}"`,
    '',
    `using HmiProgram = ${NAMESPACE}::Program_HMIMAIN;`,
    '',
    'extern "C" {',
    `const hmi_tag_t hmi_tags[${Math.max(tags.length, 1)}] = {`,
    ...(rows.length > 0 ? rows : ['    {0u, 0u, 0, 0, ""},']),
    '};',
    `const int hmi_tag_count = ${tags.length};`,
    `const char hmi_plc_md5[] = ${cString(input.plcMd5 ?? '')};`,
    `const uint32_t hmi_frame_ms = ${settings.framePeriodMs};`,
    `const char hmi_panel_pin[] = ${cString(settings.pin.enabled ? settings.pin.value : '')};`,
    `const uint32_t hmi_relock_minutes = ${settings.relock.mode === 'idle' ? settings.relock.minutes : 0};`,
    '',
    'size_t hmi_tag_size(int tag) {',
    '    switch (tag) {',
    ...tags.map(({ type }, i) => `    case ${i}: return ${sizeOf(type)};`),
    '    default: return 0;',
    '    }',
    '}',
    '',
    'int hmi_tag_read(int tag, void *buf) {',
    '    switch (tag) {',
    ...read,
    '    default: return -1;',
    '    }',
    '}',
    '',
    'int hmi_tag_write(int tag, const void *buf) {',
    '    switch (tag) {',
    ...write,
    '    default: return -1;',
    '    }',
    '}',
    '',
    'size_t hmi_unit_size(void) { return sizeof(HmiProgram); }',
    'void *hmi_unit_create(void) { return new (std::nothrow) HmiProgram(); }',
    'void hmi_unit_destroy(void *unit) { delete static_cast<HmiProgram *>(unit); }',
    'void hmi_unit_set_role(void *unit, int role) {',
    '    if (unit) static_cast<HmiProgram *>(unit)->ROLE.set(role);',
    '}',
    'void hmi_unit_frame(void *unit) {',
    '    if (unit) static_cast<HmiProgram *>(unit)->run();',
    '}',
    '}',
    '',
  ].join('\n')
}

/** Setters of each screen's literal numeric, BOOL and STRING properties, and their C++. */
function previewSetters(
  plans: readonly ScreenPlan[],
  catalog: HmiWidgetCatalog,
): Pick<HmiPreview, 'setters' | 'files'> {
  const setters: Record<string, HmiPreviewSetter> = {}
  const files: Record<string, string> = {}
  const program = `${NAMESPACE}::Program_HMIMAIN`
  plans.forEach((plan, i) => {
    const num: string[] = []
    const str: string[] = []
    for (const element of plan.model.elements) {
      for (const p of catalog.widgets.get(element.type.toUpperCase())?.properties ?? []) {
        if (STRUCTURAL.has(p.name.toUpperCase())) continue
        const kind =
          p.kind === 'string'
            ? 'str'
            : p.kind === 'number' || p.kind === 'bool' || p.kind === 'color'
              ? 'num'
              : undefined
        if (kind === undefined) continue
        const list = kind === 'num' ? num : str
        const member = `p->SCR${i}.${element.name.toUpperCase()}.${p.name.toUpperCase()}`
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
      `extern "C" int hmi_preview_set_num_${i}(void *unit, int setter, double value) {`,
      `    auto *p = static_cast<${program} *>(unit);`,
      '    switch (setter) {',
      ...num,
      '    default: return -1;',
      '    }',
      '}',
      '',
      `extern "C" int hmi_preview_set_str_${i}(void *unit, int setter, const char *value) {`,
      `    auto *p = static_cast<${program} *>(unit);`,
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

/** Groups unit files into translation units: library, project widgets, one per screen, and the rest. */
function previewUnits(files: readonly string[], plans: readonly ScreenPlan[]): HmiPreview['units'] {
  const units: HmiPreview['units'] = { library: [], widgets: [], screens: {}, glue: [] }
  const screens = new Map(plans.map((p) => [`pou_${p.model.name.toUpperCase()}.cpp`, p.model.name]))
  for (const f of files.filter((n) => n.endsWith('.cpp'))) {
    const screen = screens.get(f)
    if (f === 'lib_standard_widgets.cpp') units.library.push(f)
    else if (f === 'lib_project_widgets.cpp') units.widgets.push(f)
    else if (screen !== undefined) units.screens[screen] = [f]
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
      else if (library.has(key) || RESERVED.includes(key) || RESERVED_PREFIXES.some((p) => key.startsWith(p)))
        d.error(f.name, `${kind} name '${f.name}' is taken by the HMI library`)
      else if (project.has(key)) d.error(f.name, `${kind} name '${f.name}' is taken by a POU or data type`)
      else if (seen.has(key)) d.error(f.name, `${kind} name '${f.name}' is used twice`)
      seen.add(key)
    }
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
    elementIds: [],
    fonts: { variant: input.settings.fontVariant, faces: [0, 1] },
    preview: { units: { library: [], widgets: [], screens: {}, glue: [] }, setters: {}, files: {} },
  }
  const library = buildStandardWidgets()
  if (!library.ok) {
    for (const e of library.errors) d.error(UNIT, `StandardWidgets: ${e.message}`, e.line)
    return result
  }
  if (input.screens.length === 0) d.error(UNIT, 'the project has no HMI screens')
  if (input.screens.length > SCREENS_MAX) d.error(UNIT, `${input.screens.length} screens; at most ${SCREENS_MAX}`)
  checkNames(input, libraryNames(library.archive), d)
  if (d.errors.length > 0) return result

  const strucpp = loadStrucpp()
  const archives: StlibArchive[] = [library.archive]
  if (input.widgets.length > 0) {
    const compiled = strucpp.compileStlib(
      input.widgets.map((w) => ({ fileName: w.name, source: w.source })),
      { name: 'project-widgets', version: '1.0.0', namespace: 'hmi_project_widgets', dependencies: [library.archive] },
    )
    for (const e of compiled.errors) d.error(e.file ?? UNIT, e.message, e.line)
    if (d.errors.length > 0) return result
    archives.push(strucpp.loadStlibFromString(JSON.stringify(compiled.archive), 'project-widgets'))
  }
  const catalog = buildWidgetCatalog(archives.map((a) => a.manifest))
  for (const w of input.widgets)
    if (!catalog.widgets.has(w.name.toUpperCase()))
      d.error(w.name, `${w.name} must be a FUNCTION_BLOCK that extends HmiElement or another widget`)

  const screenBase = library.archive.manifest.functionBlocks.find((fb) => fb.name.toUpperCase() === 'HMISCREEN')
  const screenMembers = new Set(
    [...(screenBase?.inputs ?? []), ...(screenBase?.locals ?? []), ...(screenBase?.methods ?? [])].map((m) =>
      m.name.toUpperCase(),
    ),
  )
  const variables = new Map(input.plcVariables.map((v) => [v.path.toUpperCase(), v]))
  const pous = new Set([...input.plcVariables.map((v) => v.path.split('.')[0].toUpperCase()), 'GVL'])
  const tags = new Map<string, { variable: HmiPlcVariable; type: TagType }>()
  const plans: ScreenPlan[] = []
  for (const file of input.screens) {
    const parsed = parseHmiBlock(file.source, (t) => catalog.widgets.has(t.toUpperCase()))
    if (!parsed.ok) {
      for (const e of parsed.errors) d.error(file.name, e)
      continue
    }
    const { model } = parsed
    if (model.name.toUpperCase() !== file.name.toUpperCase())
      d.error(file.name, `the file declares ${model.name}; it must declare FUNCTION_BLOCK ${file.name}`)
    if (model.extends.toUpperCase() !== 'HMISCREEN') d.error(file.name, `${file.name} must extend HmiScreen`)
    for (const generated of ['BUILD', 'WRITEBACK'])
      if (model.methods.has(generated))
        d.error(file.name, `the HMI build generates ${generated === 'BUILD' ? 'Build' : 'WriteBack'}; remove it`)
    const themeName = model.theme ?? input.settings.defaultTheme
    const theme = hmiThemeId(input.settings, themeName)
    if (theme < 0) d.error(file.name, `unknown theme '${themeName}'`)
    for (const ref of model.references) {
      const [pou] = ref.split('.')
      if (!pous.has(pou)) continue
      const variable = variables.get(ref)
      if (!variable) {
        d.error(file.name, `${ref} is not a PLC variable`)
        continue
      }
      const type = tagType(variable.type)
      if (!type) d.error(file.name, `${variable.path}: ${variable.type} variables cannot be used on screens`)
      else tags.set(ref, { variable, type })
    }
    for (const e of model.elements)
      if (screenMembers.has(e.name.toUpperCase()))
        d.error(file.name, `${e.name}: an element may not be named like a member of HmiScreen`)
    const plan: ScreenPlan = { file, model, attach: [], connects: [], writeBacks: [], theme }
    elementTree(plan, catalog, d)
    plans.push(plan)
  }
  for (const plan of plans) writeBacks(plan, catalog, tags, d)
  const start =
    input.settings.startScreen === ''
      ? 0
      : plans.findIndex((p) => p.model.name.toUpperCase() === input.settings.startScreen.toUpperCase())
  if (start < 0) d.error(UNIT, `start screen '${input.settings.startScreen}' is not a screen`)
  if (d.errors.length > 0) return result

  const tagList: Array<{ variable: HmiPlcVariable; type: TagType; address: HmiTagAddress | null }> = []
  for (const t of tags.values()) {
    const address = input.resolve ? input.resolve(t.variable.path) : null
    if (input.resolve && address === null)
      d.warn(UNIT, `${t.variable.path} is not in the PLC program's debug map; the HMI will not sync it`)
    else tagList.push({ ...t, address })
  }
  let nextId = 1
  for (const plan of plans) {
    for (const a of plan.attach)
      result.elementIds.push({ id: nextId++, screen: plan.model.name, element: a.element.name })
  }
  const sources: Record<string, string> = {
    [GLUE_FILE]: glueSource(plans, input.settings),
    [MIRROR_FILE]: mirrorSource([...tags.values()]),
  }
  for (const plan of plans) sources[`${plan.model.name}.st`] = screenSource(plan)
  sources[MAIN_FILE] = mainSource(plans, input.settings, start)
  result.sources = sources
  const [first, ...rest] = Object.entries(sources)
  const compiled = strucpp.compile(first[1], {
    fileName: first[0],
    additionalSources: rest.map(([fileName, source]) => ({ fileName, source })),
    libraries: archives,
    namespace: NAMESPACE,
    headerFileName: HEADER,
    separateLibraryFiles: true,
  })
  for (const e of compiled.errors) {
    const file = (e.file ?? UNIT).replace(/\.st$/, '')
    d.error(sources[e.file ?? ''] !== undefined && !e.file?.startsWith('hmi_') ? file : UNIT, e.message, e.line)
  }
  if (d.errors.length > 0) return result
  result.files[HEADER] = compiled.headerCode
  if (compiled.libraryHeader) result.files[compiled.libraryHeader.name] = compiled.libraryHeader.content
  for (const f of compiled.cppFiles) result.files[f.name] = f.content
  result.files['hmi_unit_glue.cpp'] = glueCpp(tagList, input)
  result.tags = tagList.map(({ variable, type, address }) => ({
    path: variable.path,
    type: type.type,
    maxLength: type.maxLength,
    address,
  }))
  result.preview = { units: previewUnits(Object.keys(result.files), plans), ...previewSetters(plans, catalog) }
  result.ok = true
  return result
}
