import type { ModbusIOGroup } from '../../../middleware/shared/ports/types'
import {
  IO_GROUP_ERROR_HANDLING_OPTIONS,
  IO_GROUP_FORM_DEFAULTS,
  IO_GROUP_FUNCTION_CODE_OPTIONS,
  isReadFunctionCode,
  isSingleElementFunctionCode,
  validateIOGroupLength,
} from './io-group'

/**
 * Bulk import / export of a Modbus remote device's IO groups.
 *
 * The file schema mirrors the New IO Group form field-for-field (name,
 * functionCode, cycleTime, offset, length, errorHandling) so a row in a file
 * means exactly what the same values typed into the form would mean, and is
 * validated by the same rules (`validateIOGroupLength`, read-only error
 * handling, …). Everything here is pure — no store, no DOM — so the rules are
 * unit-testable and reusable by a headless caller.
 *
 * Import is all-or-nothing: the parser collects EVERY problem with its row
 * number instead of stopping at the first, and the caller imports nothing
 * while any error remains. A partially imported register table is worse than
 * none — the gaps are silent.
 */

type ModbusFunctionCode = ModbusIOGroup['functionCode']
type ModbusErrorHandling = ModbusIOGroup['errorHandling']

/** An IO group as described by a file: the form's fields, no id, no points. */
export type IOGroupDraft = Omit<ModbusIOGroup, 'id' | 'ioPoints'>

export type IOGroupTransferFormat = 'csv' | 'json'

export type IOGroupImportIssue = {
  /**
   * 1-based location of the offending record: the physical CSV line (header =
   * line 1) or the position in the JSON `ioGroups` array. `null` for problems
   * with the file as a whole.
   */
  row: number | null
  field?: keyof IOGroupDraft
  message: string
}

export type IOGroupImportResult = {
  groups: IOGroupDraft[]
  errors: IOGroupImportIssue[]
  warnings: IOGroupImportIssue[]
}

/** Identifies a JSON export so an unrelated JSON file is rejected up front. */
export const IO_GROUP_TRANSFER_FORMAT_ID = 'openplc-modbus-io-groups'
export const IO_GROUP_TRANSFER_VERSION = 1

/** A register map is a few KB; anything this large is the wrong file. */
export const IO_GROUP_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024
/** Upper bound on groups per file — guards the UI and the address allocator. */
export const IO_GROUP_IMPORT_MAX_GROUPS = 2000
export const IO_GROUP_NAME_MAX_LENGTH = 64
export const IO_GROUP_CYCLE_TIME_MIN_MS = 1
export const IO_GROUP_CYCLE_TIME_MAX_MS = 3_600_000
/** Modbus addresses are 16-bit: 0 … 65535. */
export const MODBUS_MAX_ADDRESS = 65535

/** Column order of the CSV export, and the canonical JSON keys. */
export const IO_GROUP_TRANSFER_FIELDS = [
  'name',
  'functionCode',
  'cycleTime',
  'offset',
  'length',
  'errorHandling',
] as const satisfies ReadonlyArray<keyof IOGroupDraft>

type TransferField = (typeof IO_GROUP_TRANSFER_FIELDS)[number]

/** Without these there is nothing sensible to default to. */
const REQUIRED_FIELDS: ReadonlyArray<TransferField> = ['name', 'functionCode']

/**
 * Header spellings accepted per field, compared after `normalizeKey` (lower
 * case, letters and digits only) — so `functionCode`, `Function Code`,
 * `function_code` and `FUNCTION-CODE` are the same column, and the form's own
 * labels (`Cycle Time (ms)`) work as headers.
 */
const FIELD_ALIASES: Record<TransferField, readonly string[]> = {
  name: ['name', 'groupname', 'iogroupname'],
  functionCode: ['functioncode', 'fc'],
  cycleTime: ['cycletime', 'cycletimems'],
  offset: ['offset'],
  length: ['length'],
  errorHandling: ['errorhandling'],
}

/** JSON keys an exported project fragment may carry that are not ours to set. */
const IGNORED_JSON_KEYS = new Set(['id', 'ioPoints'])

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '')

