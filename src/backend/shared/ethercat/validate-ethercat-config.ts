/**
 * Subset of the runtime EtherCAT root-entry shape that the validator cares
 * about. The full shape is defined locally inside `generate-ethercat-config.ts`
 * — keeping a minimal mirror here avoids coupling the validator to fields it
 * doesn't use, while still benefiting from TypeScript when iterating entries.
 */
type EthercatRootEntry = {
  name: string
  config: {
    master: {
      interface: string
    }
    slaves?: {
      position: number
      name?: string
      channels?: { pdo_entry_index: string; pdo_entry_subindex: number }[]
      rx_pdos?: { index: string; entries?: unknown[] }[]
      tx_pdos?: { index: string; entries?: unknown[] }[]
      sdo_configurations?: unknown[]
    }[]
  }
}

/** Mirror of the `conf/ethercat_iomapping.json` shape from `generate-ethercat-config.ts`. */
type EthercatIoMapping = {
  version: number
  masters: {
    name: string
    entries: { slave: number; index: string; subindex: number; iec_location: string }[]
  }[]
}

/**
 * Each EtherCAT master must own its network interface — having two masters
 * bound to the same NIC produces undefined behavior at the runtime (both
 * masters race to drive the same socket).
 */
const validateUniqueMasterInterfaces = (entries: EthercatRootEntry[]): string[] => {
  const errors: string[] = []
  const interfaceToMasters = new Map<string, string[]>()

  for (const entry of entries) {
    const iface = entry.config?.master?.interface
    if (!iface) continue
    const name = entry.name || '<unnamed master>'
    const masters = interfaceToMasters.get(iface) ?? []
    masters.push(name)
    interfaceToMasters.set(iface, masters)
  }

  for (const [iface, masters] of interfaceToMasters) {
    if (masters.length > 1) {
      errors.push(`Network interface '${iface}' is shared by multiple masters: ${masters.join(', ')}`)
    }
  }
  return errors
}

/**
 * Limits of runtimes 4.3.0 and newer (EtherDOG and the runtime's EtherCAT plugin). Exceeding
 * one makes EtherDOG refuse the bus configuration or the plugin refuse the mapping at start.
 */
export const ETHERDOG_LIMITS = {
  masters: 4,
  slavesPerMaster: 64,
  pdosPerDirection: 16,
  entriesPerPdo: 32,
  channelsPerSlave: 64,
  sdosPerSlave: 32,
  mappedEntriesPerMaster: 2048,
  nameLength: 63,
  iecLocationLength: 15,
  maxByteIndex: 65535,
} as const

// Same grammar as the runtime's parser: a bit (0-7) only on X, optional there
const IEC_LOCATION = /^%[IQ](?:X(\d+)(?:\.[0-7])?|[BWDL](\d+))$/i

/** Checks what runtimes 4.3.0 and newer can hold, so an oversized project fails at build time. */
const validateEtherdogLimits = (entries: EthercatRootEntry[], mapping: EthercatIoMapping): string[] => {
  const L = ETHERDOG_LIMITS
  const errors: string[] = []
  if (entries.length > L.masters) {
    errors.push(`EtherCAT has ${entries.length} masters; the runtime supports at most ${L.masters}`)
  }
  for (const entry of entries) {
    const master = entry.name || '<unnamed master>'
    if (master.length > L.nameLength) {
      errors.push(`EtherCAT master name '${master}' is longer than ${L.nameLength} characters`)
    }
    const slaves = entry.config?.slaves ?? []
    if (slaves.length > L.slavesPerMaster) {
      errors.push(`EtherCAT master '${master}' has ${slaves.length} slaves; at most ${L.slavesPerMaster} are supported`)
    }
    for (const slave of slaves) {
      const where = `EtherCAT master '${master}', slave ${slave.position}`
      for (const [dir, pdos] of [
        ['RxPDOs', slave.rx_pdos ?? []],
        ['TxPDOs', slave.tx_pdos ?? []],
      ] as const) {
        if (pdos.length > L.pdosPerDirection) {
          errors.push(`${where} has ${pdos.length} ${dir}; at most ${L.pdosPerDirection} are supported`)
        }
        for (const pdo of pdos) {
          const count = pdo.entries?.length ?? 0
          if (count > L.entriesPerPdo) {
            errors.push(`${where}, PDO ${pdo.index} has ${count} entries; at most ${L.entriesPerPdo} are supported`)
          }
        }
      }
      const channels = slave.channels?.length ?? 0
      if (channels > L.channelsPerSlave) {
        errors.push(`${where} has ${channels} channels; at most ${L.channelsPerSlave} are supported`)
      }
      const sdos = slave.sdo_configurations?.length ?? 0
      if (sdos > L.sdosPerSlave) {
        errors.push(`${where} has ${sdos} SDO configurations; at most ${L.sdosPerSlave} are supported`)
      }
    }
  }
  for (const master of mapping.masters ?? []) {
    const mapped = master.entries ?? []
    if (mapped.length > L.mappedEntriesPerMaster) {
      errors.push(
        `EtherCAT master '${master.name}' maps ${mapped.length} entries; at most ${L.mappedEntriesPerMaster} are supported`,
      )
    }
    for (const io of mapped) {
      const location = io.iec_location ?? ''
      const match = IEC_LOCATION.exec(location)
      if (location.length > L.iecLocationLength || !match) {
        errors.push(`EtherCAT master '${master.name}': '${location}' is not a valid IEC location for the runtime`)
      } else if (Number(match[1] ?? match[2]) > L.maxByteIndex) {
        errors.push(`EtherCAT master '${master.name}': '${location}' is beyond byte ${L.maxByteIndex}`)
      }
    }
  }
  return errors
}

