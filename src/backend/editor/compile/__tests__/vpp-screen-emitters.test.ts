import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { collectVppScreenRuntimeArtifacts } from '../vpp-screen-emitters'

// The collector reaches into PackageManagerModule for installed packages. We mock it to a tiny
// in-memory list so we can unit-test without touching the user data dir.
jest.mock('../../package-manager/package-manager-module', () => {
  return { PackageManagerModule: jest.fn() }
})
import { PackageManagerModule } from '../../package-manager/package-manager-module'

const MockedPackageManagerModule = PackageManagerModule as unknown as jest.Mock

describe('collectVppScreenRuntimeArtifacts', () => {
  let packageDir: string

  beforeEach(() => {
    packageDir = mkdtempSync(join(tmpdir(), 'vpp-emit-test-'))
    const datahub = join(packageDir, 'datahub')
    mkdirSync(datahub, { recursive: true })
    writeFileSync(
      join(datahub, 'datahub.emit.js'),
      `module.exports = function(input) {
        var exportsList = Array.isArray(input.data && input.data.exports) ? input.data.exports : []
        var mapped = []
        var errors = []
        for (var i = 0; i < exportsList.length; i++) {
          var e = exportsList[i]
          var addr = input.model.resolveAddress(e.qualifier)
          if (!addr) { errors.push(e.qualifier + ' has no address'); continue }
          mapped.push({ qualifier: e.qualifier, direction: e.direction, iec_address: addr })
        }
        var out = { files: { 'conf/data-hub.json': JSON.stringify({ exports: mapped }) } }
        if (errors.length) out.errors = errors
        return out
      }`,
    )
    MockedPackageManagerModule.mockImplementation(() => ({
      listInstalled: () => [{ packageId: 'com.test.vpp', path: packageDir, version: '0.0.1' }],
      getInstalledPackageManifest: () => ({
        package: { id: 'com.test.vpp', name: 'Test', version: '0.0.1' },
        devices: [{ id: 'test-board', runtimeEmitters: { 'data-hub': 'datahub/datahub.emit.js' } }],
      }),
    }))
  })

  afterEach(() => {
    rmSync(packageDir, { recursive: true, force: true })
    MockedPackageManagerModule.mockReset()
  })

  it('emits conf/data-hub.json with resolved addresses', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.test.vpp': {
          'data-hub': {
            exports: [
              { qualifier: 'Program0.pump_speed', direction: 'RW' },
              { qualifier: 'Program0.temp_pv', direction: 'RO' },
            ],
          },
        },
      },
      deviceId: 'test-board',
      exportableVariables: [],
      resolveAddress: (q) => (q === 'Program0.pump_speed' ? '%QW0.1' : q === 'Program0.temp_pv' ? '%IW0.0' : ''),
    })
    expect(res.errors).toEqual([])
    expect(res.files['conf/data-hub.json']).toBeDefined()
    const parsed = JSON.parse(res.files['conf/data-hub.json'] as string)
    expect(parsed).toEqual({
      exports: [
        { qualifier: 'Program0.pump_speed', direction: 'RW', iec_address: '%QW0.1' },
        { qualifier: 'Program0.temp_pv', direction: 'RO', iec_address: '%IW0.0' },
      ],
    })
  })

  it('reports an emitter error for a variable with no address, prefixed by (packageId:screenId)', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.test.vpp': {
          'data-hub': {
            exports: [{ qualifier: 'orphan', direction: 'RW' }],
          },
        },
      },
      deviceId: 'test-board',
      exportableVariables: [],
      resolveAddress: () => '',
    })
    expect(res.errors).toEqual(['com.test.vpp:data-hub: orphan has no address'])
    const parsed = JSON.parse(res.files['conf/data-hub.json'] as string)
    expect(parsed.exports).toEqual([])
  })

  it('skips emitters for packages with no entry in vppExtensions', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {},
      deviceId: 'test-board',
      exportableVariables: [],
      resolveAddress: () => '',
    })
    expect(res.files).toEqual({})
    expect(res.errors).toEqual([])
  })

  it('errors when a project uses a VPP that is not installed', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: { 'not.installed': { x: {} } },
      deviceId: 'test-board',
      exportableVariables: [],
      resolveAddress: () => '',
    })
    expect(res.files).toEqual({})
    expect(res.errors[0]).toMatch(/not installed/)
  })

  describe('resolveDebugEntry (publisher VPP sandbox hook)', () => {
    beforeEach(() => {
      const datahub = join(packageDir, 'debug-emit')
      mkdirSync(datahub, { recursive: true })
      writeFileSync(
        join(datahub, 'debug.emit.js'),
        `module.exports = function(input) {
          var exportsList = Array.isArray(input.data && input.data.exports) ? input.data.exports : []
          var mapped = []
          var errors = []
          for (var i = 0; i < exportsList.length; i++) {
            var e = exportsList[i]
            var entry = input.model.resolveDebugEntry(e.qualifier)
            if (!entry) { errors.push(e.qualifier + ' not in debug map'); continue }
            mapped.push({ qualifier: e.qualifier, arr: entry.arr, elem: entry.elem, datatype: entry.datatype })
          }
          var out = { files: { 'conf/debug-exports.json': JSON.stringify({ exports: mapped }) } }
          if (errors.length) out.errors = errors
          return out
        }`,
      )
      MockedPackageManagerModule.mockImplementation(() => ({
        listInstalled: () => [{ packageId: 'com.test.vpp', path: packageDir, version: '0.0.1' }],
        getInstalledPackageManifest: () => ({
          package: { id: 'com.test.vpp', name: 'Test', version: '0.0.1' },
          devices: [{ id: 'test-board', runtimeEmitters: { 'debug-screen': 'debug-emit/debug.emit.js' } }],
        }),
      }))
    })

    it('exposes a resolveDebugEntry callback the emitter can read verbatim', () => {
      const res = collectVppScreenRuntimeArtifacts({
        vppExtensions: {
          'com.test.vpp': {
            'debug-screen': {
              exports: [
                { qualifier: 'Program0.pump_speed' },
                { qualifier: 'GVL.setpoint' },
                { qualifier: 'Program0.missing' },
              ],
            },
          },
        },
        deviceId: 'test-board',
        exportableVariables: [],
        resolveAddress: () => '',
        resolveDebugEntry: (q) => {
          if (q === 'Program0.pump_speed') return { arr: 0, elem: 3, datatype: 'INT' }
          if (q === 'GVL.setpoint') return { arr: 0, elem: 7, datatype: 'DINT' }
          return null
        },
      })
      expect(res.errors).toEqual(['com.test.vpp:debug-screen: Program0.missing not in debug map'])
      const parsed = JSON.parse(res.files['conf/debug-exports.json'] as string)
      expect(parsed.exports).toEqual([
        { qualifier: 'Program0.pump_speed', arr: 0, elem: 3, datatype: 'INT' },
        { qualifier: 'GVL.setpoint', arr: 0, elem: 7, datatype: 'DINT' },
      ])
    })

    it('defaults resolveDebugEntry to a null-returner when the collector arg is omitted', () => {
      const res = collectVppScreenRuntimeArtifacts({
        vppExtensions: {
          'com.test.vpp': {
            'debug-screen': { exports: [{ qualifier: 'Program0.pump_speed' }] },
          },
        },
        deviceId: 'test-board',
        exportableVariables: [],
        resolveAddress: () => '',
      })
      expect(res.errors).toEqual(['com.test.vpp:debug-screen: Program0.pump_speed not in debug map'])
      const parsed = JSON.parse(res.files['conf/debug-exports.json'] as string)
      expect(parsed.exports).toEqual([])
    })
  })
})
