import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { app as electronApp } from 'electron'
import { produce } from 'immer'

import { PackageManagerModule } from '../package-manager'
import { logger } from '../services/logger-service'
import { assertPathContained } from '../utils/path-containment'
import { type BoardBuildInfo, BoardInfoResolver } from './board-info-resolver'
import type { AvailableBoards, HalsFile, SerialPort } from './types'

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
  async getAvailableSerialPorts(): Promise<SerialPort[]> {
    let xml2stBinaryPath = join(
      this.binaryDirectoryPath,
      'xml2st',
      HardwareModule.HOST_PLATFORM === 'darwin' ? 'xml2st' : '',
    )
    if (HardwareModule.HOST_PLATFORM === 'win32') {
      xml2stBinaryPath += '.exe'
    }
    const executeCommand = promisify(exec)

    try {
      const { stdout, stderr } = await executeCommand(`"${xml2stBinaryPath}" --list-ports`)

      if (stderr) {
        logger.warn(`xml2st stderr output: ${stderr}`)
      }

      let normalizedOutputString: SerialPort[] = [{ name: '', address: 'fallback' }]

      if (stdout) {
        try {
          const parsedOutput = JSON.parse(stdout) as {
            ports: {
              name: string
              address: string
            }[]
          }
          normalizedOutputString = parsedOutput.ports.map((port) => ({
            name: port.name ?? port.address,
            address: port.address,
          }))
        } catch (parseError: unknown) {
          logger.error(`Failed to parse xml2st output: ${String(parseError)}`)
          return []
        }
      }

      return normalizedOutputString
    } catch (execError: unknown) {
      logger.error(`Failed to execute xml2st: ${String(execError)}`)
      return []
    }
  }

  /**
   * Resolve compile/upload info for `boardName` from either hals.json or
   * an installed VPP package. Compiler module should call this instead
   * of reading hals.json directly.
   */
  async getBoardBuildInfo(boardName: string): Promise<BoardBuildInfo> {
    const resolver = new BoardInfoResolver(
      join(this.sourcesDirectoryPath, 'boards', 'hals.json'),
      this.sourcesDirectoryPath,
      new PackageManagerModule(),
    )
    return resolver.resolve(boardName)
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
          compiler: boardData.compiler,
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
    // Merge boards from installed VPP packages
    const mutableBoards: AvailableBoards = new Map(availableBoards)
    await this.#mergeVppBoards(mutableBoards)

    // Sort boards alphabetically by name
    const sortedBoards: AvailableBoards = new Map([...mutableBoards.entries()].sort(([a], [b]) => a.localeCompare(b)))
    return sortedBoards
  }

  async #mergeVppBoards(boards: AvailableBoards): Promise<void> {
    try {
      const packageManager = new PackageManagerModule()
      const installed = packageManager.listInstalled()
      for (const pkg of installed) {
        const manifest = packageManager.getInstalledPackageManifest(pkg.packageId)
        if (!manifest) continue

        for (const device of manifest.devices) {
          // Read all screen definitions
          const screens: Record<string, unknown> = {}
          if (device.screens) {
            for (const [screenName, screenFile] of Object.entries(device.screens)) {
              const screenPath = join(pkg.path, screenFile)
              if (existsSync(screenPath)) {
                try {
                  screens[screenName] = await HardwareModule.readJSONFile(screenPath)
                } catch {
                  /* ignore invalid screen */
                }
              }
            }
          }

          // Map target type to compiler
          const compiler = device.target.type === 'runtime-v4' ? 'openplc-compiler' : 'arduino-cli'

          // Per-module configuration screens live alongside top-level
          // screens; load them eagerly so the renderer can present the
          // full per-slot detail pane without an extra IPC round trip.
          const loadModuleConfigScreen = async (relPath: string | undefined) => {
            if (!relPath) return undefined
            const fullPath = join(pkg.path, relPath)
            if (!existsSync(fullPath)) return undefined
            try {
              return await HardwareModule.readJSONFile(fullPath)
            } catch {
              return undefined
            }
          }

          const modules = device.moduleSystem
            ? await Promise.all(
                device.moduleSystem.modules.map(async (m) => ({
                  id: m.id,
                  name: m.name,
                  hwId: m.hwId,
                  image: m.image,
                  description: m.description,
                  specs: m.specs,
                  configScreen: m.configScreen,
                  configScreenDefinition: await loadModuleConfigScreen(m.configScreen),
                  io: m.io,
                  parameters: m.parameters,
                  addressMapping: m.addressMapping,
                })),
              )
            : []

          boards.set(device.name, {
            compiler,
            core: device.target.core ?? '',
            preview: device.preview,
            specs: device.specs ?? {},
            pins: {
              defaultDin: device.defaults?.pins?.defaultDin,
              defaultDout: device.defaults?.pins?.defaultDout,
              defaultAin: device.defaults?.pins?.defaultAin,
              defaultAout: device.defaults?.pins?.defaultAout,
            },
            // Forward platformOptions only when the manifest actually declares
            // some; the UI keys off `platformOptions?.length` to decide whether
            // to render the variant dropdown, so leaving it undefined for
            // boards that don't expose variants keeps the JSX gate tight.
            platformOptions:
              device.target.platformOptions && device.target.platformOptions.length > 0
                ? device.target.platformOptions
                : undefined,
            vpp: {
              packageId: manifest.package.id,
              deviceId: device.id,
              packagePath: pkg.path,
              screens,
              moduleSystem: device.moduleSystem
                ? {
                    enabled: device.moduleSystem.enabled,
                    maxSlots: device.moduleSystem.maxSlots,
                    modules,
                  }
                : null,
            },
          })
        }
      }
    } catch (err) {
      logger.error(`Failed to load VPP packages: ${String(err)}`)
    }
  }

  async getBoardImagePreview(image: string, packagePath?: string) {
    // `image` arrives from a board manifest (built-in or VPP-installed)
    // and ultimately from disk-resident JSON the user can edit. Without
    // containment, an entry like `image: "../../../../etc/passwd"`
    // would resolve outside the expected directory and the contents
    // would be base64'd back across the IPC boundary — effectively a
    // file-read primitive scoped to whatever the editor user can read.
    //
    // For built-in boards: contain under sources/boards/previews.
    // For VPP boards: contain under the package's own directory, since
    // package authors expect to ship their preview alongside other
    // package assets.
    const baseDir = packagePath ? packagePath : join(this.sourcesDirectoryPath, 'boards', 'previews')
    const imagePath = join(baseDir, image)
    assertPathContained(baseDir, imagePath, 'preview image path')

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
