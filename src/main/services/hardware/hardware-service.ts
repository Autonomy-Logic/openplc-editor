import { exec } from 'child_process'
import { app } from 'electron'
import { readFile } from 'fs/promises'
import { produce } from 'immer'
import { join } from 'path'
import { promisify } from 'util'

import { logger } from '../logger-service'

type BoardInfo = {
  board_manager_url?: string
  compiler: string
  core: string
  c_flags?: string[]
  cxx_flags?: string[]
  default_ain: string
  default_aout: string
  default_din: string
  default_dout: string
  define?: string | string[]
  extra_libraries?: string[]
  platform: string
  preview: string
  source: string
  specs: {
    CPU: string
    RAM: string
    Flash: string
    DigitalPins: string
    AnalogPins: string
    PWMPins: string
    WiFi: string
    Bluetooth: string
    Ethernet: string
  }
  user_ain?: string
  user_aout?: string
  user_din?: string
  user_dout?: string
}

type HalsFile = {
  [boardName: string]: BoardInfo
}
class HardwareService {
  resourcesDirectory: string
  constructor() {
    this.resourcesDirectory = this.#constructResourcesDirectory()
  }

  #constructResourcesDirectory(): string {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '')
  }

  async getAvailableSerialPorts(): Promise<string[]> {
    const serialCommunication = promisify(exec)
    const isDevelopment = process.env.NODE_ENV === 'development'

    const scriptDirectory = join(
      isDevelopment ? process.cwd() : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'serial-communication',
    )

    let serialCommunicationBinary: string

    // Construct the path to the serial binary
    switch (process.platform) {
      case 'win32':
        serialCommunicationBinary = join(scriptDirectory, 'Windows', 'serial-communication.exe')
        break
      case 'darwin':
        serialCommunicationBinary = join(scriptDirectory, 'MacOS', 'serial-communication')
        break
      case 'linux':
        serialCommunicationBinary = join(scriptDirectory, 'Linux', 'serial-communication')
        break
      default:
        throw new Error(`Unsupported platform: ${process.platform}`)
    }

    // Spawn the Python process
    const { stderr, stdout } = await serialCommunication(`"${serialCommunicationBinary}" list_ports`)

    if (stderr) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsed = JSON.parse(stderr)
        logger.error(`Serial communication stderr[main-process]: ${JSON.stringify(parsed)}`)
      } catch {
        logger.error(`Serial communication stderr[main-process]: ${stderr}`)
      }
      throw new Error(stderr)
    }
    const primitiveResponse = JSON.parse(stdout) as { port: string }[]

    const availablePorts = primitiveResponse.map(({ port }) => port)

    return availablePorts
  }

  async getAvailableBoards() {
    const arduinoCorePath = join(app.getPath('userData'), 'User', 'Runtime', 'arduino-core-control.json')
    // TODO: Add log here!!!
    const halsPath = join(this.resourcesDirectory, 'runtime', 'hals.json')

    const readJSONFile = async (path: string) => {
      const file = await readFile(path, 'utf8')
      return JSON.parse(file) as unknown
    }

    // TODO: Add log here!!!
    const halsContent = (await readJSONFile(halsPath)) as HalsFile
    const arduinoCoreContent = (await readJSONFile(arduinoCorePath)) as { [core: string]: string }[]

    let availableBoards: Map<string, Pick<BoardInfo, 'core' | 'preview' | 'specs'> & { coreVersion?: string }> =
      new Map()

    for (const board in halsContent) {
      availableBoards = produce(availableBoards, (draft) => {
        draft.set(board, {
          core: halsContent[board].core,
          preview: halsContent[board].preview,
          specs: halsContent[board].specs,
          coreVersion:
            Object.values(
              arduinoCoreContent.find((core) => Object.keys(core)[0] === halsContent[board].core) ?? {},
            )[0] ?? undefined,
        })
      })
    }
    return availableBoards
  }

  async getDeviceConfigurationOptions() {
    /**
     * TODO: Implement the function that will be executed in the program startup and will send the device option to the renderer process!!!!
     */
    const [communicationPorts, availableBoards] = await Promise.allSettled([
      this.getAvailableSerialPorts(),
      this.getAvailableBoards(),
    ])

    return { ports: communicationPorts, boards: availableBoards }
  }
}

export { HardwareService }
