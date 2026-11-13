import {
  classifyHmiPath,
  HMI_SETTINGS_PATH,
  hmiScreenPath,
  hmiWidgetPath,
  newHmiScreenSource,
  newHmiWidgetSource,
  readHmiFiles,
  serializeHmiSettings,
  sortHmiFiles,
  writeHmiFiles,
} from '../project-files'
import { defaultHmiSettings, hmiSettingsSchema } from '../settings'

describe('HMI project files', () => {
  it('names screens, widget blocks and settings by path, on any platform separator', () => {
    expect(hmiScreenPath('Overview')).toBe('hmi/Overview.st')
    expect(hmiWidgetPath('Badge')).toBe('hmi/widgets/Badge.st')
    expect(classifyHmiPath('hmi/Overview.st')).toEqual({ kind: 'screen', name: 'Overview' })
    expect(classifyHmiPath('hmi\\widgets\\Badge.st')).toEqual({ kind: 'widget', name: 'Badge' })
    expect(classifyHmiPath(HMI_SETTINGS_PATH)).toEqual({ kind: 'settings' })
    for (const path of [
      'hmi/1st.st',
      'hmi/a b.st',
      'hmi/x.json',
      'hmi/widgets/deep/x.st',
      'hmi/../x.st',
      'pous/x.st',
      'hmi/x.txt',
    ])
      expect(classifyHmiPath(path)).toBeUndefined()
  })

  it('reads no HMI from a project without HMI files', () => {
    expect(readHmiFiles([])).toEqual({ warnings: [] })
  })

  it('reads screens in project order, widget blocks and settings', () => {
    const settings = hmiSettingsSchema.parse({ startScreen: 'beta', framePeriodMs: 50 })
    const { hmi, warnings } = readHmiFiles([
      { relativePath: 'hmi/beta.st', content: 'B' },
      { relativePath: 'hmi/Alpha.st', content: 'A' },
      { relativePath: 'hmi/widgets/Lamp2.st', content: 'L' },
      { relativePath: HMI_SETTINGS_PATH, content: serializeHmiSettings(settings) },
      { relativePath: 'hmi/notes.txt', content: '?' },
    ])
    expect(warnings).toEqual(['hmi/notes.txt: not an HMI file; it is left as it is'])
    expect(hmi?.screens.map((s) => s.name)).toEqual(['Alpha', 'beta'])
    expect(hmi?.widgets).toEqual([{ name: 'Lamp2', source: 'L' }])
    expect(hmi?.settings).toEqual(settings)
    expect(hmi?.unparsedSettings).toBeUndefined()
  })

  it('keeps a settings file that does not validate, with defaults in its place, and writes it back unchanged', () => {
    for (const [text, reason] of [
      ['{ nope', 'it is not JSON'],
      ['{"framePeriodMs": 5}', 'framePeriodMs:'],
    ] as const) {
      const { hmi, warnings } = readHmiFiles([{ relativePath: HMI_SETTINGS_PATH, content: text }])
      expect(hmi?.settings).toEqual(defaultHmiSettings())
      expect(hmi?.unparsedSettings).toBe(text)
      expect(warnings[0]).toContain(reason)
      expect(writeHmiFiles(hmi)).toEqual([{ relativePath: HMI_SETTINGS_PATH, content: text }])
    }
  })

  it('writes every file back, settings created with the HMI', () => {
    const hmi = {
      screens: [{ name: 'Main', source: 'S' }],
      widgets: [{ name: 'W', source: 'X' }],
      settings: defaultHmiSettings(),
    }
    expect(writeHmiFiles(hmi)).toEqual([
      { relativePath: 'hmi/Main.st', content: 'S' },
      { relativePath: 'hmi/widgets/W.st', content: 'X' },
      { relativePath: HMI_SETTINGS_PATH, content: serializeHmiSettings(defaultHmiSettings()) },
    ])
    expect(writeHmiFiles(undefined)).toEqual([])
    expect(readHmiFiles(writeHmiFiles(hmi)).hmi).toEqual(hmi)
  })

  it('orders names alphabetically, ignoring case', () => {
    expect(sortHmiFiles([{ name: 'b' }, { name: 'A' }, { name: 'a' }, { name: 'C' }]).map((f) => f.name)).toEqual([
      'A',
      'a',
      'b',
      'C',
    ])
  })

  it('starts a screen and a widget block from templates named after them', () => {
    expect(newHmiScreenSource('Main')).toMatch(/^FUNCTION_BLOCK Main EXTENDS HmiScreen\n/)
    expect(newHmiWidgetSource('Gauge2')).toMatch(/^FUNCTION_BLOCK Gauge2 EXTENDS HmiElement\n/)
  })
})
