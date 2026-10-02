/**
 * The case this exists for: a library gains a pin, and the block already on the
 * canvas is still drawing the old set.
 *
 * Project load detects that and deliberately does not apply it — growing a
 * block needs handles rebuilt, which load will not do — so the only way it
 * reaches the diagram is the update badge, and the badge only appears when this
 * says the block has diverged. Before this, a library block was never checked
 * at all: the editors only compared blocks backed by a POU in the project.
 */

import type { BlockVariant } from '@root/middleware/shared/ports/block-types'
import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

import { findLibraryPou, libraryVariantDiverges } from '../library-block-divergence'

const pin = (name: string, cls: string) => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'BOOL' },
})

const libraryPou = (...pins: ReturnType<typeof pin>[]) =>
  ({ name: 'SLEEP', type: 'function-block', language: 'st', body: '', documentation: '', variables: pins }) as never

const library = (pou: ReturnType<typeof libraryPou>): SystemLibrary =>
  ({ name: 'node-uio', author: '', version: '0.0.1', stPath: '', cPath: '', pous: [pou] }) as never

const placed = (...pins: ReturnType<typeof pin>[]) =>
  ({ name: 'SLEEP', type: 'function-block', variables: pins }) as unknown as BlockVariant

describe('finding the library a placed block came from', () => {
  it('resolves a block to its library POU', () => {
    const pou = libraryPou(pin('TRIGGER', 'input'))
    expect(findLibraryPou(placed(), [library(pou)], [])).toBe(pou)
  })

  it('leaves a project POU alone, because the project owns its interface', () => {
    const pou = libraryPou(pin('TRIGGER', 'input'))
    expect(findLibraryPou(placed(), [library(pou)], ['SLEEP'])).toBeNull()
  })

  it('answers null when no library declares it', () => {
    expect(findLibraryPou(placed(), [], [])).toBeNull()
  })

  it('treats a nameless variant as not a library block rather than throwing', () => {
    // A node can carry a variant with no name. The comparison this replaced
    // never reached for the name, so it tolerated one; opening a real project
    // is what found that out.
    const pou = libraryPou(pin('TRIGGER', 'input'))
    const nameless = { type: 'function-block', variables: [] } as unknown as BlockVariant
    expect(() => findLibraryPou(nameless, [library(pou)], [])).not.toThrow()
    expect(findLibraryPou(nameless, [library(pou)], [])).toBeNull()
  })

  it('survives a library POU with no name', () => {
    const broken = {
      name: 'node-uio',
      author: '',
      version: '0.0.1',
      stPath: '',
      cPath: '',
      pous: [{ variables: [] }],
    } as unknown as SystemLibrary
    expect(() => findLibraryPou(placed(), [broken], [])).not.toThrow()
  })
})

describe('has the placed block drifted from the library', () => {
  it('says no when the pins match', () => {
    const pou = libraryPou(pin('TRIGGER', 'input'), pin('ERROR', 'output'))
    expect(libraryVariantDiverges(placed(pin('TRIGGER', 'input'), pin('ERROR', 'output')), pou)).toBe(false)
  })

  it('says yes when the library ADDED a pin', () => {
    // HAT_IN_SLEEP and LED_IN_SLEEP, exactly.
    const pou = libraryPou(pin('TRIGGER', 'input'), pin('HAT_IN_SLEEP', 'input'))
    expect(libraryVariantDiverges(placed(pin('TRIGGER', 'input')), pou)).toBe(true)
  })

  it('says yes when the library REMOVED a pin', () => {
    const pou = libraryPou(pin('TRIGGER', 'input'))
    expect(libraryVariantDiverges(placed(pin('TRIGGER', 'input'), pin('GONE', 'input')), pou)).toBe(true)
  })

  it('says yes when a pin changed side', () => {
    // A pin that moved from input to output invalidates whatever was wired to
    // it, so it has to surface rather than quietly redraw.
    const pou = libraryPou(pin('Q', 'output'))
    expect(libraryVariantDiverges(placed(pin('Q', 'input')), pou)).toBe(true)
  })

  it('ignores EN, ENO and OUT, which a library POU never declares', () => {
    const pou = libraryPou(pin('TRIGGER', 'input'))
    const drawn = placed(pin('EN', 'input'), pin('ENO', 'output'), pin('TRIGGER', 'input'))
    expect(libraryVariantDiverges(drawn, pou)).toBe(false)
  })

  it('ignores a local, which is never drawn as a pin', () => {
    const pou = libraryPou(pin('TRIGGER', 'input'), pin('lastTrigger', 'local'))
    expect(libraryVariantDiverges(placed(pin('TRIGGER', 'input')), pou)).toBe(false)
  })

  it('ignores a pin with no name on either side', () => {
    const pou = libraryPou(pin('TRIGGER', 'input'), { class: 'input' } as never)
    const drawn = placed(pin('TRIGGER', 'input'), { class: 'output' } as never)
    expect(() => libraryVariantDiverges(drawn, pou)).not.toThrow()
    expect(libraryVariantDiverges(drawn, pou)).toBe(false)
  })

  it('compares names without regard to case, as IEC does', () => {
    const pou = libraryPou(pin('Trigger', 'input'))
    expect(libraryVariantDiverges(placed(pin('TRIGGER', 'input')), pou)).toBe(false)
  })
})
