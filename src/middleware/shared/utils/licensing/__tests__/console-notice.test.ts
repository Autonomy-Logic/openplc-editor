import { frameConsoleNotice } from '../console-notice'

describe('frameConsoleNotice', () => {
  it('fills a line up to exactly 72 columns before wrapping', () => {
    const word = 'x'.repeat(35)

    expect(frameConsoleNotice(`${word} ${word} ${word}`).slice(1, -1)).toEqual([`${word} ${word}`, word])
  })

  it('keeps a word longer than the rules on its own line', () => {
    const long = 'y'.repeat(80)

    expect(frameConsoleNotice(`a ${long} b`).slice(1, -1)).toEqual(['a', long, 'b'])
  })

  it('collapses whitespace and frames empty text as the two rules alone', () => {
    expect(frameConsoleNotice('  a \n\t b  ').slice(1, -1)).toEqual(['a b'])
    expect(frameConsoleNotice('   ')).toEqual(['*'.repeat(72), '*'.repeat(72)])
  })
})
