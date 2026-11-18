import type { LibraryFBEntry, LibraryManifest, StlibArchive } from 'strucpp'

import { loadStrucpp } from '../../../library/strucpp-runtime'
import { buildStandardWidgets } from '../build-standard-widgets'
import { buildWidgetCatalog, type HmiWidgetInfo } from '../widget-catalog'

function standardWidgets(): StlibArchive {
  const build = buildStandardWidgets()
  if (!build.ok) throw new Error(build.errors.map((e) => e.message).join('\n'))
  return build.archive
}

function widget(info: ReadonlyMap<string, HmiWidgetInfo>, name: string): HmiWidgetInfo {
  const found = info.get(name.toUpperCase())
  if (!found) throw new Error(`no widget ${name}`)
  return found
}

function fb(name: string, extra: Partial<LibraryFBEntry> = {}): LibraryFBEntry {
  return { name, inputs: [], outputs: [], inouts: [], ...extra }
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
  const catalog = buildWidgetCatalog([standardWidgets().manifest])

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
      HmiPump: 'Process',
      HmiFan: 'Process',
      HmiConveyor: 'Process',
      HmiValve: 'Process',
      HmiPipe: 'Process',
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
    expect(widget(catalog.widgets, 'HmiRect').main).toBeUndefined()
    expect(widget(catalog.widgets, 'HmiDiagram').outputs).toEqual(
      expect.arrayContaining([{ name: 'ScalePct', type: 'DINT' }]),
    )
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
    const both = buildWidgetCatalog([lib.manifest, project.archive.manifest])
    const badge = widget(both.widgets, 'Badge')
    expect(badge).toMatchObject({ library: 'project-widgets', extends: 'HMILAMP', main: { name: 'Value' } })
    expect(badge.palette).toBeUndefined()
    expect(badge.properties.at(-1)).toMatchObject({ name: 'Blink', declaredBy: 'Badge' })
    expect(both.widgets.has('HELPER')).toBe(false)
  })

  it('leaves out blocks whose base is missing or circular, and abstract ones', () => {
    const odd = buildWidgetCatalog([
      manifest('m', [
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
})
