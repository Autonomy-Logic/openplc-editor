import { sampleProject } from '../../../../../../backend/shared/hmi/unit/__tests__/fixtures/sample-project'
import { generateHmiUnit } from '../../../../../../backend/shared/hmi/unit/generate-hmi-unit'
import { copyElements, parseDesignerClipboard, pasteElements } from '../designer-clipboard'
import {
  addElement,
  deleteElements,
  type DesignerEdit,
  moveElement,
  nextElementName,
  removeProperty,
  renameElement,
  setBinding,
  setEvent,
  setProperty,
  setTheme,
  stString,
} from '../designer-edits'
import { emptyHistory, recordStep, redoStep, type SourceHistory, undoStep } from '../../source-history'
import { type DesignerModel, parseDesignerBlock, stringLiteralValue } from '../designer-model'

const isWidget = (type: string): boolean => /^(Hmi[A-Za-z]+|Badge)$/i.test(type)

const SCREEN = `{attribute 'hmi_theme' := 'Brand'}
FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    (* the main column *)
    Col : HmiStack := (Direction := HMI_DIRECTION#Column, Gap := 8);
    Level : HmiTank := (Caption := 'Level', Parent := 'Col', MaxValue := 10.0); (* fill level *)
    Run : HmiSwitch := (Parent := 'Col');
    Next : HmiButton;
    Count : INT;
  END_VAR
  METHOD Busy : BOOL
    (* kept as written *)
    Busy := Count > 3;
  END_METHOD
  Level.Value := Main.Level;
  Run.Value := Main.Running;
  IF Next.Clicked THEN
    HMI_Show(HMI_SCREEN#Details);
  END_IF;
  Count := Count + 1;
END_FUNCTION_BLOCK
`

function parse(source: string): DesignerModel {
  const parsed = parseDesignerBlock(source, isWidget)
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => `${e.line}: ${e.message}`).join('\n'))
  return parsed.model
}

function edited(result: DesignerEdit): string {
  if (!result.ok) throw new Error(result.message)
  return result.source
}

/** The sample project with Overview replaced, built by the HMI generator; returns its errors. */
function buildErrors(overview: string): string[] {
  const project = sampleProject()
  const result = generateHmiUnit({
    ...project,
    screens: [{ name: 'Overview', source: overview }, project.screens[1]],
  })
  return result.errors.map((e) => `${e.file}:${e.line ?? ''} ${e.message}`)
}

describe('designer model', () => {
  const model = parse(SCREEN)

  it('reads the elements in declaration order with their parents and properties as written', () => {
    expect(model.name).toBe('Overview')
    expect(model.theme).toBe('Brand')
    expect(model.elements.map((e) => [e.name, e.type, e.parent])).toEqual([
      ['Col', 'HmiStack', null],
      ['Level', 'HmiTank', 'Col'],
      ['Run', 'HmiSwitch', 'Col'],
      ['Next', 'HmiButton', null],
    ])
    expect(model.elements[1].props.map((p) => [p.name, p.value])).toEqual([
      ['Caption', "'Level'"],
      ['Parent', "'Col'"],
      ['MaxValue', '10.0'],
    ])
    expect(model.members.has('COUNT')).toBe(true)
    expect(model.members.has('BUSY')).toBe(true)
  })

  it('reads the bindings and event handlers of the body', () => {
    expect(model.bindings.map((b) => [b.element, b.property, b.variable])).toEqual([
      ['Level', 'Value', 'Main.Level'],
      ['Run', 'Value', 'Main.Running'],
    ])
    expect(model.events).toEqual([
      expect.objectContaining({ element: 'Next', event: 'Clicked', code: 'HMI_Show(HMI_SCREEN#Details);' }),
    ])
  })

  it('leaves an element declared with others, or with a value that is not a property list, to the code view', () => {
    const shared = parse(
      'FUNCTION_BLOCK S EXTENDS HmiScreen\n  VAR\n    A, B : HmiLabel;\n    C : HmiLabel := D;\n    D : HmiLabel;\n  END_VAR\nEND_FUNCTION_BLOCK\n',
    )
    expect(shared.elements.map((e) => [e.name, e.locked !== null])).toEqual([
      ['A', true],
      ['B', true],
      ['C', true],
      ['D', false],
    ])
    expect(setProperty('', shared, 'A', 'Text', "'x'")).toEqual({
      ok: false,
      message: 'A is edited in the code view: declared together with other names; give it a declaration of its own',
    })
  })

  it('reports code that does not parse, and a file that is not one function block', () => {
    const broken = parseDesignerBlock('FUNCTION_BLOCK S EXTENDS HmiScreen\n  VAR\n    A : HmiLabel\n', isWidget)
    expect(broken.ok).toBe(false)
    const two = parseDesignerBlock('FUNCTION_BLOCK A END_FUNCTION_BLOCK\nFUNCTION_BLOCK B END_FUNCTION_BLOCK', isWidget)
    expect(two).toEqual({
      ok: false,
      errors: [{ line: 1, message: 'the file must declare exactly one FUNCTION_BLOCK and nothing else' }],
    })
  })

  it('reads string literals', () => {
    expect(stringLiteralValue("'It$'s'")).toBe("It's")
    expect(stringLiteralValue('Col')).toBeNull()
    expect(stString("It's $5")).toBe("'It$'s $$5'")
  })
})

