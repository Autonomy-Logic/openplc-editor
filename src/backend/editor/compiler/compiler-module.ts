import { exec, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { join } from 'node:path'
import { promisify } from 'node:util'

// strucpp is loaded lazily because it uses ESM features (import.meta) that are
// incompatible with Jest's CJS transform. The actual import happens in handleCompileSTtoCpp().
type StrucppCompile = typeof import('strucpp')['compile']

import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import { generateEthercatConfig } from '@root/backend/shared/ethercat/generate-ethercat-config'
import type { DeviceConfiguration, DevicePin } from '@root/backend/shared/types/PLC/devices'
import type { PLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import {
  type CppPouData as CppPouDataCode,
  generateCBlocksCode,
} from '@root/backend/shared/utils/cpp/generateCBlocksCode'
import {
  type CppPouData as CppPouDataHeader,
  generateCBlocksHeader,
} from '@root/backend/shared/utils/cpp/generateCBlocksHeader'
import { generateModbusMasterConfig } from '@root/backend/shared/utils/modbus/generate-modbus-master-config'
import { XmlGenerator } from '@root/backend/shared/utils/PLC/xml-generator'
import { parsePlcStatus } from '@root/backend/shared/utils/plc-status'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { generateModbusSlaveConfig } from '@root/frontend/utils/modbus/generate-modbus-slave-config'
import { generateOpcUaConfig, OpcUaConfigError } from '@root/frontend/utils/opcua'
import { generateS7CommConfig } from '@root/frontend/utils/s7comm'
import { app as electronApp, dialog } from 'electron'
import type { MessagePortMain } from 'electron/main'
import JSZip from 'jszip'

import { CreateXMLFile } from '../utils'
import type { ArduinoCoreControl, HalsFile } from './types'
import { FormatMacAddress } from './utils/formatters'

interface MethodsResult<T> {
  success: boolean
  data?: T
}
type HandleOutputDataCallback = (chunk: Buffer | string, logLevel?: 'info' | 'error') => void

type CompileArduinoProgramArgs = {
  boardTarget: string
  boardHalsContent: HalsFile[string]
  compilationPath: string
  handleOutputData: HandleOutputDataCallback
}

class CompilerModule {
  binaryDirectoryPath: string
  sourceDirectoryPath: string
  halsFilePath: string

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]

  xml2stBinaryPath: string

  strucppRuntimeDir: string
  strucppLibsDir: string

  // ############################################################################
  // =========================== Static properties ==============================
  // ############################################################################
  static readonly HOST_PLATFORM = process.platform
  static readonly HOST_ARCHITECTURE = process.arch
  static readonly DEVELOPMENT_MODE = process.env.NODE_ENV === 'development'
  // This will later be replaced by platform specific libraries
  static readonly GLOBAL_LIBRARIES = [
    'Arduino_EdgeControl',
    'ArduinoJson',
    'Arduino_MachineControl',
    'ArduinoMqttClient',
    'AVR_PWM',
    'CAN',
    'CONTROLLINO',
    'DallasTemperature',
    'Ethernet',
    'megaAVR_PWM',
    'OneWire',
    'P1AM',
    'Portenta_H7_PWM',
    'PubSubClient',
    'RP2040_PWM',
    'SAMD_PWM',
    'SAMDUE_PWM',
    'STM32_CAN',
    'STM32_PWM',
    'WiFiNINA',
  ]

  // Runtime API polling configuration (important-comment)
  // 20 minutes — large projects (50+ POUs) on a Pi 4 can take 10–15 min
  // to compile generated.cpp + generated_debug.cpp at -O1, so 5 min was
  // cutting off legitimate builds. The runtime side keeps emitting status
  // while alive; this is just an absolute ceiling. (important-comment)
  static readonly COMPILATION_STATUS_TIMEOUT_MS = 20 * 60 * 1000
  static readonly COMPILATION_STATUS_POLL_INTERVAL_MS = 1000 // 1 second (important-comment)

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourceDirectoryPath = this.#constructSourceDirectoryPath()
    this.halsFilePath = this.#constructHalsFilePath()

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    // INFO: We use this approach because some commands can receive additional parameters as a string array.
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]

    this.xml2stBinaryPath = this.#constructXml2stBinaryPath()

    this.strucppRuntimeDir = this.#constructStrucppRuntimeDir()
    this.strucppLibsDir = this.#constructStrucppLibsDir()
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

  private parseLogLevel(message: string): { level: 'info' | 'warning' | 'error'; cleanedMessage: string } {
    const logLevelMatch = message.match(/^\[(INFO|WARNING|ERROR)\]\s*/)

    if (logLevelMatch) {
      const level = logLevelMatch[1].toLowerCase() as 'info' | 'warning' | 'error'
      const cleanedMessage = message.replace(/^\[(INFO|WARNING|ERROR)\]\s*/, '')
      return {
        level,
        cleanedMessage,
      }
    }

    return {
      level: 'info',
      cleanedMessage: message,
    }
  }

  // Initialize paths based on the environment
  #constructBinaryDirectoryPath(): string {
    if (CompilerModule.HOST_ARCHITECTURE !== 'x64' && CompilerModule.HOST_ARCHITECTURE !== 'arm64') return ''
    const platformSpecificPath = join(CompilerModule.HOST_PLATFORM, CompilerModule.HOST_ARCHITECTURE)
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'bin',
      CompilerModule.DEVELOPMENT_MODE ? platformSpecificPath : '',
    )
  }

  #constructSourceDirectoryPath(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'sources',
    )
  }

  #constructHalsFilePath(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'sources',
      'boards',
      'hals.json',
    )
  }

  #constructArduinoCliBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'arduino-cli')
  }

  #constructXml2stBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'xml2st', CompilerModule.HOST_PLATFORM === 'darwin' ? 'xml2st' : '')
  }

  #constructStrucppRuntimeDir(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'strucpp',
      'runtime',
      'include',
    )
  }

  #constructStrucppLibsDir(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'strucpp',
      'libs',
    )
  }

  async #getBoardRuntime(board: string) {
    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)
    if (halsFileContent[board]) {
      return halsFileContent[board]['compiler']
    }

    // Board not found in hals.json or installed VPP packages

    throw new Error(`Board "${board}" not found in hals.json or installed VPP packages`)
  }

  #executeXml2st(args: string[]) {
    let xml2stBinaryPath = this.xml2stBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      xml2stBinaryPath += '.exe'
    }
    return spawn(xml2stBinaryPath, args)
  }

  #executeArduinoCliCommand(args: string[]) {
    let arduinoCliBinaryPath = this.arduinoCliBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      arduinoCliBinaryPath += '.exe'
    }
    return spawn(arduinoCliBinaryPath, args)
  }

  // ############################################################################
  // =========================== Public methods =================================
  // ############################################################################

  // ++ ========================= Utility methods ============================= ++

  getHostHardwareInfo() {
    return `
      System Architecture - ${process.arch}
      Operating System - ${process.platform}
      Processor - ${process.env.PROCESSOR_IDENTIFIER}
      Logical CPU Cores - ${os.cpus().length}
      CPU Frequency - ${os.cpus()[0].speed} MHz
      CPU Model - ${os.cpus()[0].model}
    `
  }

  async checkArduinoCliAvailability(): Promise<MethodsResult<string>> {
    let binaryPath = this.arduinoCliBinaryPath
    const [flag, configFilePath] = this.arduinoCliBaseParameters
    const executeCommand = promisify(exec)

    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }
    // INFO: We use the version command to check if the arduino-cli is available.
    // INFO: If the command is not available, it will throw an error.
    const { stdout, stderr } = await executeCommand(`"${binaryPath}" version ${flag} "${configFilePath}" --json`)
    if (stderr) {
      throw new Error(`Arduino CLI not available: ${stderr}`)
    }

    /**
     * Parses the JSON output from the Arduino CLI.
     * @example The output will be like:
     * {
     *  "Application": "arduino-cli",
     *  "VersionString": "x.y.z",
     *  "Commit": "commit-hash",
     *  "Status": "version-status",
     *  "Date": "release-date",
     * }
     * @updatedAt 17/07/2025
     */
    const stdoutAsJsonObject = JSON.parse(stdout) as Record<string, string>

    const { VersionString } = stdoutAsJsonObject

    return { success: true, data: VersionString }
  }

  checkStrucppAvailability(): MethodsResult<string> {
    try {
      // Lazy import — strucpp uses ESM features incompatible with Jest's CJS transform
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getVersion } = require('strucpp') as { getVersion: () => string }
      return { success: true, data: getVersion() }
    } catch {
      throw new Error('STruC++ not available. Run "npm run setup:binaries" to install it.')
    }
  }

  async getArduinoInstalledCores() {
    const coreControlFilePath = join(electronApp.getPath('userData'), 'User', 'Runtime', 'arduino-core-control.json')
    const coreControlFileContent = await CompilerModule.readJSONFile<ArduinoCoreControl>(coreControlFilePath)
    return coreControlFileContent
  }

  async getArduinoInstalledLibraries() {
    const libraryControlFilePath = join(
      electronApp.getPath('userData'),
      'User',
      'Runtime',
      'arduino-library-control.json',
    )
    const libraryControlFileContent =
      await CompilerModule.readJSONFile<Array<Record<string, string>>>(libraryControlFilePath)

    const installedLibraries = libraryControlFileContent.map((lib) => Object.keys(lib)[0])

    return installedLibraries
  }

  // ++ =========================== Defines.h methods ==========================++
  async createMD5Hash(content: string): Promise<string> {
    const crypto = await import('node:crypto')
    return crypto.createHash('md5').update(content).digest('hex')
  }
  // ++ ========================= Build Steps ================================= ++

  // +++++++++++++++++++++++++ Initialization Methods ++++++++++++++++++++++++++++
  async createBasicDirectories(
    projectFolderPath: string,
    boardTarget: string,
  ): Promise<MethodsResult<string | string[]>> {
    let result: MethodsResult<string | string[]> = { success: false }
    const buildDirectory = join(projectFolderPath, 'build')
    const boardDirectory = join(buildDirectory, boardTarget)
    const sourceDirectory = join(boardDirectory, 'src')

    // Clean the board directory to remove stale files from previous builds
    await fs.rm(boardDirectory, { recursive: true, force: true })

    // Recreate the directories
    const results = await Promise.all([
      mkdir(boardDirectory, { recursive: true }),
      mkdir(sourceDirectory, { recursive: true }),
    ])
    if (results[0] || results[1]) {
      result = { success: true, data: [boardDirectory, sourceDirectory] }
    } else {
      result = { success: true }
    }

    return result
  }

  // INFO: This method is a placeholder for copying static files.
  async copyStaticFiles(compilationPath: string, boardTarget: string): Promise<MethodsResult<string>> {
    const sourceTargetFolderPath = join(compilationPath, 'src')

    const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
    const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'Baremetal')

    const filesToCopy: Promise<void>[] = []

    if (boardTarget !== 'openplc-compiler') {
      // Arduino targets: headers go flat next to the sketch (Baremetal.ino
      // includes "iec_var.hpp" etc. directly).
      filesToCopy.push(
        cp(staticArduinoFilesPath, sourceTargetFolderPath, { recursive: true }),
        this.copyStrucppRuntimeHeaders(sourceTargetFolderPath),
        cp(staticBaremetalFilesPath, join(compilationPath, 'examples', 'Baremetal'), { recursive: true }),
      )
    } else {
      // OpenPLC Runtime v4 target: headers go under strucpp_runtime/include/
      // — that's where the runtime's scripts/compile.sh expects them after
      // extracting the upload zip into core/generated/.
      const cBlocksHeaderPath = join(this.sourceDirectoryPath, 'arduino', 'c_blocks.h')
      filesToCopy.push(
        this.copyStrucppRuntimeHeaders(join(sourceTargetFolderPath, 'strucpp_runtime', 'include')),
        cp(cBlocksHeaderPath, join(sourceTargetFolderPath, 'c_blocks.h')),
      )
    }

    try {
      await Promise.all(filesToCopy)
      return { success: true, data: 'Static build files available' }
    } catch (error) {
      throw new Error(`Error copying static files: ${error as string}`)
    }
  }

  /**
   * Copy STruC++ C++ runtime headers to the target directory.
   * These headers are downloaded by scripts/download-binaries.ts from the STruC++ release.
   */
  private async copyStrucppRuntimeHeaders(targetDir: string): Promise<void> {
    const runtimeDir = this.strucppRuntimeDir
    try {
      await fs.access(runtimeDir)
    } catch {
      throw new Error(
        `STruC++ runtime headers not found at ${runtimeDir}. Run "npm run setup:binaries" to download them.`,
      )
    }
    // Ensure the target directory exists. v4 passes a nested path
    // (strucpp_runtime/include) that may not exist yet.
    await fs.mkdir(targetDir, { recursive: true })
    const files = await readdir(runtimeDir)
    await Promise.all(files.map((file) => cp(join(runtimeDir, file), join(targetDir, file))))
  }

  // +++++++++++++++++++++++++++ Compilation Methods +++++++++++++++++++++++++++++

  async handleGenerateXMLfromJSON(sourceTargetFolderPath: string, jsonData: PLCProjectData) {
    return new Promise<MethodsResult<{ xmlPath: string; xmlContent: string }>>((resolve, reject) => {
      const { data: xmlData } = XmlGenerator(jsonData as Parameters<typeof XmlGenerator>[0], 'old-editor')
      if (typeof xmlData !== 'string') {
        reject(new Error('XML data is not a string'))
        return
      }

      const xmlCreationResult = CreateXMLFile(sourceTargetFolderPath, xmlData, 'plc')

      if (xmlCreationResult.success) {
        resolve({ success: true, data: { xmlPath: sourceTargetFolderPath, xmlContent: xmlData } })
      } else {
        reject(new Error('Failed to create XML file'))
      }
    })
  }

  async handleTranspileXMLtoST(
    generatedXMLFilePath: string,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ) {
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = this.#executeXml2st(['--generate-st', generatedXMLFilePath])

      let stderrData = ''

      // INFO: We use the xml2st command to transpile the XML file to ST.
      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })

      executeCommand.on('close', (code) => {
        if (code === 0) {
          handleOutputData(`ST file generated at: ${generatedXMLFilePath.replace('plc.xml', 'program.st')}`, 'info')
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`xml2st process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleCompileSTtoCpp(
    sourceTargetFolderPath: string,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ): Promise<{ md5Hash: string }> {
    const stFilePath = join(sourceTargetFolderPath, 'program.st')
    const stSource = await readFile(stFilePath, { encoding: 'utf8' })

    handleOutputData('Compiling Structured Text to C++ with STruC++...', 'info')

    // Lazy import to avoid ESM/CJS issues at module load time (Jest compatibility)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { compile: strucppCompile } = require('strucpp') as { compile: StrucppCompile }

    const libsDir = this.strucppLibsDir
    let libraryPaths: string[] = []
    try {
      await fs.access(libsDir)
      libraryPaths = [libsDir]
    } catch {
      // No libs directory available, compile without libraries
    }

    // Precompute MD5 so STruC++ can embed it into debugMap (so the editor
    // can detect stale layouts without re-reading program.st).
    const md5Hash = crypto.createHash('md5').update(stSource).digest('hex')

    const result = strucppCompile(stSource, {
      headerFileName: 'generated.hpp',
      debug: true,
      lineMapping: true,
      libraryPaths,
      md5: md5Hash,
    })

    if (!result.success) {
      const msgs = result.errors.map((e) => `Line ${e.line}: ${e.message}`).join('\n')
      throw new Error(`STruC++ compilation failed:\n${msgs}`)
    }

    for (const warn of result.warnings) {
      handleOutputData(`Warning at line ${warn.line}: ${warn.message}`, 'info')
    }

    await writeFile(join(sourceTargetFolderPath, 'generated.cpp'), result.cppCode, { encoding: 'utf8' })
    await writeFile(join(sourceTargetFolderPath, 'generated.hpp'), result.headerCode, { encoding: 'utf8' })

    // Phase 4 debugger artifacts (present starting with strucpp v0.3.0).
    // debugTableCpp is the per-project pointer table for generated_debug.cpp.
    // debugMap is the editor-consumed manifest (path -> (arrayIdx, elemIdx)).
    if (result.debugTableCpp !== undefined) {
      await writeFile(
        join(sourceTargetFolderPath, 'generated_debug.cpp'),
        result.debugTableCpp,
        { encoding: 'utf8' },
      )
    }
    if (result.debugMap !== undefined) {
      await writeFile(
        join(sourceTargetFolderPath, 'debug-map.json'),
        JSON.stringify(result.debugMap, null, 2),
        { encoding: 'utf8' },
      )
      handleOutputData(
        `Debug map: ${result.debugMap.leaves.length} leaves in ${result.debugMap.arrays.length} arrays`,
        'info',
      )
    }

    handleOutputData(`C++ files generated at: ${sourceTargetFolderPath}`, 'info')
    handleOutputData(`Program MD5: ${md5Hash}`, 'info')

    return { md5Hash }
  }

  // Debug file generation and glue variable generation are no longer needed.
  // STruC++ generates located variable descriptors (locatedVars[]) in the C++ output,
  // and the Arduino sketch walks them dynamically for I/O binding.
  // The debugger will be redesigned in Phase 4.

  // TODO: This method is used to update the index of the Arduino core.
  // We should validate if this is necessary and if it works correctly.
  async handleCoreUpdateIndex(handleOutputData: HandleOutputDataCallback) {
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      let binaryPath = this.arduinoCliBinaryPath
      const [flag, configFilePath] = this.arduinoCliBaseParameters

      if (CompilerModule.HOST_PLATFORM === 'win32') {
        // INFO: On Windows, we need to add the .exe extension to the binary path.
        binaryPath += '.exe'
      }
      const executeCommand = spawn(binaryPath, ['core', 'update-index', flag, configFilePath])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleCoreInstallation(
    boardCore: string | null,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ) {
    if (boardCore === null) return

    const isCoreInstalled = Object.keys(await this.getArduinoInstalledCores()).some((core) => core === boardCore)
    if (isCoreInstalled) {
      handleOutputData(`Core ${boardCore} is already installed.`, 'info')
      return
    }

    let binaryPath = this.arduinoCliBinaryPath

    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = spawn(binaryPath, ['core', 'install', boardCore, ...this.arduinoCliBaseParameters])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  // Handle library installation
  // In the future, this method will be responsible for installing any missing libraries.
  // This should receive a list of libraries to install.
  async handleLibraryInstallation(handleOutputData: HandleOutputDataCallback) {
    // 1. Check what are the required libraries for the project - This will be the global libraries and the extra libraries that comes from the hals.json file.
    // This will be filled later, for now is just a placeholder.
    const extraLibraries: string[] = ['P1AM'] // We provide this value just for testing purposes.
    const requiredLibraries = Array.from(new Set([...CompilerModule.GLOBAL_LIBRARIES, ...extraLibraries]))

    // 2. Check if all required libraries are already installed
    const installedLibraries = await this.getArduinoInstalledLibraries()
    const missingLibraries = requiredLibraries.filter((lib) => !installedLibraries.includes(lib))

    if (missingLibraries.length === 0) {
      handleOutputData(`All required libraries are already installed.`, 'info')
      return
    }

    let binaryPath = this.arduinoCliBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }

    // 3. If not installed, run the installation command
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = spawn(binaryPath, [
        'lib',
        'install',
        ...missingLibraries,
        ...this.arduinoCliBaseParameters,
      ])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          handleOutputData(`All libraries installed!`, 'info')
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
    // 4. Update the library index
  }

  // TODO: This method is used to update the index of the Arduino libraries.
  // We should validate if this is necessary and if it works correctly.
  async handleLibraryUpdateIndex(handleOutputData: HandleOutputDataCallback) {
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      let binaryPath = this.arduinoCliBinaryPath
      const [flag, configFilePath] = this.arduinoCliBaseParameters

      if (CompilerModule.HOST_PLATFORM === 'win32') {
        // INFO: On Windows, we need to add the .exe extension to the binary path.
        binaryPath += '.exe'
      }
      const executeCommand = spawn(binaryPath, ['lib', 'update-index', flag, configFilePath])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleGenerateDefinitionsFile({
    projectPath,
    buildMD5Hash,
    boardTarget,
    boardRuntime,
    _handleOutputData,
  }: {
    projectPath: string
    boardTarget: string
    buildMD5Hash: string
    boardRuntime: string
    _handleOutputData: HandleOutputDataCallback
  }) {
    let DEFINES_CONTENT: string = ''

    // === Directories and files paths ===
    const devicesDirectoryPath = join(projectPath, 'devices')
    const devicesConfigurationFilePath = join(devicesDirectoryPath, 'configuration.json')
    const devicesPinMappingFilePath = join(devicesDirectoryPath, 'pin-mapping.json')

    const buildTargetDirectoryPath = join(projectPath, 'build', boardTarget)

    const stProgramFilePath = join(buildTargetDirectoryPath, 'src', 'program.st')

    const definitionsFilePath = join(buildTargetDirectoryPath, 'examples', 'Baremetal', 'defines.h')

    // === Files contents that we need ===
    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)
    const {
      communicationConfiguration: { modbusRTU, modbusTCP, communicationPreferences },
    } = await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
    const devicePinMapping = await CompilerModule.readJSONFile<DevicePin[]>(devicesPinMappingFilePath)
    const stProgramFileContent = await readFile(stProgramFilePath, 'utf-8')

    // We extract the board entry from the hals file content to validate if it has the define property.
    const boardEntry = halsFileContent[boardTarget]

    // ===== Defines.h content generation =====

    // 1. We need to verify if the board entry in the hals.json file has the define property.
    if (boardEntry && boardEntry.define) {
      // 1.2. If it has the defines property, we will write a header and iterate over the defines to create the content for the defines.h file.
      DEFINES_CONTENT = '// Board defines\n'
      if (Array.isArray(boardEntry.define)) {
        // 1.3. If the defines property is an array, we will iterate over it and add each define to the content.
        boardEntry.define.forEach((define) => {
          DEFINES_CONTENT += `#define ${define}\n`
        })
      } else if (typeof boardEntry.define === 'string') {
        // 1.4. If the defines property is a string, we will add it directly to the content.
        DEFINES_CONTENT += `#define ${boardEntry.define}\n`
      }
    }

    // 2. If the board entry does not have the define property, we will just write a double line break to the file.
    DEFINES_CONTENT += '\n\n'

    // 3. Now we write the information for the defines.h file based on the device configuration and other preferences.

    /**
     * TODOS
     * 3. In the device configuration we need to verify why the values that should be null are being set to empty strings.
     * 4. We need to ensure that the pins are correctly sorted according to their address.
     */

    // 3.1. Program MD5
    DEFINES_CONTENT += '//Program MD5\n'
    DEFINES_CONTENT += `#define PROGRAM_MD5 "${buildMD5Hash}"`
    DEFINES_CONTENT += `\n\n`

    // 3.2. Device Configuration
    DEFINES_CONTENT += '//Comms Configuration\n'
    if (boardRuntime === 'simulator') {
      // Simulator forces fixed Modbus RTU settings over emulated USART0.
      // On ATmega2560, Serial = USART0. avr8js bridges usart0.
      DEFINES_CONTENT += '#define SIMULATOR_MODE\n'
      DEFINES_CONTENT += '#define MBSERIAL_IFACE Serial\n'
      DEFINES_CONTENT += '#define MBSERIAL_BAUD 115200\n'
      DEFINES_CONTENT += '#define MBSERIAL_SLAVE 1\n'
    } else {
      DEFINES_CONTENT += `#define MBSERIAL_IFACE ${modbusRTU.rtuInterface}\n`
      DEFINES_CONTENT += `#define MBSERIAL_BAUD ${modbusRTU.rtuBaudRate}\n`
      if (modbusRTU.rtuSlaveId !== null) DEFINES_CONTENT += `#define MBSERIAL_SLAVE ${modbusRTU.rtuSlaveId}\n`
      if (modbusRTU.rtuRS485ENPin !== null) DEFINES_CONTENT += `#define MBSERIAL_TXPIN ${modbusRTU.rtuRS485ENPin}\n`
    }
    if (modbusTCP.tcpMacAddress !== null)
      DEFINES_CONTENT += `#define MBTCP_MAC ${FormatMacAddress(modbusTCP.tcpMacAddress)}\n`
    // OBS: This is giving us an empty string and this is being printed as a space
    if (modbusTCP.tcpStaticHostConfiguration.ipAddress !== null)
      DEFINES_CONTENT += `#define MBTCP_IP ${modbusTCP.tcpStaticHostConfiguration.ipAddress.replaceAll('.', ',')}\n`
    if (modbusTCP.tcpStaticHostConfiguration.dns !== null)
      DEFINES_CONTENT += `#define MBTCP_DNS ${modbusTCP.tcpStaticHostConfiguration.dns.replaceAll('.', ',')}\n`
    if (modbusTCP.tcpStaticHostConfiguration.gateway !== null)
      DEFINES_CONTENT += `#define MBTCP_GATEWAY ${modbusTCP.tcpStaticHostConfiguration.gateway.replaceAll('.', ',')}\n`
    if (modbusTCP.tcpStaticHostConfiguration.subnet !== null)
      DEFINES_CONTENT += `#define MBTCP_SUBNET ${modbusTCP.tcpStaticHostConfiguration.subnet.replaceAll('.', ',')}\n`

    if (communicationPreferences.enabledRTU || boardRuntime === 'simulator') {
      DEFINES_CONTENT += '#define MBSERIAL\n'
      DEFINES_CONTENT += '#define MODBUS_ENABLED\n'
    }

    if (communicationPreferences.enabledTCP) {
      DEFINES_CONTENT += '#define MBTCP\n'
      DEFINES_CONTENT += '#define MODBUS_ENABLED\n'
      if (modbusTCP.tcpInterface === 'Wi-Fi') {
        if (modbusTCP.tcpWifiSSID !== null) {
          DEFINES_CONTENT += `#define MBTCP_SSID "${modbusTCP.tcpWifiSSID}"\n`
        }
        if (modbusTCP.tcpWifiPassword !== null) {
          DEFINES_CONTENT += `#define MBTCP_PWD "${modbusTCP.tcpWifiPassword}"\n`
        }
        DEFINES_CONTENT += '#define MBTCP_WIFI\n'
      } else {
        DEFINES_CONTENT += '#define MBTCP_ETHERNET\n'
      }
    }

    DEFINES_CONTENT += `\n\n`

    // INFO: If null, only the define value
    // 3.3. IO Config defines
    DEFINES_CONTENT += '//IO Config\n'
    // INFO: This approach assumes that the pins are sorted.
    const digitalInputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalInput')
    const analogInputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogInput')
    const digitalOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalOutput')
    const analogOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogOutput')

    DEFINES_CONTENT += `#define PINMASK_DIN ${digitalInputPins.map(({ pin }) => pin).join(', ')}\n`
    DEFINES_CONTENT += `#define PINMASK_AIN ${analogInputPins.map(({ pin }) => pin).join(', ')}\n`
    DEFINES_CONTENT += `#define PINMASK_DOUT ${digitalOutputPins.map(({ pin }) => pin).join(', ')}\n`
    DEFINES_CONTENT += `#define PINMASK_AOUT ${analogOutputPins.map(({ pin }) => pin).join(', ')}\n`

    DEFINES_CONTENT += `#define NUM_DISCRETE_INPUT ${digitalInputPins.length}\n`
    DEFINES_CONTENT += `#define NUM_ANALOG_INPUT ${analogInputPins.length}\n`
    DEFINES_CONTENT += `#define NUM_DISCRETE_OUTPUT ${digitalOutputPins.length}\n`
    DEFINES_CONTENT += `#define NUM_ANALOG_OUTPUT ${analogOutputPins.length}\n`
    DEFINES_CONTENT += `\n\n`

    // 3.4. Arduino libraries defines
    DEFINES_CONTENT += '//Arduino libraries\n'
    if (
      stProgramFileContent.includes('DS18B20;') ||
      stProgramFileContent.includes('DS18B20_2_OUT;') ||
      stProgramFileContent.includes('DS18B20_3_OUT;') ||
      stProgramFileContent.includes('DS18B20_4_OUT;') ||
      stProgramFileContent.includes('DS18B20_5_OUT;')
    ) {
      DEFINES_CONTENT += '#define USE_DS18B20_BLOCK\n'
    }

    if (stProgramFileContent.includes('P1AM_INIT;')) DEFINES_CONTENT += '#define USE_P1AM_BLOCKS\n'

    if (stProgramFileContent.includes('CLOUD_BEGIN;')) DEFINES_CONTENT += '#define USE_CLOUD_BLOCKS\n'

    if (stProgramFileContent.includes('MQTT_CONNECT;') || stProgramFileContent.includes('MQTT_CONNECT_AUTH;'))
      DEFINES_CONTENT += '#define USE_MQTT_BLOCKS\n'

    if (
      stProgramFileContent.includes('ARDUINOCAN_CONF;') ||
      stProgramFileContent.includes('ARDUINOCAN_WRITE;') ||
      stProgramFileContent.includes('ARDUINOCAN_WRITE_WORD;') ||
      stProgramFileContent.includes('ARDUINOCAN_READ;')
    ) {
      DEFINES_CONTENT += '#define USE_ARDUINOCAN_BLOCK\n'
    }

    if (
      stProgramFileContent.includes('STM32CAN_CONF;') ||
      stProgramFileContent.includes('STM32CAN_WRITE;') ||
      stProgramFileContent.includes('STM32CAN_READ;')
    ) {
      DEFINES_CONTENT += '#define USE_STM32CAN_BLOCK\n'
    }

    if (
      stProgramFileContent.includes('SM_8RELAY;') ||
      stProgramFileContent.includes('SM_16RELAY;') ||
      stProgramFileContent.includes('SM_8DIN;') ||
      stProgramFileContent.includes('SM_16DIN;') ||
      stProgramFileContent.includes('SM_4REL4IN;') ||
      stProgramFileContent.includes('SM_INDUSTRIAL;') ||
      stProgramFileContent.includes('SM_RTD;') ||
      stProgramFileContent.includes('SM_BAS;') ||
      stProgramFileContent.includes('SM_HOME;') ||
      stProgramFileContent.includes('SM_8MOSFET;')
    ) {
      DEFINES_CONTENT += '#define USE_SM_BLOCKS\n'
    }

    // 4. Finally, we attempt to write the content to the defines.h file.
    try {
      await writeFile(definitionsFilePath, DEFINES_CONTENT, { encoding: 'utf8' })
      _handleOutputData(`Defines file created at: ${definitionsFilePath}`, 'info')
    } catch (_error) {
      _handleOutputData('Error writing defines.h file', 'error')
    }
  }

  // handlePatchGeneratedFiles is no longer needed.
  // STruC++ generates clean C++ files (generated.cpp + generated.hpp) that don't require
  // patching or unity build renaming.

  async handleGenerateArduinoCppFile(projectPath: string, boardTarget: string) {
    let result: MethodsResult<string> = { success: false }

    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)

    const boardSourceFile = halsFileContent[boardTarget]['source']

    const boardSourceFilePath = join(this.sourceDirectoryPath, 'hal', boardSourceFile)
    const arduinoCppFilePath = join(projectPath, 'build', boardTarget, 'src', 'arduino.cpp')

    try {
      await cp(boardSourceFilePath, arduinoCppFilePath, { recursive: true })
      result = { success: true, data: arduinoCppFilePath }
    } catch (error) {
      throw new Error(`Error copying Arduino source file: ${(error as Error).message}`)
    }
    return result
  }

  async handleGenerateCBlocksHeader(
    projectData: PLCProjectData & { originalCppPous?: CppPouDataCode[] },
    sourceTargetFolderPath: string,
    handleOutputData: HandleOutputDataCallback,
  ) {
    const originalCppPous = projectData.originalCppPous || []

    if (originalCppPous.length === 0) {
      handleOutputData('No C/C++ blocks found, skipping c_blocks.h generation', 'info')
      return
    }

    const cppPous = originalCppPous.map((pou) => ({
      name: pou.name,
      variables: pou.variables,
    })) as CppPouDataHeader[]

    const headerContent: string = generateCBlocksHeader(cppPous)
    const headerFilePath = join(sourceTargetFolderPath, 'c_blocks.h')

    try {
      await writeFile(headerFilePath, headerContent, { encoding: 'utf8' })
      handleOutputData(`C blocks header file populated at: ${headerFilePath}`, 'info')
    } catch (error) {
      throw new Error(`Error writing c_blocks.h file: ${(error as Error).message}`)
    }
  }

  async handleGenerateCBlocksCode(
    projectData: PLCProjectData & { originalCppPous?: CppPouDataCode[] },
    compilationPath: string,
    boardRuntime: string,
    handleOutputData: HandleOutputDataCallback,
  ) {
    const originalCppPous = projectData.originalCppPous || []

    if (originalCppPous.length === 0) {
      handleOutputData('No C/C++ blocks found, skipping c_blocks_code.cpp generation', 'info')
      return
    }

    const cppPous = originalCppPous
    // generateCBlocksCode now emits the full file (baseline + per-POU
    // wrappers + user code), so we overwrite rather than append. The
    // static Baremetal/c_blocks_code.cpp baseline is now redundant for
    // projects with C++ POUs but stays as a benign empty unit for
    // Arduino projects without any.
    const codeContent = generateCBlocksCode(cppPous)

    const codeFilePath =
      boardRuntime === 'openplc-compiler'
        ? join(compilationPath, 'src', 'c_blocks_code.cpp')
        : join(compilationPath, 'examples', 'Baremetal', 'c_blocks_code.cpp')

    try {
      await writeFile(codeFilePath, codeContent, { encoding: 'utf8' })
      handleOutputData(`C blocks code file populated at: ${codeFilePath}`, 'info')
    } catch (error) {
      throw new Error(`Error writing c_blocks_code.cpp file: ${(error as Error).message}`)
    }
  }

  async handleCompileArduinoProgram({
    boardHalsContent,
    compilationPath,
    handleOutputData,
  }: CompileArduinoProgramArgs) {
    const baremetalPath = join(compilationPath, 'examples', 'Baremetal')

    let buildProjectFlags = ['compile', '-v']

    if (boardHalsContent['c_flags']) {
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `compiler.c.extra_flags=${boardHalsContent['c_flags'].map((f) => f).join(' ')}`,
      ]
    }

    if (boardHalsContent['cxx_flags']) {
      const cxxFlags = [...boardHalsContent['cxx_flags']]
      // AVR toolchains don't ship the C++ standard library (no <type_traits>, <algorithm>, etc.).
      // Add avr-libstdcpp headers so STruC++ runtime compiles on AVR targets.
      const avrLibStdCppPath = join(this.sourceDirectoryPath, 'avr-libstdcpp', 'include')
      if (boardHalsContent['core']?.startsWith('arduino:avr')) {
        cxxFlags.push(`-I "${avrLibStdCppPath}"`)
      }
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `compiler.cpp.extra_flags=${cxxFlags.join(' ')}`,
      ]
    }

    if (boardHalsContent['ld_flags']) {
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `compiler.c.elf.extra_flags=${boardHalsContent['ld_flags'].map((f: string) => f).join(' ')}`,
      ]
    }

    buildProjectFlags = [
      ...buildProjectFlags,
      '--library',
      `${join(compilationPath, 'src')}`, // STruC++ generated code + runtime headers
      '--export-binaries', // Export binaries
      '-b',
      boardHalsContent['platform'], // Board target
      join(baremetalPath, 'Baremetal.ino'), // Arduino .ino file
      ...this.arduinoCliBaseParameters, // Base parameters
    ]

    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const child = this.#executeArduinoCliCommand(buildProjectFlags)
      let stderrData = ''
      child.stdout.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      child.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true })
        } else {
          reject(new Error(`Compilation failed with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleUploadProgram({
    projectPath,
    arduinoPlatform,
    compilationPath,
    handleOutputData,
  }: {
    projectPath: string
    arduinoPlatform: string
    compilationPath: string
    handleOutputData: HandleOutputDataCallback
  }) {
    const devicesDirectoryPath = join(projectPath, 'devices')
    const devicesConfigurationFilePath = join(devicesDirectoryPath, 'configuration.json')
    const { communicationPort: port } =
      await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
    const baremetalPath = join(compilationPath, 'examples', 'Baremetal')

    if (!port) {
      handleOutputData('No communication port specified', 'error')
      return
    }

    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const child = this.#executeArduinoCliCommand([
        'upload',
        '--port',
        port,
        '--fqbn',
        arduinoPlatform,
        baremetalPath,
        ...this.arduinoCliBaseParameters,
      ])

      let stderrData = ''

      child.stdout.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      child.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Upload failed with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  // !! Deprecated: This method is a outdated implementation and should be removed.
  async createXmlFile(
    pathToUserProject: string,
    dataToCreateXml: PLCProjectData,
    parseTo: 'old-editor' | 'codesys',
  ): Promise<{ success: boolean; message: string }> {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Project',
      defaultPath: join(pathToUserProject, 'plc.xml'),
      buttonLabel: 'Save',
      filters: [{ name: 'XML Files', extensions: ['xml'] }],
    })

    if (!filePath) {
      return { success: false, message: 'User canceled the save dialog' }
    }

    const { data: projectDataAsString, message } = XmlGenerator(
      dataToCreateXml as Parameters<typeof XmlGenerator>[0],
      parseTo,
    ) as {
      data: string | undefined
      message: string
    }
    if (!projectDataAsString) {
      return { success: false, message: message }
    }

    const result = CreateXMLFile(filePath, projectDataAsString, 'plc')
    try {
      await writeFile(filePath, projectDataAsString)
      console.log('File written to:', filePath)
    } catch (err) {
      console.error('Error writing file:', err)
    }

    return {
      success: result.success,
      message: result.success ? ` XML file created at ${filePath}` : 'Failed to create XML file',
    }
  }

  // ++ ========================= Compiler builder ============================ ++

  async compressSourceFolder(sourceFolderPath: string): Promise<Buffer> {
    const zip = new JSZip()

    async function addFilesToZip(currentPath: string, zipFolder: JSZip, relativePath: string = ''): Promise<void> {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        const zipPath = relativePath ? path.join(relativePath, entry.name) : entry.name

        if (entry.isDirectory()) {
          await addFilesToZip(fullPath, zipFolder, zipPath)
        } else {
          const fileContent = await fs.readFile(fullPath)
          zipFolder.file(zipPath, fileContent)
        }
      }
    }

    await addFilesToZip(sourceFolderPath, zip)

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    return zipBuffer
  }

  async cleanConfFolder(sourceTargetFolderPath: string, handleOutputData: HandleOutputDataCallback): Promise<void> {
    const confFolderPath = join(sourceTargetFolderPath, 'conf')

    try {
      await fs.access(confFolderPath)
      await fs.rm(confFolderPath, { recursive: true })
      handleOutputData('Cleaned conf folder from previous compilation', 'info')
    } catch {
      handleOutputData('No conf folder to clean', 'info')
    }
  }

  async handleGenerateModbusSlaveConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const modbusSlaveConfig: string | null = generateModbusSlaveConfig(
      projectData.servers as Parameters<typeof generateModbusSlaveConfig>[0],
    )

    if (modbusSlaveConfig) {
      const confFolderPath = join(sourceTargetFolderPath, 'conf')
      await mkdir(confFolderPath, { recursive: true })
      const configFilePath = join(confFolderPath, 'modbus_slave.json')
      await writeFile(configFilePath, modbusSlaveConfig, 'utf-8')
      handleOutputData('Generated conf/modbus_slave.json', 'info')
    } else {
      handleOutputData('No Modbus TCP server configured, skipping modbus_slave.json generation', 'info')
    }
  }

  async handleGenerateModbusMasterConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const modbusMasterConfig: string | null = generateModbusMasterConfig(
      projectData.remoteDevices as Parameters<typeof generateModbusMasterConfig>[0],
    )

    if (modbusMasterConfig) {
      const confFolderPath = join(sourceTargetFolderPath, 'conf')
      await mkdir(confFolderPath, { recursive: true })
      const configFilePath = join(confFolderPath, 'modbus_master.json')
      await writeFile(configFilePath, modbusMasterConfig, 'utf-8')
      handleOutputData('Generated conf/modbus_master.json', 'info')
    } else {
      handleOutputData('No Modbus TCP remote devices configured, skipping modbus_master.json generation', 'info')
    }
  }

  async handleGenerateS7CommConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    try {
      const s7commConfig: string | null = generateS7CommConfig(projectData.servers)

      if (s7commConfig) {
        const confFolderPath = join(sourceTargetFolderPath, 'conf')
        await mkdir(confFolderPath, { recursive: true })
        const configFilePath = join(confFolderPath, 's7comm.json')
        await writeFile(configFilePath, s7commConfig, 'utf-8')
        handleOutputData('Generated conf/s7comm.json', 'info')
      } else {
        handleOutputData('No S7Comm server configured, skipping s7comm.json generation', 'info')
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      handleOutputData(`Failed to generate S7Comm config: ${errorMessage}`, 'error')
      throw error
    }
  }

  /**
   * Generate OPC-UA server configuration for Runtime v4.
   * Reads debug.c to resolve variable indices and generates opcua.json.
   */
  async handleGenerateOpcUaConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    try {
      // Check if there's an enabled OPC-UA server
      const opcuaServer = projectData.servers?.find(
        (s) => s.protocol === 'opcua' && s.opcuaServerConfig?.server.enabled,
      )

      if (!opcuaServer || !opcuaServer.opcuaServerConfig) {
        handleOutputData('No OPC-UA server configured, skipping opcua.json generation', 'info')
        return
      }

      // Read the debug.c file generated by xml2st
      const debugCPath = join(sourceTargetFolderPath, 'debug.c')
      let debugContent: string

      try {
        debugContent = await readFile(debugCPath, 'utf-8')
      } catch {
        handleOutputData('Warning: Could not read debug.c file. OPC-UA variable indices may not be resolved.', 'error')
        debugContent = ''
      }

      // Get instances from Resources configuration for index resolution
      const instances = projectData.configuration.resource.instances.map((inst) => ({
        name: inst.name,
        task: inst.task,
        program: inst.program,
      }))

      // Generate the OPC-UA configuration
      const opcuaJson: string | null = generateOpcUaConfig(projectData.servers, debugContent, instances)

      if (opcuaJson) {
        // Ensure conf directory exists
        const confFolderPath = join(sourceTargetFolderPath, 'conf')
        await mkdir(confFolderPath, { recursive: true })

        // Write the configuration file
        const configFilePath = join(confFolderPath, 'opcua.json')
        await writeFile(configFilePath, opcuaJson, 'utf-8')
        handleOutputData('Generated conf/opcua.json', 'info')

        // Log the number of configured nodes
        const nodeCount = opcuaServer.opcuaServerConfig.addressSpace.nodes.length
        handleOutputData(`OPC-UA Address Space: ${nodeCount} node(s) configured`, 'info')
      } else {
        handleOutputData('OPC-UA server enabled but no configuration generated', 'info')
      }
    } catch (error) {
      if (error instanceof OpcUaConfigError) {
        handleOutputData(`OPC-UA Configuration Error:\n${error.message}`, 'error')
      } else {
        const errorMessage = getErrorMessage(error)
        handleOutputData(`Failed to generate OPC-UA config: ${errorMessage}`, 'error')
      }
      throw error
    }
  }

  async handleGenerateEthercatConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const ethercatConfig = generateEthercatConfig(projectData.remoteDevices)

    if (ethercatConfig) {
      const confFolderPath = join(sourceTargetFolderPath, 'conf')
      await mkdir(confFolderPath, { recursive: true })
      const configFilePath = join(confFolderPath, 'ethercat.json')
      await writeFile(configFilePath, ethercatConfig, 'utf-8')
      handleOutputData('Generated conf/ethercat.json', 'info')
    } else {
      handleOutputData('No EtherCAT devices configured, skipping ethercat.json generation', 'info')
    }
  }

  async embedCBlocksInProgramSt(
    sourceTargetFolderPath: string,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const programStPath = join(sourceTargetFolderPath, 'program.st')
    const cBlocksHeaderPath = join(sourceTargetFolderPath, 'c_blocks.h')
    const cBlocksCodePath = join(sourceTargetFolderPath, 'c_blocks_code.cpp')

    try {
      let programStContent = await readFile(programStPath, 'utf8')

      try {
        await fs.access(cBlocksHeaderPath)
        const headerContent = await readFile(cBlocksHeaderPath, 'utf8')
        const headerLines = headerContent.split('\n')
        const embeddedHeader = headerLines.map((line) => `(*FILE:c_blocks.h ${line} *)`).join('\n')
        programStContent += '\n' + embeddedHeader

        handleOutputData('Embedded c_blocks.h into program.st for Runtime v3', 'info')
      } catch {
        handleOutputData('c_blocks.h not found, skipping embedding', 'info')
      }

      try {
        await fs.access(cBlocksCodePath)
        const codeContent = await readFile(cBlocksCodePath, 'utf8')
        const codeLines = codeContent.split('\n')
        const embeddedCode = codeLines.map((line) => `(*FILE:c_blocks_code.cpp ${line} *)`).join('\n')
        programStContent += '\n' + embeddedCode

        handleOutputData('Embedded c_blocks_code.cpp into program.st for Runtime v3', 'info')
      } catch {
        handleOutputData('c_blocks_code.cpp not found, skipping embedding', 'info')
      }

      await writeFile(programStPath, programStContent, 'utf8')
    } catch (error) {
      throw new Error(`Error embedding C blocks in program.st: ${(error as Error).message}`)
    }
  }

  /**
   * This will be the main entry point for the compiler module.
   * It will handle all the compilation process, will orchestrate the various steps involved in compiling a program.
   */
  // Work in progress - we should specify the arguments and the return type correctly.
  async compileProgram(
    args: Array<string | null | PLCProjectData>,
    _mainProcessPort: MessagePortMain,
    mainProcessBridge: {
      makeRuntimeApiRequest: <T = void>(
        ipAddress: string,
        jwtToken: string,
        endpoint: string,
        responseParser?: (data: string) => T,
      ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
    },
  ): Promise<void> {
    // Start the main process port to communicate with the renderer process.
    // INFO: This is necessary to send messages back to the renderer process.
    _mainProcessPort.start()

    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting compilation process...' })
    // INFO: We assume the first argument is the project path,
    // INFO: the second argument is the board target, and the third argument is the project data.
    const [projectPath, boardTarget, boardCore, compileOnly, projectData, runtimeIpAddress, runtimeJwtToken] = args as [
      string,
      string,
      string | null,
      boolean,
      PLCProjectData,
      string | null,
      string | null,
    ]

    const boardRuntime = await this.#getBoardRuntime(boardTarget) // Get the board runtime from the hals.json file

    const halsContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)

    const normalizedProjectPath = projectPath.replace('project.json', '')

    const compilationPath = join(normalizedProjectPath, 'build', boardTarget) // Assuming the build folder is named 'build'

    const sourceTargetFolderPath = join(compilationPath, 'src') // Assuming the source folder is named 'src'

    let buildMD5Hash: string | null = null

    // --- Print basic information ---
    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: `Compiling program for project: ${projectPath} and board target: ${boardTarget}`,
    })
    _mainProcessPort.postMessage({
      logLevel: 'warning',
      message: 'Host Hardware Info:',
    })
    _mainProcessPort.postMessage({
      message: this.getHostHardwareInfo(),
    })

    // --- Check for unsupported features on non-v4 targets ---
    // VPP boards with runtime-v4 target type use openplc-compiler and are also v4-capable
    const isRuntimeV3 = boardTarget === 'OpenPLC Runtime v3'
    const isRuntimeV4 = boardRuntime === 'openplc-compiler' && !isRuntimeV3
    const hasServers = projectData.servers && projectData.servers.length > 0
    const hasRemoteDevices = projectData.remoteDevices && projectData.remoteDevices.length > 0

    if (!isRuntimeV4 && hasServers) {
      _mainProcessPort.postMessage({
        logLevel: 'warning',
        message: `Warning: Your project contains Modbus Server configurations, but the selected target (${boardTarget}) does not support this feature. Modbus Server is only supported on OpenPLC Runtime v4. The server configurations will be ignored during compilation.`,
      })
    }

    if (!isRuntimeV4 && hasRemoteDevices) {
      _mainProcessPort.postMessage({
        logLevel: 'warning',
        message: `Warning: Your project contains Remote IO configurations, but the selected target (${boardTarget}) does not support this feature. Remote IO is only supported on OpenPLC Runtime v4. The remote device configurations will be ignored during compilation.`,
      })
    }

    // --- Check tools availability ---
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Checking tools availability...' })

    try {
      const [arduinoCliCheckResult, strucppCheckResult] = await Promise.all([
        this.checkArduinoCliAvailability(),
        Promise.resolve(this.checkStrucppAvailability()),
      ])
      _mainProcessPort.postMessage({
        message: `Arduino CLI available at version ${arduinoCliCheckResult.data}\nSTruC++ available at version ${strucppCheckResult.data}`,
      })
    } catch (_error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        message: `${_error}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 1: Create basic directories
    try {
      await this.createBasicDirectories(normalizedProjectPath, boardTarget)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Directories for compilation source files created.',
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        message: `${error}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 2: Generate XML from JSON
    let generateXMLResult: MethodsResult<{ xmlPath: string; xmlContent: string }> = { success: false }
    try {
      generateXMLResult = await this.handleGenerateXMLfromJSON(sourceTargetFolderPath, projectData)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: `Generated XML from JSON at: ${generateXMLResult.data?.xmlPath as string}`,
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error generating XML from JSON: ${error as string}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 3: Transpile XML to ST
    const generatedXMLFilePath = join(sourceTargetFolderPath, 'plc.xml') // Assuming the XML file is named 'plc.xml'
    try {
      await this.handleTranspileXMLtoST(generatedXMLFilePath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error transpiling XML to ST: ${error as string}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // -- Copy static files --
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Copying static files...' })
    try {
      await this.copyStaticFiles(compilationPath, boardRuntime)
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Static files copied successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error copying static files: ${error as string}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 4: Compile ST to C++ with STruC++ (replaces iec2c + debug + glue generation)
    try {
      const { md5Hash } = await this.handleCompileSTtoCpp(sourceTargetFolderPath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
      buildMD5Hash = md5Hash
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Step 7: Generate C/C++ blocks header file
    try {
      await this.handleGenerateCBlocksHeader(projectData, sourceTargetFolderPath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Step 8: Generate C/C++ blocks code file
    try {
      await this.handleGenerateCBlocksCode(projectData, compilationPath, boardRuntime, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Step 9: Embed C/C++ blocks in program.st for Runtime v3
    if (boardRuntime === 'openplc-compiler' && boardTarget === 'OpenPLC Runtime v3') {
      try {
        await this.embedCBlocksInProgramSt(sourceTargetFolderPath, (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
        })
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: 'Stopping compilation process.',
        })
        _mainProcessPort.close()
        return
      }
    }

    // -- Verify if the runtime target is Arduino or OpenPLC --
    // INFO: If the runtime target is Arduino, we will continue the compilation process.
    // INFO: If the runtime target is OpenPLC we will finish the process here.
    if (boardRuntime === 'openplc-compiler') {
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'OpenPLC runtime detected.',
      })
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Source files generated successfully at: ' + sourceTargetFolderPath,
      })

      // Generate Runtime v4 conf/* files for BOTH compile-only and upload flows.
      // Without this, compile-only never produces ethercat.json (and other configs),
      // so users who only want the generated sources miss runtime configuration.
      if (isRuntimeV4) {
        try {
          // defines.h next to generated.cpp — picked up by the v4 runtime
          // shim (core/strucpp_runtime/runtime_v4_entry.cpp) via
          // __has_include so strucpp_program_md5 reflects the program
          // currently loaded. FC 0x45 (DEBUG_GET_MD5) returns this so the
          // editor can verify it's debugging the matching source. Macro
          // name matches the Arduino sketch's PROGRAM_MD5 convention.
          if (buildMD5Hash) {
            await writeFile(
              join(sourceTargetFolderPath, 'defines.h'),
              `#pragma once\n// Program MD5\n#define PROGRAM_MD5 "${buildMD5Hash}"\n`,
              { encoding: 'utf8' },
            )
          }
          await this.cleanConfFolder(sourceTargetFolderPath, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateModbusSlaveConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateModbusMasterConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateS7CommConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateOpcUaConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateEthercatConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
        } catch (error) {
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message: `Error generating Runtime v4 configs: ${error instanceof Error ? error.message : String(error)}`,
          })
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message: 'Stopping compilation process.',
          })
          _mainProcessPort.close()
          return
        }
      }

      if (compileOnly) {
        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: 'Compile only mode - skipping upload to runtime.',
        })
        _mainProcessPort.postMessage({
          message:
            '-------------------------------------------------------------------------------------------------------------\n',
        })
        _mainProcessPort.close()
        return
      }

      if (!runtimeIpAddress || !runtimeJwtToken) {
        _mainProcessPort.postMessage({
          logLevel: 'warning',
          message: 'Runtime not configured or not logged in. Skipping upload to runtime.',
        })
        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: 'To upload the program, configure the runtime IP address and login in the device configuration.',
        })
        _mainProcessPort.postMessage({
          message:
            '-------------------------------------------------------------------------------------------------------------\n',
        })
        _mainProcessPort.close()
        return
      }

      try {
        let fileBuffer: Buffer
        let filename: string
        let contentType: string

        if (isRuntimeV3) {
          _mainProcessPort.postMessage({
            logLevel: 'info',
            message: 'Preparing program.st file for OpenPLC Runtime v3...',
          })
          const programStPath = join(sourceTargetFolderPath, 'program.st')

          try {
            await fs.access(programStPath)
          } catch {
            throw new Error(`Required file not found: ${programStPath}. Cannot upload to OpenPLC Runtime v3.`)
          }

          fileBuffer = await fs.readFile(programStPath)
          filename = 'program.st'
          contentType = 'text/plain'
        } else {
          // Runtime v4 conf/* files were already generated above, before the
          // compile-only early return, so compile-only flows also get them.
          _mainProcessPort.postMessage({
            logLevel: 'info',
            message: 'Compressing source files for OpenPLC Runtime v4...',
          })
          fileBuffer = await this.compressSourceFolder(sourceTargetFolderPath)
          filename = 'program.zip'
          contentType = 'application/zip'
        }

        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: `Uploading program to runtime at ${runtimeIpAddress}...`,
        })

        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)

        const header = Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`,
        )
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
        const body = Buffer.concat([header, fileBuffer, footer] as unknown as ReadonlyArray<Uint8Array>)

        await new Promise<void>((resolve, reject) => {
          const req = https.request(
            {
              hostname: runtimeIpAddress,
              port: 8443,
              path: '/api/upload-file',
              method: 'POST',
              headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                Authorization: `Bearer ${runtimeJwtToken}`,
              },
              ...getRuntimeHttpsOptions(),
            } as https.RequestOptions,
            (res: IncomingMessage) => {
              let data = ''
              res.on('data', (chunk: Buffer) => {
                data += chunk.toString()
              })
              res.on('end', () => {
                if (res.statusCode === 200) {
                  _mainProcessPort.postMessage({
                    logLevel: 'info',
                    message: 'Program uploaded successfully to runtime.',
                  })
                  try {
                    const response = JSON.parse(data) as { CompilationStatus?: string }
                    _mainProcessPort.postMessage({
                      logLevel: 'info',
                      message: `Runtime compilation started: ${response.CompilationStatus || 'COMPILING'}`,
                    })
                  } catch (_parseError) {
                    _mainProcessPort.postMessage({
                      logLevel: 'warning',
                      message: 'Could not parse runtime response',
                    })
                  }

                  const pollCompilationStatus = async () => {
                    let lastLogCount = 0
                    let shouldContinuePolling = true
                    const startTime = Date.now()
                    const timeout = CompilerModule.COMPILATION_STATUS_TIMEOUT_MS
                    const pollInterval = CompilerModule.COMPILATION_STATUS_POLL_INTERVAL_MS

                    while (shouldContinuePolling) {
                      if (Date.now() - startTime > timeout) {
                        _mainProcessPort.postMessage({
                          logLevel: 'error',
                          message: 'Compilation status polling timed out after 20 minutes.',
                        })
                        shouldContinuePolling = false
                        continue
                      }

                      await new Promise((resolve) => setTimeout(resolve, pollInterval))

                      try {
                        const result = await mainProcessBridge.makeRuntimeApiRequest<{
                          status: string
                          logs: string[]
                          exit_code: number | null
                        }>(runtimeIpAddress, runtimeJwtToken, '/api/compilation-status', (data: string) => {
                          return JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
                        })

                        if (!result.success) {
                          _mainProcessPort.postMessage({
                            logLevel: 'error',
                            message: `Error polling compilation status: ${result.error}`,
                          })
                          shouldContinuePolling = false
                          continue
                        }

                        const { status, logs, exit_code } = result.data!

                        if (logs.length > lastLogCount) {
                          const newLogs = logs.slice(lastLogCount)
                          newLogs.forEach((log) => {
                            const { level, cleanedMessage } = this.parseLogLevel(log)
                            _mainProcessPort.postMessage({
                              logLevel: level,
                              message: cleanedMessage,
                            })
                          })
                          lastLogCount = logs.length
                        }

                        if (status === 'SUCCESS') {
                          _mainProcessPort.postMessage({
                            logLevel: 'info',
                            message: `Compilation completed successfully (exit code: ${exit_code ?? 0}).`,
                          })
                          shouldContinuePolling = false
                        } else if (status === 'FAILED') {
                          _mainProcessPort.postMessage({
                            logLevel: 'error',
                            message: `Compilation failed (exit code: ${exit_code ?? 1}).`,
                          })
                          shouldContinuePolling = false
                        }
                      } catch (pollError) {
                        _mainProcessPort.postMessage({
                          logLevel: 'error',
                          message: `Error polling compilation status: ${pollError instanceof Error ? pollError.message : String(pollError)}`,
                        })
                        shouldContinuePolling = false
                      }
                    }
                  }

                  pollCompilationStatus()
                    .then(async () => {
                      if (runtimeIpAddress && runtimeJwtToken) {
                        try {
                          const statusResult = await mainProcessBridge.makeRuntimeApiRequest<string>(
                            runtimeIpAddress,
                            runtimeJwtToken,
                            '/api/status',
                            (data: string) => {
                              const response = JSON.parse(data) as { status: string }
                              return response.status
                            },
                          )

                          if (statusResult.success && statusResult.data) {
                            const status = parsePlcStatus(statusResult.data)
                            if (status) {
                              _mainProcessPort.postMessage({
                                plcStatus: status,
                              })
                            }
                          }
                        } catch (_statusError) {
                          // Silently ignore status check errors - this is a best-effort update
                        }
                      }

                      _mainProcessPort.postMessage({
                        message:
                          '-------------------------------------------------------------------------------------------------------------\n',
                      })
                      _mainProcessPort.close()
                    })
                    .catch((error) => {
                      _mainProcessPort.postMessage({
                        logLevel: 'error',
                        message: `Unexpected error in compilation polling: ${getErrorMessage(error)}`,
                      })
                      _mainProcessPort.postMessage({
                        message:
                          '-------------------------------------------------------------------------------------------------------------\n',
                      })
                      _mainProcessPort.close()
                    })

                  resolve()
                } else {
                  _mainProcessPort.postMessage({
                    logLevel: 'error',
                    message: `Upload failed: ${data || 'HTTP ' + res.statusCode}`,
                  })
                  reject(new Error(`Upload failed with status ${res.statusCode}`))
                }
              })
            },
          )
          req.setTimeout(300000, () => {
            req.destroy()
            _mainProcessPort.postMessage({
              logLevel: 'error',
              message: 'Upload request timed out after 5 minutes.',
            })
            reject(new Error('Upload timeout'))
          })
          req.on('error', (error: Error) => {
            _mainProcessPort.postMessage({
              logLevel: 'error',
              message: `Upload error: ${error.message}`,
            })
            reject(error)
          })
          req.write(body)
          req.end()
        })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: `Failed to upload to runtime: ${getErrorMessage(error)}`,
        })
        _mainProcessPort.postMessage({
          message:
            '-------------------------------------------------------------------------------------------------------------\n',
        })
        _mainProcessPort.close()
      }
      return
    }

    // Step 5: Handle core installation
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Handling core installation...' })
    try {
      await this.handleCoreInstallation(boardCore, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }
    // Step 9: Handle library installation
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Handling library installation...' })
    try {
      await this.handleLibraryInstallation((data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Step 10: Handle defines.h file generation
    try {
      if (buildMD5Hash === null) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: 'Build MD5 hash is null, cannot generate defines.h file.',
        })
        _mainProcessPort.close()
        return
      }
      await this.handleGenerateDefinitionsFile({
        projectPath: normalizedProjectPath,
        boardTarget,
        buildMD5Hash,
        boardRuntime,
        _handleOutputData: (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        },
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
    }

    // Step 11: Generate Arduino CPP file
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Generating Arduino CPP file...' })
    try {
      await this.handleGenerateArduinoCppFile(normalizedProjectPath, boardTarget)
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Arduino CPP file generated successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.close()
      return
    }

    // Step 12: Compile Arduino Program
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Compiling Arduino program...' })
    try {
      await this.handleCompileArduinoProgram({
        boardTarget,
        boardHalsContent: halsContent[boardTarget],
        compilationPath,
        handleOutputData: (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        },
      })
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Arduino program compiled successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.close()
      return
    }

    // Step 13: Upload program to board or load into simulator
    if (boardRuntime === 'simulator') {
      // For simulator targets, send the HEX firmware path back to the renderer.
      // Derive the build sub-directory from the platform FQBN (e.g. "arduino:avr:mega" → "arduino.avr.mega")
      // so it stays in sync with the hals.json entry.
      const fqbnSubDir = halsContent[boardTarget]['platform'].replaceAll(':', '.')
      const hexPath = join(compilationPath, 'examples', 'Baremetal', 'build', fqbnSubDir, 'Baremetal.ino.hex')
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Compilation successful. Loading firmware into simulator...',
      })
      _mainProcessPort.postMessage({
        simulatorFirmwarePath: hexPath,
        closePort: true,
      })
      _mainProcessPort.close()
      return
    }

    if (!compileOnly) {
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Uploading program to board...' })
      try {
        await this.handleUploadProgram({
          projectPath: normalizedProjectPath,
          arduinoPlatform: halsContent[boardTarget]['platform'],
          compilationPath,
          handleOutputData: (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          },
        })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
        })
        _mainProcessPort.close()
        return
      }
    }

    // -- Final message --
    _mainProcessPort.postMessage({
      message:
        '-------------------------------------------------------------------------------------------------------------\n',
    })

    // INFO: This step is under development.
    setTimeout(() => {
      _mainProcessPort.close()
    }, 25)
  }

  async compileForDebugger(
    args: Array<string | null | PLCProjectData>,
    _mainProcessPort: MessagePortMain,
  ): Promise<void> {
    _mainProcessPort.start()

    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting debug compilation process...' })

    const [projectPath, boardTarget, projectData] = args as [string, string, PLCProjectData]

    const boardRuntime = await this.#getBoardRuntime(boardTarget)
    const normalizedProjectPath = projectPath.replace('project.json', '')
    const compilationPath = join(normalizedProjectPath, 'build', boardTarget)
    const sourceTargetFolderPath = join(compilationPath, 'src')

    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: `Compiling for debugger - project: ${projectPath}, board: ${boardTarget}`,
    })

    try {
      const strucppCheckResult = this.checkStrucppAvailability()
      _mainProcessPort.postMessage({
        message: `STruC++ available at version ${strucppCheckResult.data}`,
      })
    } catch (_error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${String(_error)}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    try {
      await this.createBasicDirectories(normalizedProjectPath, boardTarget)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Directories for compilation source files created.',
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${getErrorMessage(error)}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    try {
      const generateXMLResult = await this.handleGenerateXMLfromJSON(sourceTargetFolderPath, projectData)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: `Generated XML from JSON at: ${generateXMLResult.data?.xmlPath as string}`,
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error generating XML from JSON: ${error as string}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    const generatedXMLFilePath = join(sourceTargetFolderPath, 'plc.xml')
    try {
      await this.handleTranspileXMLtoST(generatedXMLFilePath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error transpiling XML to ST: ${error as string}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    try {
      await this.copyStaticFiles(compilationPath, boardRuntime)
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Static files copied successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error copying static files: ${error as string}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Compile ST to C++ with STruC++ (replaces iec2c + debug + glue generation)
    try {
      await this.handleCompileSTtoCpp(sourceTargetFolderPath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping debug compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Generate C/C++ blocks header file
    try {
      await this.handleGenerateCBlocksHeader(projectData, sourceTargetFolderPath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping debug compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Generate C/C++ blocks code file
    try {
      await this.handleGenerateCBlocksCode(projectData, compilationPath, boardRuntime, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping debug compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: 'Debug compilation completed successfully.',
    })
    _mainProcessPort.postMessage({
      message:
        '-------------------------------------------------------------------------------------------------------------\n',
    })
    setTimeout(() => {
      _mainProcessPort.close()
    }, 25)
  }
}
export { CompilerModule }
