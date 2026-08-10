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

function urlsOf(yaml: string): string[] {
  return (parse(yaml) as { board_manager?: { additional_urls?: string[] } })?.board_manager?.additional_urls ?? []
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
    const result = urlsOf(updated as string)
    for (const url of urlsOf(ARDUINO_DATA)) expect(result).toContain(url)
  })

  it('produces a config that still parses as valid YAML', () => {
    const updated = reconcileArduinoCliConfig(LEGACY_CONFIG, ARDUINO_DATA) as string
    expect(() => parse(updated)).not.toThrow()
    expect(parse(updated)).toMatchObject({ board_manager: { additional_urls: expect.any(Array) } })
  })

  it('is idempotent — a second pass reports nothing left to do', () => {
    const once = reconcileArduinoCliConfig(LEGACY_CONFIG, ARDUINO_DATA) as string
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
    const updated = reconcileArduinoCliConfig(withCustom, ARDUINO_DATA) as string
    const result = urlsOf(updated)
    expect(result).toContain('https://example.com/package_mine_index.json')
    // ...and the shipped ones still get added alongside it.
    for (const url of urlsOf(ARDUINO_DATA)) expect(result).toContain(url)
  })

  it('preserves unrelated settings and comments', () => {
    const withExtras = `# my notes\nlogging:\n  level: debug\n${LEGACY_CONFIG}`
    const updated = reconcileArduinoCliConfig(withExtras, ARDUINO_DATA) as string
    expect(updated).toContain('# my notes')
    expect(parse(updated)).toMatchObject({ logging: { level: 'debug' } })
  })

  it('keeps an output map that still holds other keys', () => {
    const withOtherOutput = `board_manager:\n  additional_urls: []\noutput:\n  no_color: true\n  format: json\n`
    const updated = reconcileArduinoCliConfig(withOtherOutput, ARDUINO_DATA) as string
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
    const updated = reconcileArduinoCliConfig('output:\n  no_color: true\n', ARDUINO_DATA) as string
    expect(urlsOf(updated)).toEqual(urlsOf(ARDUINO_DATA))
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
