import { serialPortDisplay } from '../serial-port-label'

/**
 * Two producer shapes reach this helper, and the original tests only covered
 * one of them — bare manufacturer strings — which is why the composed shape
 * regressed unnoticed. Both are exercised here.
 */
describe('serialPortDisplay', () => {
  describe('names already composed by mergeSerialPortList', () => {
    // What the editor's enumerator actually returns:
    // `name: "<address> (<descriptor>)"`.

    it('keeps the board name the enumerator appended', () => {
      expect(
        serialPortDisplay({ name: '/dev/cu.usbmodem11101 (Arduino MKR)', address: '/dev/cu.usbmodem11101' }),
      ).toEqual({
        label: '/dev/cu.usbmodem11101 (Arduino MKR)',
        title: '/dev/cu.usbmodem11101 (Arduino MKR)',
      })
    })

    it('keeps a Windows composed label', () => {
      expect(serialPortDisplay({ name: 'COM3 (Arduino Uno)', address: 'COM3' })).toEqual({
        label: 'COM3 (Arduino Uno)',
        title: 'COM3 (Arduino Uno)',
      })
    })

    it('does not double-wrap an already-composed name', () => {
      const { label } = serialPortDisplay({ name: 'COM5 (wch.cn)', address: 'COM5' })
      expect(label).toBe('COM5 (wch.cn)')
      expect(label).not.toContain('COM5 (COM5')
    })

    it('handles a descriptor containing parentheses of its own', () => {
      expect(serialPortDisplay({ name: 'COM6 (com0com - serial port emulator)', address: 'COM6' })).toEqual({
        label: 'COM6 (com0com - serial port emulator)',
        title: 'COM6 (com0com - serial port emulator)',
      })
    })
  })

  describe('bare manufacturer names', () => {
    // What `serialport` reports on its own. The path must still lead, but the
    // descriptor must not be thrown away either.

    it('composes a Windows port as COM5 (wch.cn)', () => {
      expect(serialPortDisplay({ name: 'wch.cn', address: 'COM5' })).toEqual({
        label: 'COM5 (wch.cn)',
        title: 'COM5 (wch.cn)',
      })
    })

    it('composes a Linux port', () => {
      expect(serialPortDisplay({ name: 'QinHeng Electronics', address: '/dev/ttyUSB0' })).toEqual({
        label: '/dev/ttyUSB0 (QinHeng Electronics)',
        title: '/dev/ttyUSB0 (QinHeng Electronics)',
      })
    })

    it('never replaces the path with the vendor string', () => {
      // The original bug: a NodeMCU reading "wch.cn" instead of "COM5".
      const { label } = serialPortDisplay({ name: 'wch.cn', address: 'COM5' })
      expect(label.startsWith('COM5')).toBe(true)
      expect(label).not.toBe('wch.cn')
    })
  })

  describe('degenerate inputs', () => {
    it('shows the bare path when the name is just the path echoed back', () => {
      expect(serialPortDisplay({ name: 'COM3', address: 'COM3' })).toEqual({ label: 'COM3', title: undefined })
    })

    it('shows the bare path when there is no name at all', () => {
      expect(serialPortDisplay({ name: '', address: '/dev/ttyACM0' })).toEqual({
        label: '/dev/ttyACM0',
        title: undefined,
      })
    })

    it('falls back to the name when the address is empty', () => {
      expect(serialPortDisplay({ name: 'COM7', address: '' })).toEqual({ label: 'COM7', title: undefined })
    })

    it('trims surrounding whitespace', () => {
      expect(serialPortDisplay({ name: '  wch.cn  ', address: '  COM5  ' })).toEqual({
        label: 'COM5 (wch.cn)',
        title: 'COM5 (wch.cn)',
      })
    })
  })
})
