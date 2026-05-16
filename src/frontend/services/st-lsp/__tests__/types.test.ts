import { parsePouUri, pouUri, stubUri } from '../types'

describe('pouUri / stubUri', () => {
  it('produces well-formed in-memory URIs', () => {
    expect(pouUri('Main')).toBe('inmemory://pou/Main.st')
    expect(stubUri('TankFB')).toBe('inmemory://stub/TankFB.st')
  })

  it('encodes characters that would break a path segment', () => {
    expect(pouUri('My POU/with spaces')).toBe(
      'inmemory://pou/My%20POU%2Fwith%20spaces.st',
    )
  })
})

describe('parsePouUri', () => {
  it('recognises a pou:// URI and decodes the name', () => {
    expect(parsePouUri('inmemory://pou/Main.st')).toEqual({
      kind: 'pou',
      name: 'Main',
    })
  })

  it('recognises a stub:// URI and decodes the name', () => {
    expect(parsePouUri('inmemory://stub/TankFB.st')).toEqual({
      kind: 'stub',
      name: 'TankFB',
    })
  })

  it('round-trips encoded characters', () => {
    const uri = pouUri('Foo Bar')
    expect(parsePouUri(uri)).toEqual({ kind: 'pou', name: 'Foo Bar' })
  })

  it('returns null for unrelated URIs', () => {
    expect(parsePouUri('file:///foo.st')).toBeNull()
    expect(parsePouUri('inmemory://other/Foo.st')).toBeNull()
    expect(parsePouUri('inmemory://pou/Foo.py')).toBeNull()
    expect(parsePouUri('')).toBeNull()
  })
})