const resolveField = (key: string): TransferField | undefined => {
  const normalized = normalizeKey(key)
  return IO_GROUP_TRANSFER_FIELDS.find((field) => FIELD_ALIASES[field].includes(normalized))
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

// ---------------------------------------------------------------------------
// Field coercion — shared by CSV (strings) and JSON (strings or numbers)
// ---------------------------------------------------------------------------

type RawValue = unknown
type Coerced<T> = { ok: true; value: T } | { ok: false; message: string }

const isBlank = (value: RawValue): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

const formatValue = (value: RawValue): string => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value))

/**
 * Integers only, in decimal or `0x` hexadecimal (register maps are often
 * published in hex). Rejects `1e3`, `12.0`, `0b1`, booleans and the rest of
 * what `Number()` would happily accept.
 */
const coerceInteger = (value: RawValue): number | null => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (/^[+]?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return Number.parseInt(trimmed.slice(2), 16)
  return null
}

const FUNCTION_CODE_VALUES = new Set<string>(IO_GROUP_FUNCTION_CODE_OPTIONS.map((o) => o.value))

/** Accepts `3`, `"3"`, `"03"`, `"FC3"`, `"FC 3"` or the form label itself. */
const coerceFunctionCode = (value: RawValue): Coerced<ModbusFunctionCode> => {
  const supported = IO_GROUP_FUNCTION_CODE_OPTIONS.map((o) => o.value).join(', ')
  const invalid = {
    ok: false as const,
    message: `Unsupported function code ${formatValue(value)}. Use one of: ${supported}.`,
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) && FUNCTION_CODE_VALUES.has(String(value))
      ? { ok: true, value: String(value) as ModbusFunctionCode }
      : invalid
  }
  if (typeof value !== 'string') return invalid

  const trimmed = value.trim()
  const byLabel = IO_GROUP_FUNCTION_CODE_OPTIONS.find((o) => o.label.toLowerCase() === trimmed.toLowerCase())
  if (byLabel) return { ok: true, value: byLabel.value }

  const match = /^(?:fc\s*)?0*(\d{1,2})$/i.exec(trimmed)
  if (match && FUNCTION_CODE_VALUES.has(match[1])) return { ok: true, value: match[1] as ModbusFunctionCode }
  return invalid
}

/** Accepts the stored value (`keep-last-value`) or the form label (`Keep last value`). */
const coerceErrorHandling = (value: RawValue): Coerced<ModbusErrorHandling> => {
  if (typeof value === 'string') {
    const normalized = normalizeKey(value)
    const option = IO_GROUP_ERROR_HANDLING_OPTIONS.find(
      (o) => normalizeKey(o.value) === normalized || normalizeKey(o.label) === normalized,
    )
    if (option) return { ok: true, value: option.value }
  }
  const allowed = IO_GROUP_ERROR_HANDLING_OPTIONS.map((o) => o.value).join(' or ')
  return { ok: false, message: `Invalid error handling ${formatValue(value)}. Use ${allowed}.` }
}

// C0/C1 control characters (tabs and line breaks included) have no place in a name.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Turns one record (header → raw value) into a draft, pushing every problem
 * found instead of stopping at the first. Missing optional fields take the
 * form's defaults, so a minimal file needs only `name` and `functionCode`.
 */
