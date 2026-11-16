import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve as pathResolve, sep as pathSep } from 'node:path'
import { promisify } from 'node:util'

import { app as electronApp } from 'electron'
import { produce } from 'immer'
import { SerialPort as NodeSerialPort } from 'serialport'

import { boardHardwareFromManifestDevice } from '../../../middleware/shared/utils/board-hardware/from-manifest-device'
import { readHalsFile } from '../../shared/firmware/hals-loader'
import { type BoardBuildInfo, BoardInfoResolver } from '../../shared/hardware/board-info-resolver'
import { resolveConfigTemplatePluginName } from '../../shared/utils/vpp/build-vpp-plugin-files'
import { PackageManagerModule } from '../package-manager'
import { readPackageFile } from '../package-manager/read-package-file'
import { logger } from '../services/logger-service'
import { assertPathContained } from '../utils/path-containment'
import { orderBoardsByVppGroup } from './order-boards-by-vpp-group'
import { mergeSerialPortList, toCalloutPath } from './serial-port-list'
import { toVppModuleDefinition } from './to-vpp-module-definition'
import type { AvailableBoards, HalsFile, SerialPort } from './types'

const execFileAsync = promisify(execFile)

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

  static readonly HOST_PLATFORM = process.platform
  static readonly HOST_ARCHITECTURE = process.arch
  /** Unpackaged means the binaries and sources sit beside the checkout. */
  static readonly DEVELOPMENT_MODE = !electronApp.isPackaged

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourcesDirectoryPath = this.#constructSourceDirectoryPath()

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]
    this.arduinoCoreFilePath = this.#constructArduinoCoreFilePath()
  }

  static async readJSONFile<T>(filePath: string): Promise<T> {
    const data = await readFile(filePath, 'utf-8')
    return JSON.parse(data) as T
  }

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

  #constructArduinoCliBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'arduino-cli')
  }

  #constructArduinoCoreFilePath(): string {
    return join(electronApp.getPath('userData'), 'User', 'Runtime', 'arduino-core-control.json')
  }

  async getAvailableSerialPorts(): Promise<SerialPort[]> {
    const [boardNamesByPath, manufacturersByPath] = await Promise.all([
      this.#identifyBoardsByPath(),
      this.#listSerialPortManufacturers(),
    ])
    return mergeSerialPortList(boardNamesByPath, manufacturersByPath)
  }

  /** Is this serial port still attached? */
  async isSerialPortPresent(address: string): Promise<boolean> {
    try {
      const ports = await NodeSerialPort.list()
      const wanted = toCalloutPath(address)
      return ports.some((port) => toCalloutPath(port.path) === wanted)
    } catch (error: unknown) {
      logger.error(`Failed to check serial port presence: ${String(error)}`)
      return true
    }
  }

  /**
   * `serialport` enumeration → `path → manufacturer`. This is the reliable,
   * instant, cross-platform source for the *set* of ports; arduino-cli only
   * enriches it. Best-effort: any failure yields an empty map (never throws)
   * so arduino-cli-discovered ports still come through.
   */
  async #listSerialPortManufacturers(): Promise<Map<string, string | undefined>> {
    try {
      const ports = await NodeSerialPort.list()
      return new Map(ports.map((port) => [port.path, port.manufacturer]))
    } catch (error: unknown) {
      logger.error(`Failed to enumerate serial ports: ${String(error)}`)
      return new Map()
    }
  }

  /**
   * `arduino-cli board list --format json` → `path → board name`. arduino-cli
   * matches each port's USB VID/PID against the installed cores' `boards.txt`
   * — the exact identification the Arduino IDE surfaces (e.g. `Arduino Uno`,
   * `Opta`). A detected-but-unmatched port maps to `undefined` (it will fall
   * back to the manufacturer descriptor). Best-effort: a missing binary, no
   * installed cores, a spawn error, or malformed JSON all yield an empty map
   * so plain `serialport` enumeration still works. Reuses the same binary and
   * `--config-file` as compile/upload, so it sees the same installed cores.
   */
  async #identifyBoardsByPath(): Promise<Map<string, string | undefined>> {
    const boardNamesByPath = new Map<string, string | undefined>()
    try {
      let binaryPath = this.arduinoCliBinaryPath
      if (HardwareModule.HOST_PLATFORM === 'win32') binaryPath += '.exe'

      const { stdout } = await execFileAsync(
        binaryPath,
        ['board', 'list', '--format', 'json', ...this.arduinoCliBaseParameters],
        { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
      )

      const parsed = JSON.parse(stdout) as {
        detected_ports?: Array<{
          matching_boards?: Array<{ name?: string }>
          port?: { address?: string }
        }>
      }

      for (const detected of parsed.detected_ports ?? []) {
        const address = detected.port?.address
        if (!address) continue
        boardNamesByPath.set(address, detected.matching_boards?.[0]?.name)
      }
    } catch (error: unknown) {
      logger.warn(`arduino-cli board list failed; serial ports will show without board names: ${String(error)}`)
    }
    return boardNamesByPath
  }

  /**
   * Resolve compile/upload info for `boardName` from either hals.json or
   * an installed VPP package. Compiler module should call this instead
   * of reading hals.json directly.
   */
  async getBoardBuildInfo(boardName: string): Promise<BoardBuildInfo> {
    const halsContent = await readHalsFile<HalsFile>()
    const resolvePackageRelativePath = (pkgPath: string, relPath: string): string => {
      const root = pathResolve(pkgPath)
      const candidate = pathResolve(root, relPath)
      if (candidate !== root && !candidate.startsWith(root + pathSep)) {
        throw new Error(`Path "${relPath}" escapes package directory ${pkgPath}`)
      }
      return candidate
    }
    const resolver = new BoardInfoResolver({
      halsContent,
      packageManager: new PackageManagerModule(),
      resolveHalSourcePath: (rel) => join(this.sourcesDirectoryPath, 'hal', rel),
      resolvePackageRelativePath,
      readPackageFile,
    })
    return resolver.resolve(boardName)
  }

  async getAvailableBoards(): Promise<AvailableBoards> {
    const halsFileContent = await readHalsFile<HalsFile>()
    const arduinoCoreFileContent = await HardwareModule.readJSONFile<{ [core: string]: string }[]>(
      this.arduinoCoreFilePath,
    )

    let availableBoards: AvailableBoards = new Map()

    for (const [board, boardData] of Object.entries(halsFileContent)) {
      const coreVersion = arduinoCoreFileContent.find((core) => Object.keys(core)[0] === boardData.core)?.[
        boardData.core
      ]

      availableBoards = produce(availableBoards, (draft) => {
        draft.set(board, {
          compiler: boardData.compiler,
          core: boardData.core,
          ...(boardData.platform ? { platform: boardData.platform } : {}),
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
          ...(boardData.debug ? { debug: boardData.debug } : {}),
        })
      })
    }
    const mutableBoards: AvailableBoards = new Map(availableBoards)
    await this.#mergeVppBoards(mutableBoards)

    return orderBoardsByVppGroup(mutableBoards)
  }

  async #mergeVppBoards(boards: AvailableBoards): Promise<void> {
    try {
      const packageManager = new PackageManagerModule()
      const installed = packageManager.listInstalled()
      for (const pkg of installed) {
        const manifest = packageManager.getInstalledPackageManifest(pkg.packageId)
        if (!manifest) continue

        for (const device of manifest.devices) {
          const screens: Record<string, unknown> = {}
          if (device.screens) {
            for (const [screenName, screenFile] of Object.entries(device.screens)) {
              const screenPath = join(pkg.path, screenFile)
              if (existsSync(screenPath)) {
                try {
                  screens[screenName] = await HardwareModule.readJSONFile(screenPath)
                  // eslint-disable-next-line no-empty
                } catch {}
              }
            }
          }

          const compiler = device.target.type === 'runtime-v4' ? 'openplc-compiler' : 'arduino-cli'

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
                device.moduleSystem.modules.map(async (m) =>
                  toVppModuleDefinition(m, await loadModuleConfigScreen(m.configScreen)),
                ),
              )
            : []

          const pluginName = await HardwareModule.#readPluginName(pkg.path, device.hal?.configTemplate)

          boards.set(device.name, {
            compiler,
            core: device.target.core ?? '',
            uploadMethod: device.target.uploadMethod,
            ...(device.target.platform ? { platform: device.target.platform } : {}),
            preview: device.preview,
            specs: device.specs ?? {},
            pins: {
              defaultDin: device.defaults?.pins?.defaultDin,
              defaultDout: device.defaults?.pins?.defaultDout,
              defaultAin: device.defaults?.pins?.defaultAin,
              defaultAout: device.defaults?.pins?.defaultAout,
              ...(device.defaults?.pins?.pull ? { pull: device.defaults.pins.pull } : {}),
            },
            platformOptions:
              device.target.platformOptions && device.target.platformOptions.length > 0
                ? device.target.platformOptions
                : undefined,
            capabilities: device.capabilities,
            vpp: {
              packageId: manifest.package.id,
              vendor: manifest.package.vendor.name,
              deviceId: device.id,
              packagePath: pkg.path,
              screens,
              ...(device.hidesNativeScreens ? { hidesNativeScreens: device.hidesNativeScreens } : {}),
              ...(pluginName ? { pluginName } : {}),
              moduleSystem: device.moduleSystem
                ? {
                    enabled: device.moduleSystem.enabled,
                    maxSlots: device.moduleSystem.maxSlots,
                    discoverySupported: device.moduleSystem.discoverySupported === true,
                    modules,
                  }
                : null,
            },
            ...boardHardwareFromManifestDevice(device),
            ...(device.debug ? { debug: device.debug } : {}),
          })
        }
      }
    } catch (err) {
      logger.error(`Failed to load VPP packages: ${String(err)}`)
    }
  }

  /** Plugin name from the device's config template, or null when it is absent, unreadable or unsafe. */
  static async #readPluginName(packagePath: string, configTemplate: string | undefined): Promise<string | null> {
    if (!configTemplate) return null
    const templatePath = join(packagePath, configTemplate)
    try {
      assertPathContained(packagePath, templatePath, 'hal.configTemplate')
      if (!existsSync(templatePath)) return null
      const parsed: unknown = await HardwareModule.readJSONFile(templatePath)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      return resolveConfigTemplatePluginName(parsed as Record<string, unknown>)
    } catch {
      return null
    }
  }

  async getBoardImagePreview(image: string, packagePath?: string) {
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
