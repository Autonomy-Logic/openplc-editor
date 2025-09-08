import { exec, spawn } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { CreateXMLFile } from '@root/main/utils'
import { ProjectState } from '@root/renderer/store/slices'
import type { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { XmlGenerator } from '@root/utils'
import { app as electronApp, dialog } from 'electron'
import type { MessagePortMain } from 'electron/main'

import type { ArduinoCoreControl, HalsFile } from './compiler-types'
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

  iec2cBinaryPath: string

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

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourceDirectoryPath = this.#constructSourceDirectoryPath()
    this.halsFilePath = this.#constructHalsFilePath()

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    // INFO: We use this approach because some commands can receive additional parameters as a string array.
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]

    this.xml2stBinaryPath = this.#constructXml2stBinaryPath()

    this.iec2cBinaryPath = this.#constructIec2cBinaryPath()
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

  #constructIec2cBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'iec2c')
  }

  async #getBoardRuntime(board: string) {
    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)
    return halsFileContent[board]['compiler']
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

  async checkIec2cAvailability(): Promise<MethodsResult<string>> {
    let binaryPath = this.iec2cBinaryPath
    const executeCommand = promisify(exec)

    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }
    // INFO: We use the version command to check if the iec2c is available.
    // INFO: If the command is not available, it will throw an error.
    const { stdout, stderr } = await executeCommand(`"${binaryPath}" -v`)
    if (stderr) {
      throw new Error(`IEC2C not available: ${stderr}`)
    }

    const firstLine = stdout.split('\n')[0] // Get the first line of the output
    const lineAsArray = firstLine.split(' ') // Split the line by spaces
    const version = lineAsArray[lineAsArray.length - 1] // The version is the last element in the array

    return { success: true, data: version }
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
    // INFO: We don't need to check if the directories already exist, as mkdir with { recursive: true } will handle that.
    // INFO: We will create a build directory (if it does not exist), a board-specific directory, and a source directory within the board directory.
    let result: MethodsResult<string | string[]> = { success: false }
    const buildDirectory = join(projectFolderPath, 'build')
    const boardDirectory = join(buildDirectory, boardTarget)
    const sourceDirectory = join(boardDirectory, 'src')

    // Create the directories recursively.
    // INFO: We don't have to create the build directory separately
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
    let result: MethodsResult<string> = { success: false }
    let filesToCopy: Promise<void>[] = []

    const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
    const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'Baremetal')
    const staticMatIECLibraryFilesPath = join(this.sourceDirectoryPath, 'MatIEC', 'lib')

    const sourceTargetFolderPath = join(compilationPath, 'src')

    if (boardTarget !== 'openplc-compiler') {
      filesToCopy = [
        cp(staticArduinoFilesPath, sourceTargetFolderPath, { recursive: true }),
        cp(staticMatIECLibraryFilesPath, join(sourceTargetFolderPath, 'lib'), { recursive: true }),
        cp(staticBaremetalFilesPath, join(compilationPath, 'examples', 'Baremetal'), { recursive: true }),
      ]
    } else {
      // INFO: If the board target is OpenPLC, we only copy the MatIEC library files.
      filesToCopy = [cp(staticMatIECLibraryFilesPath, join(sourceTargetFolderPath, 'lib'), { recursive: true })]
    }

    try {
      // Implement the logic to copy static build files.
      const results = await Promise.all(filesToCopy)
      if (results.every((res) => res === undefined)) {
        result = { success: true, data: 'Static build files available' }
      }
    } catch (error) {
      throw new Error(`Error copying static files: ${error as string}`)
    }

    return result
  }

  // +++++++++++++++++++++++++++ Compilation Methods +++++++++++++++++++++++++++++

  async handleGenerateXMLfromJSON(sourceTargetFolderPath: string, jsonData: ProjectState['data']) {
    return new Promise<MethodsResult<{ xmlPath: string; xmlContent: string }>>((resolve, reject) => {
      const { data: xmlData } = XmlGenerator(jsonData, 'old-editor')
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

  async handleTranspileSTtoC(
    generatedSTFilePath: string,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ) {
    // As the iec2c binary generates the C files in the same directory as the binary location,
    // we need to set the target directory for the output files accordingly with the generated ST file path.
    const targetDirectoryForOutput = join(generatedSTFilePath.replace('program.st', ''))

    let binaryPath = this.iec2cBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }

    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = spawn(binaryPath, ['-f', '-p', '-i', '-l', generatedSTFilePath], {
        cwd: targetDirectoryForOutput,
      })

      let stderrData = ''

      // INFO: We use the iec2c command to transpile the ST file to C.
      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })

      executeCommand.on('close', (code) => {
        if (code === 0) {
          handleOutputData(`C files generated at: ${targetDirectoryForOutput}`, 'info')
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`iec2c process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleGenerateDebugFiles(
    sourceTargetFolderPath: string,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ) {
    const generatedSTFilePath = join(sourceTargetFolderPath, 'program.st') // Assuming the XML file is named 'program.st'
    const generatedVARIABLESFilePath = join(sourceTargetFolderPath, 'VARIABLES.csv') // Assuming the VARIABLES file is named 'VARIABLES.csv'

    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = this.#executeXml2st(['--generate-debug', generatedSTFilePath, generatedVARIABLESFilePath])

      let stderrData = ''

      // INFO: We use the xml2st command to generate debug files.
      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })

      executeCommand.on('close', (code) => {
        if (code === 0) {
          handleOutputData(`Debug files generated at: ${sourceTargetFolderPath}`, 'info')
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`xml2st process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleGenerateGlueVars(
    sourceTargetFolderPath: string,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ) {
    const generatedLocatedVariablesFilePath = join(sourceTargetFolderPath, 'LOCATED_VARIABLES.h')

    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = this.#executeXml2st(['--generate-gluevars', generatedLocatedVariablesFilePath])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })

      executeCommand.on('close', (code) => {
        if (code === 0) {
          handleOutputData(`Glue vars generated at: ${sourceTargetFolderPath}`, 'info')
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`xml2st process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

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
    _handleOutputData,
  }: {
    projectPath: string
    boardTarget: string
    buildMD5Hash: string
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
    DEFINES_CONTENT += `#define MBSERIAL_IFACE ${modbusRTU.rtuInterface}\n`
    DEFINES_CONTENT += `#define MBSERIAL_BAUD ${modbusRTU.rtuBaudRate}\n`
    if (modbusRTU.rtuSlaveId !== null) DEFINES_CONTENT += `#define MBSERIAL_SLAVE ${modbusRTU.rtuSlaveId}\n`
    if (modbusRTU.rtuRS485ENPin !== null) DEFINES_CONTENT += `#define MBSERIAL_TXPIN ${modbusRTU.rtuRS485ENPin}\n`
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

    if (communicationPreferences.enabledRTU) {
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

  async handlePatchGeneratedFiles(compilationPath: string, handleOutputData: HandleOutputDataCallback) {
    const pousCFilePath = join(compilationPath, 'src', 'POUS.c')
    const res0FilePath = join(compilationPath, 'src', 'Res0.c')

    const pousCContent = await readFile(pousCFilePath, { encoding: 'utf8' })
    const patchedPousCContent = `#include "POUS.h"\n#include "Config0.h"\n\n${pousCContent}`
    await writeFile(pousCFilePath, patchedPousCContent, { encoding: 'utf8' })

    const res0FileContent = await readFile(res0FilePath, { encoding: 'utf8' })

    const patchedRes0FileContent = res0FileContent.replaceAll('#include "POUS.c"', '#include "POUS.h"\n')

    await writeFile(res0FilePath, patchedRes0FileContent, { encoding: 'utf8' })
    handleOutputData('Required files patched', 'info')
  }

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
        `${boardHalsContent['c_flags'].map((f) => f).join(' ')}`,
      ]
    }

    if (boardHalsContent['cxx_flags']) {
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `${boardHalsContent['cxx_flags'].map((f) => f).join(' ')}`,
      ]
    }

    buildProjectFlags = [
      ...buildProjectFlags,
      '--library',
      `${join(compilationPath, 'src')}`, // Basic libraries
      '--library',
      `${join(compilationPath, 'src', 'lib')}`, // Arduino libraries
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

  // !! Deprecated: This method is a outdated implementation and should be removed.
  async createXmlFile(
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
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

    const { data: projectDataAsString, message } = XmlGenerator(dataToCreateXml, parseTo)
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

  /**
   * This will be the main entry point for the compiler module.
   * It will handle all the compilation process, will orchestrate the various steps involved in compiling a program.
   */
  // Work in progress - we should specify the arguments and the return type correctly.
  async compileProgram(
    args: Array<string | null | ProjectState['data']>,
    _mainProcessPort: MessagePortMain,
  ): Promise<void> {
    // Start the main process port to communicate with the renderer process.
    // INFO: This is necessary to send messages back to the renderer process.
    _mainProcessPort.start()

    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting compilation process...' })
    // INFO: We assume the first argument is the project path,
    // INFO: the second argument is the board target, and the third argument is the project data.
    const [projectPath, boardTarget, boardCore, projectData] = args as [
      string,
      string,
      string | null,
      ProjectState['data'],
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

    // --- Check tools availability ---
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Checking tools availability...' })

    try {
      const [arduinoCliCheckResult, iec2cCheckResult] = await Promise.all([
        this.checkArduinoCliAvailability(),
        this.checkIec2cAvailability(),
      ])
      _mainProcessPort.postMessage({
        message: `Arduino CLI available at version ${arduinoCliCheckResult.data}\nIEC2C available at version ${iec2cCheckResult.data}`,
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

    // Step 2.1: Generate MD5 hash of the XML file
    try {
      const xmlContentToGenerateHash = generateXMLResult.data?.xmlContent
      if (xmlContentToGenerateHash) {
        buildMD5Hash = await this.createMD5Hash(xmlContentToGenerateHash)
        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: `Build MD5 hash: ${buildMD5Hash}`,
        })
      }
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error generating MD5 hash of the XML file: ${error as string}\n`,
      })
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

    // Step 4: Generate C code from ST
    const generatedSTFilePath = join(sourceTargetFolderPath, 'program.st') // Assuming the ST file is named 'program.st'
    try {
      await this.handleTranspileSTtoC(generatedSTFilePath, (data, logLevel) => {
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

    // Step 5: Generate debug files
    try {
      await this.handleGenerateDebugFiles(sourceTargetFolderPath, (data, logLevel) => {
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

    // Step 6: Generate glue vars
    try {
      await this.handleGenerateGlueVars(sourceTargetFolderPath, (data, logLevel) => {
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

    // -- Verify if the runtime target is Arduino or OpenPLC --
    // INFO: If the runtime target is Arduino, we will continue the compilation process.
    // INFO: If the runtime target is OpenPLC we will finish the process here.
    if (boardRuntime === 'openplc-compiler') {
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'OpenPLC runtime detected, stopping compilation process.',
      })
      _mainProcessPort.postMessage({
        message:
          '-------------------------------------------------------------------------------------------------------------\n',
      })
      _mainProcessPort.close()
      return
    }

    // Step 7: Handle patch files
    try {
      await this.handlePatchGeneratedFiles(compilationPath, (data, logLevel) => {
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

    // Step 8: Handle core installation
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

    // -- Final message --
    _mainProcessPort.postMessage({
      message:
        '-------------------------------------------------------------------------------------------------------------\n',
    })

    // INFO: This step is under development.
    _mainProcessPort.close()
  }
}
export { CompilerModule }