describe('designer edits', () => {
  const model = parse(SCREEN)

  it('changes one property and nothing else, keeping methods and comments (TC01)', () => {
    const source = edited(setProperty(SCREEN, model, 'Level', 'MaxValue', '20.0'))
    expect(source).toBe(SCREEN.replace('MaxValue := 10.0', 'MaxValue := 20.0'))
    const added = edited(setProperty(SCREEN, model, 'Next', 'Text', "'Details'"))
    expect(added).toBe(SCREEN.replace('Next : HmiButton;', "Next : HmiButton := (Text := 'Details');"))
    const appended = edited(setProperty(SCREEN, model, 'Run', 'Caption', "'Run'"))
    expect(appended).toBe(
      SCREEN.replace(
        "Run : HmiSwitch := (Parent := 'Col');",
        "Run : HmiSwitch := (Parent := 'Col', Caption := 'Run');",
      ),
    )
    expect(buildErrors(appended)).toEqual([])
  })

  it('removes a property: the only one, a middle one and the last one', () => {
    expect(edited(removeProperty(SCREEN, model, 'Run', 'Parent'))).toBe(
      SCREEN.replace("Run : HmiSwitch := (Parent := 'Col');", 'Run : HmiSwitch;'),
    )
    expect(edited(removeProperty(SCREEN, model, 'Level', 'Parent'))).toContain("(Caption := 'Level', MaxValue := 10.0)")
    expect(edited(removeProperty(SCREEN, model, 'Level', 'MaxValue'))).toContain(
      "(Caption := 'Level', Parent := 'Col'); (* fill level *)",
    )
    expect(edited(removeProperty(SCREEN, model, 'Next', 'Text'))).toBe(SCREEN)
  })

  it('adds an element last in its parent, before a sibling, or on the screen, with a free name', () => {
    expect(nextElementName(model, 'Label')).toBe('Label1')
    const inCol = addElement(SCREEN, model, { type: 'HmiLabel', parent: 'Col', props: [['Text', "'Hi'"]] })
    expect(inCol.ok && inCol.name).toBe('Label1')
    const source = edited(inCol)
    expect(source).toContain(
      "    Run : HmiSwitch := (Parent := 'Col');\n    Label1 : HmiLabel := (Parent := 'Col', Text := 'Hi');\n    Next : HmiButton;",
    )
    expect(
      parse(source)
        .elements.filter((e) => e.parent === 'Col')
        .map((e) => e.name),
    ).toEqual(['Level', 'Run', 'Label1'])
    expect(buildErrors(source)).toEqual([])
    const first = edited(addElement(SCREEN, model, { type: 'HmiLamp', parent: 'Col', before: 'Level', name: 'Alarm' }))
    expect(parse(first).elements.map((e) => e.name)).toEqual(['Col', 'Alarm', 'Level', 'Run', 'Next'])
    const root = edited(addElement(SCREEN, model, { type: 'HmiLabel', parent: null }))
    expect(root).toContain('    Next : HmiButton;\n    Label1 : HmiLabel;\n    Count : INT;')
  })

  it('refuses a taken or invalid name, and a parent that is not an element', () => {
    expect(addElement(SCREEN, model, { type: 'HmiLabel', parent: null, name: 'count' })).toEqual({
      ok: false,
      message: 'Overview already has a member named count',
    })
    expect(addElement(SCREEN, model, { type: 'HmiLabel', parent: null, name: '1x' })).toEqual({
      ok: false,
      message: '1x is not a valid name',
    })
    expect(addElement(SCREEN, model, { type: 'HmiLabel', parent: 'Count' })).toEqual({
      ok: false,
      message: 'Count is not an element of Overview',
    })
  })

  it('opens a VAR block for the first element of a block that has none', () => {
    const bare = 'FUNCTION_BLOCK Info EXTENDS HmiScreen\nEND_FUNCTION_BLOCK\n'
    const source = edited(addElement(bare, parse(bare), { type: 'HmiLabel', parent: null }))
    expect(source).toBe(
      'FUNCTION_BLOCK Info EXTENDS HmiScreen\n  VAR\n    Label1 : HmiLabel;\n  END_VAR\nEND_FUNCTION_BLOCK\n',
    )
  })

  it('deletes an element with everything under it, its bindings and its handlers', () => {
    const source = edited(deleteElements(SCREEN, model, ['Col', 'Next']))
    const after = parse(source)
    expect(after.elements.map((e) => e.name)).toEqual([])
    expect(after.bindings).toEqual([])
    expect(after.events).toEqual([])
    expect(source).toContain('(* the main column *)')
    expect(source).toContain('METHOD Busy : BOOL')
    expect(source).toContain('  Count := Count + 1;')
  })

  it('moves an element to another parent and position, and refuses to move it inside itself', () => {
    const out = edited(moveElement(SCREEN, model, 'Run', null, 'Col'))
    const after = parse(out)
    expect(after.elements.map((e) => [e.name, e.parent])).toEqual([
      ['Run', null],
      ['Col', null],
      ['Level', 'Col'],
      ['Next', null],
    ])
    const intoCol = edited(moveElement(SCREEN, model, 'Next', 'Col', 'Level'))
    expect(parse(intoCol).elements.map((e) => [e.name, e.parent])).toEqual([
      ['Col', null],
      ['Next', 'Col'],
      ['Level', 'Col'],
      ['Run', 'Col'],
    ])
    expect(buildErrors(intoCol)).toEqual([])
    expect(moveElement(SCREEN, model, 'Col', 'Level', null)).toEqual({
      ok: false,
      message: 'Col cannot go inside itself',
    })
    expect(edited(moveElement(SCREEN, model, 'Run', 'Col', 'Run'))).toBe(SCREEN)
  })

  it('renames an element with the properties naming it and every use in the code', () => {
    const source = edited(renameElement(SCREEN, model, 'Col', 'Main_Col'))
    const after = parse(source)
    expect(after.elements.map((e) => [e.name, e.parent])).toEqual([
      ['Main_Col', null],
      ['Level', 'Main_Col'],
      ['Run', 'Main_Col'],
      ['Next', null],
    ])
    const button = edited(renameElement(SCREEN, model, 'Next', 'GoOn'))
    expect(parse(button).events.map((e) => e.element)).toEqual(['GoOn'])
    expect(buildErrors(button)).toEqual([])
    expect(renameElement(SCREEN, model, 'Next', 'Count').ok).toBe(false)
    expect(edited(renameElement(SCREEN, model, 'next', 'Next'))).toBe(SCREEN)
  })

  it('binds, rebinds and unbinds a property', () => {
    const bound = edited(setBinding(SCREEN, model, 'Next', 'Visible', 'GVL.Alarm'))
    expect(bound).toContain('  Count := Count + 1;\n  Next.Visible := GVL.Alarm;\nEND_FUNCTION_BLOCK')
    expect(edited(setBinding(SCREEN, model, 'Level', 'Value', 'Main.Speed'))).toContain(
      '  Level.Value := Main.Speed;\n',
    )
    const unbound = edited(setBinding(SCREEN, model, 'Run', 'Value', null))
    expect(unbound).not.toContain('Run.Value')
    expect(edited(setBinding(SCREEN, model, 'Next', 'Text', null))).toBe(SCREEN)
    expect(setBinding(SCREEN, model, 'Next', 'Text', 'oops; x := 1')).toEqual({
      ok: false,
      message: 'oops; x := 1 is not a PLC variable',
    })
  })

  it('sets, replaces and removes an event handler', () => {
    const replaced = edited(setEvent(SCREEN, model, 'Next', 'Clicked', 'HMI_Back();'))
    expect(replaced).toContain('  IF Next.Clicked THEN\n    HMI_Back();\n  END_IF;\n')
    expect(replaced).not.toContain('HMI_SCREEN#Details')
    const added = edited(setEvent(SCREEN, model, 'Run', 'Changed', 'Count := 0;\nCount := Count + 2;'))
    expect(parse(added).events.map((e) => [e.element, e.code])).toEqual([
      ['Next', 'HMI_Show(HMI_SCREEN#Details);'],
      ['Run', 'Count := 0;\n    Count := Count + 2;'],
    ])
    expect(edited(setEvent(SCREEN, model, 'Next', 'Clicked', null))).not.toContain('IF Next.Clicked')
    expect(edited(setEvent(SCREEN, model, 'Run', 'Changed', '  '))).toBe(SCREEN)
  })

  it('sets, changes and removes the theme', () => {
    expect(edited(setTheme(SCREEN, model, 'Ocean'))).toBe(SCREEN.replace("'Brand'", "'Ocean'"))
    expect(edited(setTheme(SCREEN, model, null))).toBe(SCREEN.replace("{attribute 'hmi_theme' := 'Brand'}\n", ''))
    const plain = SCREEN.replace("{attribute 'hmi_theme' := 'Brand'}\n", '')
    expect(edited(setTheme(plain, parse(plain), 'Dark'))).toBe(`{attribute 'hmi_theme' := 'Dark'}\n${plain}`)
    expect(edited(setTheme(plain, parse(plain), null))).toBe(plain)
  })
})

