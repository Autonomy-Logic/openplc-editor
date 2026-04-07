import { readFile } from 'node:fs/promises'
import { enableMapSet } from 'immer'

enableMapSet()

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/mock-user-data'),
  },
}))

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}))

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
}))

// Provide process.resourcesPath for non-dev mode
;(process as unknown as { resourcesPath: string }).resourcesPath ??= process.cwd()

import { exec } from 'node:child_process'

import { HardwareModule } from '../hardware-module'

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>
const mockedExec = exec as unknown as jest.MockedFunction<
  (cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => void
>

describe('HardwareModule', () => {
  let hardware: HardwareModule

  beforeEach(() => {
    hardware = new HardwareModule()
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    it('initializes directory and binary paths', () => {
      expect(typeof hardware.binaryDirectoryPath).toBe('string')
      expect(typeof hardware.sourcesDirectoryPath).toBe('string')
      expect(typeof hardware.arduinoCliBinaryPath).toBe('string')
      expect(typeof hardware.arduinoCliConfigurationFilePath).toBe('string')
      expect(Array.isArray(hardware.arduinoCliBaseParameters)).toBe(true)
    })
  })

  describe('readJSONFile', () => {
    it('reads and parses a JSON file', async () => {
      mockedReadFile.mockResolvedValue('{"key":"value"}')
      const result = await HardwareModule.readJSONFile<{ key: string }>('/some/file.json')
      expect(result).toEqual({ key: 'value' })
    })
  })

  describe('getAvailableSerialPorts', () => {
    it('returns parsed serial ports on success', async () => {
      const mockStdout = JSON.stringify({
        ports: [
          { name: 'COM3', address: '/dev/ttyUSB0' },
          { address: '/dev/ttyUSB1' },
        ],
      })

      mockedExec.mockImplementation((_cmd, cb) => {
        ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout: mockStdout,
          stderr: '',
        })
        return undefined as never
      })

      const ports = await hardware.getAvailableSerialPorts()
      expect(ports).toEqual([
        { name: 'COM3', address: '/dev/ttyUSB0' },
        { name: '/dev/ttyUSB1', address: '/dev/ttyUSB1' },
      ])
    })

    it('returns fallback when stdout is empty', async () => {
      mockedExec.mockImplementation((_cmd, cb) => {
        ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout: '',
          stderr: '',
        })
        return undefined as never
      })

      const ports = await hardware.getAvailableSerialPorts()
      expect(ports).toEqual([{ name: '', address: 'fallback' }])
    })

    it('returns empty array when JSON parsing fails', async () => {
      mockedExec.mockImplementation((_cmd, cb) => {
        ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout: 'invalid json',
          stderr: '',
        })
        return undefined as never
      })

      const ports = await hardware.getAvailableSerialPorts()
      expect(ports).toEqual([])
    })

    it('returns empty array when exec fails', async () => {
      mockedExec.mockImplementation((_cmd, cb) => {
        ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(
          new Error('command not found'),
          { stdout: '', stderr: '' },
        )
        return undefined as never
      })

      const ports = await hardware.getAvailableSerialPorts()
      expect(ports).toEqual([])
    })

    it('warns but continues when stderr is present', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const mockStdout = JSON.stringify({ ports: [{ name: 'COM1', address: '/dev/tty0' }] })

      mockedExec.mockImplementation((_cmd, cb) => {
        ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout: mockStdout,
          stderr: 'some warning',
        })
        return undefined as never
      })

      const ports = await hardware.getAvailableSerialPorts()
      expect(ports).toHaveLength(1)
      expect(warnSpy).toHaveBeenCalledWith('xml2st stderr output:', 'some warning')
      warnSpy.mockRestore()
    })
  })

  describe('getAvailableBoards', () => {
    it('returns sorted boards from hals.json and core control', async () => {
      const halsData = {
        BoardB: {
          compiler: 'arduino-cli',
          core: 'avr',
          preview: 'boardb.png',
          specs: {
            CPU: 'ATmega',
            RAM: '8KB',
            Flash: '256KB',
            DigitalPins: '54',
            AnalogPins: '16',
            PWMPins: '15',
            WiFi: 'No',
            Bluetooth: 'No',
            Ethernet: 'No',
          },
          default_ain: 'A0, A1',
          default_aout: '',
          default_din: 'D2, D3',
          default_dout: 'D4',
          platform: 'arduino:avr:mega',
          source: 'mega.cpp',
        },
        BoardA: {
          compiler: 'arduino-cli',
          core: 'samd',
          preview: 'boarda.png',
          specs: {
            CPU: 'SAMD21',
            RAM: '32KB',
            Flash: '256KB',
            DigitalPins: '20',
            AnalogPins: '6',
            PWMPins: '12',
            WiFi: 'Yes',
            Bluetooth: 'No',
            Ethernet: 'No',
          },
          default_ain: '',
          default_aout: undefined,
          default_din: '',
          default_dout: '',
          platform: 'arduino:samd:mkr1000',
          source: 'mkr.cpp',
        },
      }

      const coreControl = [{ avr: '1.8.6' }, { samd: '1.8.13' }]

      // First call is for hals.json, second for arduino-core-control.json
      mockedReadFile
        .mockResolvedValueOnce(JSON.stringify(halsData))
        .mockResolvedValueOnce(JSON.stringify(coreControl))

      const boards = await hardware.getAvailableBoards()
      const keys = Array.from(boards.keys())

      expect(keys).toEqual(['BoardA', 'BoardB']) // sorted alphabetically
      expect(boards.get('BoardB')!.coreVersion).toBe('1.8.6')
      expect(boards.get('BoardA')!.coreVersion).toBe('1.8.13')
      expect(boards.get('BoardB')!.pins.defaultAin).toEqual(['A0', 'A1'])
      expect(boards.get('BoardB')!.pins.defaultDout).toEqual(['D4'])
    })
  })

  describe('getBoardImagePreview', () => {
    it('returns base64 encoded image', async () => {
      const imageBuffer = Buffer.from('fake-image-data')
      mockedReadFile.mockResolvedValue(imageBuffer)

      const result = await hardware.getBoardImagePreview('board.png')
      expect(result).toMatch(/^data:image\/png;base64,/)
      expect(result).toContain(imageBuffer.toString('base64'))
    })
  })

  describe('getDeviceConfigurationOptions', () => {
    it('returns both ports and boards via Promise.allSettled', async () => {
      // Mock getAvailableSerialPorts
      mockedExec.mockImplementation((_cmd, cb) => {
        ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout: JSON.stringify({ ports: [{ name: 'COM1', address: '/dev/tty0' }] }),
          stderr: '',
        })
        return undefined as never
      })

      // Mock getAvailableBoards (two readFile calls)
      mockedReadFile
        .mockResolvedValueOnce(
          JSON.stringify({
            TestBoard: {
              compiler: 'arduino-cli',
              core: 'avr',
              preview: 'test.png',
              specs: {
                CPU: 'X',
                RAM: 'X',
                Flash: 'X',
                DigitalPins: '0',
                AnalogPins: '0',
                PWMPins: '0',
                WiFi: 'No',
                Bluetooth: 'No',
                Ethernet: 'No',
              },
              default_ain: '',
              default_aout: '',
              default_din: '',
              default_dout: '',
              platform: 'p',
              source: 's',
            },
          }),
        )
        .mockResolvedValueOnce(JSON.stringify([]))

      const result = await hardware.getDeviceConfigurationOptions()
      expect(result).toHaveProperty('ports')
      expect(result).toHaveProperty('boards')
    })
  })
})
