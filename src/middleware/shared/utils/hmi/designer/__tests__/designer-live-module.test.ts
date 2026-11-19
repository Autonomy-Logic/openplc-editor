import type { HmiPreviewBuild } from '../../../../ports/hmi-preview-types'
import type { LiveSyncPlan } from '../designer-live'
import { compiledEntries, entriesAfter, liveElementIds, liveModuleOf, liveSetter } from '../designer-live-module'
import { parseDesignerBlock } from '../designer-model'

type Built = Extract<HmiPreviewBuild, { ok: true }>

const source = (lines: string) =>
  `FUNCTION_BLOCK Main EXTENDS HmiScreen\n  VAR\n${lines}\n  END_VAR\nEND_FUNCTION_BLOCK\n`
const model = (text: string) => {
  const parsed = parseDesignerBlock(text, () => true)
  if (!parsed.ok) throw new Error('the screen does not parse')
  return parsed.model
}
const SHOWN = source("    Body : HmiHorizontalStack;\n    Old : HmiLabel := (Parent := 'Body');")
const NEXT = source("    Body : HmiHorizontalStack;\n    New : HmiLabel := (Parent := 'Body', Text := 'N');")
const built: Built = {
  ok: true,
  wasm: new Uint8Array(),
  pages: { Main: 2 },
  setters: { 'Main.Old.Text': { screen: 2, index: 4, kind: 'str' } },
  elementIds: [
    { id: 1, screen: 'Main', element: 'Body' },
    { id: 2, screen: 'Main', element: 'Old' },
    { id: 7, screen: 'Other', element: 'X' },
  ],
  factory: { types: { HMILABEL: { type: 3, setters: { TEXT: { index: 9, kind: 'str' } } } } },
  warnings: [],
  stats: { units: 0, cached: 0, compileMs: 0, linkMs: 0 },
  timings: { sourcesMs: 0, generateMs: 0, widgetsMs: 0, strucppMs: 0, fontsMs: 0, toolchainMs: 0, totalMs: 0 },
}

describe('designer-live-module', () => {
  it("starts from the build's elements of the shown screen, compiled and laid out", () => {
    const entries = compiledEntries(built.elementIds, 'main')
    expect([...entries.keys()]).toEqual(['BODY', 'OLD'])
    const module = liveModuleOf(entries)
    expect(module.attached('old')).toBe(2)
    expect(module.detached('Old')).toBeUndefined()
    expect(module.created('Old')).toBe(false)
    expect(liveElementIds(entries, 'Main')).toEqual([
      { id: 1, screen: 'Main', element: 'Body' },
      { id: 2, screen: 'Main', element: 'Old' },
    ])
  })

  it('keeps the declaration of what it took off, and the ids of what it made or put back', () => {
    const plan: LiveSyncPlan = {
      detach: [{ element: 2, parent: 1, parentKind: 'stack' }],
      detached: ['Old'],
      elements: [{ type: 3, parent: { id: 1 }, parentKind: 'stack', before: 0, drawBefore: 0, numbers: [], texts: [] }],
      names: ['New'],
      values: [],
    }
    const after = entriesAfter(
      compiledEntries(built.elementIds, 'Main'),
      plan,
      [40],
      { model: model(SHOWN), source: SHOWN },
      model(NEXT),
    )
    const module = liveModuleOf(after)
    expect(module.attached('Old')).toBeUndefined()
    expect(module.detached('Old')).toEqual({ id: 2, declaration: "Old : HmiLabel := (Parent := 'Body');" })
    expect(module.attached('New')).toBe(40)
    expect(module.created('New')).toBe(true)
    expect(after.get('NEW')).toMatchObject({ name: 'New', type: 'HMILABEL' })

    const back = entriesAfter(
      after,
      { ...plan, detach: [], detached: [], elements: [{ ...plan.elements[0], element: 2 }], names: ['Old'] },
      [2],
      { model: model(NEXT), source: NEXT },
      model(SHOWN),
    )
    expect(liveModuleOf(back).attached('Old')).toBe(2)
    expect(liveModuleOf(back).created('Old')).toBe(false)
  })

  it("sets a made element through the factory table and a compiled one through the build's setters", () => {
    const made = new Map([['NEW', { name: 'New', id: 40, type: 'HMILABEL', created: true, attached: true }]])
    expect(liveSetter(made, built, 'Main', 'new', 'text')).toEqual({ index: 9, kind: 'str', screen: 2, element: 40 })
    expect(liveSetter(made, built, 'Main', 'New', 'Missing')).toBeUndefined()
    const compiled = compiledEntries(built.elementIds, 'Main')
    expect(liveSetter(compiled, built, 'Main', 'old', 'TEXT')).toEqual({ screen: 2, index: 4, kind: 'str' })
    expect(liveSetter(compiled, built, 'Main', 'Body', 'Text')).toBeUndefined()
  })
})
