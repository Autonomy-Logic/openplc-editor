import { mergeSerialPortList } from '../serial-port-list'

const boardMap = (entries: Array<[string, string | undefined]>) => new Map<string, string | undefined>(entries)

describe('mergeSerialPortList', () => {
  it('labels a port with the arduino-cli board name when identified', () => {
    const boards = boardMap([['/dev/cu.usbmodem1', 'Arduino Uno']])
    const manufacturers = boardMap([['/dev/cu.usbmodem1', 'Arduino LLC']])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([
      { name: '/dev/cu.usbmodem1 (Arduino Uno)', address: '/dev/cu.usbmodem1' },
    ])
  })

  it('prefers the board name over the manufacturer when both are present', () => {
    const boards = boardMap([['COM1', 'Opta']])
    const manufacturers = boardMap([['COM1', 'Arduino']])

    expect(mergeSerialPortList(boards, manufacturers)[0].name).toBe('COM1 (Opta)')
  })

  it('falls back to the manufacturer when the board is detected but not identified', () => {
    const boards = boardMap([['COM6', undefined]])
    const manufacturers = boardMap([['COM6', 'com0com - serial port emulator']])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([
      { name: 'COM6 (com0com - serial port emulator)', address: 'COM6' },
    ])
  })

  it('uses the bare path when neither board nor manufacturer is known', () => {
    const boards = boardMap([])
    const manufacturers = boardMap([['/dev/ttyUSB0', undefined]])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([
      { name: '/dev/ttyUSB0', address: '/dev/ttyUSB0' },
    ])
  })

  it('treats an empty-string descriptor as absent', () => {
    const boards = boardMap([['COM1', '']])
    const manufacturers = boardMap([['COM1', '']])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([{ name: 'COM1', address: 'COM1' }])
  })

  it('unions both scans, keeps serialport ordering, and dedupes by path', () => {
    // COM3/COM4 come from serialport; arduino-cli enriches COM4 and adds COM9.
    const manufacturers = boardMap([
      ['COM3', 'FTDI'],
      ['COM4', undefined],
    ])
    const boards = boardMap([
      ['COM4', 'Arduino Mega'],
      ['COM9', 'Arduino Nano'],
    ])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([
      { name: 'COM3 (FTDI)', address: 'COM3' },
      { name: 'COM4 (Arduino Mega)', address: 'COM4' },
      { name: 'COM9 (Arduino Nano)', address: 'COM9' },
    ])
  })

  it('returns an empty list when both scans are empty', () => {
    expect(mergeSerialPortList(boardMap([]), boardMap([]))).toEqual([])
  })
})
