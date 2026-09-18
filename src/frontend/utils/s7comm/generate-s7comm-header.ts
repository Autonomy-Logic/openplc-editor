/**
 * Author the `src/s7comm_config.h` content for a baremetal arduino-cli target.
 *
 * Sibling of `generate-opcua-header.ts`, and much smaller: OPC-UA publishes
 * named variables and has to resolve every path through `debug-map.json`, while
 * an S7 area is a flat run of bytes over a located buffer, so the whole address
 * space is `(area, db, buffer, startIndex, length)`.
 *
 * The mapping is Runtime v4's, unchanged, so a project moved between targets
 * addresses the same variable the same way.
 *
 * `s7comm_types.h` declares the record this instantiates; the two are halves of
 * one ABI.
 */

import type { S7TargetProfile } from '@root/middleware/shared/utils/target-capabilities/types'

/** Buffer selector values, matching `S7COMM_BUF_*` in `s7comm_types.h`. */
const BUFFER_CODE: Record<string, string> = {
  bool_input: 'S7COMM_BUF_BOOL_INPUT',
  bool_output: 'S7COMM_BUF_BOOL_OUTPUT',
  int_input: 'S7COMM_BUF_INT_INPUT',
  int_output: 'S7COMM_BUF_INT_OUTPUT',
  int_memory: 'S7COMM_BUF_INT_MEMORY',
  dint_memory: 'S7COMM_BUF_DINT_MEMORY',
  lint_memory: 'S7COMM_BUF_LINT_MEMORY',
}

/**
 * Buffers the editor accepts that an arduino-cli build has no array for.
 *
 * Runtime v3/v4 define all of these; `openplc.h` on a baremetal target defines
 * none. Naming them here gives the user "this target has no bool_memory buffer"
 * instead of "unknown mapping".
 */
const UNSUPPORTED_ON_BAREMETAL: Record<string, string> = {
  bool_memory: 'bool_memory (%MX)',
  byte_input: 'byte_input (%IB)',
  byte_output: 'byte_output (%QB)',
  dint_input: 'dint_input (%ID as DINT)',
  dint_output: 'dint_output (%QD as DINT)',
  lint_input: 'lint_input',
  lint_output: 'lint_output',
}

/** One area, already validated and ready to become an `S7COMM_AREAS[]` row. */
interface EmittedArea {
  area: string
  dbNumber: number
  sizeBytes: number
  buffer: string
  startIndex: number
  writable: boolean
  /** Only for the comment beside the row — the user's own words for it. */
  label: string
}

export interface S7CommBufferMappingLike {
  type: string
  startBuffer: number
  bitAddressing?: boolean
}

export interface S7CommDataBlockLike {
  dbNumber: number
  description: string
  sizeBytes: number
  mapping: S7CommBufferMappingLike
}

export interface S7CommSystemAreaLike {
  enabled: boolean
  sizeBytes: number
  mapping?: S7CommBufferMappingLike
}

export interface S7CommServerSettingsLike {
  enabled: boolean
  bindAddress: string
  port: number
  maxClients: number
  pduSize: number
}

export interface S7CommSlaveConfigLike {
  server: S7CommServerSettingsLike
  plcIdentity?: {
    name: string
    moduleType: string
    serialNumber: string
    copyright: string
    moduleName: string
  }
  dataBlocks: S7CommDataBlockLike[]
  systemAreas?: {
    peArea?: S7CommSystemAreaLike
    paArea?: S7CommSystemAreaLike
    mkArea?: S7CommSystemAreaLike
  }
}

export interface GenerateS7CommHeaderInput {
  /** The project's S7 slave config, or `null` when the project has no enabled S7
   *  server; the generator then emits a disabled header so the runtime's
   *  unconditional `#include "s7comm_config.h"` still resolves. */
  config: S7CommSlaveConfigLike | null
  /** The target's S7 profile, already defaulted by `resolveTargetCapabilities`. */
  profile: S7TargetProfile
  /** Called for anything the user should know but that should not stop the
   *  build: a data block dropped for exceeding the target's ceiling, a buffer
   *  this target has no array for. */
  warn?: (message: string) => void
}

/** C string literal, escaped. \r included — escaping \n but not \r left a bare
 *  carriage return in the literal, which the compiler reports as an unterminated
 *  string with no hint which field carried it. */
const cString = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`

/** Text safe to drop into a `//` line comment: no newline can break out of it
 *  into code. A data-block description reaches here from a hand-edited, imported
 *  or shared project (the pipeline reads the S7 config through a cast, not a
 *  parse), so a newline in it would otherwise inject arbitrary C. */
