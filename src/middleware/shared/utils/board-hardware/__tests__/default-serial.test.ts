import { debuggerUart, FALLBACK_DEFAULT_SERIAL } from '../default-serial'

describe('debuggerUart', () => {
  it('gives the UART the board declares as its default serial', () => {
    expect(debuggerUart({ defaultSerial: 'Serial1' })).toBe('Serial1')
  })

  it('gives Serial when the board declares no default serial', () => {
    expect(debuggerUart({})).toBe('Serial')
  })

  it('names Serial as the fallback UART', () => {
    expect(FALLBACK_DEFAULT_SERIAL).toBe('Serial')
  })
})