/**
 * Mapping masters must match the busconfig entries in order and name; each entry must resolve to
 * exactly one channel (slave position + PDO entry index + subindex).
 */
const validateIoMapping = (entries: EthercatRootEntry[], iomappingJson: string): string[] => {
  let mapping: EthercatIoMapping
  try {
    mapping = JSON.parse(iomappingJson) as EthercatIoMapping
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return [`Failed to parse generated EtherCAT I/O mapping: ${detail}`]
  }

  if (!mapping || !Array.isArray(mapping.masters)) {
    return ['Generated EtherCAT I/O mapping has no masters array']
  }
  if (mapping.masters.length !== entries.length) {
    return [
      `EtherCAT I/O mapping lists ${mapping.masters.length} master(s) but the bus configuration has ${entries.length}`,
    ]
  }

  const errors: string[] = []
  mapping.masters.forEach((master, i) => {
    const entry = entries[i]
    if (master.name !== entry.name) {
      errors.push(`EtherCAT I/O mapping master #${i} is '${master.name}' but the bus configuration has '${entry.name}'`)
      return
    }
    // An entry may sit in several alternative PDOs of the ESI; only the assigned one reaches the
    // runtime's layout, so a key found in more than one channel is fine.
    const channelKeys = new Set(
      (entry.config?.slaves ?? []).flatMap((slave) =>
        (slave.channels ?? []).map((ch) => `${slave.position}:${ch.pdo_entry_index}:${ch.pdo_entry_subindex}`),
      ),
    )
    const mappedTo = new Map<string, string>()
    for (const ioEntry of master.entries ?? []) {
      const key = `${ioEntry.slave}:${ioEntry.index}:${ioEntry.subindex}`
      const where = `(master '${master.name}', slave ${ioEntry.slave}, ${ioEntry.index}:${ioEntry.subindex})`
      if (!channelKeys.has(key)) {
        errors.push(
          `EtherCAT I/O mapping entry ${ioEntry.iec_location} ${where} has no matching channel in the bus configuration`,
        )
      }
      const previous = mappedTo.get(key)
      if (previous !== undefined) {
        errors.push(`EtherCAT process data entry ${where} is mapped twice: ${previous} and ${ioEntry.iec_location}`)
      } else {
        mappedTo.set(key, ioEntry.iec_location)
      }
    }
  })
  return errors
}

/**
 * Run all internal validations on the EtherCAT configuration produced by `generate-ethercat-config.ts`.
 *
 * `configJson` is the legacy `ethercat.json` or the EtherDOG busconfig; both share the array root.
 * `iomappingJson`, when given, is checked against it with `validateIoMapping`.
 *
 * Validating the generator's output (instead of its input) keeps this gate
 * honest: whatever lands in the bundle is exactly what we check, with
 * no risk of drifting from the generator's filter rules.
 *
 * Returns the list of validation errors. An empty list means "deploy is
 * safe"; a non-empty list means the caller must abort and is responsible
 * for surfacing the messages to the user (each platform routes errors
 * differently — Vite progress, Electron output panel, etc.).
 */
export const validateEthercatConfig = (configJson: string | null, iomappingJson: string | null = null): string[] => {
  if (!configJson) {
    return iomappingJson ? ['Generated EtherCAT I/O mapping has no bus configuration'] : []
  }

  let entries: EthercatRootEntry[]
  try {
    entries = JSON.parse(configJson) as EthercatRootEntry[]
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return [`Failed to parse generated EtherCAT config: ${detail}`]
  }

  if (!Array.isArray(entries)) {
    return ['Generated EtherCAT config is not an array']
  }

  const errors: string[] = []
  errors.push(...validateUniqueMasterInterfaces(entries))
  if (iomappingJson !== null) {
    errors.push(...validateIoMapping(entries, iomappingJson))
    try {
      errors.push(...validateEtherdogLimits(entries, JSON.parse(iomappingJson) as EthercatIoMapping))
    } catch {
      // An unparseable mapping is already reported by validateIoMapping
    }
  }
  // Future internal validations append their errors here. Keeping them
  // additive lets the user see every problem in a single pass instead of
  // one-error-at-a-time.

  return errors
}
