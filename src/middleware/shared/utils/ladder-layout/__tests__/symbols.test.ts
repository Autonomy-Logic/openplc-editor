import type { LadderSymbolKind } from '../symbols'
import { ladderSymbol, symbolKindOf } from '../symbols'

const ALL_KINDS: readonly LadderSymbolKind[] = [
  'contact',
  'contact-negated',
  'contact-rising',
  'contact-falling',
  'coil',
  'coil-negated',
  'coil-set',
  'coil-reset',
  'coil-rising',
  'coil-falling',
]

describe('ladderSymbol', () => {
  it.each(ALL_KINDS)('draws %s in a 22 x 14 box', (kind) => {
    const geometry = ladderSymbol(kind)
    expect(geometry.width).toBe(22)
    expect(geometry.height).toBe(14)
  })

  it.each(ALL_KINDS)('draws %s with at least one path or line', (kind) => {
    const geometry = ladderSymbol(kind)
    expect(geometry.paths.length + geometry.lines.length).toBeGreaterThan(0)
  })

  it.each(ALL_KINDS)('keeps every line of %s inside its local box', (kind) => {
    for (const line of ladderSymbol(kind).lines) {
      for (const x of [line.x1, line.x2]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(22)
      }
      for (const y of [line.y1, line.y2]) {
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(14)
      }
    }
  })

  it.each([
    ['coil-set', 'S'],
    ['coil-reset', 'R'],
    ['coil-rising', 'P'],
    ['coil-falling', 'N'],
    ['contact-rising', 'P'],
    ['contact-falling', 'N'],
  ] as const)('marks %s with the letter %s', (kind, letter) => {
    expect(ladderSymbol(kind).glyphText?.text).toBe(letter)
  })

  it.each(['contact', 'contact-negated', 'coil', 'coil-negated'] as const)('draws %s with no letter', (kind) => {
    expect(ladderSymbol(kind).glyphText).toBeUndefined()
  })

  it('draws the negated contact differently from the plain contact', () => {
    expect(ladderSymbol('contact-negated')).not.toEqual(ladderSymbol('contact'))
  })

  it('draws the negated coil differently from the plain coil', () => {
    expect(ladderSymbol('coil-negated')).not.toEqual(ladderSymbol('coil'))
  })

  it('draws a contact differently from a coil', () => {
    expect(ladderSymbol('contact')).not.toEqual(ladderSymbol('coil'))
  })
})

describe('symbolKindOf', () => {
  it.each([
    ['default', 'contact'],
    ['negated', 'contact-negated'],
    ['risingEdge', 'contact-rising'],
    ['fallingEdge', 'contact-falling'],
  ] as const)('maps the contact variant %s to %s', (variant, kind) => {
    expect(symbolKindOf('contact', variant)).toBe(kind)
  })

  it.each([
    ['default', 'coil'],
    ['negated', 'coil-negated'],
    ['set', 'coil-set'],
    ['reset', 'coil-reset'],
    ['risingEdge', 'coil-rising'],
    ['fallingEdge', 'coil-falling'],
  ] as const)('maps the coil variant %s to %s', (variant, kind) => {
    expect(symbolKindOf('coil', variant)).toBe(kind)
  })

  it.each(['block', 'variable', 'powerRail'])('gives no symbol kind for a %s node', (nodeType) => {
    expect(symbolKindOf(nodeType, 'default')).toBeUndefined()
  })
})
