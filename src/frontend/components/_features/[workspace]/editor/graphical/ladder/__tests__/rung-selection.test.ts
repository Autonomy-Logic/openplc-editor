import { isRungDeleteKey, moveRungs, nextRungSelection } from '../rung-selection'

const rungs = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id) => ({ id }))
const ids = (list: readonly { id: string }[]) => list.map((rung) => rung.id)

describe('rung selection', () => {
  it('selects one rung on a click, adds or removes with Shift, and clears on a second click', () => {
    expect(nextRungSelection([], 'r2')).toEqual(['r2'])
    expect(nextRungSelection(['r2'], 'r4', { extend: true })).toEqual(['r2', 'r4'])
    expect(nextRungSelection(['r2', 'r4'], 'r2', { extend: true })).toEqual(['r4'])
    expect(nextRungSelection(['r2', 'r4'], 'r5')).toEqual(['r5'])
    expect(nextRungSelection(['r5'], 'r5')).toEqual([])
    expect(nextRungSelection(['r2', 'r4'], 'r4', { toggle: false })).toEqual(['r2', 'r4'])
  })

  it('moves selected rungs as one block, in order and without gaps, down after or up before the target', () => {
    const selected = new Set(['r2', 'r4'])
    expect(ids(moveRungs(rungs, selected, 'r2', 'r5'))).toEqual(['r1', 'r3', 'r5', 'r2', 'r4', 'r6'])
    expect(ids(moveRungs(rungs, new Set(['r4', 'r6']), 'r6', 'r2'))).toEqual(['r1', 'r4', 'r6', 'r2', 'r3', 'r5'])
    expect(ids(moveRungs(rungs, selected, 'r2', 'r4'))).toEqual(ids(rungs))
    expect(ids(moveRungs(rungs, selected, 'r3', 'r5'))).toEqual(['r1', 'r2', 'r4', 'r5', 'r3', 'r6'])
  })

  it('deletes a rung only with Ctrl or ⌘ held, so Delete and Backspace alone stay for elements', () => {
    const press = (key: string, mod: boolean) => isRungDeleteKey({ key, metaKey: false, ctrlKey: mod })
    expect([press('Delete', false), press('Backspace', false)]).toEqual([false, false])
    expect([
      press('Delete', true),
      press('Backspace', true),
      isRungDeleteKey({ key: 'Backspace', metaKey: true, ctrlKey: false }),
    ]).toEqual([true, true, true])
  })
})
