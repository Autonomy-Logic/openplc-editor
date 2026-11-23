import type { HmiWidgetCatalog, HmiWidgetInfo, HmiWidgetProperty } from '../../../ports/hmi-preview-types'
import { hmiCompletions } from '../code-assist'
import { defaultHmiSettings, hmiSettingsSchema } from '../settings'

const prop = (name: string, extra: Partial<HmiWidgetProperty> = {}): HmiWidgetProperty => ({
  name,
  type: 'STRING',
  kind: 'string',
  group: 'layout',
  declaredBy: 'HmiElement',
  ...extra,
})
const widget = (name: string, base: string, props: HmiWidgetProperty[] = []): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties: [prop('Parent'), prop('PrefWidth', { type: 'REAL', kind: 'number', defaultValue: '0.0' }), ...props],
  outputs: [],
  events: [],
})
const CATALOG: HmiWidgetCatalog = {
  widgets: new Map(
    [
      widget('HmiElement', ''),
      widget('HmiVerticalStack', 'HmiStack'),
      widget('HmiHorizontalStack', 'HmiStack'),
      widget('HmiDiagram', 'HmiContainer'),
      widget('HmiSlider', 'HmiElement', [
        prop('Orientation', { type: 'HMI_DIRECTION', kind: 'enum', enumMembers: ['Auto', 'Row', 'Column'] }),
      ]),
      widget('HmiLamp', 'HmiElement', [
        prop('Blink', { type: 'BOOL', kind: 'bool', group: 'display' }),
        prop('OnColor', { type: 'UDINT', kind: 'color', group: 'display' }),
      ]),
      widget('HmiPipe', 'HmiElement', [prop('Source'), prop('Target')]),
    ].map((w) => [w.name.toUpperCase(), w]),
  ),
  colors: ['Accent', 'Danger'],
}
const SETTINGS = defaultHmiSettings()

/** Completions at the `|` of `text`. */
function at(text: string, settings = SETTINGS) {
  const offset = text.indexOf('|')
  return hmiCompletions(text.slice(0, offset) + text.slice(offset + 1), offset, CATALOG, settings)
}
const labels = (text: string) => at(text)?.map((i) => i.label) ?? null

const SCREEN = (decl: string) => `FUNCTION_BLOCK S EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack;
    Row : HmiVerticalStack := (Parent := 'Col');
    A : HmiLamp;
${decl}
  END_VAR
END_FUNCTION_BLOCK
`

describe('HMI code assist', () => {
  it('offers the properties an initializer has not set yet, as `Name := `', () => {
    const items = at(SCREEN("    L : HmiLamp := (Parent := 'Row', |"))
    expect(items?.map((i) => i.label)).toEqual(['PrefWidth', 'Blink', 'OnColor'])
    expect(items?.[0]).toMatchObject({ insertText: 'PrefWidth := ', kind: 'property', detail: 'REAL := 0.0' })
    expect(labels(SCREEN('    L : HmiLamp := (Bl|'))).toEqual(['Parent', 'PrefWidth', 'Blink', 'OnColor'])
  })

  it('offers values of enumerated, BOOL and color properties', () => {
    expect(labels(SCREEN('    S : HmiSlider := (Orientation := |'))).toEqual([
      'HMI_DIRECTION#Auto',
      'HMI_DIRECTION#Row',
      'HMI_DIRECTION#Column',
    ])
    expect(labels(SCREEN('    L : HmiLamp := (Blink := T|'))).toEqual(['TRUE', 'FALSE'])
    expect(labels(SCREEN('    L : HmiLamp := (OnColor := COLOR.|'))).toEqual(['COLOR.Accent', 'COLOR.Danger'])
    expect(labels(SCREEN('    L : HmiLamp := (PrefWidth := |'))).toEqual([])
    expect(at(SCREEN('    L : HmiLamp := (PrefWidth := 3 + |'))).toBeNull()
  })

  it('offers containers for Parent and elements for pipe ends, never the element itself', () => {
    expect(labels(SCREEN("    L : HmiLamp := (Parent := '|"))).toEqual(['Col', 'Row'])
    expect(labels(SCREEN("    Row2 : HmiVerticalStack := (Parent := 'R|"))).toEqual(['Col', 'Row'])
    expect(labels(SCREEN("    D : HmiDiagram := (Parent := 'Row');\n    L : HmiLamp := (Parent := '|"))).toEqual([
      'Col',
      'Row',
      'D',
    ])
    expect(labels(SCREEN("    P : HmiPipe := (Source := '|"))).toEqual(['Col', 'Row', 'A'])
  })

  it('offers the predefined and project themes in the theme pragma', () => {
    const settings = hmiSettingsSchema.parse({ ...SETTINGS, themes: [{ name: 'Brand', base: 'Autonomy', colors: {} }] })
    const themes = at(`{attribute 'hmi_theme' := '|`, settings)?.map((i) => i.label)
    expect(themes).toContain('Brand')
    expect(themes?.length).toBeGreaterThan(1)
  })

  it('leaves everything else to the ST language service', () => {
    expect(at(SCREEN('    L : HmiLamp;\n  END_VAR\n  L.|'))).toBeNull()
    expect(at(SCREEN('    X : INT := (|'))).toBeNull()
    expect(at(SCREEN("    L : HmiLamp := (PrefWidth := 2); (* (Parent := '| *)"))).toBeNull()
  })
})