const cComment = (value: string): string => value.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /')

/** Resolve one mapping to a `S7COMM_BUF_*` name, or explain why not. */
const resolveBuffer = (
  mapping: S7CommBufferMappingLike | undefined,
  label: string,
  warn: (message: string) => void,
): string | null => {
  if (!mapping) {
    warn(`S7Comm: ${label} has no buffer mapping and was skipped.`)
    return null
  }
  const code = BUFFER_CODE[mapping.type]
  if (code) return code

  const friendly = UNSUPPORTED_ON_BAREMETAL[mapping.type]
  if (friendly) {
    warn(
      `S7Comm: ${label} maps to ${friendly}, which this target has no buffer for — ` +
        `it exists on Runtime v3/v4 only. The area was skipped.`,
    )
  } else {
    warn(`S7Comm: ${label} maps to an unknown buffer type "${mapping.type}" and was skipped.`)
  }
  return null
}

/**
 * Collect the areas that survive validation. Everything refused here is refused
 * at build time with a message naming the block, rather than shipping a device
 * that answers some addresses and not others.
 */
export function collectS7Areas(
  config: S7CommSlaveConfigLike,
  profile: S7TargetProfile,
  warn: (message: string) => void,
): EmittedArea[] {
  const areas: EmittedArea[] = []

  // System areas first, so they read in protocol order (PE, PA, MK) ahead of the
  // data blocks.
  const system: Array<[string, S7CommSystemAreaLike | undefined, string]> = [
    ['S7COMM_AREA_PE', config.systemAreas?.peArea, 'the process-input area (PE)'],
    ['S7COMM_AREA_PA', config.systemAreas?.paArea, 'the process-output area (PA)'],
    ['S7COMM_AREA_MK', config.systemAreas?.mkArea, 'the merker area (MK)'],
  ]

  for (const [areaCode, spec, label] of system) {
    if (!spec || !spec.enabled) continue
    const buffer = resolveBuffer(spec.mapping, label, warn)
    if (!buffer) continue
    areas.push({
      area: areaCode,
      dbNumber: 0,
      sizeBytes: spec.sizeBytes,
      buffer,
      startIndex: spec.mapping?.startBuffer ?? 0,
      // The process-input area is what the field wires drive. A client that
      // writes it is writing a value the next input refresh overwrites, which
      // looks like the write was lost.
      writable: areaCode !== 'S7COMM_AREA_PE',
      label,
    })
  }

  const seenDb = new Set<number>()
  for (const db of config.dataBlocks) {
    const label = `DB${db.dbNumber}${db.description ? ` (${db.description})` : ''}`

    if (seenDb.has(db.dbNumber)) {
      warn(`S7Comm: ${label} repeats a DB number already defined; the later one was skipped.`)
      continue
    }

    if (areas.filter((a) => a.area === 'S7COMM_AREA_DB').length >= profile.maxDataBlocks) {
      warn(
        `S7Comm: this target allows ${profile.maxDataBlocks} data blocks and the project has more; ` +
          `${label} and any after it were skipped.`,
      )
      break
    }

    const buffer = resolveBuffer(db.mapping, label, warn)
    if (!buffer) continue

    seenDb.add(db.dbNumber)
    areas.push({
      area: 'S7COMM_AREA_DB',
      dbNumber: db.dbNumber,
      sizeBytes: db.sizeBytes,
      buffer,
      startIndex: db.mapping.startBuffer,
      writable: true,
      label,
    })
  }

  return areas
}

/**
 * Render `s7comm_config.h`.
 */
