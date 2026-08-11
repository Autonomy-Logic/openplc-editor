import { parse } from 'yaml'

import { reconcileArduinoCliConfig } from '../arduino-cli-config'
import { ARDUINO_DATA } from '../types'

/**
 * The config every install created before this change: two board-manager URLs
 * and the colour suppression the console no longer needs.
 */
const LEGACY_CONFIG = `
board_manager:
  additional_urls:
      - https://arduino.esp8266.com/stable/package_esp8266com_index.json
      - https://espressif.github.io/arduino-esp32/package_esp32_index.json
output:
  no_color: true
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Board-manager URLs in a YAML document, without asserting its shape. */
function urlsOf(yaml: string): string[] {
  const parsed: unknown = parse(yaml)
  if (!isRecord(parsed) || !isRecord(parsed.board_manager)) return []
  const urls = parsed.board_manager.additional_urls
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === 'string') : []
}

/**
 * The reconciled config, failing the test if nothing changed.
 *
 * `reconcileArduinoCliConfig` returns `null` for "already up to date", which
 * is a real outcome worth asserting on separately -- so a test that expects a
 * rewrite says so here rather than casting the null away and failing later
 * with a confusing message.
 */
function requireUpdated(result: string | null): string {
  if (result === null) throw new Error('expected the config to be rewritten, but it needed no changes')
  return result
}

describe('reconcileArduinoCliConfig', () => {
  // ---------------------------------------------------------------------
  // The upgrade path that matters: an install that already has no_color.
  // ---------------------------------------------------------------------
  it('drops output.no_color from a legacy config', () => {
    const updated = reconcileArduinoCliConfig(LEGACY_CONFIG, ARDUINO_DATA)
    expect(updated).not.toBeNull()
    expect(updated).not.toContain('no_color')
    // The whole `output` map existed only to hold it.
    expect(updated).not.toContain('output:')
  })

  it('backfills the board manager URLs the legacy config never received', () => {
    const updated = reconcileArduinoCliConfig(LEGACY_CONFIG, ARDUINO_DATA)
    const result = urlsOf(requireUpdated(updated))
    for (const url of urlsOf(ARDUINO_DATA)) expect(result).toContain(url)
  })

  it('produces a config that still parses as valid YAML', () => {
    const updated = requireUpdated(reconcileArduinoCliConfig(LEGACY_CONFIG, ARDUINO_DATA))
    expect(() => parse(updated)).not.toThrow()
    expect(parse(updated)).toMatchObject({ board_manager: { additional_urls: expect.any(Array) } })
  })

  it('is idempotent — a second pass reports nothing left to do', () => {
    const once = requireUpdated(reconcileArduinoCliConfig(LEGACY_CONFIG, ARDUINO_DATA))
    expect(reconcileArduinoCliConfig(once, ARDUINO_DATA)).toBeNull()
  })

  // ---------------------------------------------------------------------
  // Don't destroy what the user put there.
  // ---------------------------------------------------------------------
  it('keeps user-added URLs that the editor does not ship', () => {
    const withCustom = `
board_manager:
  additional_urls:
      - https://arduino.esp8266.com/stable/package_esp8266com_index.json
      - https://example.com/package_mine_index.json
output:
  no_color: true
`
    const updated = requireUpdated(reconcileArduinoCliConfig(withCustom, ARDUINO_DATA))
    const result = urlsOf(updated)
    expect(result).toContain('https://example.com/package_mine_index.json')
    // ...and the shipped ones still get added alongside it.
    for (const url of urlsOf(ARDUINO_DATA)) expect(result).toContain(url)
  })

  it('preserves unrelated settings and comments', () => {
    const withExtras = `# my notes\nlogging:\n  level: debug\n${LEGACY_CONFIG}`
    const updated = requireUpdated(reconcileArduinoCliConfig(withExtras, ARDUINO_DATA))
    expect(updated).toContain('# my notes')
    expect(parse(updated)).toMatchObject({ logging: { level: 'debug' } })
  })

  it('keeps an output map that still holds other keys', () => {
    const withOtherOutput = `board_manager:\n  additional_urls: []\noutput:\n  no_color: true\n  format: json\n`
    const updated = requireUpdated(reconcileArduinoCliConfig(withOtherOutput, ARDUINO_DATA))
    expect(updated).not.toContain('no_color')
    expect(parse(updated)).toMatchObject({ output: { format: 'json' } })
  })

  // ---------------------------------------------------------------------
  // No-op and failure cases.
  // ---------------------------------------------------------------------
  it('returns null when the file already matches what we ship', () => {
    expect(reconcileArduinoCliConfig(ARDUINO_DATA, ARDUINO_DATA)).toBeNull()
  })

  it('installs the shipped URL list when the key is missing entirely', () => {
    const updated = requireUpdated(reconcileArduinoCliConfig('output:\n  no_color: true\n', ARDUINO_DATA))
    expect(urlsOf(updated)).toEqual(urlsOf(ARDUINO_DATA))
  })

  // A hand-edited config can be parseable but structurally odd. yaml's nested
  // `*In()` helpers throw on a scalar parent ("Expected YAML collection at
  // board_manager"), which would abort the whole reconciliation and silently
  // leave the user un-migrated.
  it('does not throw when board_manager is a scalar', () => {
    expect(() => reconcileArduinoCliConfig('board_manager: 5\n', ARDUINO_DATA)).not.toThrow()
  })

  it('does not throw when output is a scalar, and still backfills URLs', () => {
    const updated = reconcileArduinoCliConfig('output: "text"\n', ARDUINO_DATA)
    expect(updated).not.toBeNull()
    for (const url of urlsOf(ARDUINO_DATA)) expect(urlsOf(requireUpdated(updated))).toContain(url)
  })

  it('leaves a scalar board_manager untouched rather than guessing', () => {
    // Nothing safe to merge into a scalar: leave it for the user to fix.
    const updated = reconcileArduinoCliConfig('board_manager: 5\noutput:\n  no_color: true\n', ARDUINO_DATA)
    // The no_color retirement still happens; the URL backfill is skipped.
    expect(updated).not.toContain('no_color')
    expect(updated).toContain('board_manager: 5')
  })

  it('does not throw when additional_urls is a scalar', () => {
    expect(() => reconcileArduinoCliConfig('board_manager:\n  additional_urls: 7\n', ARDUINO_DATA)).not.toThrow()
  })

  it('leaves an unparseable config alone rather than clobbering it', () => {
    expect(reconcileArduinoCliConfig('board_manager: [oops\n  : :\n', ARDUINO_DATA)).toBeNull()
  })
})

describe('ARDUINO_DATA', () => {
  it('no longer ships the obsolete colour suppression', () => {
    // The console renders SGR colour now; forcing it off would make the
    // renderer dead code on every fresh install.
    expect(ARDUINO_DATA).not.toContain('no_color')
  })

  it('is valid YAML with a non-empty board manager list', () => {
    expect(urlsOf(ARDUINO_DATA).length).toBeGreaterThan(0)
  })
})
