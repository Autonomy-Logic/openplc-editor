import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LibraryFBEntry, LibraryManifest, StlibArchive } from 'strucpp'

import { loadStrucpp } from '../../../library/strucpp-runtime'
import { installedArchiveText, installedWidgetArchives } from '../../unit/__tests__/fixtures/widget-libraries'
import { compileHmiWidgets } from '../../unit/generate-hmi-unit'
import { buildWidgetCatalog, type HmiWidgetInfo } from '../widget-catalog'
import { loadHmiWidgetLibraries } from '../widget-libraries'

/** The pre-installed standard-widgets archive, loaded as every consumer loads it. */
function standardWidgets(): StlibArchive {
  return loadStrucpp().loadStlibFromString(installedArchiveText('standard-widgets'), 'standard-widgets')
}

function widget(info: ReadonlyMap<string, HmiWidgetInfo>, name: string): HmiWidgetInfo {
  const found = info.get(name.toUpperCase())
  if (!found) throw new Error(`no widget ${name}`)
  return found
}

function fb(name: string, extra: Partial<LibraryFBEntry> = {}): LibraryFBEntry {
  return { name, inputs: [], outputs: [], inouts: [], ...extra }
}

function archive(name: string, functionBlocks: LibraryFBEntry[]): StlibArchive {
  return { formatVersion: 1, manifest: manifest(name, functionBlocks), chunks: [], dependencies: [] }
}

function manifest(name: string, functionBlocks: LibraryFBEntry[]): LibraryManifest {
  return {
    name,
    version: '1.0.0',
    namespace: name,
    functions: [],
    functionBlocks,
    types: [],
    headers: [],
    isBuiltin: false,
  }
}

