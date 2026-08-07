import {
  dtViewUri,
  parseDtViewUri,
  parsePouUri,
  parsePouVarsUri,
  POU_DECLARATION_LINE_COUNT,
  pouUri,
  pouVarsUri,
  stubUri,
} from '../types'

describe('pouUri / stubUri', () => {
  it('produces well-formed in-memory URIs', () => {
    expect(pouUri('Main')).toBe('inmemory://pou/Main.st')
    expect(stubUri('TankFB')).toBe('inmemory://stub/TankFB.st')
  })

  it('encodes characters that would break a path segment', () => {
    expect(pouUri('My POU/with spaces')).toBe('inmemory://pou/My%20POU%2Fwith%20spaces.st')
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

describe('pouVarsUri / parsePouVarsUri', () => {
  it('produces well-formed pouvars:// URIs that encode their name', () => {
    expect(pouVarsUri('Main')).toBe('inmemory://pouvars/Main.st')
    expect(pouVarsUri('My POU/with spaces')).toBe('inmemory://pouvars/My%20POU%2Fwith%20spaces.st')
  })

  it('round-trips a name through encode/decode', () => {
    const name = 'Foo Bar/Baz'
    expect(parsePouVarsUri(pouVarsUri(name))).toBe(name)
  })

  it('returns the POU name for a pouvars URI', () => {
    expect(parsePouVarsUri('inmemory://pouvars/Main.st')).toBe('Main')
  })

  it('returns null for non-pouvars URIs (including pou:// and stub://)', () => {
    expect(parsePouVarsUri('inmemory://pou/Main.st')).toBeNull()
    expect(parsePouVarsUri('inmemory://stub/Main.st')).toBeNull()
    expect(parsePouVarsUri('file:///foo.st')).toBeNull()
    expect(parsePouVarsUri('')).toBeNull()
  })
})

describe('POU_DECLARATION_LINE_COUNT', () => {
  it('matches the single-line declaration produced by the signature serializer', () => {
    // The serializer emits `${declaration}\n…` with declaration as one
    // line (e.g. `PROGRAM Main` or `FUNCTION foo : INT`).  If that
    // contract ever changes, the providers' line-offset translation
    // for the variables-text view needs to update with it.
    expect(POU_DECLARATION_LINE_COUNT).toBe(1)
  })
})

describe('dtViewUri / parseDtViewUri', () => {
  it('round-trips a data type name, encoding included', () => {
    expect(dtViewUri('Motor')).toBe('inmemory://dtview/Motor.dt')
    expect(parseDtViewUri(dtViewUri('My Type'))).toBe('My Type')
  })

  it('returns null for the other ST URI shapes', () => {
    expect(parseDtViewUri(pouUri('Motor'))).toBeNull()
    expect(parseDtViewUri(pouVarsUri('Motor'))).toBeNull()
    expect(parseDtViewUri('inmemory://datatypes/__project__.st')).toBeNull()
  })

  it('does not collide with the pouvars parser', () => {
    expect(parsePouVarsUri(dtViewUri('Motor'))).toBeNull()
  })
})

describe('malformed percent encoding', () => {
  // These parsers run on every model URI the providers see, so a throw
  // here would take hover / completion down for that model.
  it('returns null instead of throwing, for every synthetic URI shape', () => {
    expect(parsePouUri('inmemory://pou/%ZZ.st')).toBeNull()
    expect(parsePouUri('inmemory://stub/%ZZ.st')).toBeNull()
    expect(parsePouVarsUri('inmemory://pouvars/%ZZ.st')).toBeNull()
    expect(parseDtViewUri('inmemory://dtview/%ZZ.dt')).toBeNull()
  })

  it('still decodes well-formed encodings', () => {
    expect(parsePouUri(pouUri('My POU'))?.name).toBe('My POU')
    expect(parsePouVarsUri(pouVarsUri('My POU'))).toBe('My POU')
    expect(parseDtViewUri(dtViewUri('My Type'))).toBe('My Type')
  })
})
