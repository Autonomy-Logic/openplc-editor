import { type HmiBlockModel, parseHmiBlock } from '../screen-model'

const WIDGETS = new Set(['HMILABEL', 'HMISTACK', 'HMISWITCH'])
const isWidget = (type: string): boolean => WIDGETS.has(type.toUpperCase())

function model(source: string): HmiBlockModel {
  const parsed = parseHmiBlock(source, isWidget)
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  return parsed.model
}

describe('HMI screen model', () => {
  const SCREEN = `{attribute 'hmi_theme' := 'Dark'}
FUNCTION_BLOCK Main_Screen EXTENDS HmiScreen
  VAR
    Col : HmiStack := (Gap := 4);
    A, B : HmiLabel := (Text := 'Hi', Parent := 'Col');
    Run : HmiSwitch;
    Count : INT;
  END_VAR
  VAR_INPUT Extra : HmiLabel; END_VAR
  METHOD PROTECTED OVERRIDE Layout : BOOL A.Text := Plant.Name; Layout := TRUE; END_METHOD
  Run.Value := Plant.Running;
  A.Text := GVL.Title;
  Count := Count + Plant.Ticks[1];
  B.Visible := Col.Visible;
  Col.Gap := 8;
END_FUNCTION_BLOCK`

  it('reads elements with their initializer texts, as written', () => {
    const m = model(SCREEN)
    expect(m.name).toBe('Main_Screen')
    expect(m.extends).toBe('HMISCREEN')
    expect(m.theme).toBe('Dark')
    expect(m.elements.map((e) => [e.name, e.type, Object.fromEntries(e.props)])).toEqual([
      ['Col', 'HmiStack', { GAP: '4' }],
      ['A', 'HmiLabel', { TEXT: "'Hi'", PARENT: "'Col'" }],
      ['B', 'HmiLabel', { TEXT: "'Hi'", PARENT: "'Col'" }],
      ['Run', 'HmiSwitch', {}],
    ])
    expect(m.methods).toEqual(new Set(['LAYOUT']))
  })

  it('reads bindings of a variable to an element property, and references outside the block', () => {
    const m = model(SCREEN)
    expect(m.bindings).toEqual([
      { element: 'Run', property: 'Value', variable: 'Plant.Running' },
      { element: 'A', property: 'Text', variable: 'GVL.Title' },
      { element: 'B', property: 'Visible', variable: 'Col.Visible' },
    ])
    expect(m.references).toEqual(new Set(['PLANT.NAME', 'PLANT.RUNNING', 'GVL.TITLE', 'PLANT.TICKS']))
  })

  it('puts generated methods after the declarations, before methods and body', () => {
    const m = model(SCREEN)
    expect(SCREEN.slice(m.insertAt - 7, m.insertAt)).toBe('END_VAR')
    expect(SCREEN.slice(m.insertAt).trimStart().startsWith('METHOD')).toBe(true)
    const noVars = 'FUNCTION_BLOCK S EXTENDS HmiScreen\n  METHOD M : BOOL M := TRUE; END_METHOD\nEND_FUNCTION_BLOCK'
    expect(noVars.slice(model(noVars).insertAt).startsWith('METHOD M')).toBe(true)
    const bodyOnly = 'FUNCTION_BLOCK S EXTENDS HmiScreen\n  X.Y := 1;\nEND_FUNCTION_BLOCK'
    expect(bodyOnly.slice(model(bodyOnly).insertAt).startsWith('X.Y')).toBe(true)
    const empty = 'FUNCTION_BLOCK S EXTENDS HmiScreen\nEND_FUNCTION_BLOCK'
    expect(empty.slice(model(empty).insertAt)).toBe('END_FUNCTION_BLOCK')
  })

  it('keeps offsets right with Windows line ends and tabs', () => {
    const source = SCREEN.replace(/\n/g, '\r\n').replace(/  /g, '\t')
    const m = model(source)
    expect(source.slice(m.insertAt - 7, m.insertAt)).toBe('END_VAR')
    expect(m.elements[1].props.get('PARENT')).toBe("'Col'")
  })

  it('refuses a file that does not declare exactly one function block', () => {
    expect(parseHmiBlock('FUNCTION_BLOCK A END_FUNCTION_BLOCK FUNCTION_BLOCK B END_FUNCTION_BLOCK', isWidget)).toEqual({
      ok: false,
      errors: ['the file must declare exactly one FUNCTION_BLOCK and nothing else'],
    })
    expect(parseHmiBlock('PROGRAM P END_PROGRAM', isWidget)).toMatchObject({ ok: false })
    const broken = parseHmiBlock('FUNCTION_BLOCK A\n  VAR x : ; END_VAR\nEND_FUNCTION_BLOCK', isWidget)
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.errors[0]).toMatch(/^line 2: /)
  })
})
