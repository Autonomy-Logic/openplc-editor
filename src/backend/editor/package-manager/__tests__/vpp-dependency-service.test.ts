import { GLOBAL_ARDUINO_LIBRARIES } from '@root/backend/shared/packages/arduino-dependencies'
import type { PackageInstallProgress } from '@root/middleware/shared/ports/types'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

import { installArduinoDependencies, queryInstalledArduinoState } from '../arduino-dependency-installer'
import type { PackageManagerModule } from '../package-manager-module'
import { StartupDependencyCheck } from '../startup-dependency-check'
import type { PackageManifest } from '../types'
import { VppDependencyService } from '../vpp-dependency-service'

jest.mock('electron', () => ({ app: { getPath: jest.fn().mockReturnValue('/tmp/mock-user-data') } }))

interface FakeCli {
  calls: string[][]
  spawn: (args: string[]) => ChildProcess
}

/** A fake arduino-cli: answers list commands from @p state and fails the commands @p fail matches. */
function fakeCli(
  state: {
    cores: Record<string, string>
    libraries: Array<{ name: string; location: string }>
    manualCores?: string[]
  },
  fail: (args: string[]) => boolean = () => false,
  output: (args: string[]) => string = () => '',
  stderr = '',
): FakeCli {
  const calls: string[][] = []
  const spawn = (args: string[]): ChildProcess => {
    calls.push(args)
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    let killed = false
    child.kill = () => {
      killed = true
    }
    setTimeout(() => {
      let text = output(args)
      if (args[0] === 'core' && args[1] === 'list') {
        text = JSON.stringify({
          platforms: Object.entries(state.cores).map(([id, installed_version]) => ({
            id,
            installed_version,
            manually_installed: (state.manualCores ?? []).includes(id),
          })),
        })
      }
      if (args[0] === 'lib' && args[1] === 'list') {
        text = JSON.stringify({ installed_libraries: state.libraries.map((library) => ({ library })) })
      }
      if (stderr) child.stderr.emit('data', Buffer.from(stderr))
      if (text) child.stdout.emit('data', Buffer.from(text))
      child.emit('close', killed ? null : fail(args) ? 1 : 0)
    }, 0)
    return child as unknown as ChildProcess
  }
  return { calls, spawn }
}

function manifest(
  id: string,
  devices: Array<{ platform: string; libs?: string[]; coreVersion?: string }>,
): PackageManifest {
  return {
    package: { id, name: id, version: '1.0.0' },
    devices: devices.map((d, index) => ({
      id: `${id}-${index}`,
      name: `${id}-${index}`,
      preview: '',
      target: { type: 'arduino-cli', platform: d.platform, coreVersion: d.coreVersion },
      hal: { type: 'arduino-hal', extraArduinoLibraries: d.libs },
    })),
  } as unknown as PackageManifest
}

describe('queryInstalledArduinoState', () => {
  it('lists the editor and sketchbook libraries but not those bundled in a core, and owns only the editor ones', async () => {
    const cli = fakeCli({
      cores: { 'arduino:avr': '1.8.8' },
      libraries: [
        { name: 'Ethernet', location: 'ide' },
        { name: 'EthernetENC', location: 'user' },
        { name: 'SPI', location: 'platform' },
      ],
    })
    const state = await queryInstalledArduinoState(cli.spawn)
    expect(state.cores).toEqual({ 'arduino:avr': '1.8.8' })
    expect([...state.libraries].sort()).toEqual(['Ethernet', 'EthernetENC'])
    expect(state.ownedLibraries).toEqual(['EthernetENC'])
  })

  it('parses stdout only, so a warning on stderr does not break the JSON', async () => {
    const cli = fakeCli(
      { cores: { 'arduino:avr': '1.8.8' }, libraries: [] },
      () => false,
      () => '',
      'Warning: unknown config key\n',
    )
    expect((await queryInstalledArduinoState(cli.spawn)).cores).toEqual({ 'arduino:avr': '1.8.8' })
  })
})

