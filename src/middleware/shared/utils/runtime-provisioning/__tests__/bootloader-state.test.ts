import type { BootloaderApiResult, BootloaderCapabilities } from '../../../ports/runtime-port'
import { decideAfterBootloader } from '../bootloader-state'

const answered = (state: string, recovery: boolean): BootloaderApiResult<BootloaderCapabilities> => ({
  success: true,
  data: { service: 'openplc-bootloader', bootloaderVersion: '1.0.0', state, recovery },
})

describe('decideAfterBootloader', () => {
  it('checks SSH when the bootloader does not answer', () => {
    expect(decideAfterBootloader({ success: false, error: 'connect ECONNREFUSED 192.168.1.50:8445' })).toEqual({
      kind: 'check-ssh',
    })
  })

  it('checks SSH when the bootloader is healthy and not in recovery', () => {
    expect(decideAfterBootloader(answered('healthy', false))).toEqual({ kind: 'check-ssh' })
  })

  it('reports recovery when the bootloader says recovery', () => {
    expect(decideAfterBootloader(answered('recovery', true))).toEqual({ kind: 'recovery', state: 'recovery' })
  })

  it('reports recovery when the state is recovery even if the flag is false', () => {
    expect(decideAfterBootloader(answered('recovery', false))).toEqual({ kind: 'recovery', state: 'recovery' })
  })

  it('reports recovery when the flag is set whatever the state, showing the reported state', () => {
    expect(decideAfterBootloader(answered('healthy', true))).toEqual({ kind: 'recovery', state: 'healthy' })
    expect(decideAfterBootloader(answered('starting', true))).toEqual({ kind: 'recovery', state: 'starting' })
  })

  it.each(['starting', 'updating', 'booting'])('reports the listed state %s as busy', (state) => {
    expect(decideAfterBootloader(answered(state, false))).toEqual({ kind: 'busy', state })
  })

  it.each(['pulling', 'Healthy', 'stopped'])('reports the unlisted state %s as busy', (state) => {
    expect(decideAfterBootloader(answered(state, false))).toEqual({ kind: 'busy', state })
  })

  it('reports an empty state as busy, shown as unknown', () => {
    expect(decideAfterBootloader(answered('', false))).toEqual({ kind: 'busy', state: 'unknown' })
  })

  describe('the reported state for display', () => {
    it('removes control characters', () => {
      expect(decideAfterBootloader(answered('start\u0000ing\u001b[31m\u007f\n', false))).toEqual({
        kind: 'busy',
        state: 'starting[31m',
      })
    })

    it('keeps a printable space and tilde', () => {
      expect(decideAfterBootloader(answered('wait ~ing', false))).toEqual({ kind: 'busy', state: 'wait ~ing' })
    })

    it('cuts the state at 64 characters', () => {
      expect(decideAfterBootloader(answered('x'.repeat(100), false))).toEqual({ kind: 'busy', state: 'x'.repeat(64) })
    })

    it('keeps a state of exactly 64 characters', () => {
      expect(decideAfterBootloader(answered('y'.repeat(64), false))).toEqual({ kind: 'busy', state: 'y'.repeat(64) })
    })

    it('removes control characters before cutting', () => {
      expect(decideAfterBootloader(answered(`${'\u0001'.repeat(10)}${'a'.repeat(70)}`, false))).toEqual({
        kind: 'busy',
        state: 'a'.repeat(64),
      })
    })

    it('shows unknown when only control characters were reported', () => {
      expect(decideAfterBootloader(answered('\u0000\u001f\u007f', false))).toEqual({ kind: 'busy', state: 'unknown' })
      expect(decideAfterBootloader(answered('\t\r\n', true))).toEqual({ kind: 'recovery', state: 'unknown' })
    })
  })
})
