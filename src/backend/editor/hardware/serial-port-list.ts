import type { SerialPort } from './types'

/**
 * Merge the two independent serial-port scans into the `{ name, address }`
 * shape the renderer's communication-port dropdown expects.
 *
 * The device path (`address`) is ALWAYS the primary, guaranteed-unique
 * label — this mirrors the Arduino IDE, which keys every entry on the
 * port path (`COM3`, `/dev/ttyACM0`, `/dev/cu.usbmodem…`) and never
 * collapses ports to a shared vendor string.  A descriptor is appended
 * in parentheses when available, in order of usefulness:
 *
 *  1. the arduino-cli-identified board name (from the connected core's
 *     `boards.txt` VID/PID — e.g. `COM3 (Arduino Uno)`), else
 *  2. the OS manufacturer/vendor string reported by `serialport`
 *     (e.g. `COM6 (com0com - serial port emulator)`), else
 *  3. nothing — just the bare path.
 *
 * `serialport` provides the reliable, instant set of ports and is listed
 * first so its ordering is preserved; arduino-cli only enriches those
 * entries and may contribute additional ports it discovered on its own.
 * Ports present in both scans are deduped by path.
 *
 * @param boardNamesByPath    path → arduino-cli board name (`undefined` when
 *                            the port was detected but no board matched)
 * @param manufacturersByPath path → `serialport` manufacturer/vendor string
 */
export function mergeSerialPortList(
  boardNamesByPath: Map<string, string | undefined>,
  manufacturersByPath: Map<string, string | undefined>,
): SerialPort[] {
  // serialport ordering first, then any arduino-cli-only ports. A Set keeps
  // insertion order and dedupes ports seen by both scans.
  const addresses = new Set<string>([...manufacturersByPath.keys(), ...boardNamesByPath.keys()])

  return [...addresses].map((address) => {
    // `||` (not `??`) so an empty-string descriptor falls through too.
    const descriptor = boardNamesByPath.get(address) || manufacturersByPath.get(address)
    return {
      name: descriptor ? `${address} (${descriptor})` : address,
      address,
    }
  })
}
