import type { PackageManifest } from '../../../middleware/shared/ports/types'
import { OPEN62541_LIBRARY, SETTIMINO_LIBRARY } from '../compile/third-party-libraries'
import {
  collectArduinoDependencies,
  coreIdFromPlatform,
  describeDependencyStep,
  dependencyStepName,
  detectsMissingArduinoCore,
  GLOBAL_ARDUINO_LIBRARIES,
  missingArduinoCoreHint,
  parseArduinoCliProgress,
  planDependencyInstall,
  planDependencyRemoval,
  SIMULATOR_CORE,
} from '../packages/arduino-dependencies'

type Device = PackageManifest['devices'][number]

function device(id: string, target: Partial<Device['target']>, hal: Partial<Device['hal']> = {}, extra = {}): Device {
  return {
    id,
    name: id,
    preview: '',
    target: { type: 'arduino-cli', ...target },
    hal: { type: 'arduino-hal', ...hal },
    ...extra,
  } as Device
}

const MULTI_CORE = {
  devices: [
    device('mega', { platform: 'arduino:avr:mega' }, { extraArduinoLibraries: ['Ethernet', 'EthernetENC'] }),
    device('uno', { platform: 'arduino:avr:uno' }, { extraArduinoLibraries: ['Ethernet'] }),
    device(
      'p1am',
      { platform: 'FACTS:samd:P1AM-200', coreVersion: '1.7.13', boardManagerUrl: 'https://example.com/i.json' },
      {
        extraArduinoLibraries: ['P1AM@1.0.0'],
      },
    ),
    device('rt', { type: 'runtime-v4', platform: 'linux-arm64' }),
  ],
}

describe('coreIdFromPlatform', () => {
  it('keeps vendor and architecture', () => {
    expect(coreIdFromPlatform('esp32:esp32:nano_nora')).toBe('esp32:esp32')
    expect(coreIdFromPlatform('linux-arm64')).toBe('')
  })
})

describe('collectArduinoDependencies', () => {
  it('collects each core once, with its pin and index, from arduino-cli devices only', () => {
    const deps = collectArduinoDependencies(MULTI_CORE)
    expect(deps.cores).toEqual([
      { id: 'arduino:avr' },
      { id: 'FACTS:samd', version: '1.7.13', boardManagerUrl: 'https://example.com/i.json' },
    ])
    expect(deps.libraries).toEqual(['Ethernet', 'EthernetENC', 'P1AM@1.0.0'])
    expect(deps.gitLibraries).toEqual([])
  })

  it('adds the git libraries the device capabilities need', () => {
    const deps = collectArduinoDependencies({
      devices: [
        device(
          'slm',
          { platform: 'FACTS:stm32:slm_cpu_0' },
          {},
          { capabilities: { opcuaServer: true, s7Server: true } },
        ),
      ],
    })
    expect(deps.gitLibraries).toEqual([OPEN62541_LIBRARY, SETTIMINO_LIBRARY])
  })
})

describe('planDependencyInstall', () => {
  const deps = collectArduinoDependencies(MULTI_CORE)

  it('plans every dependency when nothing is installed', () => {
    const steps = planDependencyInstall(deps, { cores: {}, libraries: [] })
    expect(steps.map(describeDependencyStep)).toEqual([
      'Installing core arduino:avr',
      'Installing core FACTS:samd 1.7.13',
      'Installing library Ethernet',
      'Installing library EthernetENC',
      'Installing library P1AM@1.0.0',
    ])
  })

  it('skips what is installed and reinstalls a pinned core at another version', () => {
    const steps = planDependencyInstall(deps, {
      cores: { 'arduino:avr': '1.8.8', 'FACTS:samd': '1.7.12' },
      libraries: ['Ethernet', 'EthernetENC', 'P1AM'],
    })
    expect(steps.map(describeDependencyStep)).toEqual(['Installing core FACTS:samd 1.7.13'])
  })

  it('plans nothing when everything is installed', () => {
    expect(
      planDependencyInstall(deps, {
        cores: { 'arduino:avr': '1.8.8', 'FACTS:samd': '1.7.13' },
        libraries: ['Ethernet', 'EthernetENC', 'P1AM'],
      }),
    ).toEqual([])
  })
})

