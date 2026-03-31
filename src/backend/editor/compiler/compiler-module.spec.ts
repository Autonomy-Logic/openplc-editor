import { CompilerModule } from './compiler-module'

describe('CompilerModule', () => {
  let compilerModule: CompilerModule

  beforeEach(() => {
    compilerModule = new CompilerModule()
  })

  it('should be defined and instantiated successfully', () => {
    expect(compilerModule).toBeDefined()
    expect(compilerModule).toBeInstanceOf(CompilerModule)
  })

  it('should have expected static properties', () => {
    expect(typeof CompilerModule.HOST_PLATFORM).toBe('string')
    expect(['x64', 'arm64', 'ia32', 'arm']).toContain(CompilerModule.HOST_ARCHITECTURE)
    expect(typeof CompilerModule.DEVELOPMENT_MODE).toBe('boolean')
    expect(Array.isArray(CompilerModule.GLOBAL_LIBRARIES)).toBe(true)
    expect(CompilerModule.GLOBAL_LIBRARIES.length).toBeGreaterThan(0)
  })

  it('should initialize directory and binary paths', () => {
    expect(typeof compilerModule.binaryDirectoryPath).toBe('string')
    expect(typeof compilerModule.sourceDirectoryPath).toBe('string')
    expect(typeof compilerModule.arduinoCliBinaryPath).toBe('string')
    expect(typeof compilerModule.arduinoCliConfigurationFilePath).toBe('string')
    expect(Array.isArray(compilerModule.arduinoCliBaseParameters)).toBe(true)
    expect(typeof compilerModule.xml2stBinaryPath).toBe('string')
    expect(typeof compilerModule.iec2cBinaryPath).toBe('string')
  })

  it('getHostHardwareInfo should return a string containing hardware info', () => {
    const info = compilerModule.getHostHardwareInfo()
    expect(typeof info).toBe('string')
    expect(info).toContain('System Architecture')
    expect(info).toContain('Operating System')
    expect(info).toContain('Logical CPU Cores')
  })
})
