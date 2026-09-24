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
      channels?: { pdo_entry_index: string; pdo_entry_subindex: number }[]
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
 * Each I/O mapping master pairs with the busconfig root entry at the same position and name, and
 * each of its entries must resolve to exactly one channel (slave position + PDO entry index +
 * subindex) there. Anything else means the runtime would bind a located variable to the wrong
 * PDO entry, or to none.
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
    const channelKeys = (entry.config?.slaves ?? []).flatMap((slave) =>
      (slave.channels ?? []).map((ch) => `${slave.position}:${ch.pdo_entry_index}:${ch.pdo_entry_subindex}`),
    )
    for (const ioEntry of master.entries ?? []) {
      const key = `${ioEntry.slave}:${ioEntry.index}:${ioEntry.subindex}`
      const matches = channelKeys.filter((k) => k === key).length
      if (matches !== 1) {
        errors.push(
          `EtherCAT I/O mapping entry ${ioEntry.iec_location} (master '${master.name}', slave ${ioEntry.slave}, ` +
            `${ioEntry.index}:${ioEntry.subindex}) matches ${matches} channel(s) in the bus configuration, expected 1`,
        )
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
  }
  // Future internal validations append their errors here. Keeping them
  // additive lets the user see every problem in a single pass instead of
  // one-error-at-a-time.

  return errors
}
