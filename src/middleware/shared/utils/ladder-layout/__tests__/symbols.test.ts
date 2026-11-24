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
  it('draws every kind in a 22 x 14 box, distinct, with the right letter', () => {
    const letters: Partial<Record<LadderSymbolKind, string>> = {
      'coil-set': 'S',
      'coil-reset': 'R',
      'coil-rising': 'P',
      'coil-falling': 'N',
      'contact-rising': 'P',
      'contact-falling': 'N',
    }
    const drawn = ALL_KINDS.map((kind) => ladderSymbol(kind))
    drawn.forEach((geometry, index) => {
      const kind = ALL_KINDS[index]
      expect({ kind, width: geometry.width, height: geometry.height }).toEqual({ kind, width: 22, height: 14 })
      expect(geometry.paths.length + geometry.lines.length).toBeGreaterThan(0)
      for (const line of geometry.lines) {
        expect(Math.min(line.x1, line.x2, line.y1, line.y2)).toBeGreaterThanOrEqual(0)
        expect(Math.max(line.x1, line.x2)).toBeLessThanOrEqual(22)
        expect(Math.max(line.y1, line.y2)).toBeLessThanOrEqual(14)
      }
      expect(geometry.glyphText?.text).toBe(letters[kind])
    })
    expect(new Set(drawn.map((geometry) => JSON.stringify(geometry))).size).toBe(ALL_KINDS.length)
  })
})

describe('symbolKindOf', () => {
  it('maps contact and coil variants to symbol kinds, and other nodes to none', () => {
    expect(symbolKindOf('contact', 'negated')).toBe('contact-negated')
    expect(symbolKindOf('contact', 'risingEdge')).toBe('contact-rising')
    expect(symbolKindOf('coil', 'set')).toBe('coil-set')
    expect(symbolKindOf('coil', 'fallingEdge')).toBe('coil-falling')
    expect(symbolKindOf('block', 'default')).toBeUndefined()
  })
})