export function generateS7CommHeaderContent(input: GenerateS7CommHeaderInput): string {
  const { config, profile } = input
  const warn = input.warn ?? (() => undefined)

  const lines: string[] = []
  lines.push('// s7comm_config.h — auto-generated, do not edit by hand.')
  lines.push('//')
  lines.push("// Written by generate-s7comm-header.ts from the project's S7Comm server")
  lines.push("// configuration and the target's declared S7 profile.")
  lines.push('')
  lines.push('#ifndef S7COMM_CONFIG_H')
  lines.push('#define S7COMM_CONFIG_H')
  lines.push('')

  if (!config || !config.server.enabled) {
    lines.push('// No enabled S7Comm server in this project — the server compiles out.')
    lines.push('#define S7COMM_ENABLED 0')
    lines.push('')
    lines.push('#endif // S7COMM_CONFIG_H')
    return `${lines.join('\n')}\n`
  }

  const areas = collectS7Areas(config, profile, warn)

  if (areas.length === 0) {
    // A server with no areas would accept connections and answer every read with
    // "out of range". Compiling it out and saying so is more useful.
    warn(
      'S7Comm: the server is enabled but no area could be mapped on this target, ' + 'so it was left out of the build.',
    )
    lines.push('// S7Comm server enabled, but no area survived validation — see the build log.')
    lines.push('#define S7COMM_ENABLED 0')
    lines.push('')
    lines.push('#endif // S7COMM_CONFIG_H')
    return `${lines.join('\n')}\n`
  }

  // The negotiated PDU is the smaller of what the project asked for and what the
  // target says it can buffer. Clamped here rather than on the device so the
  // number in the image is the number in the build log.
  const pduSize = Math.min(Math.max(config.server.pduSize, 240), profile.pduSize)
  if (config.server.pduSize > profile.pduSize) {
    warn(
      `S7Comm: the project asks for a ${config.server.pduSize}-byte PDU and this target ` +
        `allows ${profile.pduSize}; ${pduSize} will be negotiated. Clients adapt — ` +
        `the server always answers with the smaller of the two.`,
    )
  }

  const maxClients = Math.min(config.server.maxClients, profile.maxClients)
  if (config.server.maxClients > profile.maxClients) {
    warn(
      `S7Comm: the project allows ${config.server.maxClients} concurrent clients and this ` +
        `target allows ${profile.maxClients}; the limit is ${maxClients}. Each client costs ` +
        `a ${pduSize}-byte receive/transmit pair in RAM.`,
    )
  }

  lines.push('#define S7COMM_ENABLED 1')
  lines.push('')
  // Self-contained on purpose: the table below is typed on s7comm_area_t and
  // this header is pulled in by several TUs in whatever order they include it,
  // so it must not depend on the includer declaring the record first.
  lines.push('#include "s7comm_types.h"')
  lines.push('')
  lines.push('// ---- Server ----')
  lines.push(`#define S7COMM_PORT ${config.server.port}`)
  lines.push(`#define S7COMM_MAX_CLIENTS ${maxClients}`)
  lines.push(`#define S7COMM_PDU_SIZE ${pduSize}`)
  lines.push(`#define S7COMM_WRITE_ENABLED ${profile.writeEnabled ? 1 : 0}`)
  lines.push(`#define S7COMM_SZL_ENABLED ${profile.szl ? 1 : 0}`)
  lines.push('')

  if (config.plcIdentity) {
    lines.push('// ---- Identity ----')
    lines.push('//')
    lines.push('// What a client sees when it asks the CPU who it is. Only')
    lines.push('// meaningful where S7COMM_SZL_ENABLED is 1 — without the')
    lines.push('// identification service there is nowhere to publish it.')
    lines.push(`#define S7COMM_ID_NAME ${cString(config.plcIdentity.name)}`)
    lines.push(`#define S7COMM_ID_MODULE_TYPE ${cString(config.plcIdentity.moduleType)}`)
    lines.push(`#define S7COMM_ID_SERIAL ${cString(config.plcIdentity.serialNumber)}`)
    lines.push(`#define S7COMM_ID_COPYRIGHT ${cString(config.plcIdentity.copyright)}`)
    lines.push(`#define S7COMM_ID_MODULE_NAME ${cString(config.plcIdentity.moduleName)}`)
    lines.push('')
  }

  lines.push('// ---- Address space ----')
  lines.push('//')
  lines.push('// const, so it lives in flash. It is fixed when the project is')
  lines.push('// built and never changes, so there is no version of this that')
  lines.push('// should cost RAM.')
  lines.push(`#define S7COMM_AREA_COUNT ${areas.length}`)
  lines.push('')
  lines.push('static const s7comm_area_t S7COMM_AREAS[S7COMM_AREA_COUNT] = {')
  for (const a of areas) {
    lines.push(
      `    { ${a.area}, ${Math.trunc(Number(a.dbNumber)) || 0}, ${Math.trunc(Number(a.sizeBytes)) || 0}, ` +
        `${a.buffer}, ${Math.trunc(Number(a.startIndex)) || 0}, ${a.writable ? 1 : 0} },` +
        `  // ${cComment(a.label)}`,
    )
  }
  lines.push('};')
  lines.push('')
  lines.push('#endif // S7COMM_CONFIG_H')

  return `${lines.join('\n')}\n`
}
