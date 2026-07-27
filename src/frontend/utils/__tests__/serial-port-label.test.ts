import { serialPortDisplay } from '../serial-port-label'

describe('serialPortDisplay', () => {
  it('labels a Windows port by its COM path, chip name on hover', () => {
    expect(serialPortDisplay({ name: 'wch.cn', address: 'COM5' })).toEqual({ label: 'COM5', title: 'wch.cn' })
  })

  it('labels a Linux port by its /dev path', () => {
    expect(serialPortDisplay({ name: 'QinHeng Electronics', address: '/dev/ttyUSB0' })).toEqual({
      label: '/dev/ttyUSB0',
      title: 'QinHeng Electronics',
    })
  })

  it('labels a macOS port by its /dev/tty.usbserial path', () => {
    expect(serialPortDisplay({ name: 'wch.cn', address: '/dev/tty.usbserial-1420' })).toEqual({
      label: '/dev/tty.usbserial-1420',
      title: 'wch.cn',
    })
  })

  it('omits the hover title when the name is just the path echoed back', () => {
    // The enumerator falls back to `name: path` when no manufacturer is known.
    expect(serialPortDisplay({ name: 'COM3', address: 'COM3' })).toEqual({ label: 'COM3', title: undefined })
  })

  it('falls back to the name when the address is empty', () => {
    expect(serialPortDisplay({ name: 'COM7', address: '' })).toEqual({ label: 'COM7', title: undefined })
  })

  it('trims surrounding whitespace', () => {
    expect(serialPortDisplay({ name: '  wch.cn  ', address: '  COM5  ' })).toEqual({ label: 'COM5', title: 'wch.cn' })
  })
})
