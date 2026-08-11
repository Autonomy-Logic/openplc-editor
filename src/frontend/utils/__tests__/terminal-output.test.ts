import { collapseCarriageReturns, hasAnsi, parseAnsi, stripAnsi } from '../terminal-output'

const ESC = '\u001B'
const BEL = '\u0007'

// The literal bytes arduino-cli 1.4.1 writes for its compile summary table.
// Captured from `arduino-cli compile` with colour enabled — this is the exact
// shape the console has to cope with.
const ARDUINO_SUMMARY =
  `${ESC}[92mUsed platform${ESC}[0m ${ESC}[92mVersion${ESC}[0m ${ESC}[90mPath${ESC}[0m\n` +
  `${ESC}[93marduino:avr${ESC}[0m   1.8.8   ${ESC}[90m/Users/x/Arduino15/packages/arduino/hardware/avr/1.8.8${ESC}[0m`

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
