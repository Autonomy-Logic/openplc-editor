import { mergeSerialPortList, toCalloutPath } from '../serial-port-list'

const boardMap = (entries: Array<[string, string | undefined]>) => new Map<string, string | undefined>(entries)

describe('toCalloutPath', () => {
  it('rewrites a macOS dial-in (tty.) node to its call-out (cu.) node', () => {
    expect(toCalloutPath('/dev/tty.usbmodem11301')).toBe('/dev/cu.usbmodem11301')
  })

  it('leaves an already-call-out (cu.) path unchanged', () => {
    expect(toCalloutPath('/dev/cu.usbmodem11301')).toBe('/dev/cu.usbmodem11301')
  })

  it('leaves Linux paths unchanged (no dotted tty. prefix)', () => {
    expect(toCalloutPath('/dev/ttyUSB0')).toBe('/dev/ttyUSB0')
    expect(toCalloutPath('/dev/ttyACM0')).toBe('/dev/ttyACM0')
  })

  it('leaves Windows COM paths unchanged', () => {
    expect(toCalloutPath('COM3')).toBe('COM3')
  })
})

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

  describe('macOS tty./cu. canonicalization', () => {
    it('collapses the tty. (serialport) and cu. (arduino-cli) nodes of one device into a single cu. entry', () => {
      const manufacturers = boardMap([['/dev/tty.usbmodem11301', 'Arduino']])
      const boards = boardMap([['/dev/cu.usbmodem11301', 'Opta']])

      expect(mergeSerialPortList(boards, manufacturers)).toEqual([
        { name: '/dev/cu.usbmodem11301 (Opta)', address: '/dev/cu.usbmodem11301' },
      ])
    })

    it('canonicalizes a tty.-only device (from serialport) to its cu. node', () => {
      const manufacturers = boardMap([['/dev/tty.usbserial-99', 'FTDI']])

      expect(mergeSerialPortList(boardMap([]), manufacturers)).toEqual([
        { name: '/dev/cu.usbserial-99 (FTDI)', address: '/dev/cu.usbserial-99' },
      ])
    })

    it('reproduces the reported duplicate-ports scenario as a single deduped, cu.-based list', () => {
      // serialport reports tty.* with manufacturers; arduino-cli reports cu.* with board id.
      const manufacturers = boardMap([
        ['/dev/tty.debug-console', undefined],
        ['/dev/tty.Bluetooth-Incoming-Port', undefined],
        ['/dev/tty.usbserial-1140', 'Prolific Technology Inc.'],
        ['/dev/tty.usbmodem11301', 'Arduino'],
      ])
      const boards = boardMap([
        ['/dev/cu.debug-console', undefined],
        ['/dev/cu.Bluetooth-Incoming-Port', undefined],
        ['/dev/cu.usbserial-1140', undefined],
        ['/dev/cu.usbmodem11301', 'Opta'],
      ])

      expect(mergeSerialPortList(boards, manufacturers)).toEqual([
        { name: '/dev/cu.debug-console', address: '/dev/cu.debug-console' },
        { name: '/dev/cu.Bluetooth-Incoming-Port', address: '/dev/cu.Bluetooth-Incoming-Port' },
        { name: '/dev/cu.usbserial-1140 (Prolific Technology Inc.)', address: '/dev/cu.usbserial-1140' },
        { name: '/dev/cu.usbmodem11301 (Opta)', address: '/dev/cu.usbmodem11301' },
      ])
    })

    it('does not merge Linux tty paths (no dotted tty./cu. prefix)', () => {
      const manufacturers = boardMap([
        ['/dev/ttyUSB0', 'FTDI'],
        ['/dev/ttyACM0', undefined],
      ])
      const boards = boardMap([['/dev/ttyACM0', 'Arduino Uno']])

      expect(mergeSerialPortList(boards, manufacturers)).toEqual([
        { name: '/dev/ttyUSB0 (FTDI)', address: '/dev/ttyUSB0' },
        { name: '/dev/ttyACM0 (Arduino Uno)', address: '/dev/ttyACM0' },
      ])
    })
  })
})
