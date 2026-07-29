import type { CommunicationPort } from '../../middleware/shared/ports/types'

/**
 * How a serial port should read in the communication-port picker.
 *
 * The label is always the OS-canonical port identifier — the `address`
 * (`port.path` from `serialport`): `COM5` on Windows, `/dev/ttyUSB0` on Linux,
 * `/dev/tty.usbserial-XXXX` on macOS. This is both what the user recognizes and
 * what we actually open, so it must never be replaced by the vendor string.
 *
 * The chip/vendor name (e.g. "wch.cn" for a CH340) is a useful disambiguator
 * when several ports are present, so it rides along as a hover `title` — never
 * as the visible label (that was the bug: a NodeMCU showed "wch.cn" instead of
 * "COM5", since `name` held the manufacturer).
 */
export function serialPortDisplay(port: CommunicationPort): { label: string; title?: string } {
  const address = port.address?.trim() ?? ''
  const name = port.name?.trim() ?? ''
  // Prefer the path; fall back to the name only if the path is somehow empty.
  const label = address || name
  // Show the vendor/chip name on hover only when it adds information beyond the
  // path (i.e. it isn't just the path echoed back by the enumerator's fallback).
  const title = name && name !== label ? name : undefined
  return { label, title }
}
