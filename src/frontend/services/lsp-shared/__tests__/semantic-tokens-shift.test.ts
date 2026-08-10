/**
 * @jest-environment jsdom
 */
import { shiftSemanticTokensToBody } from '../internal/semantic-tokens-shift'

// One token per line of a synthesised datatypes document:
//   0 `TYPE`                 col 0
//   1 `  Colors : (RED);`    col 2
//   2 `  Motor : STRUCT`     col 2
//   3 `    speed : INT;`     col 4
//   4 `  END_STRUCT;`        col 2
const AGGREGATE = [0, 0, 4, 0, 0, 1, 2, 6, 0, 0, 1, 2, 5, 0, 0, 1, 4, 5, 0, 0, 1, 2, 10, 0, 0]

describe('shiftSemanticTokensToBody', () => {
  it('drops tokens before the window and rebases the rest to line 0 by default', () => {
    expect(Array.from(shiftSemanticTokensToBody(AGGREGATE, 1, 2))).toEqual([0, 2, 6, 0, 0])
  })

  it('rebases onto outputStartLine so a view can render its own frame above the window', () => {
    // `Motor` occupies lines 2..4; its `.dt` view renders them under a
    // local `TYPE` line, so they land on local lines 1..3.
    expect(Array.from(shiftSemanticTokensToBody(AGGREGATE, 2, 5, 1))).toEqual([
      1, 2, 5, 0, 0, 1, 4, 5, 0, 0, 1, 2, 10, 0, 0,
    ])
  })

  it('never emits the line above the window, whose columns can overrun a short frame line', () => {
    const out = Array.from(shiftSemanticTokensToBody(AGGREGATE, 2, 5, 1))
    // The `Colors` token (length 6) would not fit on the 4-character `TYPE` line.
    expect(out).not.toContain(6)
  })

  it('keeps everything from startLine when no end is given', () => {
    expect(Array.from(shiftSemanticTokensToBody(AGGREGATE, 3))).toEqual([0, 4, 5, 0, 0, 1, 2, 10, 0, 0])
  })

  it('returns an empty stream when the window selects nothing', () => {
    expect(Array.from(shiftSemanticTokensToBody(AGGREGATE, 9, 12))).toEqual([])
  })
})
