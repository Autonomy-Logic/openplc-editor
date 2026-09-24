import { directiveStream, stripCommentsAndSplice } from '../preprocessor-directives'

describe('stripCommentsAndSplice', () => {
  it('splices a line continuation before comments are read', () => {
    expect(stripCommentsAndSplice('#define A 1 \\\n  + 2')).toBe('#define A 1   + 2')
  })

  it('keeps a directive that a block comment spans past', () => {
    const { lines } = directiveStream('/* opening\n   still open */\n#define KEEP 1')
    expect(lines).toEqual(['#define KEEP 1'])
  })

  it('does not mistake a comment marker inside a string literal for a comment', () => {
    expect(stripCommentsAndSplice('const char* s = "a // b";')).toBe('const char* s = "a // b";')
  })
})

describe('directiveStream', () => {
  it('drops code and keeps the directives around it', () => {
    const { lines } = directiveStream('#ifdef X\nint answer = 42;\n#endif')
    expect(lines).toEqual(['#ifdef X', '#endif'])
  })

  it('reports an angle include and carries it through', () => {
    const { lines, hasInclude } = directiveStream('#include <Wire.h>')
    expect(hasInclude).toBe(true)
    expect(lines).toEqual(['#include <Wire.h>'])
  })

  it('drops a quoted include, which names a file the sketch does not have', () => {
    const { lines, hasInclude } = directiveStream('#include "local.h"')
    expect(hasInclude).toBe(false)
    expect(lines).toEqual([])
  })

  it('keeps a macro-formed include, whose #define travelled with it', () => {
    const { lines, hasInclude } = directiveStream('#define LIB <Wire.h>\n#include LIB')
    expect(hasInclude).toBe(true)
    expect(lines).toEqual(['#define LIB <Wire.h>', '#include LIB'])
  })

  it('leaves out #error, #warning and #pragma', () => {
    const { lines } = directiveStream('#error nope\n#warning hmm\n#pragma once\n#define KEEP 1')
    expect(lines).toEqual(['#define KEEP 1'])
  })

  it('reports no include when only conditionals are present', () => {
    expect(directiveStream('#ifdef X\n#endif').hasInclude).toBe(false)
  })
})
