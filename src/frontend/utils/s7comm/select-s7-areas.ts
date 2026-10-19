/**
 * Which S7 areas a target actually serves, decided once.
 *
 * Three consumers used to answer this separately and disagree: the bare-metal
 * header dropped duplicates, stopped at the target's ceiling and skipped a
 * buffer the firmware has no array for; the Runtime v4 config file shipped
 * every block as written; and the image sizer sized all of them on both
 * targets. So a project could be sized for an area no device would answer,
 * and `AT %ID0` passed the producer gate while the header discarded the block
 * that was supposed to back it.
 *
 * What differs between targets is DATA, not logic: how many blocks it holds
 * and which buffers it can address. Both come from the target's S7 profile.
 */

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

/** What the selection needs from the target. A subset of `S7TargetProfile`, so
 *  a caller holding the whole profile passes it unchanged. */
export interface S7SelectionRules {
  maxDataBlocks: number
  /** Mapping types this target's S7 server can address. */
  buffers: readonly string[]
}

/** How each buffer reads back to the user, with the IEC prefix that makes it
 *  recognisable on the variables table. */
const BUFFER_LABEL: Record<string, string> = {
  bool_input: 'bool_input (%IX)',
  bool_output: 'bool_output (%QX)',
  bool_memory: 'bool_memory (%MX)',
  byte_input: 'byte_input (%IB)',
  byte_output: 'byte_output (%QB)',
  int_input: 'int_input (%IW)',
  int_output: 'int_output (%QW)',
  int_memory: 'int_memory (%MW)',
  dint_input: 'dint_input (%ID as DINT)',
  dint_output: 'dint_output (%QD as DINT)',
  dint_memory: 'dint_memory (%MD)',
  lint_input: 'lint_input (%IL)',
  lint_output: 'lint_output (%QL)',
  lint_memory: 'lint_memory (%ML)',
}

/** The three system areas, in protocol order, with the code each one carries. */
const SYSTEM_AREAS = [
  { code: 'S7COMM_AREA_PE', key: 'peArea', label: 'the process-input area (PE)' },
  { code: 'S7COMM_AREA_PA', key: 'paArea', label: 'the process-output area (PA)' },
  { code: 'S7COMM_AREA_MK', key: 'mkArea', label: 'the merker area (MK)' },
] as const

/** One area that survived selection, with the mapping that reached it. */
export interface SelectedS7Area {
  /** `S7COMM_AREA_DB` for a data block, the system code otherwise. */
  area: string
  /** 0 for a system area, which has no DB number. */
  dbNumber: number
  description: string
  sizeBytes: number
  mapping: S7CommBufferMappingLike
  /** The process-input area is what the field wires drive. A client writing it
   *  writes a value the next input refresh overwrites. */
  writable: boolean
  /** How the area names itself in a message to the user. */
  label: string
}

interface SelectableConfig {
  /** Optional: a server created and not yet configured carries none. */
  dataBlocks?: S7CommDataBlockLike[]
  systemAreas?: {
    peArea?: S7CommSystemAreaLike
    paArea?: S7CommSystemAreaLike
    mkArea?: S7CommSystemAreaLike
  }
}

/**
 * The areas this target serves, in the order it serves them.
 *
 * Everything refused here is refused at build time with a message naming the
 * block, rather than shipping a device that answers some addresses and not
 * others. `warn` is optional because the sizer runs the same selection only to
 * learn the sizes; the emitter that ships the file is what tells the user.
 */
export function selectS7Areas(
  config: SelectableConfig,
  rules: S7SelectionRules,
  warn: (message: string) => void = () => undefined,
): SelectedS7Area[] {
  const serves = (mapping: S7CommBufferMappingLike | undefined, label: string): boolean => {
    if (!mapping) {
      warn(`S7Comm: ${label} has no buffer mapping and was skipped.`)
      return false
    }
    if (rules.buffers.includes(mapping.type)) return true

    // "This target has no array for it" and "no such buffer exists" are
    // different mistakes, and only the first has a remedy the user can act on.
    const friendly = BUFFER_LABEL[mapping.type]
    if (friendly) {
      warn(
        `S7Comm: ${label} maps to ${friendly}, which this target has no buffer for — ` +
          `it exists on Runtime v3/v4 only. The area was skipped.`,
      )
    } else {
      warn(`S7Comm: ${label} maps to an unknown buffer type "${mapping.type}" and was skipped.`)
    }
    return false
  }

  const selected: SelectedS7Area[] = []

  // System areas first, so they read in protocol order ahead of the data blocks.
  for (const { code, key, label } of SYSTEM_AREAS) {
    const spec = config.systemAreas?.[key]
    if (!spec || !spec.enabled) continue
    if (!serves(spec.mapping, label)) continue
    selected.push({
      area: code,
      dbNumber: 0,
      description: '',
      sizeBytes: spec.sizeBytes,
      mapping: spec.mapping ?? { type: '', startBuffer: 0 },
      writable: code !== 'S7COMM_AREA_PE',
      label,
    })
  }

  const seenDb = new Set<number>()
  let blocks = 0

  for (const db of config.dataBlocks ?? []) {
    const label = `DB${db.dbNumber}${db.description ? ` (${db.description})` : ''}`

    if (seenDb.has(db.dbNumber)) {
      warn(`S7Comm: ${label} repeats a DB number already defined; the later one was skipped.`)
      continue
    }

    if (blocks >= rules.maxDataBlocks) {
      warn(
        `S7Comm: this target allows ${rules.maxDataBlocks} data blocks and the project has more; ` +
          `${label} and any after it were skipped.`,
      )
      break
    }

    if (!serves(db.mapping, label)) continue

    seenDb.add(db.dbNumber)
    blocks += 1
    selected.push({
      area: 'S7COMM_AREA_DB',
      dbNumber: db.dbNumber,
      description: db.description,
      sizeBytes: db.sizeBytes,
      mapping: db.mapping,
      writable: true,
      label,
    })
  }

  return selected
}
