/**
 * The comment on its own lines above a declaration belongs to that variable.
 *
 * It used to be free text: nothing read it, nothing could set it, and deleting
 * the variable left it behind describing a pin that no longer existed — in an
 * ST POU and a C++ block alike, since both keep their declarations as text.
 */
import { leadingComment, parseVariableDeclarations } from '../PLC/variable-declarations'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { applyVariablesToText } from '../variable-text-edits'

const TEXT = [
  'VAR_INPUT (* header note *)',
  '    KEEP_ALIVE : UINT := 60; (* seconds *)',
  '    (* A TRANSPORT SOMETHING ELSE OWNS, for a board.',
  '       On the Runtime this is left at 0. *)',
  '    LINK : __XWORD; (* trailing *)',
  '',
  '    (* A heading, set apart by a blank line. *)',
  '',
  '    ENABLE : BOOL := TRUE;',
  '    // first line',
  '    // second line',
  '    TRANSPORT : INT;',
  'END_VAR',
].join('\n')

const variables = (text: string) => parseVariableDeclarations(text, {}).blocks.flatMap((block) => block.declarations)
const byName = (text: string, name: string) => variables(text).find((d) => d.variable.name === name)?.variable

describe('reading the comment above a declaration', () => {
  it('reads a multi-line block comment, dedented to its text column', () => {
    expect(byName(TEXT, 'LINK')?.leadingComment).toBe(
      'A TRANSPORT SOMETHING ELSE OWNS, for a board.\nOn the Runtime this is left at 0.',
    )
    expect(byName(TEXT, 'LINK')?.documentation).toBe('trailing')
  })

  it('reads a run of line comments', () => {
    expect(byName(TEXT, 'TRANSPORT')?.leadingComment).toBe('first line\nsecond line')
  })

  it('does not take a heading set apart by a blank line', () => {
    expect(byName(TEXT, 'ENABLE')?.leadingComment).toBeUndefined()
  })

  it("does not take the header's comment, or the previous declaration's trailing one", () => {
    expect(byName(TEXT, 'KEEP_ALIVE')?.leadingComment).toBeUndefined()
    expect(byName(TEXT, 'KEEP_ALIVE')?.documentation).toBe('seconds')
  })

  it('does not take a comment that shares its line with code', () => {
    expect(leadingComment('x := 1; (* not mine *)\n    A : INT;', 0, 'x := 1; (* not mine *)\n'.length)).toBeUndefined()
  })
})

describe('writing it back', () => {
  const vars = () => variables(TEXT).map((d) => d.variable)

  it('removes the comment with its variable — no orphan left behind', () => {
    const next = applyVariablesToText(
      TEXT,
      vars().filter((v) => v.name !== 'LINK'),
    )
    expect(next).not.toContain('A TRANSPORT')
    expect(next).not.toContain('LINK')
    // Everything else is untouched, byte for byte.
    expect(next).toBe(TEXT.replace(/ {4}\(\* A TRANSPORT[\s\S]*?\(\* trailing \*\)\n/, ''))
  })

  it('leaves the text alone when the comment is absent from the update or unchanged', () => {
    const untouched = vars().map((v) => ({ ...v, leadingComment: undefined }))
    expect(applyVariablesToText(TEXT, untouched)).toBe(TEXT)
    expect(applyVariablesToText(TEXT, vars())).toBe(TEXT)
  })

  it('replaces, adds and removes it', () => {
    const set = (name: string, leading: string) =>
      vars().map((v) => (v.name === name ? { ...v, leadingComment: leading } : v))

    const replaced = applyVariablesToText(TEXT, set('LINK', 'Wire a client here.'))
    expect(byName(replaced, 'LINK')?.leadingComment).toBe('Wire a client here.')
    expect(replaced).toContain('    (* Wire a client here. *)\n    LINK : __XWORD;')

    const added = applyVariablesToText(TEXT, set('KEEP_ALIVE', 'Two lines,\nkept as two.'))
    expect(byName(added, 'KEEP_ALIVE')?.leadingComment).toBe('Two lines,\nkept as two.')

    const removed = applyVariablesToText(TEXT, set('TRANSPORT', ''))
    expect(byName(removed, 'TRANSPORT')?.leadingComment).toBeUndefined()
    expect(removed).not.toContain('// first line')
  })

  it('round-trips text holding the comment delimiters', () => {
    const text = 'Not (* nested *), and *) does not close it.'
    const next = applyVariablesToText(
      TEXT,
      vars().map((v) => (v.name === 'ENABLE' ? { ...v, leadingComment: text } : v)),
    )
    expect(parseVariableDeclarations(next, {}).errors).toEqual([])
    expect(byName(next, 'ENABLE')?.leadingComment).toBe(text)
  })

  it('moves the comment with its variable on a reorder', () => {
    const list = vars()
    const link = list.find((v) => v.name === 'LINK')!
    const reordered = [link, ...list.filter((v) => v !== link)]
    const next = applyVariablesToText(TEXT, reordered)
    expect(byName(next, 'LINK')?.leadingComment).toBe(
      'A TRANSPORT SOMETHING ELSE OWNS, for a board.\nOn the Runtime this is left at 0.',
    )
    expect(byName(next, 'KEEP_ALIVE')?.leadingComment).toBeUndefined()
  })

  it('writes it above a new declaration, and in a freshly generated block', () => {
    const fresh = { ...byName(TEXT, 'ENABLE')!, name: 'FRESH', leadingComment: 'Brand new.' }
    const next = applyVariablesToText(TEXT, [...vars(), fresh])
    expect(byName(next, 'FRESH')?.leadingComment).toBe('Brand new.')

    const generated = generateIecVariablesToString([fresh])
    expect(byName(generated, 'FRESH')?.leadingComment).toBe('Brand new.')
  })
})
