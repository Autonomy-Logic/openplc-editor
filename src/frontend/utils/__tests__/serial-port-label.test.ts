import { serialPortDisplay } from '../serial-port-label'

/**
 * This helper is the ONE place a port's label is decided, so the platform
 * expectations are asserted here rather than inferred from the producer.
 */
describe('serialPortDisplay', () => {
  describe('the path always leads', () => {
    it('labels a Windows port by its COM number', () => {
      expect(serialPortDisplay({ address: 'COM5', boardName: 'Arduino Uno' })).toEqual({
        label: 'COM5 (Arduino Uno)',
        title: 'COM5 (Arduino Uno)',
      })
    })

    it('labels a macOS port by its /dev/cu path', () => {
      expect(serialPortDisplay({ address: '/dev/cu.usbmodem11101', boardName: 'Arduino MKR' })).toEqual({
        label: '/dev/cu.usbmodem11101 (Arduino MKR)',
        title: '/dev/cu.usbmodem11101 (Arduino MKR)',
      })
    })

    it('labels a Linux port by its /dev/tty path', () => {
      expect(serialPortDisplay({ address: '/dev/ttyACM0', boardName: 'Arduino Mega' })).toEqual({
        label: '/dev/ttyACM0 (Arduino Mega)',
        title: '/dev/ttyACM0 (Arduino Mega)',
      })
    })

    it('never replaces the path with the descriptor', () => {
      // The original bug: a NodeMCU reading "wch.cn" instead of "COM5".
      const { label } = serialPortDisplay({ address: 'COM5', manufacturer: 'wch.cn' })
      expect(label.startsWith('COM5')).toBe(true)
      expect(label).not.toBe('wch.cn')
    })
  })

  describe('descriptor precedence', () => {
    it('prefers the arduino-cli board name over the manufacturer', () => {
      // Both scans found something; the board name is the specific one.
      expect(serialPortDisplay({ address: 'COM1', boardName: 'Opta', manufacturer: 'Arduino' })).toEqual({
        label: 'COM1 (Opta)',
        title: 'COM1 (Opta)',
      })
    })

    it('falls back to the manufacturer when arduino-cli identified no board', () => {
      expect(serialPortDisplay({ address: 'COM6', manufacturer: 'com0com - serial port emulator' })).toEqual({
        label: 'COM6 (com0com - serial port emulator)',
        title: 'COM6 (com0com - serial port emulator)',
      })
    })

    it('shows the bare path when neither scan knew a descriptor', () => {
      expect(serialPortDisplay({ address: '/dev/ttyUSB0' })).toEqual({
        label: '/dev/ttyUSB0',
        title: undefined,
      })
    })

    it('treats a blank descriptor as absent', () => {
      expect(serialPortDisplay({ address: 'COM3', boardName: '   ', manufacturer: '' })).toEqual({
        label: 'COM3',
        title: undefined,
      })
    })

    it('falls through a blank board name to the manufacturer', () => {
      expect(serialPortDisplay({ address: 'COM3', boardName: '  ', manufacturer: 'FTDI' })).toEqual({
        label: 'COM3 (FTDI)',
        title: 'COM3 (FTDI)',
      })
    })
  })

  describe('degenerate inputs', () => {
    it('falls back to the descriptor when the address is empty', () => {
      expect(serialPortDisplay({ address: '', boardName: 'Arduino Uno' })).toEqual({
        label: 'Arduino Uno',
        title: undefined,
      })
    })

    it('trims surrounding whitespace', () => {
      expect(serialPortDisplay({ address: '  COM5  ', manufacturer: '  wch.cn  ' })).toEqual({
        label: 'COM5 (wch.cn)',
        title: 'COM5 (wch.cn)',
      })
    })

    it('cannot double-wrap, because it never receives a composed string', () => {
      // The regression this structure prevents: when the producer pre-composed
      // `name`, the renderer had to guess whether it already contained the path.
      const { label } = serialPortDisplay({ address: 'COM5', boardName: 'Arduino Uno' })
      expect(label).toBe('COM5 (Arduino Uno)')
      expect(label).not.toContain('COM5 (COM5')
    })
  })
})