const buildDraft = (
  record: Partial<Record<TransferField, RawValue>>,
  row: number,
  errors: IOGroupImportIssue[],
  warnings: IOGroupImportIssue[],
): IOGroupDraft | null => {
  const errorCountBefore = errors.length
  const fail = (field: TransferField, message: string) => errors.push({ row, field, message })

  // name
  let name = ''
  if (isBlank(record.name)) fail('name', 'Name is required.')
  else if (typeof record.name !== 'string' && typeof record.name !== 'number')
    fail('name', `Name must be text, got ${formatValue(record.name)}.`)
  else {
    name = String(record.name).trim()
    if (name.length > IO_GROUP_NAME_MAX_LENGTH)
      fail('name', `Name is longer than ${IO_GROUP_NAME_MAX_LENGTH} characters.`)
    else if (CONTROL_CHARS.test(name)) fail('name', 'Name contains control characters (tab, line break, …).')
  }

  // functionCode
  let functionCode: ModbusFunctionCode = IO_GROUP_FORM_DEFAULTS.functionCode
  if (isBlank(record.functionCode)) fail('functionCode', 'Function code is required.')
  else {
    const fc = coerceFunctionCode(record.functionCode)
    if (fc.ok) functionCode = fc.value
    else fail('functionCode', fc.message)
  }
  const functionCodeOk = errors.every((e) => e.row !== row || e.field !== 'functionCode')

  // cycleTime
  let cycleTime = IO_GROUP_FORM_DEFAULTS.cycleTime
  if (!isBlank(record.cycleTime)) {
    const parsed = coerceInteger(record.cycleTime)
    if (parsed === null)
      fail('cycleTime', `Cycle time must be a whole number of milliseconds, got ${formatValue(record.cycleTime)}.`)
    else if (parsed < IO_GROUP_CYCLE_TIME_MIN_MS || parsed > IO_GROUP_CYCLE_TIME_MAX_MS)
      fail(
        'cycleTime',
        `Cycle time must be between ${IO_GROUP_CYCLE_TIME_MIN_MS} and ${IO_GROUP_CYCLE_TIME_MAX_MS} ms.`,
      )
    else cycleTime = parsed
  }

  // offset
  let offset = Number(IO_GROUP_FORM_DEFAULTS.offset)
  let offsetOk = true
  if (!isBlank(record.offset)) {
    const parsed = coerceInteger(record.offset)
    if (parsed === null || parsed > MODBUS_MAX_ADDRESS) {
      offsetOk = false
      fail(
        'offset',
        `Offset must be a whole number between 0 and ${MODBUS_MAX_ADDRESS}, got ${formatValue(record.offset)}.`,
      )
    } else offset = parsed
  }

  // length — the exact rule the form applies, for the resolved function code
  let length = IO_GROUP_FORM_DEFAULTS.length
  let lengthOk = true
  if (functionCodeOk) {
    if (isSingleElementFunctionCode(functionCode)) {
      if (!isBlank(record.length) && coerceInteger(record.length) !== 1)
        warnings.push({
          row,
          field: 'length',
          message: `FC ${functionCode} addresses exactly one element; length ${formatValue(record.length)} was set to 1.`,
        })
    } else if (!isBlank(record.length)) {
      const raw = typeof record.length === 'number' ? String(record.length) : record.length
      const validation = typeof raw === 'string' ? validateIOGroupLength(functionCode, raw) : null
      if (validation?.ok) length = validation.length
      else {
        lengthOk = false
        fail(
          'length',
          validation && !validation.ok ? validation.message : `Invalid length ${formatValue(record.length)}.`,
        )
      }
    }
  }

  if (functionCodeOk && offsetOk && lengthOk && offset + length - 1 > MODBUS_MAX_ADDRESS)
    fail('length', `Offset ${offset} + length ${length} runs past the last Modbus address (${MODBUS_MAX_ADDRESS}).`)

  // errorHandling — only meaningful for read groups, exactly like the form
  let errorHandling: ModbusErrorHandling = IO_GROUP_FORM_DEFAULTS.errorHandling
  if (!isBlank(record.errorHandling)) {
    const eh = coerceErrorHandling(record.errorHandling)
    if (!eh.ok) fail('errorHandling', eh.message)
    else if (functionCodeOk && !isReadFunctionCode(functionCode)) {
      if (eh.value !== IO_GROUP_FORM_DEFAULTS.errorHandling)
        warnings.push({
          row,
          field: 'errorHandling',
          message: `Error handling only applies to read function codes; ignored for FC ${functionCode}.`,
        })
    } else errorHandling = eh.value
  }

  if (errors.length > errorCountBefore) return null
  return { name, functionCode, cycleTime, offset: String(offset), length, errorHandling }
}

/**
 * Names become point identifiers (`<name>_<index>`), so two groups with the
 * same name in one device would collide. IEC 61131-3 identifiers are
 * case-insensitive, hence the case-folded comparison.
 */
const reportDuplicateNames = (drafts: Array<{ draft: IOGroupDraft; row: number }>, errors: IOGroupImportIssue[]) => {
  const firstRowByName = new Map<string, number>()
  for (const { draft, row } of drafts) {
    const key = draft.name.toLowerCase()
    const first = firstRowByName.get(key)
    if (first === undefined) firstRowByName.set(key, row)
    else errors.push({ row, field: 'name', message: `Duplicate name "${draft.name}" (first used on row ${first}).` })
  }
}