describe('designer clipboard', () => {
  const model = parse(SCREEN)

  it('copies an element with everything under it, its bindings and handlers', () => {
    const clip = copyElements(model, ['Col'])
    expect(clip?.elements.map((e) => [e.name, e.parent])).toEqual([
      ['Col', null],
      ['Level', 'Col'],
      ['Run', 'Col'],
    ])
    expect(clip?.bindings.map((b) => b.element)).toEqual(['Level', 'Run'])
    expect(copyElements(model, ['Nothing'])).toBeNull()
  })

  it('pastes into the same screen under fresh names, keeping the copy wired', () => {
    const clip = copyElements(model, ['Col', 'Next'])
    if (!clip) throw new Error('nothing copied')
    const result = pasteElements(SCREEN, model, clip, null)
    expect(result.ok && result.names).toEqual(['Col1', 'Level1', 'Run1', 'Next1'])
    const source = edited(result)
    const after = parse(source)
    expect(after.elements.filter((e) => e.parent === 'Col1').map((e) => e.name)).toEqual(['Level1', 'Run1'])
    expect(after.bindings.map((b) => `${b.element}.${b.property}`)).toContain('Level1.Value')
    expect(after.events.map((e) => e.element)).toEqual(['Next', 'Next1'])
    expect(buildErrors(source)).toEqual([])
  })

  it('pastes into another block under a parent, keeping free names, and rewires element references', () => {
    const target = 'FUNCTION_BLOCK Info EXTENDS HmiScreen\n  VAR\n    Box : HmiStack;\n  END_VAR\nEND_FUNCTION_BLOCK\n'
    const clip = copyElements(model, ['Col'])
    if (!clip) throw new Error('nothing copied')
    clip.elements[1].props.push(['Follow', "'Run'"])
    const result = pasteElements(target, parse(target), clip, 'Box', null, (_type, property) => property === 'Follow')
    const after = parse(edited(result))
    expect(after.elements.map((e) => [e.name, e.parent])).toEqual([
      ['Box', null],
      ['Col', 'Box'],
      ['Level', 'Col'],
      ['Run', 'Col'],
    ])
    expect(after.elements[2].props.find((p) => p.name === 'Follow')?.value).toBe("'Run'")
  })

  it('reads only a well-formed payload from outside', () => {
    const clip = copyElements(model, ['Next'])
    expect(parseDesignerClipboard(JSON.parse(JSON.stringify(clip)))).toEqual(clip)
    for (const bad of [
      null,
      { kind: 'other', version: 1, elements: [], bindings: [], events: [] },
      { kind: 'openplc-hmi-elements', version: 1, elements: [], bindings: [], events: [] },
      {
        kind: 'openplc-hmi-elements',
        version: 1,
        elements: [{ name: 'A', type: 'T', parent: null, props: [['a']] }],
        bindings: [],
        events: [],
      },
      {
        kind: 'openplc-hmi-elements',
        version: 1,
        elements: [{ name: 'A', type: 'T', parent: null, props: [] }],
        bindings: [{}],
        events: [],
      },
      {
        kind: 'openplc-hmi-elements',
        version: 1,
        elements: [{ name: 'A', type: 'T', parent: null, props: [] }],
        bindings: [],
        events: [{}],
      },
      { kind: 'openplc-hmi-elements', version: 1, elements: [{ name: 1 }], bindings: [], events: [] },
    ])
      expect(parseDesignerClipboard(bad)).toBeNull()
  })
})

