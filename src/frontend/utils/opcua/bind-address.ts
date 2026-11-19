/**
 * Helpers for the OPC-UA server "Network Interface" (bind address) setting.
 *
 * The runtime builds its endpoint as `opc.tcp://<bindAddress>:<port><path>`, so
 * the value stored in the project is always an IPv4 address. Two of them are
 * well-known (all interfaces / loopback); anything else means the user wants
 * the server bound to one specific interface of the target device.
 */

/** Bind to every interface of the target device. */
export const ALL_INTERFACES_ADDRESS = '0.0.0.0'

/** Bind to the loopback interface only. */
export const LOCALHOST_ADDRESS = '127.0.0.1'

/** Select value for the "specific interface" choice. Never persisted. */
export const SPECIFIC_INTERFACE_MODE = 'specific'

export type BindAddressMode = typeof ALL_INTERFACES_ADDRESS | typeof LOCALHOST_ADDRESS | typeof SPECIFIC_INTERFACE_MODE

export type BindAddressSuggestion = {
  /** IPv4 address that will be stored as the bind address. */
  address: string
  /** Where the editor learned about this address. */
  source: string
}

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_PATTERN = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`)

/**
 * Check whether a value is a dotted-quad IPv4 address (e.g. `192.168.1.10`).
 * Leading zeros are rejected so the stored value is unambiguous.
 */
export const isValidIpv4Address = (value: string): boolean => IPV4_PATTERN.test(value.trim())

/**
 * Map a stored bind address to the option shown in the "Network Interface" select.
 */
export const getBindAddressMode = (bindAddress: string): BindAddressMode => {
  if (bindAddress === ALL_INTERFACES_ADDRESS) return ALL_INTERFACES_ADDRESS
  if (bindAddress === LOCALHOST_ADDRESS) return LOCALHOST_ADDRESS
  return SPECIFIC_INTERFACE_MODE
}

/**
 * Build the list of addresses offered for a specific interface.
 *
 * The editor cannot enumerate the target's interfaces (it may be offline and the
 * runtime exposes no IP listing), so it offers the addresses it already knows
 * about, in priority order and without duplicates. The user can still type any
 * other IPv4 address.
 */
export const buildBindAddressSuggestions = ({
  currentBindAddress,
  deviceIpAddress,
  connectedIpAddress,
}: {
  currentBindAddress?: string | null
  deviceIpAddress?: string | null
  connectedIpAddress?: string | null
}): BindAddressSuggestion[] => {
  const candidates: BindAddressSuggestion[] = [
    { address: currentBindAddress?.trim() ?? '', source: 'Current' },
    { address: deviceIpAddress?.trim() ?? '', source: 'Device configuration' },
    { address: connectedIpAddress?.trim() ?? '', source: 'Connected runtime' },
  ]

  const suggestions: BindAddressSuggestion[] = []
  for (const candidate of candidates) {
    if (!isValidIpv4Address(candidate.address)) continue
    if (getBindAddressMode(candidate.address) !== SPECIFIC_INTERFACE_MODE) continue
    if (suggestions.some((s) => s.address === candidate.address)) continue
    suggestions.push(candidate)
  }
  return suggestions
}