describe('planDependencyRemoval', () => {
  const installed = {
    cores: { 'arduino:avr': '1.8.8', 'FACTS:samd': '1.7.13', 'esp32:esp32': '3.3.10' },
    libraries: ['Ethernet', 'EthernetENC', 'P1AM', 'open62541'],
  }

  it('keeps the simulator core and global libraries', () => {
    const plan = planDependencyRemoval(collectArduinoDependencies(MULTI_CORE), [], installed)
    expect(plan.cores).toEqual(['FACTS:samd'])
    expect(plan.cores).not.toContain(SIMULATOR_CORE)
    expect(plan.libraries).toEqual(['EthernetENC'])
    expect(GLOBAL_ARDUINO_LIBRARIES).toEqual(expect.arrayContaining(['Ethernet', 'P1AM']))
  })

  it('keeps what another installed package declares', () => {
    const other = collectArduinoDependencies({
      devices: [device('p1am', { platform: 'FACTS:samd:P1AM-200' }, { extraArduinoLibraries: ['EthernetENC'] })],
    })
    const plan = planDependencyRemoval(collectArduinoDependencies(MULTI_CORE), [other], installed)
    expect(plan).toEqual({ cores: [], libraries: [] })
  })

  it('removes only what is installed', () => {
    const plan = planDependencyRemoval(collectArduinoDependencies(MULTI_CORE), [], { cores: {}, libraries: [] })
    expect(plan).toEqual({ cores: [], libraries: [] })
  })
})

describe('parseArduinoCliProgress', () => {
  it('reads the last progress record of a chunk', () => {
    const chunk =
      '\rarduino:avr-gcc@7.3.0 0 B / 36.71 MiB    0.00%\rarduino:avr-gcc@7.3.0 12.34 MiB / 36.71 MiB   33.60% 00m03s'
    expect(parseArduinoCliProgress(chunk)).toEqual({
      item: 'arduino:avr-gcc@7.3.0',
      done: '12.34 MiB',
      total: '36.71 MiB',
      percent: 33.6,
    })
  })

  it('returns null for output without a progress record', () => {
    expect(parseArduinoCliProgress('Downloading packages...\narduino:avr-gcc@7.3.0 downloaded\n')).toBeNull()
  })
})

describe('detectsMissingArduinoCore', () => {
  it('recognises a missing core', () => {
    expect(
      detectsMissingArduinoCore("Error during build: Platform 'FACTS:stm32' not found: platform not installed"),
    ).toBe(true)
  })

  it("ignores a missing header, which may be the user's own include", () => {
    expect(
      detectsMissingArduinoCore('c_blocks_code.cpp:3:10: fatal error: NotInstalled.h: No such file or directory'),
    ).toBe(false)
    expect(detectsMissingArduinoCore("a.cpp:3:10: fatal error: 'Settimino.h' file not found")).toBe(false)
  })

  it('ignores ordinary compile errors', () => {
    expect(detectsMissingArduinoCore("a.cpp:12:5: error: 'foo' was not declared in this scope")).toBe(false)
  })
})

describe('missingArduinoCoreHint', () => {
  it('sends the desktop user to Reinstall and the CLI user to packages install', () => {
    expect(missingArduinoCoreHint({ simulator: false, surface: 'desktop' })).toContain(
      'File > Board Package Manager...',
    )
    expect(missingArduinoCoreHint({ simulator: false, surface: 'cli' })).toContain(
      'openplc-cli packages install <file.vpp>',
    )
  })

  it('names the simulator core and the repair for each surface', () => {
    const desktop = missingArduinoCoreHint({ simulator: true, surface: 'desktop' })
    expect(desktop).toContain(SIMULATOR_CORE)
    expect(desktop).toContain('Start the OpenPLC Editor')
    expect(desktop).not.toContain('Board Package Manager')
    const cli = missingArduinoCoreHint({ simulator: true, surface: 'cli' })
    expect(cli).toContain(SIMULATOR_CORE)
    expect(cli).toContain('openplc-cli packages install')
    expect(cli).not.toContain('Start the OpenPLC Editor')
  })
})

describe('dependencyStepName', () => {
  it('names the core, the index library without its version, and the git library', () => {
    expect(dependencyStepName({ kind: 'core', core: { id: 'arduino:avr' } })).toBe('arduino:avr')
    expect(dependencyStepName({ kind: 'library', name: 'P1AM@1.0.0' })).toBe('P1AM')
    expect(dependencyStepName({ kind: 'git-library', library: OPEN62541_LIBRARY })).toBe('open62541')
  })

  it('says what asked for a git library in its install label', () => {
    expect(describeDependencyStep({ kind: 'git-library', library: OPEN62541_LIBRARY })).toBe(
      'Installing library open62541 (OPC-UA server)',
    )
  })
})