const finalize = (
  drafts: Array<{ draft: IOGroupDraft; row: number }>,
  errors: IOGroupImportIssue[],
  warnings: IOGroupImportIssue[],
  hadRecords: boolean,
): IOGroupImportResult => {
  if (!hadRecords && errors.length === 0) errors.push({ row: null, message: 'The file contains no IO groups.' })
  reportDuplicateNames(drafts, errors)
  // Never hand back a partial list: the caller must not import anything while errors remain.
  return { groups: errors.length === 0 ? drafts.map((d) => d.draft) : [], errors, warnings }
}

const fileLevelError = (message: string): IOGroupImportResult => ({
  groups: [],
  errors: [{ row: null, message }],
  warnings: [],
})

// ---------------------------------------------------------------------------
// CSV (RFC 4180)
// ---------------------------------------------------------------------------

const CSV_DELIMITER_CANDIDATES = [',', ';', '\t'] as const

/**
 * Picks the delimiter from the header line by counting candidates outside
 * quotes. `;` matters in practice: Excel writes it whenever the OS locale uses
 * a decimal comma (pt-BR, de-DE, …).
 */
export const detectCsvDelimiter = (text: string): string => {
  const counts = new Map<string, number>(CSV_DELIMITER_CANDIDATES.map((d) => [d, 0]))
  let inQuotes = false
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && (char === '\n' || char === '\r')) break
    else if (!inQuotes && counts.has(char)) counts.set(char, counts.get(char)! + 1)
  }
  let best: string = ','
  for (const delimiter of CSV_DELIMITER_CANDIDATES) if (counts.get(delimiter)! > counts.get(best)!) best = delimiter
  return best
}

type CsvRecord = { line: number; cells: string[] }
type CsvParseResult = { records: CsvRecord[]; error?: string }

/**
 * Minimal RFC 4180 reader: quoted fields may contain the delimiter, line
 * breaks and `""`-escaped quotes; CRLF, LF and CR line endings are all
 * accepted. Each record keeps the physical line it started on so error
 * messages point at the line a spreadsheet user sees.
 */
export const parseCsv = (text: string, delimiter: string): CsvParseResult => {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let quotedCell = false
  let line = 1
  let recordLine = 1

  const endCell = () => {
    cells.push(quotedCell ? cell : cell.trim())
    cell = ''
    quotedCell = false
  }
  const endRecord = () => {
    endCell()
    records.push({ line: recordLine, cells })
    cells = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else {
        if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) line++
        cell += char
      }
      continue
    }

    if (char === '"') {
      if (cell.trim() !== '') return { records, error: `Line ${line}: unexpected quote inside an unquoted field.` }
      cell = ''
      inQuotes = true
      quotedCell = true
    } else if (char === delimiter) {
      endCell()
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++
      endRecord()
      line++
      recordLine = line
    } else if (quotedCell) {
      if (char.trim() !== '') return { records, error: `Line ${line}: unexpected text after a closing quote.` }
    } else cell += char
  }

  if (inQuotes) return { records, error: `Line ${recordLine}: a quoted field is never closed.` }
  if (cell !== '' || quotedCell || cells.length > 0) endRecord()
  return { records }
}

/**
 * Undoes the formula-injection guard applied by `escapeCsvCell`: a leading
 * apostrophe in front of a formula trigger character is the guard, not data.
 */