describe('widget catalogue', () => {
  const catalog = buildWidgetCatalog([standardWidgets()])

  it('lists the library widgets with their palette group, and nothing that is not a widget', () => {
    const palette = Object.fromEntries([...catalog.widgets.values()].map((w) => [w.name, w.palette]))
    expect(palette).toEqual({
      HmiVerticalStack: 'Containers',
      HmiHorizontalStack: 'Containers',
      HmiDiagram: 'Containers',
      HmiRect: 'Shapes',
      HmiEllipse: 'Shapes',
      HmiPolygon: 'Shapes',
      HmiLine: 'Shapes',
      HmiLabel: 'Display',
      HmiValue: 'Display',
      HmiLamp: 'Display',
      HmiGauge: 'Display',
      HmiTank: 'Display',
      HmiTrend: 'Display',
      HmiReadout: 'Display',
      HmiVessel: 'Display',
      HmiMultiLamp: 'Display',
      HmiBarGraph: 'Display',
      HmiProgress: 'Display',
      HmiLed: 'Display',
      HmiSevenSegment: 'Display',
      HmiThermometer: 'Display',
      HmiDateTime: 'Display',
      HmiClock: 'Display',
      HmiButton: 'Controls',
      HmiSwitch: 'Controls',
      HmiSlider: 'Controls',
      HmiNumericInput: 'Controls',
      HmiTextInput: 'Controls',
      HmiToggleButton: 'Controls',
      HmiLampButton: 'Controls',
      HmiSelector: 'Controls',
      HmiOptionButtons: 'Controls',
      HmiDropDown: 'Controls',
      HmiStepper: 'Controls',
      HmiKnob: 'Controls',
      HmiCheckBox: 'Controls',
      HmiPump: 'Process',
      HmiFan: 'Process',
      HmiConveyor: 'Process',
      HmiValve: 'Process',
      HmiMotor: 'Process',
      HmiAgitator: 'Process',
      HmiControlValve: 'Process',
      HmiCheckValve: 'Process',
      HmiThreeWayValve: 'Process',
      HmiHeatExchanger: 'Process',
      HmiSilo: 'Process',
      HmiInstrument: 'Process',
      HmiPipe: 'Process',
      HmiAlarmBanner: 'Alarms',
      HmiAlarmList: 'Alarms',
      HmiEventLog: 'Alarms',
      HmiXYPlot: 'Data',
      HmiDataTable: 'Data',
      HmiDialog: 'Controls',
    })
    expect(widget(catalog.widgets, 'HmiDiagram').extends).toBe('HMICONTAINER')
    expect(widget(catalog.widgets, 'HmiVerticalStack').extends).toBe('HMISTACK')
    expect(widget(catalog.widgets, 'HmiHorizontalStack').extends).toBe('HMISTACK')
  })

  it('gives both stacks the container and stack properties, and no direction', () => {
    for (const name of ['HmiVerticalStack', 'HmiHorizontalStack']) {
      const own = widget(catalog.widgets, name).properties.filter(
        (p) => p.group !== 'layout' && p.declaredBy !== 'HmiElement',
      )
      expect(own.map((p) => [p.name, p.declaredBy])).toEqual([
        ['Fill', 'HmiContainer'],
        ['Gap', 'HmiStack'],
        ['Padding', 'HmiStack'],
      ])
    }
  })

  it('lists the trend series: the value and colour of each, and the count', () => {
    const trend = widget(catalog.widgets, 'HmiTrend')
    expect(trend.series).toEqual({
      count: 'Pens',
      values: ['Value', 'Value2', 'Value3', 'Value4', 'Value5', 'Value6', 'Value7', 'Value8'],
      colors: ['AccentColor', 'Color2', 'Color3', 'Color4', 'Color5', 'Color6', 'Color7', 'Color8'],
    })
    expect(trend.main?.name).toBe('Value')
    expect(widget(catalog.widgets, 'HmiLabel').series).toBeUndefined()
  })

  it("starts containers, shapes, the gauge and the trend growing, from the type's own default", () => {
    for (const name of ['HmiVerticalStack', 'HmiHorizontalStack', 'HmiDiagram', 'HmiRect', 'HmiGauge', 'HmiTrend']) {
      const info = widget(catalog.widgets, name)
      expect(info.typeDefaults).toEqual([{ name: 'GrowAuto', value: 'TRUE' }])
      expect(info.properties.find((p) => p.name === 'GrowAuto')?.defaultValue).toBe('TRUE')
    }
    for (const name of ['HmiButton', 'HmiValue', 'HmiLamp', 'HmiTank'])
      expect(widget(catalog.widgets, name).properties.find((p) => p.name === 'GrowAuto')?.defaultValue).toBe('FALSE')
  })

  it('gives every widget the inherited properties first, with kind, group and default', () => {
    const label = widget(catalog.widgets, 'HmiLabel')
    expect(label.properties.map((p) => p.name)).toEqual([
      'Parent',
      'PrefWidth',
      'PrefHeight',
      'MinWidth',
      'MaxWidth',
      'MinHeight',
      'MaxHeight',
      'GrowAuto',
      'GrowScale',
      'Floating',
      'X',
      'Y',
      'Visible',
      'Enabled',
      'Text',
      'Size',
      'Font',
      'TextColor',
      'Align',
    ])
    const prop = (name: string) => label.properties.find((p) => p.name === name)
    expect(prop('Parent')).toMatchObject({
      kind: 'elementRef',
      group: 'layout',
      declaredBy: 'HmiElement',
      maxLength: 64,
    })
    expect(prop('GrowAuto')).toMatchObject({ kind: 'bool', group: 'layout', defaultValue: 'FALSE' })
    expect(prop('GrowScale')).toMatchObject({
      kind: 'number',
      group: 'layout',
      defaultValue: '1',
      enabledBy: 'GrowAuto',
    })
    expect(label.typeDefaults).toBeUndefined()
    expect(label.properties.some((p) => p.previewValue !== undefined)).toBe(false)
    expect(widget(catalog.widgets, 'HmiDropDown').properties.find((p) => p.name === 'Value')?.previewValue).toBe('0')
    expect(prop('Visible')).toMatchObject({ kind: 'bool', group: 'display', defaultValue: 'TRUE' })
    expect(prop('Text')).toMatchObject({
      kind: 'string',
      group: 'data',
      defaultValue: "'Label'",
      maxLength: 64,
      declaredBy: 'HmiLabel',
    })
    expect(prop('Size')).toMatchObject({ kind: 'number', group: 'display', defaultValue: '16' })
    expect(prop('Font')).toMatchObject({
      kind: 'enum',
      type: 'HMI_FONT',
      enumMembers: ['Regular', 'Bold'],
      defaultValue: 'HMI_FONT#Regular',
    })
    expect(prop('TextColor')).toMatchObject({ kind: 'color', defaultValue: 'COLOR.Text' })
    expect(widget(catalog.widgets, 'HmiPipe').properties.find((p) => p.name === 'Source')).toMatchObject({
      kind: 'elementRef',
      group: 'layout',
    })
    expect(widget(catalog.widgets, 'HmiTrend').properties.find((p) => p.name === 'Value2')).toMatchObject({
      group: 'data',
    })
  })

  it('reads the main binding, the two-way pair and the events', () => {
    expect(widget(catalog.widgets, 'HmiSwitch')).toMatchObject({
      main: { name: 'Value', direction: 'input', type: 'BOOL' },
      twoWay: { value: 'Value', changed: 'Changed', newValue: 'NewValue' },
      events: ['Clicked'],
    })
    expect(widget(catalog.widgets, 'HmiNumericInput')).toMatchObject({
      main: { name: 'Value', type: 'REAL' },
      twoWay: { value: 'Value' },
    })
    const button = widget(catalog.widgets, 'HmiButton')
    expect(button.main).toEqual({ name: 'Pressed', direction: 'output', type: 'BOOL' })
    expect(button.twoWay).toBeUndefined()
    expect(button.momentary).toEqual({ value: 'Pressed', changed: 'Changed' })
    expect(button.events).toEqual(['Clicked'])
    expect(widget(catalog.widgets, 'HmiLamp')).toMatchObject({ main: { name: 'Value' }, events: [] })
    expect(widget(catalog.widgets, 'HmiLamp').twoWay).toBeUndefined()
    expect(widget(catalog.widgets, 'HmiSlider').momentary).toBeUndefined()
    expect(widget(catalog.widgets, 'HmiSwitch').twoWay?.range).toBeUndefined()
    for (const name of ['HmiSlider', 'HmiKnob', 'HmiStepper', 'HmiNumericInput'])
      expect(widget(catalog.widgets, name).twoWay?.range).toBe('MinValue..MaxValue')
    expect(widget(catalog.widgets, 'HmiSelector').twoWay?.range).toBe('0..2')
    for (const name of ['HmiOptionButtons', 'HmiDropDown'])
      expect(widget(catalog.widgets, name).twoWay?.range).toBe('0..last(Options)')
    expect(widget(catalog.widgets, 'HmiTextInput').twoWay?.maxLength).toBe('MaxLength')
    const numeric = widget(catalog.widgets, 'HmiNumericInput').properties
    expect(numeric.find((p) => p.name === 'MinValue')?.defaultValue).toBe('-1.0E38')
    expect(numeric.find((p) => p.name === 'MaxValue')?.defaultValue).toBe('1.0E38')
    expect(widget(catalog.widgets, 'HmiRect').main).toBeUndefined()
    expect(widget(catalog.widgets, 'HmiDiagram').outputs).toEqual(
      expect.arrayContaining([{ name: 'ScalePct', type: 'DINT' }]),
    )
  })

  it('equals the catalogue openplc-hmi-widgets 1.0.0 embedded for the standard widgets', () => {
    const previous: unknown = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'standard-widgets.catalog.json'), 'utf8'),
    )
    expect(previous).toEqual({ widgets: expect.any(Array), colors: expect.any(Array) })
    const shape = (widgets: Iterable<HmiWidgetInfo>) =>
      Object.fromEntries([...widgets].map((w) => [w.name.toUpperCase(), w]))
    const embedded = typeof previous === 'object' && previous !== null && 'widgets' in previous ? previous : null
    expect(shape(catalog.widgets.values())).toEqual(
      Object.fromEntries(
        (Array.isArray(embedded?.widgets) ? embedded.widgets : []).map((w: { name: string }) => [
          w.name.toUpperCase(),
          w,
        ]),
      ),
    )
    expect(catalog.colors).toEqual(embedded !== null && 'colors' in embedded ? embedded.colors : null)
  })

  it('is the catalogue HMI builds derive from every installed library', () => {
    const loaded = loadHmiWidgetLibraries(installedWidgetArchives())
    expect(loaded.libraries.map((l) => l.name)).toEqual(['hmi-alarms', 'standard-widgets'])
    expect([...loaded.catalog.widgets.entries()]).toEqual([...catalog.widgets.entries()])
    expect(loaded.catalog.colors).toEqual(catalog.colors)
  })

  it('names the COLOR constant fields, theme colors first', () => {
    expect(catalog.colors.slice(0, 3)).toEqual(['Background', 'Surface', 'Text'])
    expect(catalog.colors).toContain('Transparent')
    expect(catalog.colors).toHaveLength(22)
  })

  it('adds project widget blocks compiled against the library, without a palette group of their own', () => {
    const lib = standardWidgets()
    const project = loadStrucpp().compileStlib(
      [
        {
          fileName: 'badge.st',
          source: `FUNCTION_BLOCK Badge EXTENDS HmiLamp
  VAR_INPUT Blink : BOOL; END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK Helper VAR_INPUT X : INT; END_VAR END_FUNCTION_BLOCK`,
        },
      ],
      { name: 'project-widgets', version: '1.0.0', namespace: 'project_widgets', dependencies: [lib] },
    )
    expect(project.errors).toEqual([])
    const both = buildWidgetCatalog([lib, project.archive])
    const badge = widget(both.widgets, 'Badge')
    expect(badge).toMatchObject({ library: 'project-widgets', extends: 'HMILAMP', main: { name: 'Value' } })
    expect(badge.palette).toBeUndefined()
    expect(badge.properties.at(-1)).toMatchObject({ name: 'Blink', declaredBy: 'Badge' })
    expect(both.widgets.has('HELPER')).toBe(false)
  })

  it('leaves out blocks whose base is missing or circular, and abstract ones', () => {
    const odd = buildWidgetCatalog([
      archive('m', [
        fb('HMIELEMENT', { isAbstract: true }),
        fb('ABSTRACTWIDGET', { extends: 'HMIELEMENT', isAbstract: true }),
        fb('ORPHAN', { extends: 'MISSING' }),
        fb('LOOPA', { extends: 'LOOPB' }),
        fb('LOOPB', { extends: 'LOOPA' }),
        fb('PLAIN', {
          extends: 'HMIELEMENT',
          inputs: [{ name: 'P', type: 'POINT', attributes: [{ name: 'hmi_group', value: 'nonsense' }] }],
          outputs: [
            { name: 'CHANGED', type: 'BOOL' },
            { name: 'NEWVALUE', type: 'INT' },
          ],
        }),
      ]),
    ])
    expect([...odd.widgets.keys()]).toEqual(['PLAIN'])
    const plain = widget(odd.widgets, 'PLAIN')
    expect(plain.properties).toEqual([
      { name: 'P', type: 'POINT', kind: 'other', group: 'display', declaredBy: 'PLAIN' },
    ])
    expect(plain.twoWay).toBeUndefined()
    expect(plain.events).toEqual([])
    expect(odd.colors).toEqual([])
  })

  it('names the capability a widget needs and the PLC data its source inputs take, in feed order', () => {
    expect(widget(catalog.widgets, 'HmiAlarmList').requires).toBe('hmiDataWidgets')
    expect(widget(catalog.widgets, 'HmiEventLog').requires).toBe('hmiDataWidgets')
    for (const name of ['HmiAlarmBanner', 'HmiXYPlot', 'HmiDataTable', 'HmiDialog', 'HmiTrend'])
      expect(widget(catalog.widgets, name).requires).toBeUndefined()
    expect(widget(catalog.widgets, 'HmiAlarmList').sources).toEqual([
      { name: 'Source', type: 'ARRAY OF HMI_ALARM_ROW', slot: 0 },
      { name: 'Service', type: 'HMI_ALARM_SUMMARY', slot: 1 },
    ])
    expect(widget(catalog.widgets, 'HmiAlarmBanner').sources).toEqual([
      { name: 'Source', type: 'HMI_ALARM_SUMMARY', slot: 0 },
    ])
    expect(widget(catalog.widgets, 'HmiEventLog').sources).toEqual([
      { name: 'Source', type: 'ARRAY OF HMI_EVENT_ROW', slot: 0 },
    ])
    expect(widget(catalog.widgets, 'HmiXYPlot').sources?.map((s) => `${s.slot}:${s.name}`)).toEqual([
      '0:XSource',
      '1:YSource',
      '2:X2Source',
      '3:Y2Source',
      '4:X3Source',
      '5:Y3Source',
      '6:X4Source',
      '7:Y4Source',
    ])
    expect(widget(catalog.widgets, 'HmiDataTable').series).toEqual({
      count: 'Rows',
      values: ['Value', 'Value2', 'Value3', 'Value4', 'Value5', 'Value6', 'Value7', 'Value8'],
      colors: ['Status', 'Status2', 'Status3', 'Status4', 'Status5', 'Status6', 'Status7', 'Status8'],
    })
    expect(widget(catalog.widgets, 'HmiDialog').main).toEqual({ name: 'Open', direction: 'input', type: 'BOOL' })
    expect(widget(catalog.widgets, 'HmiDialog').events).toContain('Answered')
    expect(widget(catalog.widgets, 'HmiTrend').extends).toBe('HMIPLOTBASE')
  })

  it('reads hmi_requires and hmi_source from a project widget block', () => {
    const lib = compileHmiWidgets(
      [
        {
          name: 'Gauge2',
          source: `{attribute 'hmi_requires' := 'hmiDataWidgets'}
FUNCTION_BLOCK Gauge2 EXTENDS HmiDataElement
  VAR_INPUT
    {attribute 'hmi_source' := 'array of   real'}
    Data : STRING(96);
  END_VAR
END_FUNCTION_BLOCK
`,
        },
      ],
      loadHmiWidgetLibraries(installedWidgetArchives()).libraries,
      loadHmiWidgetLibraries(installedWidgetArchives()).catalog,
    )
    expect(lib.errors).toEqual([])
    const info = widget(lib.catalog.widgets, 'Gauge2')
    expect(info.requires).toBe('hmiDataWidgets')
    expect(info.sources).toEqual([{ name: 'Data', type: 'ARRAY OF REAL', slot: 0 }])
  })
})