describe('source history', () => {
  /** Plays edits through the history, as the store does. */
  class Session {
    history: SourceHistory = emptyHistory()
    constructor(public current: string) {}
    edit(next: string, merge?: { key: string; at: number }, limit?: number) {
      this.history = recordStep(this.history, this.current, next, merge, limit)
      this.current = next
    }
    undo() {
      const step = undoStep(this.history, this.current)
      if (!step) return null
      this.history = step.history
      this.current = step.source
      return step.source
    }
    redo() {
      const step = redoStep(this.history, this.current)
      if (!step) return null
      this.history = step.history
      this.current = step.source
      return step.source
    }
  }

  it('undoes and redoes visual and code edits alike, and merges steps of one kind made close together', () => {
    const session = new Session('a')
    session.edit('ab', { key: 'typing', at: 0 })
    session.edit('abc', { key: 'typing', at: 500 })
    session.edit('abcd')
    session.edit('abcd')
    expect(session.undo()).toBe('abc')
    expect(session.undo()).toBe('a')
    expect(session.history.past).toEqual([])
    expect(session.undo()).toBeNull()
    expect(session.redo()).toBe('abc')
    session.edit('x')
    expect(session.history.future).toEqual([])
    expect(session.redo()).toBeNull()
    expect(session.current).toBe('x')
  })

  it('keeps steps apart past the merge window, and keeps at most its limit', () => {
    const session = new Session('0')
    for (let i = 1; i <= 5; i++) session.edit(String(i), { key: 'typing', at: i * 5000 }, 3)
    expect([session.undo(), session.undo(), session.undo(), session.undo()]).toEqual(['4', '3', '2', null])
  })
})

