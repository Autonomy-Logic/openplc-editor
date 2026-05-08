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
  }
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
 * Run all internal validations on the EtherCAT runtime configuration JSON
 * produced by `generateEthercatConfig`.
 *
 * Validating the generator's output (instead of its input) keeps this gate
 * honest: whatever lands in `ethercat.json` is exactly what we check, with
 * no risk of drifting from the generator's filter rules.
 *
 * Returns the list of validation errors. An empty list means "deploy is
 * safe"; a non-empty list means the caller must abort and is responsible
 * for surfacing the messages to the user (each platform routes errors
 * differently — Vite progress, Electron output panel, etc.).
 */
export const validateEthercatConfig = (configJson: string | null): string[] => {
  if (!configJson) return []

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
  // Future internal validations append their errors here. Keeping them
  // additive lets the user see every problem in a single pass instead of
  // one-error-at-a-time.

  return errors
}