describe('installArduinoDependencies', () => {
  const deps = {
    cores: [{ id: 'FACTS:samd', version: '1.7.13', boardManagerUrl: 'https://example.com/i.json' }],
    libraries: ['P1AM'],
    gitLibraries: [],
  }

  it('runs only the missing steps and reports progress with downloads', async () => {
    const cli = fakeCli(
      { cores: {}, libraries: [] },
      () => false,
      (args) => (args[1] === 'install' && args[0] === 'core' ? '\rarduino:tool@1 1.00 MiB / 2.00 MiB   50.00%' : ''),
    )
    const progress: PackageInstallProgress[] = []
    const result = await installArduinoDependencies(deps, cli.spawn, (p) => progress.push(p))
    expect(result).toEqual({ ok: true, installed: 2 })
    expect(cli.calls.slice(2)).toEqual([
      ['core', 'update-index', '--additional-urls', 'https://example.com/i.json'],
      ['core', 'install', 'FACTS:samd@1.7.13', '--additional-urls', 'https://example.com/i.json'],
      ['lib', 'install', 'P1AM'],
    ])
    expect(progress.map((p) => `${p.step}/${p.total} ${p.label}`)).toContain('1/2 Installing core FACTS:samd 1.7.13')
    expect(progress.find((p) => p.download)?.download?.percent).toBe(50)
  })

  it('stops at the first failing step and names it', async () => {
    const cli = fakeCli({ cores: {}, libraries: [] }, (args) => args[1] === 'install' && args[0] === 'core')
    const result = await installArduinoDependencies(deps, cli.spawn, () => undefined)
    expect(result).toEqual(expect.objectContaining({ ok: false, cancelled: false }))
    expect(result.ok === false && result.error).toMatch(/Installing core FACTS:samd 1\.7\.13 failed/)
    expect(cli.calls.some((args) => args[0] === 'lib' && args[1] === 'install')).toBe(false)
  })

  it('stops when cancelled', async () => {
    const cli = fakeCli({ cores: {}, libraries: [] })
    const controller = new AbortController()
    controller.abort()
    const result = await installArduinoDependencies(deps, cli.spawn, () => undefined, { signal: controller.signal })
    expect(result).toEqual({ ok: false, cancelled: true, error: 'Installation cancelled.' })
  })

  it('attempts every step with keepGoing and reports every failure', async () => {
    const two = { cores: [], libraries: ['CAN', 'OneWire'], gitLibraries: [] }
    const cli = fakeCli({ cores: {}, libraries: [] }, (args) => args[1] === 'install' && args[2] === 'CAN')
    const result = await installArduinoDependencies(two, cli.spawn, () => undefined, { keepGoing: true })
    expect(cli.calls.filter((args) => args[1] === 'install')).toEqual([
      ['lib', 'install', 'CAN'],
      ['lib', 'install', 'OneWire'],
    ])
    expect(result.ok === false && result.error).toMatch(/Installing library CAN failed/)
  })
})

