import { exec } from 'child_process'
import { app } from 'electron'
import { readFile } from 'fs/promises'
import { produce } from 'immer'
import { join } from 'path'
import { promisify } from 'util'

import { logger } from '../logger-service'
import type { BoardInfo, HalsFile } from './types'

class HardwareService {
  binPath: string
  sourcesPath: string
  resourcesDirectory: string
  constructor() {
    this.binPath = this.#constructBinPath()
    this.sourcesPath = this.#constructSourcesPath()
    this.resourcesDirectory = this.#constructResourcesDirectory()
  }

  #constructBinPath(): string {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '', 'bin')
  }

  #constructSourcesPath(): string {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '', 'sources')
  }

  #constructResourcesDirectory(): string {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '')
  }

  async getAvailableSerialPorts(): Promise<string[]> {
    const serialCommunication = promisify(exec)
    let serialCommunicationBinary: string

    // Construct the path to the serial binary
    switch (process.platform) {
      case 'win32':
        serialCommunicationBinary = join(
          this.binPath,
          'windows',
          'x64',
          'bin',
          'serial-communication',
          'serial-communication.exe',
        )
        break
      case 'darwin':
        serialCommunicationBinary = join(
          this.binPath,
          'darwin',
          'x64',
          'bin',
          'serial-communication',
          'serial-communication',
        )
        break
      case 'linux':
        serialCommunicationBinary = join(
          this.binPath,
          'linux',
          'x64',
          'bin',
          'serial-communication',
          'serial-communication',
        )
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
    const halsPath = join(this.sourcesPath, 'boards', 'hals.json')

    const readJSONFile = async (path: string) => {
      const file = await readFile(path, 'utf8')
      return JSON.parse(file) as unknown
    }

    // TODO: Add log here!!!
    const halsContent = (await readJSONFile(halsPath)) as HalsFile
    const arduinoCoreContent = (await readJSONFile(arduinoCorePath)) as { [core: string]: string }[]

    let availableBoards: Map<
      string,
      Pick<BoardInfo, 'core' | 'preview' | 'specs'> & {
        coreVersion?: string
        pins: {
          defaultAin?: string[]
          defaultAout?: string[]
          defaultDin?: string[]
          defaultDout?: string[]
        }
      }
    > = new Map()

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
          pins: {
            defaultAin:
              halsContent[board].default_ain
                ?.split(',')
                .map((pin) => pin.trim())
                .filter((pin) => pin !== '') ?? [],
            defaultAout:
              halsContent[board].default_aout
                ?.split(',')
                .map((pin) => pin.trim())
                .filter((pin) => pin !== '') ?? [],
            defaultDin:
              halsContent[board].default_din
                ?.split(',')
                .map((pin) => pin.trim())
                .filter((pin) => pin !== '') ?? [],
            defaultDout:
              halsContent[board].default_dout
                ?.split(',')
                .map((pin) => pin.trim())
                .filter((pin) => pin !== '') ?? [],
          },
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
