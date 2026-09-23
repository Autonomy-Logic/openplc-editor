import type { EditSessionClientKind } from '../../middleware/shared/ports/edit-session-port'

/**
 * How this place is named to the user when the same project is open elsewhere:
 * "Chrome on macOS", "OpenPLC Editor on Windows". Only good enough to tell two
 * places apart; it is never used to decide anything.
 */
export function describeEditSessionClient(
  isNativeApplication: boolean,
  userAgent: string,
): { kind: EditSessionClientKind; label: string } {
  const os = operatingSystemOf(userAgent)

  if (isNativeApplication) {
    return { kind: 'desktop', label: os ? `OpenPLC Editor on ${os}` : 'OpenPLC Editor' }
  }

  const browser = browserOf(userAgent)
  const label = browser && os ? `${browser} on ${os}` : (browser ?? (os ? `Browser on ${os}` : 'Web browser'))

  return { kind: 'web', label }
}

function operatingSystemOf(ua: string): string | null {
  if (/Windows/i.test(ua)) return 'Windows'
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/Linux/i.test(ua)) return 'Linux'
  return null
}

// Order matters: every Chromium browser also says "Chrome", and Chrome also says "Safari".
function browserOf(ua: string): string | null {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return null
}
