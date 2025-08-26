import { exec } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { app as electronApp } from 'electron'
import { produce } from 'immer'

import type { AvailableBoards, HalsFile } from './hardware-types'

// interface MethodsResult<T> {
//   success: boolean
//   data?: T
// }

class HardwareModule {
  binaryDirectoryPath: string
  sourcesDirectoryPath: string

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]
  arduinoCoreFilePath: string

  // ############################################################################
  // =========================== Static properties ==============================
  // ############################################################################
  static readonly HOST_PLATFORM = process.platform
  static readonly HOST_ARCHITECTURE = process.arch
  static readonly DEVELOPMENT_MODE = process.env.NODE_ENV === 'development'

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourcesDirectoryPath = this.#constructSourceDirectoryPath()

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    // INFO: We use this approach because some commands can receive additional parameters as a string array.
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]
    this.arduinoCoreFilePath = this.#constructArduinoCoreFilePath()
  }

  // ############################################################################
  // =========================== Static methods =================================
  // ############################################################################

  static async readJSONFile<T>(filePath: string): Promise<T> {
    const data = await readFile(filePath, 'utf-8')
    return JSON.parse(data) as T
  }

  // ############################################################################
  // =========================== Private methods ================================
  // ############################################################################

  // Initialize paths based on the environment
  #constructBinaryDirectoryPath(): string {
    if (HardwareModule.HOST_ARCHITECTURE !== 'x64' && HardwareModule.HOST_ARCHITECTURE !== 'arm64') return ''
    const platformSpecificPath = join(HardwareModule.HOST_PLATFORM, HardwareModule.HOST_ARCHITECTURE)
    return join(
      HardwareModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      HardwareModule.DEVELOPMENT_MODE ? 'resources' : '',
      'bin',
      HardwareModule.DEVELOPMENT_MODE ? platformSpecificPath : '',
    )
  }

  #constructSourceDirectoryPath(): string {
    return join(
      HardwareModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      HardwareModule.DEVELOPMENT_MODE ? 'resources' : '',
      'sources',
    )
  }

  // TODO: Validate the path.
  #constructArduinoCliBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'arduino-cli')
  }

  #constructArduinoCoreFilePath(): string {
    return join(electronApp.getPath('userData'), 'User', 'Runtime', 'arduino-core-control.json')
  }

  // ############################################################################
  // =========================== Public methods =================================
  // ############################################################################

  // ++ ============================= Getters ================================ ++
  async getAvailableSerialPorts(): Promise<string[]> {
    const executeCommand = promisify(exec)

    const listCommand =
      HardwareModule.HOST_PLATFORM === 'win32'
        ? 'mode'
        : HardwareModule.HOST_PLATFORM === 'linux'
          ? 'udevadm info -e | grep "DEVNAME=/dev/tty"'
          : 'ls /dev/tty.*'

    const { stdout, stderr } = await executeCommand(listCommand)

    if (stderr) {
      console.error('Error while getting available serial ports:', stderr)
      return []
    }

    let normalizedOutputString = ['fallback']

    if (HardwareModule.HOST_PLATFORM === 'win32') {
      // Normalize Windows output
      normalizedOutputString = stdout
        .split('\n')
        .filter((line) => line.includes('COM'))
        .map((line) => line.split(' ')[0].trim())
    } else {
      // Normalize Unix output
      normalizedOutputString = stdout.trim().split('\n').filter(Boolean)
    }

    return normalizedOutputString
  }

  async getAvailableBoards(): Promise<AvailableBoards> {
    // Construct the path to the hals.json file
    const halsFilePath = join(this.sourcesDirectoryPath, 'boards', 'hals.json')

    // Read the content of the necessary files - hals.json and arduino-core-control.json
    const halsFileContent = await HardwareModule.readJSONFile<HalsFile>(halsFilePath)
    const arduinoCoreFileContent = await HardwareModule.readJSONFile<{ [core: string]: string }[]>(
      this.arduinoCoreFilePath,
    )

    // Create a Map to store the available boards, which will be returned
    let availableBoards: AvailableBoards = new Map()

    for (const [board, boardData] of Object.entries(halsFileContent)) {
      const coreVersion = arduinoCoreFileContent.find((core) => Object.keys(core)[0] === boardData.core)?.[
        boardData.core
      ]

      availableBoards = produce(availableBoards, (draft) => {
        draft.set(board, {
          core: boardData.core,
          preview: boardData.preview,
          specs: boardData.specs,
          coreVersion: coreVersion ?? undefined,
          pins: {
            defaultAin:
              boardData.default_ain
                ?.split(',')
                .map((pin) => pin.trim())
                .filter(Boolean) ?? [],
            defaultAout:
              boardData.default_aout
                ?.split(',')
                .map((pin) => pin.trim())
                .filter(Boolean) ?? [],
            defaultDin:
              boardData.default_din
                ?.split(',')
                .map((pin) => pin.trim())
                .filter(Boolean) ?? [],
            defaultDout:
              boardData.default_dout
                ?.split(',')
                .map((pin) => pin.trim())
                .filter(Boolean) ?? [],
          },
        })
      })
    }
    // TODO: Improve error handling and return type
    // if (availableBoards.size === 0) {
    //   return { success: false, data: undefined }
    // }
    return availableBoards
  }

  async getBoardImagePreview(image: string) {
    const imagePath = join(this.sourcesDirectoryPath, 'boards', 'previews', image)

    const imageBuffer = await readFile(imagePath)

    const base64Image = imageBuffer.toString('base64')

    return `data:image/png;base64,${base64Image}`
  }

  async getDeviceConfigurationOptions() {
    const [communicationPorts, availableBoards] = await Promise.allSettled([
      this.getAvailableSerialPorts(),
      this.getAvailableBoards(),
    ])
    return { ports: communicationPorts, boards: availableBoards }
  }
}

export { HardwareModule }
