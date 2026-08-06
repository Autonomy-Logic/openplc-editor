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
  it('reports both descriptors when both scans knew one', () => {
    // The merge no longer picks a winner: it reports what each scan found and
    // lets `serialPortDisplay` apply the precedence. That split is why the
    // renderer can no longer mistake one shape for another.
    const boards = boardMap([['/dev/cu.usbmodem1', 'Arduino Uno']])
    const manufacturers = boardMap([['/dev/cu.usbmodem1', 'Arduino LLC']])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([
      { address: '/dev/cu.usbmodem1', boardName: 'Arduino Uno', manufacturer: 'Arduino LLC' },
    ])
  })

  it('falls back to the manufacturer when the board is detected but not identified', () => {
    const boards = boardMap([['COM6', undefined]])
    const manufacturers = boardMap([['COM6', 'com0com - serial port emulator']])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([
      { address: 'COM6', manufacturer: 'com0com - serial port emulator' },
    ])
  })

  it('uses the bare path when neither board nor manufacturer is known', () => {
    const boards = boardMap([])
    const manufacturers = boardMap([['/dev/ttyUSB0', undefined]])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([{ address: '/dev/ttyUSB0' }])
  })

  it('treats an empty-string descriptor as absent', () => {
    const boards = boardMap([['COM1', '']])
    const manufacturers = boardMap([['COM1', '']])

    expect(mergeSerialPortList(boards, manufacturers)).toEqual([{ address: 'COM1' }])
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
      { address: 'COM3', manufacturer: 'FTDI' },
      { address: 'COM4', boardName: 'Arduino Mega' },
      { address: 'COM9', boardName: 'Arduino Nano' },
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
        { address: '/dev/cu.usbmodem11301', boardName: 'Opta', manufacturer: 'Arduino' },
      ])
    })

    it('canonicalizes a tty.-only device (from serialport) to its cu. node', () => {
      const manufacturers = boardMap([['/dev/tty.usbserial-99', 'FTDI']])

      expect(mergeSerialPortList(boardMap([]), manufacturers)).toEqual([
        { address: '/dev/cu.usbserial-99', manufacturer: 'FTDI' },
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
        { address: '/dev/cu.debug-console' },
        { address: '/dev/cu.Bluetooth-Incoming-Port' },
        { address: '/dev/cu.usbserial-1140', manufacturer: 'Prolific Technology Inc.' },
        { address: '/dev/cu.usbmodem11301', boardName: 'Opta', manufacturer: 'Arduino' },
      ])
    })

    it('does not merge Linux tty paths (no dotted tty./cu. prefix)', () => {
      const manufacturers = boardMap([
        ['/dev/ttyUSB0', 'FTDI'],
        ['/dev/ttyACM0', undefined],
      ])
      const boards = boardMap([['/dev/ttyACM0', 'Arduino Uno']])

      expect(mergeSerialPortList(boards, manufacturers)).toEqual([
        { address: '/dev/ttyUSB0', manufacturer: 'FTDI' },
        { address: '/dev/ttyACM0', boardName: 'Arduino Uno' },
      ])
    })
  })
})
