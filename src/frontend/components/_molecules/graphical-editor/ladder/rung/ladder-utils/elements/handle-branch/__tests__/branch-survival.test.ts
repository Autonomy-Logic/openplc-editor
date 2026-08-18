import { branchSurvivesBlockChange } from '../index'

const bool = { definition: 'base-type' as const, value: 'BOOL' }
const int = { definition: 'base-type' as const, value: 'INT' }

describe('a handle branch survives a block change only if its pin does', () => {
  it('keeps a branch whose output pin is unchanged', () => {
    expect(
      branchSurvivesBlockChange({ handleId: 'Q', direction: 'output' }, [{ name: 'Q', class: 'output', type: bool }]),
    ).toBe(true)
  })

  it('keeps a branch on an input pin', () => {
    expect(
      branchSurvivesBlockChange({ handleId: 'IN', direction: 'input' }, [{ name: 'IN', class: 'input', type: bool }]),
    ).toBe(true)
  })

  it('removes an OUTPUT branch on a VAR_IN_OUT pin — the pin only has an input side now', () => {
    // The whole point: the name still matches and the type is still BOOL, so a name-only check
    // would keep this branch and remap the coil onto a handle that is no longer drawn.
    expect(
      branchSurvivesBlockChange({ handleId: 'Flag', direction: 'output' }, [
        { name: 'Flag', class: 'inOut', type: bool },
      ]),
    ).toBe(false)
  })

  it('keeps an INPUT branch on a VAR_IN_OUT pin — that side is where the pin lives', () => {
    expect(
      branchSurvivesBlockChange({ handleId: 'Flag', direction: 'input' }, [
        { name: 'Flag', class: 'inOut', type: bool },
      ]),
    ).toBe(true)
  })

  it('removes a branch whose pin is gone', () => {
    expect(branchSurvivesBlockChange({ handleId: 'Gone', direction: 'output' }, [])).toBe(false)
  })

  it('removes a branch whose pin is no longer BOOL-compatible', () => {
    expect(
      branchSurvivesBlockChange({ handleId: 'Q', direction: 'output' }, [{ name: 'Q', class: 'output', type: int }]),
    ).toBe(false)
  })

  it('removes a branch whose pin moved to the other side of the block', () => {
    expect(
      branchSurvivesBlockChange({ handleId: 'Q', direction: 'output' }, [{ name: 'Q', class: 'input', type: bool }]),
    ).toBe(false)
  })
})
