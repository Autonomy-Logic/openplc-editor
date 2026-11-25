import { collapseCarriageReturns, hasAnsi, parseAnsi, plainTerminalLine, stripAnsi } from '../terminal-output'

const ESC = '\u001B'
const BEL = '\u0007'

// The literal bytes arduino-cli 1.4.1 writes for its compile summary table.
// Captured from `arduino-cli compile` with colour enabled — this is the exact
// shape the console has to cope with.
const ARDUINO_SUMMARY =
  `${ESC}[92mUsed platform${ESC}[0m ${ESC}[92mVersion${ESC}[0m ${ESC}[90mPath${ESC}[0m\n` +
  `${ESC}[93marduino:avr${ESC}[0m   1.8.8   ${ESC}[90m/Users/x/Arduino15/packages/arduino/hardware/avr/1.8.8${ESC}[0m`

const OSC_OPENERS_ENDING_IN_BEL = `${ESC}]`.repeat(2047) + BEL
const OSC_OPENERS_WITHOUT_TERMINATOR = `${ESC}]`.repeat(2048)

const CUT_SEQUENCE_LINES: [string, string, string, string][] = [
  ['2,047 OSC openers ending in BEL', OSC_OPENERS_ENDING_IN_BEL, '', ''],
  ['2,048 OSC openers with no terminator', OSC_OPENERS_WITHOUT_TERMINATOR, '', ''],
  ['819 OSC openers each followed by a cut CSI, ending in BEL', `${ESC}]${ESC}[0`.repeat(819) + BEL, '', ''],
  [
    'an OSC hyperlink followed by an OSC with no terminator',
    `see ${ESC}]8;;u${BEL}link${ESC}]8;;`,
    'see link',
    'see link8;;',
  ],
  ['an OSC ended by ST followed by an OSC with no terminator', `a${ESC}]x${ESC}\\b${ESC}]y`, 'ab', 'aby'],
  [
    'OSCs ended by ST and by BEL followed by an OSC with no terminator',
    `${ESC}]a${ESC}\\ ${ESC}]b${BEL} ${ESC}]c`,
    '  ',
    '  c',
  ],
  ['a CSI cut after an OSC ended by BEL', `a${ESC}]x${BEL}b${ESC}[1`, 'ab', 'ab1'],
  ['a CSI cut inside an OSC with no terminator', `a${ESC}]x${ESC}[0;3`, 'a', 'ax0;3'],
  ['a password completed by an OSC with no terminator', `x Sec${ESC}]ret1`, 'x Sec', 'x Secret1'],
  ['a password completed by a cut CSI', `run hunter${ESC}[2`, 'run hunter', 'run hunter2'],
]

describe('hasAnsi', () => {
  it('is false for ordinary output and true once an escape appears', () => {
    expect(hasAnsi('Sketch uses 924 bytes')).toBe(false)
    expect(hasAnsi(`${ESC}[92mgreen${ESC}[0m`)).toBe(true)
  })
})

describe('stripAnsi', () => {
  it('leaves plain text untouched (identity, not a copy path)', () => {
    const plain = 'Compiling core...'
    expect(stripAnsi(plain)).toBe(plain)
  })

  it('removes every escape from real arduino-cli output', () => {
    const stripped = stripAnsi(ARDUINO_SUMMARY)
    expect(stripped).not.toContain(ESC)
    expect(stripped).toContain('Used platform Version Path')
    expect(stripped).toContain('arduino:avr   1.8.8   /Users/x/Arduino15/packages/arduino/hardware/avr/1.8.8')
  })

  it('removes non-SGR CSI sequences too, so they cannot leak into the text', () => {
    expect(stripAnsi(`before${ESC}[2Kafter`)).toBe('beforeafter')
  })
})

