/* eslint-disable @typescript-eslint/unbound-method */
import { app } from 'electron'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { UserService } from './index'

// Mock dependencies
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/user/data/path'),
  },
}))

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  constants: { F_OK: 0 },
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}))

jest.mock('child_process', () => ({
  exec: jest.fn((_cmd: string, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
    if (callback) {
      callback(null, 'mock stdout', '')
    }
    return undefined
  }),
}))

// Create a mock for the promisified exec function that returns a proper object with stdout and stderr
const mockExecPromise = jest.fn().mockResolvedValue({ stdout: 'core list output', stderr: '' })

jest.mock('util', () => ({
  promisify: jest.fn().mockImplementation(() => mockExecPromise),
}))

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
}))

// Mock process.env and process.platform
const originalPlatform = process.platform
const originalEnv = process.env.NODE_ENV
const originalCwd = process.cwd

// Explicitly annotate this function to avoid unbound method warnings
function nextTick(this: void, resolve: () => void): void {
  process.nextTick(resolve)
}

describe('UserService', () => {
  beforeEach(function (this: void) {
    // Reset all mocks
    jest.clearAllMocks()

    // Mock process properties
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    process.env.NODE_ENV = 'development'
    process.cwd = jest.fn().mockReturnValue('/mock/cwd')
    // Mock resourcesPath via Object.defineProperty instead of direct assignment
    Object.defineProperty(process, 'resourcesPath', { value: '/mock/resources', configurable: true })
  })

  afterEach(function (this: void) {
    // Restore original process properties
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env.NODE_ENV = originalEnv
    process.cwd = originalCwd
  })

  describe('createDirectoryIfNotExists', () => {
    it('should not create directory if it already exists', async function (this: void) {
      // Setup
      const path = '/test/directory'

      // Mock access to succeed (directory exists)
      ;(access as jest.Mock).mockResolvedValueOnce(undefined)

      // Execute
      await UserService.createDirectoryIfNotExists(path)

      // Verify
      expect(access).toHaveBeenCalledWith(path, constants.F_OK)
      expect(mkdir).not.toHaveBeenCalled()
    })

    it('should create directory if it does not exist', async function (this: void) {
      // Setup
      const path = '/test/directory'

      // Mock access to fail (directory doesn't exist)
      ;(access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'))
      ;(mkdir as jest.Mock).mockResolvedValueOnce(undefined)

      // Execute
      await UserService.createDirectoryIfNotExists(path)

      // Verify
      expect(access).toHaveBeenCalledWith(path, constants.F_OK)
      expect(mkdir).toHaveBeenCalledWith(path, { recursive: true })
    })

    it('should handle directory already exists error', async function (this: void) {
      // Setup
      const path = '/test/directory'
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(function (this: void) {
        return undefined
      })

      // Mock access to fail (directory doesn't exist)
      ;(access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'))
      // Mock mkdir to fail with EEXIST
      const error = new Error('EEXIST')
      ;(mkdir as jest.Mock).mockRejectedValueOnce(error)

      // Execute
      await UserService.createDirectoryIfNotExists(path)

      // Verify
      expect(access).toHaveBeenCalledWith(path, constants.F_OK)
      expect(mkdir).toHaveBeenCalledWith(path, { recursive: true })
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Directory already exists'))

      // Restore console.warn
      consoleWarnSpy.mockRestore()
    })

    it('should handle other errors when creating directory', async function (this: void) {
      // Setup
      const path = '/test/directory'
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(function (this: void) {
        return undefined
      })

      // Mock access to fail (directory doesn't exist)
      ;(access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'))
      // Mock mkdir to fail with other error
      const error = new Error('Some other error')
      ;(mkdir as jest.Mock).mockRejectedValueOnce(error)

      // Execute
      await UserService.createDirectoryIfNotExists(path)

      // Verify
      expect(access).toHaveBeenCalledWith(path, constants.F_OK)
      expect(mkdir).toHaveBeenCalledWith(path, { recursive: true })
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error creating directory'))

      // Restore console.error
      consoleErrorSpy.mockRestore()
    })
  })

  describe('createJSONFileIfNotExists', () => {
    it('should create JSON file if it does not exist', async function (this: void) {
      // Setup
      const filePath = '/test/file.json'
      const data = { test: 'data' }

      // Mock writeFile to succeed
      ;(writeFile as jest.Mock).mockResolvedValueOnce(undefined)

      // Execute
      await UserService.createJSONFileIfNotExists(filePath, data)

      // Verify
      expect(writeFile).toHaveBeenCalledWith(filePath, JSON.stringify(data, null, 2), { flag: 'wx' })
    })

    it('should handle file already exists error', async function (this: void) {
      // Setup
      const filePath = '/test/file.json'
      const data = { test: 'data' }
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(function (this: void) {
        return undefined
      })

      // Mock writeFile to fail with EEXIST
      const error = new Error('EEXIST')
      ;(writeFile as jest.Mock).mockRejectedValueOnce(error)

      // Execute
      await UserService.createJSONFileIfNotExists(filePath, data)

      // Verify
      expect(writeFile).toHaveBeenCalledWith(filePath, JSON.stringify(data, null, 2), { flag: 'wx' })
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('File already exists'))

      // Restore console.warn
      consoleWarnSpy.mockRestore()
    })

    it('should handle other errors when creating file', async function (this: void) {
      // Setup
      const filePath = '/test/file.json'
      const data = { test: 'data' }
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(function (this: void) {
        return undefined
      })

      // Mock writeFile to fail with other error
      const error = new Error('Some other error')
      ;(writeFile as jest.Mock).mockRejectedValueOnce(error)

      // Execute
      await UserService.createJSONFileIfNotExists(filePath, data)

      // Verify
      expect(writeFile).toHaveBeenCalledWith(filePath, JSON.stringify(data, null, 2), { flag: 'wx' })
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error creating file'))

      // Restore console.error
      consoleErrorSpy.mockRestore()
    })
  })

  describe('constructor', () => {
    it('should initialize compilerDirectory correctly for development environment', function (this: void) {
      // Setup - already done in beforeEach

      // Execute
      const _userService = new UserService()

      // Verify
      expect(join).toHaveBeenCalledWith('/mock/cwd', 'resources', 'compilers')
    })

    it('should initialize compilerDirectory correctly for production environment', function (this: void) {
      // Setup
      process.env.NODE_ENV = 'production'

      // Execute
      const _userService = new UserService()

      // Verify
      expect(join).toHaveBeenCalledWith('/mock/resources', '', 'compilers')
    })
  })

  describe('private methods', () => {
    // Since private methods can't be directly tested, we can test them indirectly
    // through the constructor which calls #initializeUserSettingsAndHistory

    it('should initialize user settings and history during construction', async function (this: void) {
      // Setup
      // Reset the mockExecPromise to return success case
      mockExecPromise.mockResolvedValue({ stdout: 'core list output', stderr: '' })

      // Mock all the writeFile calls to succeed
      ;(writeFile as jest.Mock).mockResolvedValue(undefined)

      // Execute
      const _userService = new UserService()

      // We need to wait for the async initialization to complete
      // This is a bit hacky but necessary for testing async constructor behavior
      await new Promise<void>(nextTick)

      // Verify
      // Check that app.getPath was called for userData
      expect(app.getPath).toHaveBeenCalledWith('userData')

      // Check that directories were created
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User')
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User', 'History')
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User', 'Runtime')

      // Check that files were created
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User', 'settings.json')
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User', 'History', 'projects.json')
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User', 'History', 'libraries.json')
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User', 'arduino-cli.yaml')
      expect(join).toHaveBeenCalledWith('/mock/user/data/path', 'User', 'Runtime', 'arduino-core-control.json')
    })

    it('should handle arduino-cli core list errors', async function (this: void) {
      // Setup
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(function (this: void) {
        return undefined
      })
      // Reset the mockExecPromise to return error case
      mockExecPromise.mockResolvedValue({ stdout: '', stderr: 'some error' })

      // Execute
      const _userService = new UserService()

      // We need to wait for the async initialization to complete
      await new Promise<void>(nextTick)

      // Verify
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error listing cores'))

      // Restore console.error
      consoleErrorSpy.mockRestore()
    })
  })
})
