import type { SerialPort } from './types'

/**
 * Canonicalize a serial-port path to the macOS call-out (`/dev/cu.*`) node.
 *
 * macOS exposes each serial device as a paired dial-in node (`/dev/tty.*`)
 * and call-out node (`/dev/cu.*`) that differ only by that prefix.
 * `serialport`'s native binding hardcodes the dial-in (`tty.*`) name
 * (`@serialport/bindings-cpp` `darwin_list.cpp` reads `kIODialinDeviceKey`),
 * but callers must use the call-out (`cu.*`) node to actually talk to a
 * device — and that is the name arduino-cli and the Arduino IDE report. So
 * we rewrite `tty.` → `cu.` at the source: both scans then agree on one path
 * and no cross-node reconciliation is needed. IOKit always publishes both
 * nodes for a serial service, so the rewritten path is guaranteed to exist.
 *
 * The pattern is macOS-specific (dotted prefix): Linux (`/dev/ttyUSB0`,
 * `/dev/ttyACM0`) and Windows (`COM3`) paths don't match and pass through
 * unchanged. Already-`cu.*` paths are left as-is.
 */
export function toCalloutPath(address: string): string {
  return address.replace(/^\/dev\/tty\./, '/dev/cu.')
}

/** Re-key a scan's map onto canonical call-out paths, keeping the first defined descriptor per device. */
function toCalloutMap(byPath: Map<string, string | undefined>): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>()
  for (const [address, descriptor] of byPath) {
    const key = toCalloutPath(address)
    // `existing || descriptor` keeps the first non-empty descriptor seen for
    // a device (e.g. if it somehow surfaced under both nodes).
    result.set(key, result.get(key) || descriptor)
  }
  return result
}

/**
 * Merge the two independent serial-port scans into one entry per device.
 *
 * Reports FACTS, not a display string: the device path plus whichever
 * descriptors each scan knew. How that reads in the picker — the path leading,
 * the descriptor in parentheses, arduino-cli's board name preferred over the
 * OS vendor string — is `serialPortDisplay`'s decision, and lives there so a
 * single code path serves every platform. Composing here as well is what
 * previously let the board name be dropped: the renderer could not tell a bare
 * manufacturer from an already-composed label.
 *
 * Both scans are first canonicalized to the macOS call-out node
 * (`toCalloutPath`), so a device is keyed identically regardless of which scan
 * reported it; the merge is then a plain union deduped by path. `serialport`
 * provides the reliable, instant set of ports and is folded in first so its
 * ordering is preserved; arduino-cli only enriches those entries and may
 * contribute additional ports it discovered on its own.
 *
 * @param boardNamesByPath    path -> arduino-cli board name (`undefined` when
 *                            the port was detected but no board matched)
 * @param manufacturersByPath path -> `serialport` manufacturer/vendor string
 */
export function mergeSerialPortList(
  boardNamesByPath: Map<string, string | undefined>,
  manufacturersByPath: Map<string, string | undefined>,
): SerialPort[] {
  const boardNames = toCalloutMap(boardNamesByPath)
  const manufacturers = toCalloutMap(manufacturersByPath)

  // serialport ordering first, then any arduino-cli-only ports. A Set keeps
  // insertion order and dedupes ports seen by both scans.
  const addresses = new Set<string>([...manufacturers.keys(), ...boardNames.keys()])

  return [...addresses].map((address) => {
    // Empty strings are normalised away so the renderer only has to check for
    // absence, not for blank-but-present descriptors.
    const boardName = boardNames.get(address)?.trim() || undefined
    const manufacturer = manufacturers.get(address)?.trim() || undefined
    return {
      address,
      ...(boardName ? { boardName } : {}),
      ...(manufacturer ? { manufacturer } : {}),
    }
  })
}