describe('VppDependencyService', () => {
  const avrPackage = manifest('com.example.avr', [{ platform: 'arduino:avr:mega', libs: ['Ethernet', 'EthernetENC'] }])
  const samdPackage = manifest('com.example.samd', [{ platform: 'FACTS:samd:P1AM-200', libs: ['EthernetENC'] }])

  function packageManager(installed: PackageManifest[], removed: PackageManifest, unsigned: string[] = []) {
    const remaining = [...installed]
    return {
      getInstalledPackageManifest: (id: string) => [...remaining, removed].find((m) => m.package.id === id) ?? null,
      installedPackageRejectionReason: (id: string) => (unsigned.includes(id) ? 'invalid signature' : null),
      uninstall: (id: string) => {
        const index = remaining.findIndex((m) => m.package.id === id)
        if (index >= 0) remaining.splice(index, 1)
        return { success: true }
      },
      listInstalled: () => remaining.map((m) => ({ packageId: m.package.id })),
      importFromFile: jest.fn(),
    } as unknown as PackageManagerModule
  }

  it('removes on uninstall only what no other package, the simulator or the global list uses', async () => {
    const cli = fakeCli({
      cores: { 'arduino:avr': '1.8.8', 'FACTS:samd': '1.7.13' },
      libraries: [
        { name: 'Ethernet', location: 'user' },
        { name: 'EthernetENC', location: 'user' },
      ],
    })
    const extra = manifest('com.example.extra', [{ platform: 'esp32:esp32:x', libs: ['Extra'] }])
    const service = new VppDependencyService(packageManager([avrPackage, extra], samdPackage), cli.spawn)
    await service.uninstall('com.example.avr')
    const uninstalls = cli.calls.filter((args) => args[1] === 'uninstall')
    expect(uninstalls).toEqual([['lib', 'uninstall', 'EthernetENC']])
  })

  it('never removes a core installed by hand in the Arduino sketchbook', async () => {
    const cli = fakeCli({ cores: { 'FACTS:samd': '1.7.13' }, libraries: [], manualCores: ['FACTS:samd'] })
    const service = new VppDependencyService(packageManager([samdPackage], avrPackage), cli.spawn)
    await service.uninstall('com.example.samd')
    expect(cli.calls.filter((args) => args[1] === 'uninstall')).toEqual([])
  })

  it('still uninstalls and warns when a removal fails', async () => {
    const cli = fakeCli(
      { cores: { 'FACTS:samd': '1.7.13' }, libraries: [{ name: 'EthernetENC', location: 'user' }] },
      (args) => args[1] === 'uninstall' && args[0] === 'core',
    )
    const service = new VppDependencyService(packageManager([samdPackage], avrPackage), cli.spawn)
    const result = await service.uninstall('com.example.samd')
    expect(result).toEqual({ success: true, warning: 'Could not remove core FACTS:samd.' })
  })

  it('waits for the start-up check before installing and says so', async () => {
    let release: () => void = () => undefined
    const done = new Promise<void>((resolve) => (release = resolve))
    let running = true
    const gate = { isRunning: () => running, whenDone: () => done }
    const cli = fakeCli({ cores: {}, libraries: [] })
    const service = new VppDependencyService(packageManager([avrPackage], avrPackage), cli.spawn, gate)
    const progress: PackageInstallProgress[] = []
    const pending = service.reinstall('com.example.avr', (p) => progress.push(p))
    await new Promise((r) => setTimeout(r, 0))
    expect(progress[0]?.label).toBe('Waiting for the board dependency check to finish')
    expect(cli.calls).toEqual([])
    running = false
    release()
    expect(await pending).toEqual(expect.objectContaining({ success: true }))
    expect(cli.calls.some((args) => args[0] === 'core' && args[1] === 'install')).toBe(true)
  })

  it('installs a package that declares no arduino-cli dependency without arduino-cli or the start-up wait', async () => {
    const runtimeOnly = {
      package: { id: 'com.example.v4', name: 'v4', version: '1.0.0' },
      devices: [{ id: 'v4', name: 'v4', preview: '', target: { type: 'runtime-v4' }, hal: { type: 'runtime-plugin' } }],
    } as unknown as PackageManifest
    const gate = { isRunning: () => true, whenDone: () => new Promise<void>(() => undefined) }
    const cli = fakeCli({ cores: {}, libraries: [] })
    const service = new VppDependencyService(packageManager([runtimeOnly], runtimeOnly), cli.spawn, gate)
    expect(await service.reinstall('com.example.v4', () => undefined)).toEqual(
      expect.objectContaining({ success: true }),
    )
    expect(cli.calls).toEqual([])
  })

  it('cancels at once while waiting for the start-up check', async () => {
    const gate = { isRunning: () => true, whenDone: () => new Promise<void>(() => undefined) }
    const cli = fakeCli({ cores: {}, libraries: [] })
    const service = new VppDependencyService(packageManager([avrPackage], avrPackage), cli.spawn, gate)
    const pending = service.reinstall('com.example.avr', () => undefined)
    await new Promise((r) => setTimeout(r, 0))
    service.cancel()
    expect(await pending).toEqual(expect.objectContaining({ success: false, canceled: true }))
    expect(cli.calls).toEqual([])
  })

  it('refuses an uninstall while an install runs, and reports removal progress', async () => {
    let release: () => void = () => undefined
    const done = new Promise<void>((resolve) => (release = resolve))
    let running = true
    const gate = { isRunning: () => running, whenDone: () => done }
    const cli = fakeCli({
      cores: { 'arduino:avr': '1.8.8', 'FACTS:samd': '1.7.13' },
      libraries: [{ name: 'EthernetENC', location: 'user' }],
    })
    const service = new VppDependencyService(packageManager([avrPackage, samdPackage], samdPackage), cli.spawn, gate)
    const install = service.reinstall('com.example.avr', () => undefined)
    await new Promise((r) => setTimeout(r, 0))
    expect(await service.uninstall('com.example.samd')).toEqual(expect.objectContaining({ success: false }))
    running = false
    release()
    await install
    const progress: PackageInstallProgress[] = []
    expect(await service.uninstall('com.example.samd', (p) => progress.push(p))).toEqual({ success: true })
    expect(progress.every((p) => p.removing === true)).toBe(true)
    expect(progress.map((p) => p.label)).toContain('Removing core FACTS:samd')
  })
})

