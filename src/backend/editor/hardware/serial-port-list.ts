import type { SerialPort } from './types'

/**
 * macOS exposes every serial device twice: a call-in node (`/dev/tty.*`)
 * and a call-out node (`/dev/cu.*`). Our two scans disagree on which they
 * report — `serialport` lists the `tty.*` node, arduino-cli lists the
 * `cu.*` node — so without reconciliation the same device shows up twice.
 *
 * Both nodes share the suffix after the prefix (`tty.usbmodem11301` and
 * `cu.usbmodem11301` → `usbmodem11301`), so we group on that and emit a
 * single entry per device, displaying the call-out (`cu.*`) node: that is
 * the one used for talking to a device (non-blocking, no carrier-detect
 * wait) and the one the Arduino IDE selects.
 *
 * Linux (`/dev/ttyUSB0`, `/dev/ttyACM0`) and Windows (`COM3`) paths don't
 * match the `tty.`/`cu.` (dotted) pattern, so they key on their full path
 * and are never merged.
 */
const MACOS_SERIAL_NODE = /^\/dev\/(?:tty|cu)\.(.+)$/

/** Canonical per-device key: the shared suffix on macOS, else the path itself. */
function deviceKey(address: string): string {
  const match = MACOS_SERIAL_NODE.exec(address)
  return match ? match[1] : address
}

/** Prefer the macOS call-out (`/dev/cu.*`) node when a device has several. */
function preferCallout(addresses: string[]): string {
  return addresses.find((address) => address.startsWith('/dev/cu.')) ?? addresses[0]
}

/**
 * Merge the two independent serial-port scans into the `{ name, address }`
 * shape the renderer's communication-port dropdown expects.
 *
 * The device path (`address`) is ALWAYS the primary, guaranteed-unique
 * label — this mirrors the Arduino IDE, which keys every entry on the
 * port path (`COM3`, `/dev/ttyACM0`, `/dev/cu.usbmodem…`) and never
 * collapses ports to a shared vendor string. A descriptor is appended
 * in parentheses when available, in order of usefulness:
 *
 *  1. the arduino-cli-identified board name (from the connected core's
 *     `boards.txt` VID/PID — e.g. `COM3 (Arduino Uno)`), else
 *  2. the OS manufacturer/vendor string reported by `serialport`
 *     (e.g. `COM6 (com0com - serial port emulator)`), else
 *  3. nothing — just the bare path.
 *
 * `serialport` provides the reliable, instant set of ports and is folded
 * in first so its ordering is preserved; arduino-cli only enriches those
 * entries and may contribute additional ports it discovered on its own.
 * Ports that resolve to the same device (by path, or by macOS `tty.`/`cu.`
 * pairing) are collapsed to a single entry.
 *
 * @param boardNamesByPath    path → arduino-cli board name (`undefined` when
 *                            the port was detected but no board matched)
 * @param manufacturersByPath path → `serialport` manufacturer/vendor string
 */
export function mergeSerialPortList(
  boardNamesByPath: Map<string, string | undefined>,
  manufacturersByPath: Map<string, string | undefined>,
): SerialPort[] {
  type DeviceGroup = { addresses: string[]; boardName?: string; manufacturer?: string }
  const groups = new Map<string, DeviceGroup>()

  const groupFor = (address: string): DeviceGroup => {
    const key = deviceKey(address)
    let group = groups.get(key)
    if (!group) {
      group = { addresses: [] }
      groups.set(key, group)
    }
    if (!group.addresses.includes(address)) group.addresses.push(address)
    return group
  }

  // serialport first so its ordering drives the list, then arduino-cli.
  for (const [address, manufacturer] of manufacturersByPath) {
    const group = groupFor(address)
    // `if (manufacturer)` (not `?? `) so an empty-string descriptor is ignored.
    if (manufacturer && !group.manufacturer) group.manufacturer = manufacturer
  }
  for (const [address, boardName] of boardNamesByPath) {
    const group = groupFor(address)
    if (boardName && !group.boardName) group.boardName = boardName
  }

  return [...groups.values()].map((group) => {
    const address = preferCallout(group.addresses)
    // Board name (more specific) wins over the manufacturer/vendor string.
    const descriptor = group.boardName || group.manufacturer
    return {
      name: descriptor ? `${address} (${descriptor})` : address,
      address,
    }
  })
}