describe('designer edits that are refused', () => {
  const model = parse(SCREEN)
  const refused = (result: DesignerEdit): string => {
    if (result.ok) throw new Error('the edit was applied')
    return result.message
  }

  it('names the element an edit cannot find', () => {
    expect(refused(setProperty(SCREEN, model, 'Nope', 'Caption', "'x'"))).toMatch(/Nope/)
    expect(refused(removeProperty(SCREEN, model, 'Nope', 'Caption'))).toMatch(/Nope/)
    expect(refused(deleteElements(SCREEN, model, ['Nope']))).toMatch(/Nope/)
    expect(refused(moveElement(SCREEN, model, 'Nope', null, null))).toMatch(/Nope/)
    expect(refused(renameElement(SCREEN, model, 'Nope', 'Other'))).toMatch(/Nope/)
    expect(refused(setBinding(SCREEN, model, 'Nope', 'Value', 'Main.Level'))).toMatch(/Nope/)
    expect(refused(setEvent(SCREEN, model, 'Nope', 'Clicked', 'Count := 0;'))).toMatch(/Nope/)
  })

  it('refuses a parent that is not an element, and a move inside the element itself', () => {
    expect(refused(addElement(SCREEN, model, { type: 'HmiLamp', parent: 'Nope', before: null }))).toMatch(/Nope/)
    expect(refused(moveElement(SCREEN, model, 'Level', 'Nope', null))).toMatch(/Nope/)
    expect(refused(moveElement(SCREEN, model, 'Col', 'Level', null))).toMatch(/inside itself/)
    expect(refused(moveElement(SCREEN, model, 'Col', 'Col', null))).toMatch(/inside itself/)
  })

  it('refuses names that are not identifiers or that the screen already has', () => {
    expect(refused(addElement(SCREEN, model, { type: 'HmiLamp', parent: null, name: '1st' }))).toMatch(/1st/)
    expect(refused(addElement(SCREEN, model, { type: 'HmiLamp', parent: null, name: 'Count' }))).toMatch(/Count/)
    expect(refused(renameElement(SCREEN, model, 'Level', 'Run'))).toMatch(/Run/)
  })

  it('takes a valid stem for generated names and skips members the screen has', () => {
    expect(nextElementName(model, '#!')).toBe('Element1')
    expect(nextElementName(parse(SCREEN.replace('Count : INT;', 'Lamp1 : INT;')), 'Lamp')).toBe('Lamp2')
  })

  it('writes a first property as a new initializer, and declares into a new VAR block when the screen has none', () => {
    expect(edited(setProperty(SCREEN, model, 'Next', 'Text', "'Go'"))).toContain("Next : HmiButton := (Text := 'Go');")
    const bare = 'FUNCTION_BLOCK Bare EXTENDS HmiScreen\nEND_FUNCTION_BLOCK\n'
    const added = edited(addElement(bare, parse(bare), { type: 'HmiLamp', parent: null }))
    expect(added).toMatch(/VAR\n\s+Lamp1 : HmiLamp;\n\s*END_VAR/)
    expect(parse(added).elements.map((e) => e.name)).toEqual(['Lamp1'])
  })
})

