/**
 * POU documentation is written as the file's leading `(* … *)` comment, which
 * ends at the first `*)`. Documentation holding one closed the comment early:
 * `apply` saved the file, and the next load could not find the POU header
 * ("Could not find FUNCTION_BLOCK declaration") — for every language, though
 * it surfaced on C++ blocks, whose docs quote C comments and pointers.
 *
 * Apply -> save -> reload, through the same serializer and loader the CLI uses.
 */

import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { buildAllProjectFileContentsPure } from '@root/frontend/services/save-actions'
import { openPLCStoreBase } from '@root/frontend/store'
import { escapeCommentText, unescapeCommentText } from '@root/frontend/utils/PLC/comment-text'
import { compileStlib } from 'strucpp'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const INT = { definition: 'base-type' as const, value: 'INT' }

const DOCS = [
  'Counts pulses (* nested *) and holds the total.',
  'A C pointer deref: *p) closes nothing *)',
  '(* the whole text is one comment *)',
  'Ends in a star *',
  'An escape already in the text: *\\) and (\\* stay as typed.',
  'Line one\n(* line two *)\nline three',
]

const pou = (name: string, language: 'st' | 'cpp', documentation: string) => ({
  name,
  kind: 'function-block' as const,
  language,
  documentation,
  variables: [{ name: 'count', class: 'output' as const, type: INT }],
  body: { text: language === 'st' ? 'count := count + 1;' : 'void setup() {}\nvoid loop() { count++; }' },
})

function saveAndReload() {
  const files = buildAllProjectFileContentsPure()
  const pouFiles = Object.entries(files)
    .filter(([path]) => path.startsWith('pous/'))
    .map(([relativePath, content]) => ({ relativePath, content }))
  return {
    files,
    parsed: parseProjectFiles(
      '/p',
      files['project.json'],
      files['devices/configuration.json'] ?? '',
      '',
      pouFiles,
      [],
      [],
    ),
  }
}

describe('POU documentation containing comment delimiters', () => {
  it.each(DOCS.map((doc, index) => [index, doc]))('round-trips doc %i on ST and C++ blocks', async (index, doc) => {
    const st = `FB_ST_${index}`
    const cpp = `FB_CPP_${index}`
    const outcome = await applySpec(
      { specVersion: 1, pous: [pou(st, 'st', doc as string), pou(cpp, 'cpp', doc as string)] } as ApplySpec,
      { prune: false, projectPath: '/does/not/matter' },
    )
    expect(outcome.errors).toEqual([])
    expect(openPLCStoreBase.getState().project.data.pous.find((p) => p.name === cpp)?.documentation).toBe(doc)

    const { files, parsed } = saveAndReload()

    // Exactly one comment ahead of the header, and it closes where it should.
    const cppFile = Object.entries(files).find(([path]) => path.endsWith(`/${cpp}.cpp`))?.[1] ?? ''
    expect(cppFile.indexOf('*)')).toBe(cppFile.indexOf(`*)\n\nFUNCTION_BLOCK ${cpp}`))

    expect(parsed.fatalErrors ?? []).toEqual([])
    // A POU the parser cannot read opens through a best-effort fallback with a
    // warning, not a fatal error — so the warnings are the real signal.
    expect((parsed.warnings ?? []).filter((warning) => warning.includes(st) || warning.includes(cpp))).toEqual([])
    for (const name of [st, cpp]) {
      const reloaded = parsed.projectData.pous.find((p) => p.name === name)
      expect(reloaded).toBeDefined()
      expect(reloaded?.pouType).toBe('function-block')
      expect(reloaded?.documentation).toBe(doc)
      expect(reloaded?.interface?.variables.map((variable) => variable.name)).toEqual(['count'])
    }
  })
})

describe('a library build of the saved C++ block', () => {
  // `library build` hands the authored .cpp to STruC++, which finds the block's
  // interface after the leading comment with the same first-`*)` rule. An early
  // close left text in front of the header: "missing the ST header".
  it.each(DOCS.map((doc, index) => [index, doc]))('finds the ST header with doc %i', async (index, doc) => {
    const cpp = `FB_LIB_${index}`
    await applySpec({ specVersion: 1, pous: [pou(cpp, 'cpp', doc as string)] } as ApplySpec, {
      prune: false,
      projectPath: '/does/not/matter',
    })
    const [fileName, source] = Object.entries(buildAllProjectFileContentsPure()).find(([path]) =>
      path.endsWith(`/${cpp}.cpp`),
    ) ?? ['', '']

    const result = compileStlib([{ fileName, source }], { name: 'doclib', version: '1.0.0', namespace: 'doclib' })
    expect((result.errors ?? []).map((error) => error.message)).toEqual([])
    expect(result.success).toBe(true)
    expect(result.archive.manifest.functionBlocks.map((block) => block.name)).toEqual([cpp])
  })
})

describe('comment text escaping', () => {
  it.each(['*)', '(*', '(*)', '(**)', '*\\)', '(\\*', '*\\\\)', 'plain text', 'a*b(c)d', '\\'])(
    'is reversible for %j and leaves no delimiter behind',
    (text) => {
      const escaped = escapeCommentText(text)
      expect(escaped).not.toContain('*)')
      expect(escaped).not.toContain('(*')
      expect(unescapeCommentText(escaped)).toBe(text)
    },
  )

  it('leaves text with no delimiter unchanged, so older files read back as written', () => {
    expect(escapeCommentText('Counts pulses; see C:\\docs.')).toBe('Counts pulses; see C:\\docs.')
    expect(unescapeCommentText('Counts pulses; see C:\\docs.')).toBe('Counts pulses; see C:\\docs.')
  })
})