const unguardCsvCell = (value: string): string => (/^'[=+\-@]/.test(value) ? value.slice(1) : value)

export const parseIOGroupsCsv = (input: string): IOGroupImportResult => {
  const text = stripBom(input)
  if (text.trim() === '') return fileLevelError('The file is empty.')

  const delimiter = detectCsvDelimiter(text)
  const { records: allRecords, error } = parseCsv(text, delimiter)
  if (error) return fileLevelError(`Malformed CSV. ${error}`)

  const records = allRecords.filter((r) => r.cells.some((c) => c !== ''))
  const [header, ...rows] = records
  if (!header) return fileLevelError('The file is empty.')

  const errors: IOGroupImportIssue[] = []
  const warnings: IOGroupImportIssue[] = []

  // Map header columns → fields
  const columnFields: Array<TransferField | undefined> = []
  const seen = new Set<TransferField>()
  header.cells.forEach((title, index) => {
    const field = resolveField(title)
    if (!field) {
      if (title !== '') warnings.push({ row: header.line, message: `Unknown column "${title}" was ignored.` })
      columnFields.push(undefined)
    } else if (seen.has(field)) {
      errors.push({ row: header.line, field, message: `Column "${title}" appears more than once.` })
      columnFields.push(undefined)
    } else {
      seen.add(field)
      columnFields[index] = field
    }
  })
  const missing = REQUIRED_FIELDS.filter((field) => !seen.has(field))
  if (missing.length > 0)
    errors.push({
      row: header.line,
      message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected header: ${IO_GROUP_TRANSFER_FIELDS.join(',')}`,
    })
  if (errors.length > 0) return { groups: [], errors, warnings }

  if (rows.length > IO_GROUP_IMPORT_MAX_GROUPS)
    return fileLevelError(
      `The file has ${rows.length} IO groups; at most ${IO_GROUP_IMPORT_MAX_GROUPS} can be imported at once.`,
    )

  const drafts: Array<{ draft: IOGroupDraft; row: number }> = []
  for (const { line, cells } of rows) {
    if (cells.length > header.cells.length && cells.slice(header.cells.length).some((c) => c !== '')) {
      errors.push({ row: line, message: `Row has ${cells.length} columns but the header has ${header.cells.length}.` })
      continue
    }
    const record: Partial<Record<TransferField, RawValue>> = {}
    columnFields.forEach((field, index) => {
      if (field) record[field] = field === 'name' ? unguardCsvCell(cells[index] ?? '') : cells[index]
    })
    const draft = buildDraft(record, line, errors, warnings)
    if (draft) drafts.push({ draft, row: line })
  }

  return finalize(drafts, errors, warnings, rows.length > 0)
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * Accepts either the export envelope
 * `{ "format": "openplc-modbus-io-groups", "version": 1, "ioGroups": [...] }`
 * or a bare array of groups, which is what people write by hand.
 */
export const parseIOGroupsJson = (input: string): IOGroupImportResult => {
  const text = stripBom(input)
  if (text.trim() === '') return fileLevelError('The file is empty.')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return fileLevelError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  let items: unknown
  if (Array.isArray(parsed)) items = parsed
  else if (parsed !== null && typeof parsed === 'object') {
    const envelope = parsed as Record<string, unknown>
    if (envelope.format !== undefined && envelope.format !== IO_GROUP_TRANSFER_FORMAT_ID)
      return fileLevelError(
        `Unrecognized file format ${formatValue(envelope.format)}. Expected "${IO_GROUP_TRANSFER_FORMAT_ID}".`,
      )
    if (envelope.version !== undefined) {
      if (typeof envelope.version !== 'number' || !Number.isInteger(envelope.version) || envelope.version < 1)
        return fileLevelError(`Invalid format version ${formatValue(envelope.version)}.`)
      if (envelope.version > IO_GROUP_TRANSFER_VERSION)
        return fileLevelError(
          `The file uses format version ${envelope.version}; this editor supports up to version ${IO_GROUP_TRANSFER_VERSION}. Update the editor to import it.`,
        )
    }
    if (!('ioGroups' in envelope)) return fileLevelError('Missing "ioGroups" array.')
    items = envelope.ioGroups
  } else return fileLevelError('Expected a JSON array of IO groups or an object with an "ioGroups" array.')

  if (!Array.isArray(items)) return fileLevelError('"ioGroups" must be an array.')
  if (items.length > IO_GROUP_IMPORT_MAX_GROUPS)
    return fileLevelError(
      `The file has ${items.length} IO groups; at most ${IO_GROUP_IMPORT_MAX_GROUPS} can be imported at once.`,
    )

  const errors: IOGroupImportIssue[] = []
  const warnings: IOGroupImportIssue[] = []
  const unknownKeys = new Set<string>()
  const drafts: Array<{ draft: IOGroupDraft; row: number }> = []

  items.forEach((item, index) => {
    const row = index + 1
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ row, message: 'Each IO group must be a JSON object.' })
      return
    }
    const record: Partial<Record<TransferField, RawValue>> = {}
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      const field = resolveField(key)
      if (field) record[field] = value
      else if (!IGNORED_JSON_KEYS.has(key)) unknownKeys.add(key)
    }
    const draft = buildDraft(record, row, errors, warnings)
    if (draft) drafts.push({ draft, row })
  })

  if (unknownKeys.size > 0)
    warnings.push({
      row: null,
      message: `Unknown field${unknownKeys.size > 1 ? 's' : ''} ignored: ${[...unknownKeys].join(', ')}.`,
    })

  return finalize(drafts, errors, warnings, items.length > 0)
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Decodes an imported file as UTF-8, falling back to Windows-1252 — what
 * Excel's plain "CSV (Comma delimited)" writes on Windows — when the bytes are
 * not valid UTF-8. A lossy UTF-8 decode would silently turn accented names
 * into `\uFFFD`; the fallback keeps them and the caller can tell the user.
 */
export const decodeIOGroupFile = (buffer: ArrayBuffer): { text: string; encoding: 'utf-8' | 'windows-1252' } => {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Chooses the parser from the file extension, falling back to sniffing the
 * first character for files saved without one.
 */
export const detectIOGroupFileFormat = (fileName: string, content: string): IOGroupTransferFormat | null => {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase()
  if (extension === 'json') return 'json'
  if (extension === 'csv' || extension === 'txt' || extension === 'tsv') return 'csv'
  if (extension) return null
  const first = stripBom(content).trimStart()[0]
  return first === '[' || first === '{' ? 'json' : 'csv'
}

export const parseIOGroupsFile = (fileName: string, content: string): IOGroupImportResult => {
  const format = detectIOGroupFileFormat(fileName, content)
  if (format === 'json') return parseIOGroupsJson(content)
  if (format === 'csv') return parseIOGroupsCsv(content)
  return fileLevelError('Unsupported file type. Import a .csv or .json file.')
}

/**
 * Names in `drafts` that already exist on the device (case-insensitive) —
 * a conflict only when appending; replacing removes the existing groups first.
 */
export const findIOGroupNameConflicts = (drafts: IOGroupDraft[], existingNames: string[]): string[] => {
  const existing = new Set(existingNames.map((n) => n.toLowerCase()))
  return drafts.filter((d) => existing.has(d.name.toLowerCase())).map((d) => d.name)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const toDraft = (group: IOGroupDraft): IOGroupDraft => ({
  name: group.name,
  functionCode: group.functionCode,
  cycleTime: group.cycleTime,
  offset: group.offset,
  length: group.length,
  errorHandling: group.errorHandling,
})

/**
 * Quotes a cell when it holds the delimiter, a quote or a line break, and
 * neutralizes spreadsheet formula injection (OWASP "CSV Injection") by
 * prefixing an apostrophe to values starting with `=`, `+`, `-` or `@`.
 */
const escapeCsvCell = (value: string | number): string => {
  let text = String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",;\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * RFC 4180 CSV with CRLF line endings and a UTF-8 BOM, so Excel opens
 * non-ASCII names correctly. The header uses the canonical field names, the
 * same ones the importer documents.
 */
export const serializeIOGroupsToCsv = (groups: IOGroupDraft[]): string => {
  const lines = [IO_GROUP_TRANSFER_FIELDS.join(',')]
  for (const group of groups.map(toDraft)) {
    lines.push(IO_GROUP_TRANSFER_FIELDS.map((field) => escapeCsvCell(group[field])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export const serializeIOGroupsToJson = (groups: IOGroupDraft[]): string =>
  `${JSON.stringify(
    {
      format: IO_GROUP_TRANSFER_FORMAT_ID,
      version: IO_GROUP_TRANSFER_VERSION,
      ioGroups: groups.map(toDraft).map((g) => ({
        name: g.name,
        functionCode: Number(g.functionCode),
        cycleTime: g.cycleTime,
        // Offsets are stored as strings; emit a number whenever it is one.
        offset: /^\d+$/.test(g.offset.trim()) ? Number(g.offset) : g.offset,
        length: g.length,
        errorHandling: g.errorHandling,
      })),
    },
    null,
    2,
  )}\n`

/** A filesystem-safe export file name derived from the device name. */
export const buildIOGroupExportFileName = (deviceName: string, format: IOGroupTransferFormat): string => {
  const safe = deviceName.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'remote-device'
  return `${safe}-io-groups.${format}`
}
