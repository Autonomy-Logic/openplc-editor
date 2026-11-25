/** Document URIs of screens and widget blocks, as the ST language service and the HMI code view name them. */

const SCREEN_PREFIX = 'inmemory://hmi-screen/'
const WIDGET_PREFIX = 'inmemory://hmi-widget/'

export type HmiFileKind = 'screen' | 'widget'

export const hmiFileUri = (kind: HmiFileKind, name: string): string =>
  `${kind === 'screen' ? SCREEN_PREFIX : WIDGET_PREFIX}${encodeURIComponent(name)}.st`

/** The screen or widget block a URI names, or null. */
export function parseHmiFileUri(uri: string): { kind: HmiFileKind; name: string } | null {
  for (const [prefix, kind] of [
    [SCREEN_PREFIX, 'screen'],
    [WIDGET_PREFIX, 'widget'],
  ] as const) {
    if (uri.startsWith(prefix) && uri.endsWith('.st'))
      return { kind, name: decodeURIComponent(uri.slice(prefix.length, -'.st'.length)) }
  }
  return null
}
