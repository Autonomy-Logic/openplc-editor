import type { CommunicationPort } from '../../middleware/shared/ports/types'

/**
 * How a serial port reads in the communication-port picker:
 * `/dev/cu.usbmodem11101 (Arduino MKR)`, `COM5 (Arduino Uno)`, `COM5 (wch.cn)`.
 *
 * Two rules, and they used to pull against each other:
 *
 *  1. The path always leads. It is what the user recognizes and what we
 *     actually open — `COM5` on Windows, `/dev/ttyUSB0` on Linux,
 *     `/dev/cu.usbmodem*` on macOS — so it is never replaced by a descriptor.
 *     (The bug that motivated this: a NodeMCU reading "wch.cn" instead of
 *     "COM5", because the label took a manufacturer string over the path.)
 *  2. The descriptor survives, in parentheses. It is what distinguishes two
 *     identical-looking `/dev/cu.usbmodem*` nodes, and dropping it was the
 *     regression that followed.
 *
 * Both hold because this composes rather than choosing, and it is the ONE place
 * that decides — `CommunicationPort` carries facts (`address`, `boardName`,
 * `manufacturer`), never a pre-composed string. That is what makes every
 * platform behave identically: there is no second labelling path to drift.
 *
 * Descriptor precedence: arduino-cli's identified board name first (it is the
 * specific, useful one), falling back to the OS vendor/manufacturer string, and
 * to nothing at all when neither scan knew anything.
 */
export function serialPortDisplay(port: CommunicationPort): { label: string; title?: string } {
  const address = port.address?.trim() ?? ''
  const descriptor = port.boardName?.trim() || port.manufacturer?.trim() || ''

  // No path to lead with (shouldn't happen — the enumerator keys on it) — the
  // descriptor is all there is.
  if (!address) return { label: descriptor, title: undefined }

  if (!descriptor) return { label: address, title: undefined }

  const label = `${address} (${descriptor})`
  // Offer the full string on hover as well: a composed label is the one most
  // likely to be truncated by the dropdown's width.
  return { label, title: label }
}
