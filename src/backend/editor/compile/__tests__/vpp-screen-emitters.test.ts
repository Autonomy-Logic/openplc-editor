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
      resolveAddress: (q) =>
        q === 'Program0.pump_speed' ? '%QW0.1' : q === 'Program0.temp_pv' ? '%IW0.0' : '',
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
      vppExtensions: { 'not.installed': { 'x': {} } },
      deviceId: 'test-board',
      exportableVariables: [],
      resolveAddress: () => '',
    })
    expect(res.files).toEqual({})
    expect(res.errors[0]).toMatch(/not installed/)
  })
})

describe('collectVppScreenRuntimeArtifacts — integration with the real Weidmüller emitter', () => {
  const INSTALLED_DIR = '/home/marcone/.config/open-plc-editor/packages/com.weidmuller.ucontrol'
  const EMITTER_REL = 'datahub/datahub.emit.js'

  beforeEach(() => {
    MockedPackageManagerModule.mockImplementation(() => ({
      listInstalled: () => [
        { packageId: 'com.weidmuller.ucontrol', path: INSTALLED_DIR, version: '0.1.6-poc.3' },
      ],
      getInstalledPackageManifest: () => ({
        package: { id: 'com.weidmuller.ucontrol', name: 'Weidmuller u-control', version: '0.1.6-poc.3' },
        devices: [{ id: 'uc20-m3000', runtimeEmitters: { 'data-hub': EMITTER_REL } }],
      }),
    }))
  })

  afterEach(() => MockedPackageManagerModule.mockReset())

  const emitterInstalled = (() => {
    try { return require('fs').existsSync(require('path').join(INSTALLED_DIR, EMITTER_REL)) } catch { return false }
  })()
  const integrationIt = emitterInstalled ? it : it.skip

  integrationIt('runs the real emitter end-to-end and materializes conf/weidmuller.data-hub.json', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.weidmuller.ucontrol': {
          'data-hub': {
            enabled: true,
            clientId: 'autonomy-node-datahub-provider',
            clientSecret: 'test-secret',
            vplcId: 'vplc-abc-123',
            exports: [
              { qualifier: 'Program0.pump_speed', direction: 'RW' },
              { qualifier: 'Program0.temp_pv', direction: 'RO' },
            ],
          },
        },
      },
      deviceId: 'uc20-m3000',
      exportableVariables: [
        { qualifier: 'Program0.pump_speed', type: 'INT', isWritable: true },
        { qualifier: 'Program0.temp_pv', type: 'REAL', isWritable: true },
      ],
      resolveAddress: (q) => (q === 'Program0.pump_speed' ? '%QW0.1' : q === 'Program0.temp_pv' ? '%IW0.0' : ''),
    })
    expect(res.errors).toEqual([])
    const file = res.files['conf/weidmuller.data-hub.json']
    expect(file).toBeDefined()
    const parsed = JSON.parse(file as string)
    expect(parsed).toEqual({
      enabled: true,
      clientId: 'autonomy-node-datahub-provider',
      clientSecret: 'test-secret',
      vplcId: 'vplc-abc-123',
      exports: [
        { qualifier: 'Program0.pump_speed', direction: 'RW', iec_address: '%QW0.1' },
        { qualifier: 'Program0.temp_pv', direction: 'RO', iec_address: '%IW0.0' },
      ],
    })
  })

  integrationIt('ships no files when the master switch is off', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.weidmuller.ucontrol': {
          'data-hub': {
            enabled: false,
            clientId: 'leftover',
            clientSecret: 'leftover',
            vplcId: 'leftover',
            exports: [{ qualifier: 'Program0.pump_speed', direction: 'RW' }],
          },
        },
      },
      deviceId: 'uc20-m3000',
      exportableVariables: [{ qualifier: 'Program0.pump_speed', type: 'INT', isWritable: true }],
      resolveAddress: (q) => (q === 'Program0.pump_speed' ? '%QW0.1' : ''),
    })
    expect(res.errors).toEqual([])
    expect(res.files).toEqual({})
  })

  integrationIt('ships no files when enabled is absent (default off)', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.weidmuller.ucontrol': {
          'data-hub': { exports: [{ qualifier: 'Program0.x', direction: 'RW' }] },
        },
      },
      deviceId: 'uc20-m3000',
      exportableVariables: [],
      resolveAddress: () => '%QW0.1',
    })
    expect(res.files).toEqual({})
    expect(res.errors).toEqual([])
  })

  integrationIt('errors when enabled without credentials', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.weidmuller.ucontrol': {
          'data-hub': {
            enabled: true,
            exports: [{ qualifier: 'Program0.pump_speed', direction: 'RW' }],
          },
        },
      },
      deviceId: 'uc20-m3000',
      exportableVariables: [{ qualifier: 'Program0.pump_speed', type: 'INT', isWritable: true }],
      resolveAddress: (q) => (q === 'Program0.pump_speed' ? '%QW0.1' : ''),
    })
    expect(res.errors).toEqual([
      'com.weidmuller.ucontrol:data-hub: Data Hub: clientId is required when enabled',
      'com.weidmuller.ucontrol:data-hub: Data Hub: clientSecret is required when enabled',
      'com.weidmuller.ucontrol:data-hub: Data Hub: vplcId is required when enabled',
    ])
  })

  integrationIt('enabled with no exports still ships the conf json so the runtime sees enabled:true', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.weidmuller.ucontrol': {
          'data-hub': {
            enabled: true,
            clientId: 'c',
            clientSecret: 's',
            vplcId: 'v',
            exports: [],
          },
        },
      },
      deviceId: 'uc20-m3000',
      exportableVariables: [],
      resolveAddress: () => '',
    })
    expect(res.errors).toEqual([])
    const parsed = JSON.parse(res.files['conf/weidmuller.data-hub.json'] as string)
    expect(parsed).toEqual({ enabled: true, clientId: 'c', clientSecret: 's', vplcId: 'v', exports: [] })
  })

  integrationIt('surfaces the real emitter error message for a variable with no address', () => {
    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: {
        'com.weidmuller.ucontrol': {
          'data-hub': {
            enabled: true,
            clientId: 'c',
            clientSecret: 's',
            vplcId: 'v',
            exports: [{ qualifier: 'Program0.orphan', direction: 'RW' }],
          },
        },
      },
      deviceId: 'uc20-m3000',
      exportableVariables: [],
      resolveAddress: () => '',
    })
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors[0]).toMatch(/no IEC address/)
    const parsed = JSON.parse(res.files['conf/weidmuller.data-hub.json'] as string)
    expect(parsed.exports).toEqual([])
  })

  /**
   * Full-pipeline simulation: build the exact (exportableVariables, addressByQualifier) snapshot
   * that `pipeline.ts` builds from `projectData.pous[].variables` + `configuration.resource.globalVariables`,
   * then run the real collector. The resulting `conf/weidmuller.data-hub.json` is byte-identical to what
   * `runCompileProgram` would place under `release/app/.../build/.../conf/weidmuller.data-hub.json`.
   */
  integrationIt('full-pipeline simulation: a realistic project snapshot yields the expected conf/weidmuller.data-hub.json', () => {
    // These are the field shapes the pipeline hands to collectVppScreenRuntimeArtifacts (see
    // src/backend/shared/compile/pipeline.ts lines ~852-895 in this branch).
    const exportableVariables: Array<{ qualifier: string; type: string; isWritable: boolean }> = [
      { qualifier: 'Program0.pump_speed', type: 'INT',  isWritable: true },
      { qualifier: 'Program0.temp_pv',   type: 'REAL', isWritable: true },
      { qualifier: 'Program0.estop',     type: 'BOOL', isWritable: true },
      { qualifier: 'GVL.setpoint',       type: 'INT',  isWritable: true },
      { qualifier: 'GVL.orphan',         type: 'INT',  isWritable: true },
    ]
    const addressByQualifier: Record<string, string> = {
      'Program0.pump_speed': '%QW0.1',
      'Program0.temp_pv':    '%IW0.0',
      'Program0.estop':      '%IX0.0',
      'GVL.setpoint':        '%MW0',
      'GVL.orphan':          '',
    }
    const mapping = {
      enabled: true,
      clientId: 'autonomy-node-datahub-provider',
      clientSecret: 'test-secret',
      vplcId: 'vplc-abc-123',
      exports: [
        { qualifier: 'Program0.pump_speed', direction: 'RW' },
        { qualifier: 'Program0.temp_pv',    direction: 'RO' },
        { qualifier: 'GVL.setpoint',        direction: 'RW' },
        { qualifier: 'GVL.orphan',          direction: 'RW' },
      ],
    }

    const res = collectVppScreenRuntimeArtifacts({
      vppExtensions: { 'com.weidmuller.ucontrol': { 'data-hub': mapping } },
      deviceId: 'uc20-m3000',
      exportableVariables,
      resolveAddress: (q) => addressByQualifier[q] ?? '',
    })

    const confFile = res.files['conf/weidmuller.data-hub.json']
    expect(confFile).toBeDefined()
    const parsed = JSON.parse(confFile as string)

    // Credentials and the addressed exports land in the output.
    expect(parsed.clientId).toBe('autonomy-node-datahub-provider')
    expect(parsed.clientSecret).toBe('test-secret')
    expect(parsed.vplcId).toBe('vplc-abc-123')
    expect(parsed.exports).toEqual([
      { qualifier: 'Program0.pump_speed', direction: 'RW', iec_address: '%QW0.1' },
      { qualifier: 'Program0.temp_pv',    direction: 'RO', iec_address: '%IW0.0' },
      { qualifier: 'GVL.setpoint',        direction: 'RW', iec_address: '%MW0' },
    ])
    // The orphan surfaces as a build-level error, prefixed by packageId:screenId.
    expect(res.errors).toEqual([
      'com.weidmuller.ucontrol:data-hub: Data Hub: GVL.orphan has no IEC address; add a location to export it',
    ])

    console.log('')
    console.log('=== conf/weidmuller.data-hub.json (byte-identical to the pipeline output) ===')
    console.log(confFile)
    console.log('=== End conf/weidmuller.data-hub.json ===')

    // Materialize the file at the exact path shape that `materializeRuntimeV4Bundle`
    // writes to: <release-root>/build/<board>/conf/weidmuller.data-hub.json. Proves the artifact
    // exists on disk after this test runs — the full round-trip of what the editor
    // compile pipeline would do under runCompileProgram, minus just the file-write step
    // which `materializeRuntimeV4Bundle` performs identically for every bundle entry.
    const buildDir = require('path').resolve(__dirname, '../../../../../release/app/build/uc20-m3000/conf')
    require('fs').mkdirSync(buildDir, { recursive: true })
    const outPath = require('path').join(buildDir, 'weidmuller.data-hub.json')
    require('fs').writeFileSync(outPath, confFile as string)
    expect(require('fs').existsSync(outPath)).toBe(true)
    const onDisk = JSON.parse(require('fs').readFileSync(outPath, 'utf-8'))
    expect(onDisk).toEqual(parsed)
    console.log('Materialized at:', outPath)
  })
})
