import {
  getFbdBlockType,
  getLadderBlockType,
  getLibraryPath,
  isFbdBlockDrag,
  isLadderBlockDrag,
  MIME_TYPES,
  VALID_FBD_BLOCK_TYPES,
  VALID_LADDER_BLOCK_TYPES,
} from '../drag-detection'

function createMockDataTransfer(
  overrides: Partial<{
    types: string[]
    effectAllowed: string
    getData: (type: string) => string
  }> = {},
): DataTransfer {
  return {
    types: overrides.types ?? [],
    effectAllowed: overrides.effectAllowed ?? 'none',
    getData: overrides.getData ?? (() => ''),
    dropEffect: 'none',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    clearData: () => {},
    setData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer
}

describe('isLadderBlockDrag', () => {
  it('returns true when custom MIME type is present', () => {
    const dt = createMockDataTransfer({ types: [MIME_TYPES.LADDER_BLOCKS] })
    expect(isLadderBlockDrag(dt)).toBe(true)
  })

  it('returns true when text/plain with effectAllowed=move', () => {
    const dt = createMockDataTransfer({ types: ['text/plain'], effectAllowed: 'move' })
    expect(isLadderBlockDrag(dt)).toBe(true)
  })

  it('returns true when text/plain with effectAllowed=all', () => {
    const dt = createMockDataTransfer({ types: ['text/plain'], effectAllowed: 'all' })
    expect(isLadderBlockDrag(dt)).toBe(true)
  })

  it('returns true when text/plain getData returns a valid ladder block type', () => {
    for (const blockType of VALID_LADDER_BLOCK_TYPES) {
      const dt = createMockDataTransfer({
        types: ['text/plain'],
        effectAllowed: 'copy',
        getData: () => blockType,
      })
      expect(isLadderBlockDrag(dt)).toBe(true)
    }
  })

  it('returns false when text/plain getData returns an invalid type', () => {
    const dt = createMockDataTransfer({
      types: ['text/plain'],
      effectAllowed: 'copy',
      getData: () => 'invalid-type',
    })
    expect(isLadderBlockDrag(dt)).toBe(false)
  })

  it('returns false when no types match', () => {
    const dt = createMockDataTransfer({ types: ['image/png'] })
    expect(isLadderBlockDrag(dt)).toBe(false)
  })

  it('returns false when getData throws', () => {
    const dt = createMockDataTransfer({
      types: ['text/plain'],
      effectAllowed: 'copy',
      getData: () => {
        throw new Error('SecurityError')
      },
    })
    expect(isLadderBlockDrag(dt)).toBe(false)
  })
})

describe('isFbdBlockDrag', () => {
  it('returns true when custom MIME type is present', () => {
    const dt = createMockDataTransfer({ types: [MIME_TYPES.FBD_BLOCKS] })
    expect(isFbdBlockDrag(dt)).toBe(true)
  })

  it('returns true when text/plain with effectAllowed=move', () => {
    const dt = createMockDataTransfer({ types: ['text/plain'], effectAllowed: 'move' })
    expect(isFbdBlockDrag(dt)).toBe(true)
  })

  it('returns true when text/plain with effectAllowed=all', () => {
    const dt = createMockDataTransfer({ types: ['text/plain'], effectAllowed: 'all' })
    expect(isFbdBlockDrag(dt)).toBe(true)
  })

  it('returns true when text/plain getData returns a valid FBD block type', () => {
    for (const blockType of VALID_FBD_BLOCK_TYPES) {
      const dt = createMockDataTransfer({
        types: ['text/plain'],
        effectAllowed: 'copy',
        getData: () => blockType,
      })
      expect(isFbdBlockDrag(dt)).toBe(true)
    }
  })

  it('returns false when getData returns an invalid type', () => {
    const dt = createMockDataTransfer({
      types: ['text/plain'],
      effectAllowed: 'copy',
      getData: () => 'not-a-block',
    })
    expect(isFbdBlockDrag(dt)).toBe(false)
  })

  it('returns false when no types match', () => {
    const dt = createMockDataTransfer({ types: [] })
    expect(isFbdBlockDrag(dt)).toBe(false)
  })

  it('returns false when getData throws', () => {
    const dt = createMockDataTransfer({
      types: ['text/plain'],
      effectAllowed: 'copy',
      getData: () => {
        throw new Error('SecurityError')
      },
    })
    expect(isFbdBlockDrag(dt)).toBe(false)
  })
})

describe('getLadderBlockType', () => {
  it('returns data from custom MIME type', () => {
    const dt = createMockDataTransfer({
      types: [MIME_TYPES.LADDER_BLOCKS],
      getData: (type: string) => (type === MIME_TYPES.LADDER_BLOCKS ? 'contact' : ''),
    })
    expect(getLadderBlockType(dt)).toBe('contact')
  })

  it('falls back to text/plain for valid ladder types', () => {
    const dt = createMockDataTransfer({
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? 'coil' : ''),
    })
    expect(getLadderBlockType(dt)).toBe('coil')
  })

  it('returns undefined when text/plain is not a valid ladder type', () => {
    const dt = createMockDataTransfer({
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? 'variable' : ''),
    })
    expect(getLadderBlockType(dt)).toBeUndefined()
  })

  it('returns undefined when custom MIME type is empty', () => {
    const dt = createMockDataTransfer({
      getData: () => '',
    })
    expect(getLadderBlockType(dt)).toBeUndefined()
  })
})

describe('getFbdBlockType', () => {
  it('returns data from custom MIME type', () => {
    const dt = createMockDataTransfer({
      types: [MIME_TYPES.FBD_BLOCKS],
      getData: (type: string) => (type === MIME_TYPES.FBD_BLOCKS ? 'variable-input' : ''),
    })
    expect(getFbdBlockType(dt)).toBe('variable-input')
  })

  it('falls back to text/plain for valid FBD types', () => {
    const dt = createMockDataTransfer({
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? 'block' : ''),
    })
    expect(getFbdBlockType(dt)).toBe('block')
  })

  it('returns undefined for invalid types', () => {
    const dt = createMockDataTransfer({
      getData: () => '',
    })
    expect(getFbdBlockType(dt)).toBeUndefined()
  })
})

describe('getLibraryPath', () => {
  it('returns library path from MIME type', () => {
    const dt = createMockDataTransfer({
      getData: (type: string) => (type === MIME_TYPES.LIBRARY ? '/libs/math/ADD' : ''),
    })
    expect(getLibraryPath(dt)).toBe('/libs/math/ADD')
  })

  it('returns undefined when MIME type data is empty', () => {
    const dt = createMockDataTransfer({
      getData: () => '',
    })
    expect(getLibraryPath(dt)).toBeUndefined()
  })
})
