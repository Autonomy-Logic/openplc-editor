/** The runtime's HTTPS port, which serves the HMI beside its API. */
export const HMI_RUNTIME_PORT = 8443

/** The HMI address shown when the device's own address is not known. */
export const HMI_ADDRESS_PLACEHOLDER = `https://<device IP>:${HMI_RUNTIME_PORT}/hmi/`

const HOST_NAME = /^[A-Za-z0-9.-]+$/
const IPV6 = /^[0-9A-Fa-f:.]+$/

/** Where a browser opens the HMI of a Runtime v4 device at `host`; null when `host` is not an IP address or name. */
export function hmiAddress(host: string | null | undefined): string | null {
  const h = (host ?? '').trim()
  if (h.length === 0) return null
  if (h.includes(':')) return IPV6.test(h) ? `https://[${h}]:${HMI_RUNTIME_PORT}/hmi/` : null
  return HOST_NAME.test(h) ? `https://${h}:${HMI_RUNTIME_PORT}/hmi/` : null
}
