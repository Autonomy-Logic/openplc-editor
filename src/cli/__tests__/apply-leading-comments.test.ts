/**
 * A variable's leading comment through `apply` -> save -> reload, on an ST POU
 * and a C++ block alike: settable, read back, and gone when the variable is.
 * It used to be untouchable from a spec and orphaned by a prune.
 */

import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { buildAllProjectFileContentsPure } from '@root/frontend/services/save-actions'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const XWORD = { definition: 'base-type' as const, value: 'DWORD' }
const BOOL = { definition: 'base-type' as const, value: 'BOOL' }

const LINK_NOTE = 'A transport something else owns, for a board.\nWired, it wins (* over *) TRANSPORT.'

const block = (name: string, language: 'st' | 'cpp', variables: Array<Record<string, unknown>>) => ({
  name,
  kind: 'function-block' as const,
  language,
  variables,
  body: { text: language === 'st' ? 'ENABLE := ENABLE;' : 'void setup() {}\nvoid loop() {}' },
})

const apply = (pous: unknown[]) =>
  applySpec({ specVersion: 1, pous } as ApplySpec, { prune: true, projectPath: '/does/not/matter' })

function reload() {
  const files = buildAllProjectFileContentsPure()
  const pouFiles = Object.entries(files)
    .filter(([path]) => path.startsWith('pous/'))
    .map(([relativePath, content]) => ({ relativePath, content }))
  const parsed = parseProjectFiles('/p', files['project.json'], '', '', pouFiles, [], [])
  return { files, pous: parsed.projectData.pous }
}

describe.each(['st', 'cpp'] as const)('leading comments on a %s block', (language) => {
  const name = `FB_LEAD_${language.toUpperCase()}`
  const withLink = [
    { name: 'LINK', class: 'input', type: XWORD, leadingComment: LINK_NOTE, documentation: 'trailing' },
    { name: 'ENABLE', class: 'input', type: BOOL },
  ]

  it('is set by apply and read back after a save', async () => {
    expect((await apply([block(name, language, withLink)])).errors).toEqual([])
    const reloaded = reload().pous.find((pou) => pou.name === name)
    const link = reloaded?.interface?.variables.find((variable) => variable.name === 'LINK')
    expect(link?.leadingComment).toBe(LINK_NOTE)
    expect(link?.documentation).toBe('trailing')
  })

  it('is left alone by a spec that does not mention it, and changed by one that does', async () => {
    await apply([block(name, language, withLink)])
    const untouched = withLink.map(({ leadingComment: _dropped, ...rest }) => rest)
    await apply([block(name, language, untouched)])
    let link = reload()
      .pous.find((pou) => pou.name === name)
      ?.interface?.variables.find((v) => v.name === 'LINK')
    expect(link?.leadingComment).toBe(LINK_NOTE)

    await apply([block(name, language, [{ ...withLink[0], leadingComment: 'Shorter.' }, withLink[1]])])
    link = reload()
      .pous.find((pou) => pou.name === name)
      ?.interface?.variables.find((v) => v.name === 'LINK')
    expect(link?.leadingComment).toBe('Shorter.')
  })

  it('goes with its variable when a prune removes it', async () => {
    await apply([block(name, language, withLink)])
    expect((await apply([block(name, language, [withLink[1]])])).errors).toEqual([])
    const { files } = reload()
    const file = Object.entries(files).find(([path]) => path.endsWith(`/${name}.${language}`))?.[1] ?? ''
    expect(file).not.toContain('LINK')
    expect(file).not.toContain('transport something else owns')
  })
})
