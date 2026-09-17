import { resolveFieldOptions } from '../field-options'

describe('resolveFieldOptions', () => {
  it('returns static options when there is no optionsRef', () => {
    expect(resolveFieldOptions({ options: ['a', 'b'] }, { board: undefined })).toEqual(['a', 'b'])
  })

  it('returns an empty array when neither options nor optionsRef are set', () => {
    expect(resolveFieldOptions({}, { board: undefined })).toEqual([])
  })

  it('resolves a dynamic optionsRef from board context', () => {
    expect(
      resolveFieldOptions(
        { optionsRef: 'board.serialPorts', options: ['Serial'] },
        { board: { serialPorts: ['Serial', 'Serial1'] } },
      ),
    ).toEqual(['Serial', 'Serial1'])
  })

  it('falls back to static options when optionsRef resolves to undefined', () => {
    expect(resolveFieldOptions({ optionsRef: 'board.serialPorts', options: ['Serial'] }, { board: {} })).toEqual([
      'Serial',
    ])
  })

  it('falls back to static options when the board is absent', () => {
    expect(resolveFieldOptions({ optionsRef: 'board.serialPorts', options: ['Serial'] }, { board: undefined })).toEqual(
      ['Serial'],
    )
  })

  it('falls back to static options when optionsRef resolves to an empty array', () => {
    expect(
      resolveFieldOptions({ optionsRef: 'board.serialPorts', options: ['Serial'] }, { board: { serialPorts: [] } }),
    ).toEqual(['Serial'])
  })

  it('preserves object-shaped options ({ value, label })', () => {
    const opts = [{ value: 'a', label: 'A' }]
    expect(resolveFieldOptions({ options: opts }, { board: undefined })).toEqual(opts)
  })

  it('filters out non-option entries resolved from optionsRef', () => {
    expect(
      resolveFieldOptions({ optionsRef: 'board.serialPorts' }, { board: { serialPorts: ['Serial', 42, null] } }),
    ).toEqual(['Serial'])
  })

  it('returns empty array fallback when optionsRef yields only invalid entries and no static options', () => {
    expect(resolveFieldOptions({ optionsRef: 'board.serialPorts' }, { board: { serialPorts: [42] } })).toEqual([])
  })

  describe('hostile optionsRef', () => {
    it.each(['__proto__', 'constructor', 'prototype'])(
      'refuses to resolve a path through %s',
      (segment) => {
        // `optionsRef` is a vendor-package string. A path through the
        // prototype chain would offer the user whatever it found there and
        // then write it into the generated plugin config.
        expect(resolveFieldOptions({ optionsRef: `board.${segment}` }, { board: { serialPorts: ['Serial'] } })).toEqual(
          [],
        )
      },
    )

    it('resolves own properties only, not inherited ones', () => {
      const board = Object.create({ inherited: ['Serial'] }) as Record<string, unknown>

      expect(resolveFieldOptions({ optionsRef: 'board.inherited' }, { board })).toEqual([])
    })

    it('refuses a path nested past the depth cap', () => {
      const deep = 'board' + '.a'.repeat(12)

      expect(resolveFieldOptions({ optionsRef: deep }, { board: { serialPorts: ['Serial'] } })).toEqual([])
    })

    it('still falls back to the static options when a hostile ref is refused', () => {
      expect(
        resolveFieldOptions({ optionsRef: 'board.__proto__', options: ['Serial'] }, { board: { serialPorts: [] } }),
      ).toEqual(['Serial'])
    })
  })
})