describe('VppDependencyService signature and feedback', () => {
  const avr = manifest('com.example.avr', [{ platform: 'arduino:avr:mega', libs: ['Ethernet'] }])

  function manager(unsigned: string[]) {
    const remaining = [avr]
    return {
      getInstalledPackageManifest: (id: string) => (id === avr.package.id ? avr : null),
      installedPackageRejectionReason: (id: string) => (unsigned.includes(id) ? 'invalid signature' : null),
      uninstall: jest.fn(() => {
        remaining.length = 0
        return { success: true }
      }),
      listInstalled: () => remaining.map((m) => ({ packageId: m.package.id })),
      importFromFile: jest.fn(),
    }
  }

  it('refuses Reinstall of a package that fails its signature check, without running arduino-cli', async () => {
    const cli = fakeCli({ cores: {}, libraries: [] })
    const service = new VppDependencyService(manager([avr.package.id]) as unknown as PackageManagerModule, cli.spawn)
    const result = await service.reinstall(avr.package.id, () => undefined)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/failed its signature check \(invalid signature\)/)
    expect(cli.calls).toEqual([])
  })

  it('uninstalls a package that fails its signature check but removes none of its dependencies', async () => {
    const cli = fakeCli({ cores: { 'arduino:avr': '1.8.8' }, libraries: [{ name: 'Ethernet', location: 'user' }] })
    const pm = manager([avr.package.id])
    const service = new VppDependencyService(pm as unknown as PackageManagerModule, cli.spawn)
    const result = await service.uninstall(avr.package.id)
    expect(pm.uninstall).toHaveBeenCalledWith(avr.package.id)
    expect(result).toEqual(
      expect.objectContaining({ success: true, warning: expect.stringContaining('left installed') }),
    )
    expect(cli.calls).toEqual([])
  })

  it('reports the check first and says nothing was installed when nothing is missing', async () => {
    const cli = fakeCli({ cores: { 'arduino:avr': '1.8.8' }, libraries: [{ name: 'Ethernet', location: 'ide' }] })
    const service = new VppDependencyService(manager([]) as unknown as PackageManagerModule, cli.spawn)
    const progress: PackageInstallProgress[] = []
    const result = await service.reinstall(avr.package.id, (p) => progress.push(p))
    expect(progress.map((p) => p.label)).toEqual(['Checking installed components'])
    expect(result).toEqual(expect.objectContaining({ success: true, installed: 0 }))
  })
})

describe('StartupDependencyCheck', () => {
  const everyGlobal = GLOBAL_ARDUINO_LIBRARIES.map((name) => ({ name, location: 'user' }))

  it('only lists what is installed when nothing is missing', async () => {
    const cli = fakeCli({ cores: { 'arduino:avr': '1.8.6' }, libraries: everyGlobal })
    const check = new StartupDependencyCheck(cli.spawn)
    check.start(Promise.resolve())
    expect(check.isRunning()).toBe(true)
    await check.whenDone()
    expect(check.isRunning()).toBe(false)
    expect(cli.calls.every((args) => args[1] === 'list')).toBe(true)
    expect(check.takeNotices()).toEqual([])
  })

  it('installs a missing simulator core and global library, never updating installed ones', async () => {
    const cli = fakeCli({ cores: {}, libraries: everyGlobal.filter((lib) => lib.name !== 'OneWire') })
    const check = new StartupDependencyCheck(cli.spawn)
    check.start(Promise.resolve())
    await check.whenDone()
    const installs = cli.calls.filter((args) => args[1] === 'install')
    expect(installs).toEqual([
      ['core', 'install', 'arduino:avr'],
      ['lib', 'install', 'OneWire'],
    ])
    expect(cli.calls.some((args) => args.includes('upgrade') || args.includes('update-index'))).toBe(false)
    const notices = check.takeNotices()
    expect(notices.map((n) => n.level)).toEqual(['info', 'info'])
    expect(notices[0].message).toContain('arduino:avr, OneWire')
  })

  it('keeps a warning for the console when the install fails offline', async () => {
    const cli = fakeCli({ cores: {}, libraries: everyGlobal }, (args) => args[1] === 'install')
    const check = new StartupDependencyCheck(cli.spawn)
    const listener = jest.fn()
    check.setNoticeListener(listener)
    check.start(Promise.resolve())
    await check.whenDone()
    const notices = check.takeNotices()
    expect(notices[notices.length - 1].level).toBe('warning')
    expect(notices[notices.length - 1].message).toContain('Restart the editor while connected to the internet')
    expect(listener).toHaveBeenCalled()
    expect(check.takeNotices()).toEqual([])
  })

  it('waits for the configuration before running arduino-cli', async () => {
    const cli = fakeCli({ cores: { 'arduino:avr': '1.8.6' }, libraries: everyGlobal })
    const check = new StartupDependencyCheck(cli.spawn)
    let release: () => void = () => undefined
    check.start(new Promise<void>((resolve) => (release = resolve)))
    await new Promise((r) => setTimeout(r, 5))
    expect(cli.calls).toEqual([])
    release()
    await check.whenDone()
    expect(cli.calls.length).toBeGreaterThan(0)
  })
})
