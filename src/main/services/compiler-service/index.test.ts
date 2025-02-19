import { exec, spawn } from 'child_process'
import { app, dialog } from 'electron'
import { access, mkdir } from 'fs/promises'
import { join } from 'path'

import { CompilerService } from './index'

jest.mock('fs/promises', () => ({
    access: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
}))

jest.mock('child_process', () => ({
    exec: jest.fn(),
    spawn: jest.fn(),
}))

jest.mock('electron', () => ({
    app: { getPath: jest.fn() },
    dialog: { showSaveDialog: jest.fn() },
}))

describe('CompilerService', () => {
    let originalEnv: NodeJS.ProcessEnv
    let service: CompilerService

    beforeEach(() => {
        jest.resetModules()
        originalEnv = process.env
        // Set default app.getPath mock
        ;(app.getPath as jest.Mock).mockReturnValue('/fake/userData')
        service = new CompilerService()
    })

    afterEach(() => {
        process.env = originalEnv
    })

    describe('Utilities functions', () => {
        test('constructCompilerDirectoryPath returns correct path in development', () => {
            process.env.NODE_ENV = 'development'
            const fakeCwd = '/fake/cwd'
            jest.spyOn(process, 'cwd').mockReturnValue(fakeCwd)
            const expected = join(fakeCwd, 'resources', 'compilers')
            expect(service.constructCompilerDirectoryPath()).toBe(expected)
        })

        test('constructCompilerDirectoryPath returns correct path in production', () => {
            process.env.NODE_ENV = ''
            const fakeResourcesPath = '/fake/resources'
            // Simulate production environment: process.resourcesPath is available.
            (process as any).resourcesPath = fakeResourcesPath
            const expected = join(fakeResourcesPath, '', 'compilers')
            expect(service.constructCompilerDirectoryPath()).toBe(expected)
        })

        test('constructRuntimeResourcesPath returns correct path in development', () => {
            process.env.NODE_ENV = 'development'
            const fakeCwd = '/fake/cwd'
            jest.spyOn(process, 'cwd').mockReturnValue(fakeCwd)
            const expected = join(fakeCwd, 'resources', 'runtime')
            expect(service.constructRuntimeResourcesPath()).toBe(expected)
        })

        test('constructArduinoCliBinaryPath returns correct path for win32', () => {
            Object.defineProperty(process, 'platform', {
                value: 'win32',
            })
            service.compilerDirectory = '/fake/compilerDir'
            const expected = join('/fake/compilerDir', 'Windows', 'arduino-cli', 'bin', 'arduino-cli.exe')
            expect(service.constructArduinoCliBinaryPath()).toBe(expected)
        })

        test('constructArduinoCliBinaryPath returns correct path for darwin', () => {
            Object.defineProperty(process, 'platform', {
                value: 'darwin',
            })
            service.compilerDirectory = '/fake/compilerDir'
            const expected = join('/fake/compilerDir', 'MacOS', 'arduino-cli', 'bin', 'arduino-cli')
            expect(service.constructArduinoCliBinaryPath()).toBe(expected)
        })

        test('constructArduinoCliBinaryPath returns correct path for linux', () => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
            })
            service.compilerDirectory = '/fake/compilerDir'
            const expected = join('/fake/compilerDir', 'Linux', 'arduino-cli', 'bin', 'arduino-cli')
            expect(service.constructArduinoCliBinaryPath()).toBe(expected)
        })

        test('createBuildDirectoryIfNotExist returns "Directory already exists" when access succeeds', async () => {
            const fakeProjectPath = '/fake/project/project.json'
            ;(access as jest.Mock).mockResolvedValue(undefined)
            const result = await service.createBuildDirectoryIfNotExist(fakeProjectPath)
            expect(result).toEqual({ success: true, message: 'Directory already exists' })
            expect(access).toHaveBeenCalled()
        })

        test('createBuildDirectoryIfNotExist creates directory when access fails', async () => {
            const fakeProjectPath = '/fake/project/project.json'
            ;(access as jest.Mock).mockRejectedValue(new Error('Not exists'))
            ;(mkdir as jest.Mock).mockResolvedValue(undefined)
            const result = await service.createBuildDirectoryIfNotExist(fakeProjectPath)
            expect(result).toEqual({ success: true, message: 'Directory created' })
            expect(mkdir).toHaveBeenCalled()
        })

        test('createBuildDirectoryIfNotExist returns error message if mkdir fails', async () => {
            const fakeProjectPath = '/fake/project/project.json'
            ;(access as jest.Mock).mockRejectedValue(new Error('Not exists'))
            ;(mkdir as jest.Mock).mockRejectedValue(new Error('mkdir error'))
            const result = await service.createBuildDirectoryIfNotExist(fakeProjectPath)
            expect(result.success).toBe(false)
            expect(result.message).toContain('Error creating directory')
        })
    })

    describe('Core installation functions', () => {
        test('checkCoreInstallation resolves true if core is installed', async () => {
            const fakeCore = 'core1'
            const responseObject = { platforms: [{ id: fakeCore }, { id: 'core2' }] }
            ;(exec as jest.Mock).mockImplementation((cmd, callback) => {
                callback(null, JSON.stringify(responseObject), '')
            })
            const result = await service.checkCoreInstallation(fakeCore)
            expect(result).toBe(true)
        })

        test('checkCoreInstallation resolves false if core is not installed', async () => {
            const fakeCore = 'nonexistent'
            const responseObject = { platforms: [{ id: 'core1' }, { id: 'core2' }] }
            ;(exec as jest.Mock).mockImplementation((cmd, callback) => {
                callback(null, JSON.stringify(responseObject), '')
            })
            const result = await service.checkCoreInstallation(fakeCore)
            expect(result).toBe(false)
        })

        test('checkCoreInstallation rejects if exec returns an error', async () => {
            ;(exec as jest.Mock).mockImplementation((cmd, callback) => {
                callback(new Error('exec error'), '', '')
            })
            await expect(service.checkCoreInstallation('core1')).rejects.toThrow('exec error')
        })
    })

    describe('Core update and install functions', () => {
        test('runCoreUpdateIndex spawns process and resolves exit code', async () => {
            const fakeExitCode = 0
            const fakeProcess = {
                stdout: { on: jest.fn((event, handler) => { if (event === 'data') handler(Buffer.from('output')) }) },
                stderr: { on: jest.fn((event, handler) => { if (event === 'data') handler(Buffer.from('')) }) },
                on: jest.fn((event, handler) => { if (event === 'close') handler() }),
            }
            ;(spawn as jest.Mock).mockReturnValue(fakeProcess)
            const result = await service.runCoreUpdateIndex()
            expect(spawn).toHaveBeenCalled()
            expect(result).toBe(fakeExitCode)
        })

        test('installCore spawns process and resolves exit code', async () => {
            const fakeExitCode = 0
            const fakeProcess = {
                stdout: { on: jest.fn((event, handler) => { if (event === 'data') handler(Buffer.from('output')) }) },
                stderr: { on: jest.fn((event, handler) => { if (event === 'data') handler(Buffer.from('')) }) },
                on: jest.fn((event, handler) => { if (event === 'close') handler() }),
            }
            ;(spawn as jest.Mock).mockReturnValue(fakeProcess)
            const result = await service.installCore('core1')
            expect(spawn).toHaveBeenCalled()
            expect(result).toBe(fakeExitCode)
        })
    })

    describe('Board configuration function', () => {
        test('configureBoard spawns process and resolves exit code', async () => {
            const fakeExitCode = 0
            const fakeProcess = {
                stdout: { on: jest.fn((event, handler) => { if (event === 'data') handler(Buffer.from('output')) }) },
                stderr: { on: jest.fn((event, handler) => { if (event === 'data') handler(Buffer.from('')) }) },
                on: jest.fn((event, handler) => { if (event === 'close') handler() }),
            }
            ;(spawn as jest.Mock).mockReturnValue(fakeProcess)
            const fakePort = { postMessage: jest.fn(), close: jest.fn() }
            const result = await service.configureBoard(fakePort as any)
            expect(spawn).toHaveBeenCalled()
            expect(result).toBe(fakeExitCode)
        })
    })
})