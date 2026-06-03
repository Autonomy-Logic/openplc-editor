import { substitutePlaceholders, tokenizeRecipe } from '../recipe-exec'

describe('tokenizeRecipe', () => {
  it('splits plain whitespace-separated tokens', () => {
    expect(tokenizeRecipe('a b c')).toEqual(['a', 'b', 'c'])
  })

  it('treats multiple whitespace runs (spaces, tabs, newlines) as one separator', () => {
    expect(tokenizeRecipe('a  b\tc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('strips a wrapping single-quote pair without altering contents', () => {
    expect(tokenizeRecipe("'foo bar'")).toEqual(['foo bar'])
  })

  it('strips a wrapping double-quote pair without altering contents', () => {
    expect(tokenizeRecipe('"foo bar"')).toEqual(['foo bar'])
  })

  it('preserves embedded double quotes when wrapped in single quotes (Leonardo USB descriptor)', () => {
    // Real arduino-cli output for Leonardo: '-DUSB_MANUFACTURER="Unknown"' '-DUSB_PRODUCT="Arduino Leonardo"'
    const input = '\'-DUSB_MANUFACTURER="Unknown"\' \'-DUSB_PRODUCT="Arduino Leonardo"\''
    expect(tokenizeRecipe(input)).toEqual(['-DUSB_MANUFACTURER="Unknown"', '-DUSB_PRODUCT="Arduino Leonardo"'])
  })

  it('concatenates quoted and unquoted segments inside the same token', () => {
    expect(tokenizeRecipe('-DFOO="bar baz"')).toEqual(['-DFOO=bar baz'])
  })

  it('handles Windows-style absolute paths in double quotes (with backslashes)', () => {
    const input = '"C:\\Program Files (x86)\\Arduino\\hardware\\arduino-cli.exe" -c "C:\\Path With Spaces\\file.cpp"'
    expect(tokenizeRecipe(input)).toEqual([
      'C:\\Program Files (x86)\\Arduino\\hardware\\arduino-cli.exe',
      '-c',
      'C:\\Path With Spaces\\file.cpp',
    ])
  })

  it('keeps `@responsefile` paths as single tokens (ESP32 cflags shape)', () => {
    expect(tokenizeRecipe('-c @/build/.tmp/build_opt.h foo.cpp')).toEqual(['-c', '@/build/.tmp/build_opt.h', 'foo.cpp'])
  })

  it('returns an empty array for an empty or whitespace-only recipe', () => {
    expect(tokenizeRecipe('')).toEqual([])
    expect(tokenizeRecipe('   \t \n  ')).toEqual([])
  })

  it('throws on an unterminated single quote', () => {
    expect(() => tokenizeRecipe("foo 'bar")).toThrow(/unterminated single quote/)
  })

  it('throws on an unterminated double quote', () => {
    expect(() => tokenizeRecipe('foo "bar')).toThrow(/unterminated double quote/)
  })

  it('parses a representative AVR recipe end-to-end (Leonardo shape)', () => {
    // Compacted reproduction of the failing arduino:avr:leonardo recipe.
    const recipe =
      '"C:\\avr-gcc\\bin\\avr-g++" -c -g -Os -w -std=gnu++11 -fpermissive ' +
      '-DUSB_VID=0x2341 -DUSB_PID=0x8036 \'-DUSB_MANUFACTURER="Unknown"\' ' +
      '\'-DUSB_PRODUCT="Arduino Leonardo"\' "-IC:\\build\\src" ' +
      '"C:\\build\\src\\arduino_runtime_glue.cpp" -o "C:\\build\\obj\\arduino_runtime_glue.o"'

    const argv = tokenizeRecipe(recipe)

    expect(argv).toEqual([
      'C:\\avr-gcc\\bin\\avr-g++',
      '-c',
      '-g',
      '-Os',
      '-w',
      '-std=gnu++11',
      '-fpermissive',
      '-DUSB_VID=0x2341',
      '-DUSB_PID=0x8036',
      '-DUSB_MANUFACTURER="Unknown"',
      '-DUSB_PRODUCT="Arduino Leonardo"',
      '-IC:\\build\\src',
      'C:\\build\\src\\arduino_runtime_glue.cpp',
      '-o',
      'C:\\build\\obj\\arduino_runtime_glue.o',
    ])
  })
})

describe('substitutePlaceholders', () => {
  it('replaces an exact-match scalar placeholder', () => {
    const result = substitutePlaceholders(['gcc', '-c', '{source_file}', '-o', '{object_file}'], {
      '{source_file}': '/abs/foo.cpp',
      '{object_file}': '/abs/foo.o',
    })
    expect(result).toEqual(['gcc', '-c', '/abs/foo.cpp', '-o', '/abs/foo.o'])
  })

  it('expands an exact-match array placeholder into multiple argv entries', () => {
    const result = substitutePlaceholders(['gcc', '{includes}', 'foo.cpp'], {
      '{includes}': ['-I/srcDir', '-I/baremetalDir'],
    })
    expect(result).toEqual(['gcc', '-I/srcDir', '-I/baremetalDir', 'foo.cpp'])
  })

  it('substitutes a placeholder embedded as substring inside a larger token (scalar only)', () => {
    const result = substitutePlaceholders(['-o{object_file}.tmp'], {
      '{object_file}': '/abs/foo.o',
    })
    expect(result).toEqual(['-o/abs/foo.o.tmp'])
  })

  it('throws when an array placeholder appears as substring (would silently corrupt argv)', () => {
    expect(() => substitutePlaceholders(['x{includes}y'], { '{includes}': ['-Ia', '-Ib'] })).toThrow(
      /Array expansion is only safe for exact-match tokens/,
    )
  })

  it('leaves tokens unchanged when no placeholder matches', () => {
    expect(substitutePlaceholders(['gcc', '-c'], { '{source_file}': '/abs' })).toEqual(['gcc', '-c'])
  })

  it('integrates with tokenizeRecipe to produce a runnable argv for the Leonardo recipe', () => {
    const recipe =
      '"avr-g++" -c -DUSB_VID=0x2341 \'-DUSB_PRODUCT="Arduino Leonardo"\' ' +
      '{includes} "{source_file}" -o "{object_file}"'

    const argv = substitutePlaceholders(tokenizeRecipe(recipe), {
      '{source_file}': 'C:\\build\\src\\glue.cpp',
      '{object_file}': 'C:\\build\\obj\\glue.o',
      '{includes}': ['-IC:\\build\\src', '-IC:\\build\\examples\\Baremetal'],
    })

    expect(argv).toEqual([
      'avr-g++',
      '-c',
      '-DUSB_VID=0x2341',
      '-DUSB_PRODUCT="Arduino Leonardo"',
      '-IC:\\build\\src',
      '-IC:\\build\\examples\\Baremetal',
      'C:\\build\\src\\glue.cpp',
      '-o',
      'C:\\build\\obj\\glue.o',
    ])
  })
})
