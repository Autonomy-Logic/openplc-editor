import { exec } from 'child_process'
import { app } from 'electron'
import { readFile } from 'fs/promises'
import { produce } from 'immer'
import { join } from 'path'
import { promisify } from 'util'

type BoardInfo = {
  core: string
  default_ain: string
  default_aout: string
  default_din: string
  default_dout: string
  updatedAt: number
  platform: string
  source: string
  version: string
  board_manager_url?: string
  extra_libraries?: string[]
  define?: string | string[]
  user_ain?: string
  user_aout?: string
  user_din?: string
  user_dout?: string
  c_flags?: string[]
  cxx_flags?: string[]
  arch?: string
}

type HalsFile = {
  [boardName: string]: BoardInfo
}
class HardwareService {
  constructor() {}

  async getAvailableSerialPorts(): Promise<unknown> {
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
      throw new Error(stderr)
    }
    return JSON.parse(stdout)
  }

  async getAvailableBoards() {
    const halsFilePath = join(app.getPath('userData'), 'User', 'Runtime', 'hals.json')

    const readJSONFile = async (path: string) => {
      const file = await readFile(path, 'utf8')
      return JSON.parse(file) as HalsFile
    }

    const halsContent = await readJSONFile(halsFilePath)

    let availableBoardsAndVersion: { board: string; version: string }[] = []

    for (const board in halsContent) {
      availableBoardsAndVersion = produce(availableBoardsAndVersion, (draft) => {
        draft.push({ board, version: halsContent[board]['version'] })
      })
    }

    return availableBoardsAndVersion
  }

  async getDeviceConfigurationOptions() {
    /**
     * TODO: Implement the function that will be executed in the program startup and will send the device option to the renderer process!!!!
     */
    const [communicationPorts, availableBoards] = await Promise.all([
      this.getAvailableSerialPorts(),
      this.getAvailableBoards(),
    ])

    return { ports: communicationPorts, boards: availableBoards }
  }
}

export { HardwareService }
