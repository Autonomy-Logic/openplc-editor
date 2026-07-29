/**
 * Identify the VPP vendor-screen that carries a board's Modbus slave
 * configuration.
 *
 * Arduino-family packages declare it in their manifest as
 * `"Modbus": "screens/modbus.json"` (sections `modbus_rtu` / `modbus_tcp`).
 * The editor surfaces this config under the **Servers** group — unified with
 * the runtime-v4 servers UX — instead of listing it as a generic vendor
 * screen. This helper locates the screen key so the explorer / create-element
 * flows can re-home it there.
 *
 * Matches case-insensitively on the canonical name `Modbus` so a package that
 * keys the screen slightly differently still resolves. Pure — no I/O, no store.
 */
export function findModbusScreenName(screens: Record<string, unknown> | undefined): string | undefined {
  if (!screens) return undefined
  return Object.keys(screens).find((name) => name.toLowerCase() === 'modbus')
}
