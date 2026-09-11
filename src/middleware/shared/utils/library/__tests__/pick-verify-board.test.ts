import { pickVerifyBoard } from '../pick-verify-board'

const CANDIDATES = [
  { name: 'OpenPLC Simulator', core: 'arduino:avr', compiler: 'simulator' },
  { name: 'Arduino Uno', core: 'arduino:avr', compiler: 'arduino-cli' },
  { name: 'Arduino Mega', core: 'arduino:avr', compiler: 'arduino-cli' },
  { name: 'ESP32-S3 Dev Module', core: 'esp32:esp32', compiler: 'arduino-cli' },
  { name: 'OpenPLC Runtime v4', compiler: 'openplc-compiler' },
]

describe('pickVerifyBoard', () => {
  it('prefers a real board over the in-process simulator', () => {
    // The simulator is a faked ATmega — a poor stand-in for a core that has
    // actual hardware behind it.
    expect(pickVerifyBoard(CANDIDATES, 'arduino:avr')).toBe('Arduino Mega')
  })

  it('breaks ties by name, so install order does not change the answer', () => {
    const reversed = [...CANDIDATES].reverse()
    expect(pickVerifyBoard(reversed, 'arduino:avr')).toBe('Arduino Mega')
  })

  it('returns the only board of a core', () => {
    expect(pickVerifyBoard(CANDIDATES, 'esp32:esp32')).toBe('ESP32-S3 Dev Module')
  })

  it('returns null when no board carries the core', () => {
    expect(pickVerifyBoard(CANDIDATES, 'rp2040:rp2040')).toBeNull()
  })

  it('falls back to the simulator when it is the only board of the core', () => {
    expect(pickVerifyBoard([CANDIDATES[0]], 'arduino:avr')).toBe('OpenPLC Simulator')
  })
})