describe('designer clipboard payloads', () => {
  it('refuses payloads that are not a designer copy', () => {
    for (const value of [
      null,
      'text',
      { kind: 'openplc-hmi-elements' },
      { kind: 'openplc-hmi-elements', elements: {}, bindings: [], events: [] },
      {
        kind: 'openplc-hmi-elements',
        elements: [{ name: 1, type: 'HmiLamp', parent: null, props: [] }],
        bindings: [],
        events: [],
      },
      {
        kind: 'openplc-hmi-elements',
        elements: [{ name: 'A', type: 'HmiLamp', parent: null, props: {} }],
        bindings: [],
        events: [],
      },
      {
        kind: 'openplc-hmi-elements',
        elements: [{ name: 'A', type: 'HmiLamp', parent: null, props: [['Caption']] }],
        bindings: [],
        events: [],
      },
      {
        kind: 'openplc-hmi-elements',
        elements: [{ name: 'A', type: 'HmiLamp', parent: null, props: [] }],
        bindings: [{ element: 'A', property: 'Value' }],
        events: [],
      },
    ])
      expect(parseDesignerClipboard(value)).toBeNull()
  })

  it('copies nothing that is locked to the code view', () => {
    const locked = parse(SCREEN.replace('Next : HmiButton;', 'Next, Prev : HmiButton;'))
    expect(copyElements(locked, ['Next'])).toBeNull()
  })
})
