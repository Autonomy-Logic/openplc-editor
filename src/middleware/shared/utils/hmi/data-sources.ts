/**
 * PLC data a widget is fed from, named by a literal STRING input marked `hmi_source`: an alarm table, an event log,
 * an alarm summary or an array of numbers. The kinds, how a PLC variable's type maps to one, and which of a kind's
 * fields the HMI build reads for each feed method.
 */
import type { HmiPlcSource, HmiPlcVariable, HmiSourceKind, HmiWidgetInfo } from '../../ports/hmi-preview-types'
import type { PLCDataType, PLCVariableType } from '../../ports/types'

/** Row type of an alarm table (HmiAlarms library). */
export const HMI_ALARM_ROW = 'HMI_ALARM_ROW'
/** Row type of an event log (HmiAlarms library). */
export const HMI_EVENT_ROW = 'HMI_EVENT_ROW'
/** What HMI_ALARMS reports about a table (HmiAlarms library). */
export const HMI_ALARM_SUMMARY = 'HMI_ALARM_SUMMARY'

export type { HmiPlcSource, HmiSourceKind }

/** The `hmi_source` attribute value of each kind. */
export const HMI_SOURCE_TYPES: Readonly<Record<HmiSourceKind, string>> = {
  alarms: `ARRAY OF ${HMI_ALARM_ROW}`,
  events: `ARRAY OF ${HMI_EVENT_ROW}`,
  summary: HMI_ALARM_SUMMARY,
  numbers: 'ARRAY OF REAL',
}

const NUMERIC = new Set([
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
])

const normalized = (type: string): string => type.replace(/\s+/g, ' ').trim().toUpperCase()

/** The kind an `hmi_source` attribute value names, or null for one the build does not know. */
export function hmiSourceKind(type: string): HmiSourceKind | null {
  const wanted = normalized(type)
  for (const [kind, name] of Object.entries(HMI_SOURCE_TYPES)) if (name === wanted && isKind(kind)) return kind
  return null
}

function isKind(value: string): value is HmiSourceKind {
  return value === 'alarms' || value === 'events' || value === 'summary' || value === 'numbers'
}

/** Bounds of a one-dimensional array with literal bounds, else null. */
function bounds(dimensions: ReadonlyArray<{ dimension: string }>): [number, number] | null {
  if (dimensions.length !== 1) return null
  const m = /^\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*$/.exec(dimensions[0].dimension)
  if (!m) return null
  const lo = Number(m[1])
  const hi = Number(m[2])
  return hi >= lo ? [lo, hi] : null
}

/** The source an array of `element` gives, or null when it gives none. */
function arraySource(element: string, range: [number, number] | null): HmiPlcSource | null {
  if (!range) return null
  const e = element.trim().toUpperCase()
  const [lower, upper] = range
  if (e === HMI_ALARM_ROW) return { kind: 'alarms', lower, upper }
  if (e === HMI_EVENT_ROW) return { kind: 'events', lower, upper }
  if (NUMERIC.has(e)) return { kind: 'numbers', lower, upper, element: e }
  return null
}

/** The source a variable of `type` gives: an alarm table, event log, alarm summary or array of numbers. */
export function hmiPlcSourceOf(type: PLCVariableType, dataTypes: readonly PLCDataType[] = []): HmiPlcSource | null {
  if (type.definition === 'array')
    return type.data ? arraySource(type.data.baseType.value, bounds(type.data.dimensions)) : null
  const name = type.value.trim().toUpperCase()
  if (name === HMI_ALARM_SUMMARY) return { kind: 'summary' }
  const dt = dataTypes.find((d) => d.name.toUpperCase() === name)
  if (dt?.derivation === 'array') return arraySource(dt.baseType.value, bounds(dt.dimensions))
  return null
}

/** Whether a widget source of type `wanted` (its `hmi_source`) takes the variable. */
export function hmiSourceTakes(wanted: string, variable: HmiPlcVariable): boolean {
  const kind = hmiSourceKind(wanted)
  return kind !== null && variable.source?.kind === kind
}

/**
 * The source input a dropped variable sets on a widget: the first one of its kind left empty, else the first one of
 * its kind; null when the widget takes no such data. `value` gives an input's current literal text.
 */
export function hmiSourceForDrop(
  info: Pick<HmiWidgetInfo, 'sources'>,
  variable: HmiPlcVariable,
  value: (input: string) => string,
): string | null {
  const taking = (info.sources ?? []).filter((s) => hmiSourceTakes(s.type, variable))
  return (taking.find((s) => value(s.name) === '') ?? taking[0])?.name ?? null
}

/** A feed method the build generates for a kind: its name, result type and the row field it reads. */
export interface HmiFeedMethod {
  method: string
  result: string
  /** Field of the row (or of the summary) it reads; the element itself for numbers. */
  field: string
  /** True for methods that take the row number. */
  indexed: boolean
}

/** The feed methods each kind overrides, and what each reads. */
/** Feed slots a data element has (`HmiDataElement.SetFeed` takes 0 to 7). */
export const HMI_FEED_SLOTS = 8

export const HMI_FEED_METHODS: Readonly<Record<HmiSourceKind, readonly HmiFeedMethod[]>> = {
  alarms: [
    { method: 'Used', result: 'BOOL', field: 'Used', indexed: true },
    { method: 'Active', result: 'BOOL', field: 'Active', indexed: true },
    { method: 'Acked', result: 'BOOL', field: 'Acked', indexed: true },
    { method: 'Severity', result: 'INT', field: 'Severity', indexed: true },
    { method: 'Message', result: 'STRING(80)', field: 'Message', indexed: true },
    { method: 'Stamp', result: 'DT', field: 'Raised', indexed: true },
    { method: 'Seq', result: 'UDINT', field: 'Seq', indexed: true },
  ],
  events: [
    { method: 'Seq', result: 'UDINT', field: 'Seq', indexed: true },
    { method: 'Kind', result: 'INT', field: 'Kind', indexed: true },
    { method: 'Severity', result: 'INT', field: 'Severity', indexed: true },
    { method: 'Message', result: 'STRING(80)', field: 'Message', indexed: true },
    { method: 'Stamp', result: 'DT', field: 'Stamp', indexed: true },
  ],
  summary: [
    { method: 'Count', result: 'DINT', field: 'Count', indexed: false },
    { method: 'Unacked', result: 'DINT', field: 'Unacked', indexed: false },
    { method: 'Used', result: 'BOOL', field: 'TopValid', indexed: true },
    { method: 'Acked', result: 'BOOL', field: 'TopAcked', indexed: true },
    { method: 'Severity', result: 'INT', field: 'TopSeverity', indexed: true },
    { method: 'Message', result: 'STRING(80)', field: 'TopMessage', indexed: true },
    { method: 'Stamp', result: 'DT', field: 'TopRaised', indexed: true },
    { method: 'Seq', result: 'UDINT', field: 'TopSeq', indexed: true },
  ],
  numbers: [{ method: 'Number', result: 'REAL', field: '', indexed: true }],
}

/** Whether the target can show a widget: it requires no capability, or one the target has (`hmi_requires`). */
export function hmiWidgetAvailable(info: Pick<HmiWidgetInfo, 'requires'>, capabilities: object): boolean {
  if (!info.requires) return true
  return Object.entries(capabilities).some(([name, value]) => name === info.requires && value === true)
}

/** The ST text that sets a source input to a variable: a string literal of its path. */
export const hmiSourceLiteral = (path: string): string => `'${path}'`
