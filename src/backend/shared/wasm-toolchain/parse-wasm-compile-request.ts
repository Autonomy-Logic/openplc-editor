import type {
  WasmCompileRequest,
  WasmCompileUnit,
  WasmToolchainFiles,
} from '@root/middleware/shared/ports/wasm-toolchain-types'

export type ParsedWasmCompileRequest = { ok: true; request: WasmCompileRequest } | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const optionalFlags = (value: unknown, field: string): string[] | undefined | string => {
  if (value === undefined) return undefined
  return isStringArray(value) ? value : `'${field}' must be a list of strings.`
}

function parseFiles(value: unknown): WasmToolchainFiles | string {
  if (!isRecord(value)) return "'files' must be an object of path to content."
  const files: WasmToolchainFiles = {}
  for (const [path, content] of Object.entries(value)) {
    if (typeof content === 'string') files[path] = content
    else if (ArrayBuffer.isView(content))
      files[path] = new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
    else return `File '${path}' must be text or bytes.`
  }
  return files
}

function parseUnits(value: unknown): WasmCompileUnit[] | string {
  if (!Array.isArray(value)) return "'units' must be a list."
  const units: WasmCompileUnit[] = []
  for (const unit of value) {
    if (!isRecord(unit) || typeof unit.source !== 'string') return 'Every unit needs a source path.'
    if (unit.language !== 'c' && unit.language !== 'c++') return `Unit '${unit.source}' has no valid language.`
    const flags = optionalFlags(unit.flags, `${unit.source}.flags`)
    if (typeof flags === 'string') return flags
    units.push({ source: unit.source, language: unit.language, ...(flags ? { flags } : {}) })
  }
  return units
}

/** Checks a compile request that crossed a process or worker boundary. */
export function parseWasmCompileRequest(value: unknown): ParsedWasmCompileRequest {
  if (!isRecord(value)) return { ok: false, error: 'The compile request must be an object.' }
  const files = parseFiles(value.files)
  if (typeof files === 'string') return { ok: false, error: files }
  const units = parseUnits(value.units)
  if (typeof units === 'string') return { ok: false, error: units }
  const request: WasmCompileRequest = { files, units }
  for (const field of ['cFlags', 'cxxFlags', 'linkFlags'] as const) {
    const flags = optionalFlags(value[field], field)
    if (typeof flags === 'string') return { ok: false, error: flags }
    if (flags) request[field] = flags
  }
  if (value.output !== undefined) {
    if (typeof value.output !== 'string') return { ok: false, error: "'output' must be a path." }
    request.output = value.output
  }
  return { ok: true, request }
}
