import { generateHmiUnit, type HmiUnitInput } from '../../unit/generate-hmi-unit'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import { HMI_ALL_FACES, hmiUsedFontFaces } from '../used-faces'

const fb = (name: string, body: string): string => `FUNCTION_BLOCK ${name}\n${body}\nEND_FUNCTION_BLOCK\n`
const faces = (roots: string[], pool: string[] = [], gates?: Map<string, RegExp>): number[] =>
  hmiUsedFontFaces({
    roots: roots.map((source, i) => ({ name: `r${i}`, source })),
    pool: pool.map((source, i) => ({ name: `p${i}`, source })),
    gates,
  })

describe('hmiUsedFontFaces', () => {
  it('keeps the faces named by literals, qualified or not', () => {
    expect(faces([fb('S', "HMI_Text(0, 0, 'a', 12, HMI_FONT#Bold, 0, 0);")])).toEqual([1])
    expect(faces([fb('S', 'VAR f : HMI_FONT := Regular; END_VAR')])).toEqual([0])
  })

  it('takes Regular for a font declared without a value', () => {
    expect(faces([fb('S', 'VAR f : HMI_FONT; END_VAR')])).toEqual([0])
    expect(faces([fb('S', 'VAR f : ARRAY[0..1] OF HMI_FONT; END_VAR')])).toEqual([0])
  })

  it('keeps every face when a font value comes from a conversion', () => {
    expect(faces([fb('S', 'f := TO_HMI_FONT(n);')])).toEqual([...HMI_ALL_FACES])
    expect(faces([fb('S', 'f := HMI_FONT#Italic;')])).toEqual([...HMI_ALL_FACES])
  })

  it('ignores comments, strings and blocks no reached source names', () => {
    expect(
      faces(
        [fb('S', "(* HMI_FONT#Bold *) s := 'Bold'; w : Used;")],
        [fb('Used', ''), fb('Unused', 'x := HMI_FONT#Bold;')],
      ),
    ).toEqual([])
  })

  it('follows the blocks the screens name, transitively', () => {
    const pool = [fb('A', 'b : B;'), fb('B', 'HMI_Text(0, 0, s, 9, HMI_FONT#Bold, 0, 0);')]
    expect(faces([fb('S', 'a : A;')], pool)).toEqual([1])
  })

  it('reaches a gated block only once a reached source opens it', () => {
    const pool = [fb('Kbd', 'x := HMI_FONT#Bold;'), fb('Runtime', 'k : Kbd;'), fb('Entry', 'Open();')]
    const gates = new Map([['KBD', /\bOpen\s*\(/i]])
    expect(faces([fb('S', 'r : Runtime;')], pool, gates)).toEqual([])
    expect(faces([fb('S', 'r : Runtime; e : Entry;')], pool, gates)).toEqual([1])
  })

  it('counts the faces of globals and configurations outside every POU', () => {
    const screen = fb('S', 'HMI_Text(0, 0, s, 9, G, 0, 0);')
    expect(faces([screen, 'VAR_GLOBAL\n  G : HMI_FONT := BOLD;\nEND_VAR\n'])).toEqual([1])
    expect(
      faces([screen, 'CONFIGURATION C\n  VAR_GLOBAL G : HMI_FONT := HMI_FONT#Bold; END_VAR\nEND_CONFIGURATION\n']),
    ).toEqual([1])
    expect(faces([screen], ['VAR_GLOBAL G : HMI_FONT := TO_HMI_FONT(1); END_VAR'])).toEqual([...HMI_ALL_FACES])
  })

  it("does not count the HMI_FONT type's own enumerators", () => {
    expect(faces([], ['TYPE HMI_FONT : (Regular := 0, Bold := 1); END_TYPE'])).toEqual([])
  })
})

describe('HMI unit fonts', () => {
  const only = (vars: string): HmiUnitInput => {
    const project = sampleProject()
    const source = `FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Body : HmiHorizontalStack;\n${vars}\n  END_VAR\nEND_FUNCTION_BLOCK\n`
    return { ...project, screens: [{ name: 'Overview', source }], settings: { ...project.settings, startScreen: '' } }
  }

  it('builds only Regular for screens that draw only Regular text', () => {
    const result = generateHmiUnit(only("    T : HmiLabel := (Parent := 'Body', Text := 'Hi');"))
    expect(result.errors).toEqual([])
    expect(result.fonts.faces).toEqual([0])
  })

  it('adds Bold when a screen asks for it', () => {
    const result = generateHmiUnit(only("    T : HmiLabel := (Parent := 'Body', Text := 'Hi', Font := HMI_FONT#Bold);"))
    expect(result.fonts.faces).toEqual([0, 1])
  })

  it('keeps the face of the PIN entry when the panel has a PIN', () => {
    const input = only("    T : HmiRect := (Parent := 'Body');")
    const settings = { ...input.settings, pin: { enabled: true, value: '1234' } }
    expect(generateHmiUnit({ ...input, settings }).fonts.faces).toContain(0)
  })

  it('builds every face for previews', () => {
    expect(generateHmiUnit({ ...only("    T : HmiLabel := (Parent := 'Body');"), preview: true }).fonts.faces).toEqual([
      ...HMI_ALL_FACES,
    ])
  })
})
