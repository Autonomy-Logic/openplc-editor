/**
 * The preview's precompiled prelude: the opening of the generated unit header, up to and including its libraries
 * header, compiled once with the preview's C++ flags and shipped with the compiled objects. A preview unit whose header
 * opens with the same text, over the same libraries header and the same runtime and HMI files, starts from it.
 */
import { sha256Hex } from '../../wasm-toolchain/content-digest'

/** Request path of the prelude's source, which the precompiled header names as its own. */
export const HMI_PRELUDE_SOURCE = 'hmi/preview/hmi_prelude.h'
/** Request path of the precompiled header. */
export const HMI_PRELUDE_PCH = 'hmi/preview/hmi_prelude.pch'
/** Shipped file describing the prelude. */
export const HMI_PRELUDE_INDEX = 'hmi_prelude.json'
/** Shipped precompiled header. */
export const HMI_PRELUDE_FILE = 'hmi_prelude.pch'
/** The unit header the prelude opens, and the libraries header it ends with, by their unit file names. */
export const HMI_UNIT_HEADER = 'hmi_unit.hpp'
export const HMI_UNIT_LIBRARIES_HEADER = 'hmi_unit_libraries.hpp'
/** Request path of the unit's libraries header. */
const LIBRARIES_PATH = `unit/${HMI_UNIT_LIBRARIES_HEADER}`
const LIBRARIES_INCLUDE = `#include "${HMI_UNIT_LIBRARIES_HEADER}"`
const FORMAT = 1
const DIGEST = /^[0-9a-f]{64}$/

export interface HmiPrelude {
  /** The prelude's text: the opening of the unit header it was built from. */
  header: string
  /** The libraries header it was built against. */
  libraries: string
  /** The precompiled header. */
  pch: Uint8Array
}

interface HmiPreludeIndex {
  format: number
  toolchain: string
  header: string
  libraries: string
  /** SHA-256 of the precompiled header. */
  pch: string
  /** Every request file the precompiled header was built from, with its SHA-256. */
  inputs: Array<[path: string, sha256: string]>
}

/** The opening of a unit header up to and including the line that includes its libraries header, or null. */
export function hmiPreludeText(unitHeader: string): string | null {
  const at = unitHeader.indexOf(`\n${LIBRARIES_INCLUDE}\n`)
  return at < 0 ? null : unitHeader.slice(0, at + LIBRARIES_INCLUDE.length + 2)
}

/** Whether a unit's files start from `prelude`: its header opens with the prelude, over the same libraries header. */
export function hmiPreludeFits(
  prelude: HmiPrelude | null | undefined,
  unitFiles: Readonly<Record<string, string>>,
): prelude is HmiPrelude {
  return (
    prelude !== null &&
    prelude !== undefined &&
    unitFiles[HMI_UNIT_HEADER]?.startsWith(prelude.header) === true &&
    unitFiles[HMI_UNIT_LIBRARIES_HEADER] === prelude.libraries
  )
}

/** The shipped files of a prelude built by `toolchain` from `inputs`: the index and the precompiled header. */
export async function encodeHmiPrelude(
  toolchain: string,
  prelude: HmiPrelude,
  inputs: ReadonlyArray<[string, string]>,
): Promise<Record<string, Uint8Array>> {
  const index: HmiPreludeIndex = {
    format: FORMAT,
    toolchain,
    header: prelude.header,
    libraries: prelude.libraries,
    pch: await sha256Hex(prelude.pch),
    inputs: [...inputs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  }
  return {
    [HMI_PRELUDE_INDEX]: new TextEncoder().encode(`${JSON.stringify(index, null, 1)}\n`),
    [HMI_PRELUDE_FILE]: prelude.pch,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isInput = (value: unknown): value is [string, string] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'string' &&
  DIGEST.test(value[1])

function parseIndex(bytes: Uint8Array): HmiPreludeIndex | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!isRecord(value) || value.format !== FORMAT) return null
  const { toolchain, header, libraries, pch, inputs } = value
  if (typeof toolchain !== 'string' || typeof header !== 'string' || typeof libraries !== 'string') return null
  if (typeof pch !== 'string' || !DIGEST.test(pch) || !Array.isArray(inputs) || !inputs.every(isInput)) return null
  return { format: FORMAT, toolchain, header, libraries, pch, inputs }
}

/**
 * The shipped prelude, or null when there is none, it was built by another toolchain, its files are damaged, or it
 * was built from a file that differs from the one the preview compiles with. `fixedFiles` are the preview's runtime
 * headers and HMI sources by request path.
 */
export async function loadHmiPrelude(
  indexBytes: Uint8Array | null,
  pch: Uint8Array | null,
  toolchain: string,
  fixedFiles: Readonly<Record<string, string>>,
): Promise<HmiPrelude | null> {
  const index = indexBytes === null ? null : parseIndex(indexBytes)
  if (index === null || pch === null || index.toolchain !== toolchain) return null
  if (hmiPreludeText(index.header) !== index.header || (await sha256Hex(pch)) !== index.pch) return null
  const own: Record<string, string> = { [HMI_PRELUDE_SOURCE]: index.header, [LIBRARIES_PATH]: index.libraries }
  for (const [path, digest] of index.inputs) {
    const text = own[path] ?? fixedFiles[path]
    if (text === undefined || (await sha256Hex(text)) !== digest) return null
  }
  return { header: index.header, libraries: index.libraries, pch }
}
