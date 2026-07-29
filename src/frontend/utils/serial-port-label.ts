import type { CommunicationPort } from '../../middleware/shared/ports/types'

/**
 * How a serial port should read in the communication-port picker:
 * `/dev/cu.usbmodem11101 (Arduino MKR)` — the OS-canonical path, with the
 * board/chip descriptor in parentheses when one is known.
 *
 * Two invariants, and they pull in opposite directions:
 *
 *  1. The path is ALWAYS present and always leads. It is what the user
 *     recognizes and what we actually open, so it must never be replaced by a
 *     vendor string — the bug where a NodeMCU read "wch.cn" instead of "COM5".
 *  2. The descriptor must survive. It is what tells two identical-looking
 *     `/dev/cu.usbmodem*` nodes apart, and dropping it was a regression.
 *
 * Satisfying both means composing, not choosing between them.
 *
 * Two producer shapes are handled, because `name` is not consistently one
 * thing: `mergeSerialPortList` (the editor's enumerator) already returns
 * `name: "<address> (<descriptor>)"`, while a bare manufacturer string is what
 * `serialport` reports on its own. Detecting the pre-composed form instead of
 * assuming either one is what keeps this from double-wrapping into
 * `COM5 (COM5 (wch.cn))`.
 */
export function serialPortDisplay(port: CommunicationPort): { label: string; title?: string } {
  const address = port.address?.trim() ?? ''
  const name = port.name?.trim() ?? ''

  // No path to lead with (shouldn't happen, but the enumerator's shape isn't
  // guaranteed) — the name is all there is.
  if (!address) return { label: name, title: undefined }

  // Already composed by the producer, or simply the path echoed back when no
  // descriptor was known. Either way it starts with the path, so invariant 1
  // holds and it can be used verbatim.
  if (name === address || name.startsWith(`${address} `)) {
    const label = name || address
    // Offer the full string on hover too: a long composed label is the one most
    // likely to be truncated by the dropdown's width.
    return { label, title: label !== address ? label : undefined }
  }

  // A bare descriptor (manufacturer / chip). Compose it behind the path so the
  // path still leads.
  if (name) {
    const label = `${address} (${name})`
    return { label, title: label }
  }

  return { label: address, title: undefined }
}
