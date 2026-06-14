/**
 * Helpers to ensure EtherCAT slave names are unique within a project.
 *
 * Slaves with the same name across different masters used to collide in the
 * UI's name-keyed slices (tabs/editor/file). Dedup happens at creation time
 * by appending `_01`, `_02`, … to the base name when it clashes with any
 * existing slave in any master.
 */

type RemoteDeviceForNameCollection = {
  ethercatConfig?: {
    devices?: Array<{ name: string }>
  }
}

/**
 * Collect every EtherCAT slave name currently configured across all masters.
 */
export function collectAllSlaveNames(remoteDevices: RemoteDeviceForNameCollection[] | undefined): Set<string> {
  const names = new Set<string>()
  if (!remoteDevices) return names

  for (const rd of remoteDevices) {
    for (const dev of rd.ethercatConfig?.devices ?? []) {
      names.add(dev.name)
    }
  }
  return names
}

/**
 * Return `base` if unused, otherwise the first `${base}_NN` (two-digit padded)
 * not present in `existing`. Two-digit pad doesn't truncate, so 3+ digit
 * indices pass through unchanged.
 */
export function generateUniqueSlaveName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  let candidate = base
  let i = 0
  while (taken.has(candidate)) {
    i++
    candidate = `${base}_${String(i).padStart(2, '0')}`
  }
  return candidate
}