describe('stripAnsi — non-CSI escapes', () => {
  // The module promises stored messages carry no escapes. Matching only CSI
  // left OSC payloads and bare ESC bytes in the text, where they reached
  // search, copy and the DOM.
  it('removes an OSC hyperlink, payload and all', () => {
    const link = `${ESC}]8;;https://example.com${BEL}click here${ESC}]8;;${BEL}`
    expect(stripAnsi(link)).toBe('click here')
  })

  it('accepts the ST terminator as well as BEL', () => {
    expect(stripAnsi(`${ESC}]0;window title${ESC}\\text`)).toBe('text')
  })

  it('removes a two-byte escape', () => {
    expect(stripAnsi(`before${ESC}Mafter`)).toBe('beforeafter')
  })

  it('removes a stray ESC with nothing after it', () => {
    expect(stripAnsi(`trailing${ESC}`)).toBe('trailing')
  })

  it('leaves no escape byte behind in mixed output', () => {
    const mixed = `${ESC}[92mok${ESC}[0m ${ESC}]8;;https://x${BEL}link${ESC}]8;;${BEL} ${ESC}`
    expect(stripAnsi(mixed)).not.toContain(ESC)
  })

  it.each(CUT_SEQUENCE_LINES)('keeps its result for %s', (_name, input, _plain, expected) => {
    expect(stripAnsi(input)).toBe(expected)
  })

  it('strips 300 lines of 2,048 OSC openers with no terminator in under a second', () => {
    const started = Date.now()
    for (let call = 0; call < 300 && Date.now() - started < 1000; call += 1) stripAnsi(OSC_OPENERS_WITHOUT_TERMINATOR)

    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('parseAnsi', () => {
  it('returns a single unstyled segment when there is no colour', () => {
    expect(parseAnsi('plain line')).toEqual([{ text: 'plain line' }])
  })

  it('returns nothing for an empty string', () => {
    expect(parseAnsi('')).toEqual([])
  })

  it('styles each coloured run and leaves the rest unstyled', () => {
    const segments = parseAnsi(`${ESC}[93marduino:avr${ESC}[0m   1.8.8`)
    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe('arduino:avr')
    expect(segments[0].className).toContain('text-yellow-600')
    expect(segments[1]).toEqual({ text: '   1.8.8' })
  })

  it('round-trips: concatenated segment text equals the stripped message', () => {
    const segments = parseAnsi(ARDUINO_SUMMARY)
    expect(segments.map((s) => s.text).join('')).toBe(stripAnsi(ARDUINO_SUMMARY))
  })

  it('merges adjacent runs that share a style instead of emitting duplicate spans', () => {
    // reset -> same colour again is common; it must not fragment the output.
    const segments = parseAnsi(`${ESC}[92mone${ESC}[0m${ESC}[92mtwo${ESC}[0m`)
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('onetwo')
  })

  it('treats an empty parameter list as a reset (ECMA-48)', () => {
    const segments = parseAnsi(`${ESC}[92mgreen${ESC}[mplain`)
    expect(segments[1]).toEqual({ text: 'plain' })
  })

  it('applies and clears bold independently of colour', () => {
    const segments = parseAnsi(`${ESC}[1mbold${ESC}[22mnormal`)
    expect(segments[0].className).toContain('font-bold')
    expect(segments[1]).toEqual({ text: 'normal' })
  })

  it('clears only the colour on SGR 39', () => {
    const segments = parseAnsi(`${ESC}[1m${ESC}[92mboth${ESC}[39mboldonly`)
    expect(segments[0].className).toContain('text-green-600')
    expect(segments[0].className).toContain('font-bold')
    expect(segments[1].className).toBe('font-bold')
  })

  it('drops unknown codes without losing the text they wrap', () => {
    // 48;5;21 (256-colour background) is not mapped; the text must survive.
    const segments = parseAnsi(`${ESC}[48;5;21mstill here${ESC}[0m`)
    expect(segments.map((s) => s.text).join('')).toBe('still here')
  })
})

describe('collapseCarriageReturns', () => {
  it('returns the line unchanged when there is no redraw', () => {
    expect(collapseCarriageReturns('Linking everything together...')).toBe('Linking everything together...')
  })

  it('keeps only the frame a terminal would leave on screen', () => {
    expect(collapseCarriageReturns('\rDownloading 10%\rDownloading 60%\rDownloading 100%')).toBe('Downloading 100%')
  })

  it('keeps the preceding text when the line ends with a bare carriage return', () => {
    // A trailing CR moves the cursor but writes nothing.
    expect(collapseCarriageReturns('Downloading 100%\r')).toBe('Downloading 100%')
  })

  it('collapses a real arduino-cli download frame pair', () => {
    const raw =
      '\rDownloading index: package_index.tar.bz2 0 B / 108.96 KiB    0.00%' +
      '\rDownloading index: package_index.tar.bz2 downloaded'
    expect(collapseCarriageReturns(raw)).toBe('Downloading index: package_index.tar.bz2 downloaded')
  })

  it('handles CRLF without swallowing the line', () => {
    // Split on \n happens before this, leaving a trailing \r on Windows output.
    expect(collapseCarriageReturns('Windows line\r')).toBe('Windows line')
  })
})

function removedControlCodePoints(text: string): number[] {
  return Array.from(text)
    .map((character) => character.codePointAt(0) ?? 0)
    .filter((code) => (code <= 0x1f && code !== 0x09) || (code >= 0x7f && code <= 0x9f))
}

const PLAIN_TERMINAL_LINES: [string, string, string][] = [
  ['a blue [INFO] line', `${ESC}[0;34m[INFO]${ESC}[0m Docker daemon is running`, '[INFO] Docker daemon is running'],
  ['a green [SUCCESS] line', `${ESC}[0;32m[SUCCESS]${ESC}[0m Runtime is up`, '[SUCCESS] Runtime is up'],
  [
    'a yellow [WARNING] line',
    `${ESC}[1;33m[WARNING]${ESC}[0m The runtime has not reported healthy after 300s. Check:`,
    '[WARNING] The runtime has not reported healthy after 300s. Check:',
  ],
  [
    'a red [ERROR] line',
    `${ESC}[0;31m[ERROR]${ESC}[0m Could not download the Docker installer.`,
    '[ERROR] Could not download the Docker installer.',
  ],
  [
    'SGR, an OSC hyperlink, an erase-in-line and a two-byte escape',
    `${ESC}[1m${ESC}[92mok${ESC}[0m ${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL} ${ESC}[2Kdone${ESC}M`,
    'ok link done',
  ],
  ['a stray ESC at the end', `Pulling${ESC}`, 'Pulling'],
  ['a CSI cut right after its bracket', `Pulling${ESC}[`, 'Pulling'],
  ['a CSI cut inside its parameters', `Pulling${ESC}[0;3`, 'Pulling'],
  ['an OSC with no terminator', `see ${ESC}]8;;https://example.com`, 'see '],
  ['an ESC that starts no sequence', `a${ESC}zb`, 'azb'],
  ['C0, DEL and C1 control characters', `a${BEL}b\u0000c\u0008d\u007Fe\u009Bf\u0085g\rh`, 'abcdefgh'],
  ['a tab', 'a\tb', 'a\tb'],
  [
    'an installer line with no codes (TC43)',
    '[3/6] Pulling ghcr.io/autonomy-logic/openplc-runtime:latest',
    '[3/6] Pulling ghcr.io/autonomy-logic/openplc-runtime:latest',
  ],
  [
    'markup-like text with a literal backslash and n',
    'Step 4/6: <docker> **pull** \\n 50% & done',
    'Step 4/6: <docker> **pull** \\n 50% & done',
  ],
  [
    'bracketed code text with no escape character',
    '[0;34m[INFO][0m text with no escape character',
    '[0;34m[INFO][0m text with no escape character',
  ],
  ['non-ASCII letters and emoji', 'Instalação concluída ✓ 🎉', 'Instalação concluída ✓ 🎉'],
  ['a replacement character', 'bad byte \uFFFD kept', 'bad byte \uFFFD kept'],
  ['a lone reset', `${ESC}[0m`, ''],
  ['an empty text', '', ''],
  ...CUT_SEQUENCE_LINES.map(([name, input, plain]): [string, string, string] => [name, input, plain]),
]

describe('plainTerminalLine', () => {
  it.each(PLAIN_TERMINAL_LINES)('turns %s into plain text', (_name, input, expected) => {
    expect(plainTerminalLine(input)).toBe(expected)
  })

  it.each(PLAIN_TERMINAL_LINES)('is idempotent for %s', (_name, input) => {
    const plain = plainTerminalLine(input)

    expect(plainTerminalLine(plain)).toBe(plain)
  })

  it.each(PLAIN_TERMINAL_LINES)('leaves no ESC and no removed control character for %s', (_name, input) => {
    const plain = plainTerminalLine(input)

    expect(plain).not.toContain(ESC)
    expect(removedControlCodePoints(plain)).toEqual([])
  })

  it.each(PLAIN_TERMINAL_LINES)('is never longer than the input for %s', (_name, input) => {
    expect(plainTerminalLine(input).length).toBeLessThanOrEqual(input.length)
  })

  it('returns a text with nothing to remove unchanged', () => {
    const text = `[1/6] Checking Docker\t${'é✓'.repeat(2048)}`

    expect(plainTerminalLine(text)).toBe(text)
  })

  it('leaves stripAnsi unchanged for a CSI cut inside its parameters', () => {
    expect(stripAnsi(`a${ESC}[0;3`)).toBe('a0;3')
  })

  it('cleans 200 lines of 2,047 OSC openers ending in BEL in under a second', () => {
    const started = Date.now()
    for (let call = 0; call < 200 && Date.now() - started < 1000; call += 1)
      plainTerminalLine(OSC_OPENERS_ENDING_IN_BEL)

    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('parseAnsi and stripAnsi', () => {
  it.each(PLAIN_TERMINAL_LINES)('renders %s as the same text as stripAnsi', (_name, input) => {
    expect(
      parseAnsi(input)
        .map((s) => s.text)
        .join(''),
    ).toBe(stripAnsi(input))
  })
})
