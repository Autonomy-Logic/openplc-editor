/**
 * Editor `CompilerPlatformPort` adapter — unit tests.
 *
 * Pipeline-internal behaviour is covered upstream by
 * `pipeline.test.ts`; here we focus on the editor-specific glue:
 *
 *   1. `assertEditorHttpsContext` discriminator narrow.
 *   2. `findHexInCompilationPath` — deterministic FQBN path + walk
 *      fallback (regression for the multi-board stale-build bug
 *      that returned the wrong `.hex`).
 *   3. Port methods that translate handler results into the canonical
 *      port shape (uploadArduinoBoard forwards args.port through to
 *      `handleUploadProgram`, packageVppPlugin error mapping, etc.).
 *
 * Filesystem is real (per-test temp dir) so we exercise the actual
 * arduino-cli build directory shape.  The editor handlers themselves
 * are stubbed since they spawn subprocesses we can't run in CI.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type { PlatformDeviceContext } from '@root/middleware/shared/ports/compiler-platform-port'

import {
  assertEditorHttpsContext,
  createEditorCompilerPlatformPort,
  findHexInCompilationPath,
  type EditorCompilerHandlers,
  type EditorCompilerPlatformPortContext,
} from '../editor-compiler-platform-port'

// ---------------------------------------------------------------------------
// assertEditorHttpsContext
// ---------------------------------------------------------------------------

describe('assertEditorHttpsContext', () => {
  it('returns the context unchanged when kind is editor-https', () => {
    const ctx: PlatformDeviceContext = { kind: 'editor-https', ip: '192.168.1.10', jwt: 'token' }
    const result = assertEditorHttpsContext(ctx)
    expect(result).toBe(ctx)
    expect(result.ip).toBe('192.168.1.10')
  })

  it('throws when handed a web-orchestrator context (web→editor port misuse guard)', () => {
    const ctx = { kind: 'web-orchestrator', deviceId: 'rt' } as unknown as PlatformDeviceContext
    expect(() => assertEditorHttpsContext(ctx)).toThrow(/non-editor context/)
    expect(() => assertEditorHttpsContext(ctx)).toThrow(/web-orchestrator/)
  })
})

// ---------------------------------------------------------------------------
// findHexInCompilationPath
// ---------------------------------------------------------------------------

describe('findHexInCompilationPath', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'find-hex-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function writeHex(fqbnSubDir: string, content = ':00\n'): string {
    const dir = join(tmp, 'examples', 'Baremetal', 'build', fqbnSubDir)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'Baremetal.ino.hex')
    writeFileSync(path, content)
    return path
  }

  it('returns null when the build directory does not exist', async () => {
    const result = await findHexInCompilationPath(tmp, 'arduino:avr:mega')
    expect(result).toBeNull()
  })

  it('finds the .hex at the canonical fqbn-derived path (`:`→`.`)', async () => {
    const expected = writeHex('arduino.avr.mega')
    const result = await findHexInCompilationPath(tmp, 'arduino:avr:mega')
    expect(result).toBe(expected)
  })

  it('picks the requested FQBN even when stale builds from other boards exist (regression)', async () => {
    // Pre-fix bug scenario: user compiled for Mega, switched to Uno,
    // then upload triggers a fresh compile.  arduino-cli writes the
    // new Uno hex; the stale Mega hex is still in the tree.  The walk
    // fallback returned the Mega hex (alphabetical first).  The
    // canonical-path lookup must pick the Uno hex deterministically.
    writeHex('arduino.avr.mega', ':MEGA\n')
    const unoHex = writeHex('arduino.avr.uno', ':UNO\n')
    const result = await findHexInCompilationPath(tmp, 'arduino:avr:uno')
    expect(result).toBe(unoHex)
  })

  it('falls back to the walk when the canonical path does not exist (FQBN-mangling cores)', async () => {
    // Some Arduino cores write to a directory derived differently
    // from the FQBN string (board aliases, core-internal mangling).
    // When the canonical path is absent, walk and return the first
    // matching .hex — preserves pre-fix behaviour as a safety net.
    const oddHex = writeHex('vendor.board.custom-name')
    const result = await findHexInCompilationPath(tmp, 'arduino:avr:mega')
    expect(result).toBe(oddHex)
  })

  it('returns null when no .hex exists anywhere in the build tree', async () => {
    mkdirSync(join(tmp, 'examples', 'Baremetal', 'build', 'arduino.avr.mega'), { recursive: true })
    // No .hex file written.
    const result = await findHexInCompilationPath(tmp, 'arduino:avr:mega')
    expect(result).toBeNull()
  })

  it('returns null and skips the canonical-path lookup when fqbn is empty', async () => {
    // The simulator path always passes a non-empty platform string;
    // an empty fqbn is a sign the caller's hals entry is malformed.
    // We still try the walk so an existing .hex (e.g. from a prior
    // session) gets picked up.
    const walkHex = writeHex('any-fqbn')
    const result = await findHexInCompilationPath(tmp, '')
    expect(result).toBe(walkHex)
  })
})

// ---------------------------------------------------------------------------
// createEditorCompilerPlatformPort — port method behaviour
// ---------------------------------------------------------------------------

describe('createEditorCompilerPlatformPort', () => {
  function makeHandlers(overrides?: Partial<EditorCompilerHandlers>): EditorCompilerHandlers {
    return {
      handleCompileArduinoProgram: jest.fn(),
      handleUploadProgram: jest.fn(),
      handleCoreInstallation: jest.fn(),
      handleLibraryInstallation: jest.fn(),
      handleVendorPluginPackaging: jest.fn(),
      ...overrides,
    } as unknown as EditorCompilerHandlers
  }

  function makeContext(overrides?: Partial<EditorCompilerPlatformPortContext>): EditorCompilerPlatformPortContext {
    return {
      normalizedProjectPath: '/tmp/project',
      compilationPath: '/tmp/project/build/Arduino Mega',
      sourceTargetFolderPath: '/tmp/project/build/Arduino Mega/src',
      boardTarget: 'Arduino Mega',
      boardCore: 'arduino:avr',
      boardHalsContent: { platform: 'arduino:avr:mega' },
      cleanBuild: false,
      mainProcessBridge: {
        makeRuntimeApiRequest: jest.fn(),
        makeRuntimeApiUpload: jest.fn(),
      },
      compressSourceFolder: jest.fn(),
      pollTimeoutMs: 1000,
      pollIntervalMs: 10,
      startTimeoutMs: 1000,
      startIntervalMs: 10,
      ...overrides,
    }
  }

  // ---- computeMd5 ---------------------------------------------------------

  it('computeMd5 returns the canonical MD5 hex digest', async () => {
    const port = createEditorCompilerPlatformPort(makeHandlers(), makeContext())
    const md5 = await port.computeMd5('hello world')
    // crypto.createHash('md5').update('hello world').digest('hex')
    expect(md5).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3')
  })

  // ---- installArduinoCore / installArduinoLib ----------------------------

  it('installArduinoCore forwards to handler and returns ok:true on resolve', async () => {
    const handleCoreInstallation = jest.fn(async () => undefined)
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleCoreInstallation }), makeContext())
    const result = await port.installArduinoCore({ coreId: 'arduino:avr' }, () => undefined)
    expect(handleCoreInstallation).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  it('installArduinoCore returns ok:false when the handler throws', async () => {
    const handleCoreInstallation = jest.fn(async () => {
      throw new Error('core install failed')
    })
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleCoreInstallation }), makeContext())
    const result = await port.installArduinoCore({ coreId: 'arduino:avr' }, log)
    expect(result.ok).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('core install failed'), 'error')
  })

  it('installArduinoLib forwards extraLibraries to handler and returns ok:true', async () => {
    const handleLibraryInstallation = jest.fn(async () => undefined)
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleLibraryInstallation }), makeContext())
    const result = await port.installArduinoLib(
      { libId: '', extraLibraries: ['Arduino_Opta_Blueprint', 'P1AM'] },
      () => undefined,
    )
    expect(handleLibraryInstallation).toHaveBeenCalledTimes(1)
    // The per-board library list is the first argument; the output
    // callback follows.  Asserting the exact list catches accidental
    // drops in plumbing between port → handler.
    expect(handleLibraryInstallation).toHaveBeenCalledWith(['Arduino_Opta_Blueprint', 'P1AM'], expect.any(Function))
    expect(result).toEqual({ ok: true })
  })

  it('installArduinoLib defaults extraLibraries to [] when the caller omits it', async () => {
    const handleLibraryInstallation = jest.fn(async () => undefined)
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleLibraryInstallation }), makeContext())
    await port.installArduinoLib({ libId: '' }, () => undefined)
    expect(handleLibraryInstallation).toHaveBeenCalledWith([], expect.any(Function))
  })

  it('installArduinoLib warns and returns ok:true when the install machinery throws', async () => {
    // The handler swallows non-zero `arduino-cli lib install` exits as
    // warnings — only catastrophic failures (binary missing, spawn
    // error) bubble out as throws.  Either way the port logs a warning
    // and reports ok:true so the build continues and arduino-cli
    // compile becomes the source of truth for missing headers.
    const handleLibraryInstallation = jest.fn(async () => {
      throw new Error('lib install failed')
    })
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleLibraryInstallation }), makeContext())
    const result = await port.installArduinoLib({ libId: '' }, log)
    expect(result.ok).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('lib install failed'), 'warning')
  })

  // ---- uploadArduinoBoard — port wiring (regression for issue #5) ----

  it('uploadArduinoBoard forwards args.port to the handler as communicationPort', async () => {
    const handleUploadProgram = jest.fn(async () => undefined)
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleUploadProgram }), makeContext())
    await port.uploadArduinoBoard(
      { compilationPath: '', fqbn: 'arduino:avr:mega', port: '/dev/cu.usbmodem1101' },
      () => undefined,
    )
    expect(handleUploadProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        communicationPort: '/dev/cu.usbmodem1101',
        arduinoPlatform: 'arduino:avr:mega',
      }),
    )
  })

  it('uploadArduinoBoard passes communicationPort=undefined to the handler when args.port is empty', async () => {
    // Empty string means "no explicit port from the renderer" — the
    // handler must fall back to the disk-persisted value rather than
    // call arduino-cli with `--port ""`.  The undefined sentinel
    // signals "fall through" to the handler's legacy code path.
    const handleUploadProgram = jest.fn(async () => undefined)
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleUploadProgram }), makeContext())
    await port.uploadArduinoBoard({ compilationPath: '', fqbn: 'arduino:avr:mega', port: '' }, () => undefined)
    expect(handleUploadProgram).toHaveBeenCalledWith(expect.objectContaining({ communicationPort: undefined }))
  })

  it('uploadArduinoBoard returns ok:false when the upload handler throws', async () => {
    const handleUploadProgram = jest.fn(async () => {
      throw new Error('serial port busy')
    })
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleUploadProgram }), makeContext())
    const result = await port.uploadArduinoBoard(
      { compilationPath: '', fqbn: 'arduino:avr:mega', port: '/dev/ttyACM0' },
      log,
    )
    expect(result.ok).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('serial port busy'), 'error')
  })

  // ---- packageVppPlugin --------------------------------------------------

  it('packageVppPlugin forwards to handler and returns empty files map on success', async () => {
    const handleVendorPluginPackaging = jest.fn(async () => undefined)
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleVendorPluginPackaging }), makeContext())
    const result = await port.packageVppPlugin({ boardTarget: 'SLM-RP4' }, () => undefined)
    expect(handleVendorPluginPackaging).toHaveBeenCalledTimes(1)
    // No `getVppRuntimeFloor` in the default context, so no floor is known —
    // which the pipeline reads as "no constraint".
    expect(result).toEqual({ files: {}, minRuntimeVersion: null })
  })

  it('packageVppPlugin surfaces the VPP runtime floor when the context can resolve one', async () => {
    const getVppRuntimeFloor = jest.fn(() => '4.1.9')
    const port = createEditorCompilerPlatformPort(makeHandlers(), makeContext({ getVppRuntimeFloor }))
    const result = await port.packageVppPlugin({ boardTarget: 'SLM-RP4' }, () => undefined)
    expect(getVppRuntimeFloor).toHaveBeenCalledWith('SLM-RP4')
    expect(result.minRuntimeVersion).toBe('4.1.9')
  })

  it('packageVppPlugin reports no floor when the resolver throws', async () => {
    // A gate that failed the build because it could not read its own metadata
    // would be worse than the mismatch it exists to catch.
    const getVppRuntimeFloor = jest.fn(() => {
      throw new Error('registry unreadable')
    })
    const port = createEditorCompilerPlatformPort(makeHandlers(), makeContext({ getVppRuntimeFloor }))
    const result = await port.packageVppPlugin({ boardTarget: 'SLM-RP4' }, () => undefined)
    expect(result.minRuntimeVersion).toBeNull()
    expect(result.errors).toBeUndefined()
  })

  it('packageVppPlugin returns an errors[] when the handler throws', async () => {
    const handleVendorPluginPackaging = jest.fn(async () => {
      throw new Error('VPP read failed')
    })
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleVendorPluginPackaging }), makeContext())
    const result = await port.packageVppPlugin({ boardTarget: 'SLM-RP4' }, () => undefined)
    expect(result.files).toEqual({})
    expect(result.errors).toHaveLength(1)
    expect(result.errors?.[0]?.message).toBe('VPP read failed')
  })

  it('packageVppPlugin forwards the handler log lines through PlatformLog (Buffer → string coercion)', async () => {
    const log = jest.fn()
    const handleVendorPluginPackaging = jest.fn(
      async (
        _boardTarget: string,
        _projectPath: string,
        _sourceTargetFolderPath: string,
        callback: (chunk: Buffer | string, level?: 'info' | 'error') => void,
      ) => {
        callback('plain string line', 'info')
        callback(Buffer.from('buffer line', 'utf-8'), 'error')
        callback('default level line')
      },
    )
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleVendorPluginPackaging }), makeContext())
    await port.packageVppPlugin({ boardTarget: 'SLM-RP4' }, log)
    expect(log).toHaveBeenCalledWith('plain string line', 'info')
    expect(log).toHaveBeenCalledWith('buffer line', 'error')
    expect(log).toHaveBeenCalledWith('default level line', 'info')
  })

  // ---- checkRuntimeVersion ------------------------------------------------

  it('checkRuntimeVersion returns the runtime version on a successful probe', async () => {
    const makeRuntimeApiRequest = jest.fn(async () => ({
      success: true as const,
      data: { version: '4.1.2' },
    })) as unknown as EditorCompilerPlatformPortContext['mainProcessBridge']['makeRuntimeApiRequest']
    const port = createEditorCompilerPlatformPort(
      makeHandlers(),
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest, makeRuntimeApiUpload: jest.fn() } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      () => undefined,
    )
    // This stub answers every endpoint with a `/api/version` body, so
    // `/api/capabilities` yields no usable `runtimeVersion` and the probe
    // falls back — the exact shape of a runtime predating the endpoint.
    expect(result).toEqual({ ok: true, version: '4.1.2', minEditorVersion: null, supportsProjectSnapshot: false })
  })

  it('checkRuntimeVersion reads the editor floor from /api/capabilities when the device serves it', async () => {
    const makeRuntimeApiRequest = jest.fn(async (_ip: string, endpoint: string) => {
      if (endpoint === '/api/capabilities') {
        return { success: true as const, data: { runtimeVersion: 'v4.2.0', minEditorVersion: '4.2.1' } }
      }
      return { success: true as const, data: { version: 'SHOULD-NOT-BE-USED' } }
    }) as unknown as EditorCompilerPlatformPortContext['mainProcessBridge']['makeRuntimeApiRequest']
    const port = createEditorCompilerPlatformPort(
      makeHandlers(),
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest, makeRuntimeApiUpload: jest.fn() } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      () => undefined,
    )
    expect(result).toEqual({ ok: true, version: 'v4.2.0', minEditorVersion: '4.2.1', supportsProjectSnapshot: false })
  })

  it('checkRuntimeVersion falls back to /api/version when capabilities 404s', async () => {
    const makeRuntimeApiRequest = jest.fn(async (_ip: string, endpoint: string) => {
      if (endpoint === '/api/capabilities') return { success: false as const, error: '404 Not Found' }
      return { success: true as const, data: { version: 'v4.1.7' } }
    }) as unknown as EditorCompilerPlatformPortContext['mainProcessBridge']['makeRuntimeApiRequest']
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(
      makeHandlers(),
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest, makeRuntimeApiUpload: jest.fn() } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      log,
    )
    expect(result).toEqual({ ok: true, version: 'v4.1.7', minEditorVersion: null, supportsProjectSnapshot: false })
    // The 404 is the normal answer from every deployed runtime — it must not
    // nag the user on every upload.
    expect(log).not.toHaveBeenCalled()
  })

  it('checkRuntimeVersion returns version=null and logs a warning on probe failure', async () => {
    const makeRuntimeApiRequest = jest.fn(async () => ({
      success: false as const,
      error: 'ECONNREFUSED',
    })) as unknown as EditorCompilerPlatformPortContext['mainProcessBridge']['makeRuntimeApiRequest']
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(
      makeHandlers(),
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest, makeRuntimeApiUpload: jest.fn() } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      log,
    )
    expect(result).toEqual({ ok: true, version: null, minEditorVersion: null, supportsProjectSnapshot: false })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not reach runtime'), 'warning')
  })

  it('checkRuntimeVersion catches sync throws and returns version=null', async () => {
    const makeRuntimeApiRequest = jest.fn(async () => {
      throw new Error('probe blew up')
    }) as unknown as EditorCompilerPlatformPortContext['mainProcessBridge']['makeRuntimeApiRequest']
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(
      makeHandlers(),
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest, makeRuntimeApiUpload: jest.fn() } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      log,
    )
    expect(result).toEqual({ ok: true, version: null, minEditorVersion: null, supportsProjectSnapshot: false })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('probe blew up'), 'warning')
  })

  // ---- uploadRuntimeV4: the project-snapshot capability --------------------
  //
  // The capability is read by the pre-upload probe and acted on here. These pin
  // the behaviour rather than the plumbing: whether the archive gets built at
  // all. Building one for a runtime that discards it costs the user upload time
  // and leaves them a device they cannot retrieve from; not building one for a
  // runtime that would have kept it silently loses the feature.

  describe('uploadRuntimeV4 — project-snapshot capability', () => {
    const deviceContext = { kind: 'editor-https' as const, ip: '10.0.0.1', jwt: 'token' }

    function makeUploadContext(overrides?: Partial<EditorCompilerPlatformPortContext>) {
      return makeContext({
        compressSourceFolder: jest.fn().mockResolvedValue(Buffer.from('program')),
        mainProcessBridge: {
          makeRuntimeApiRequest: jest.fn(),
          makeRuntimeApiUpload: jest.fn().mockResolvedValue({ success: true, data: '{}' }),
        },
        ...overrides,
      })
    }

    it('builds and sends the project when the runtime stores them', async () => {
      const buildUploadSnapshot = jest.fn().mockResolvedValue({
        archive: Buffer.from('zip'),
        metadata: '{"projectName":"Demo"}',
        missingLibraries: [],
      })
      const context = makeUploadContext({ buildUploadSnapshot })
      const port = createEditorCompilerPlatformPort(makeHandlers(), context)

      await port.uploadRuntimeV4({ bundle: {}, context: deviceContext, supportsProjectSnapshot: true }, () => undefined)

      expect(buildUploadSnapshot).toHaveBeenCalled()
      const upload = (context.mainProcessBridge.makeRuntimeApiUpload as jest.Mock).mock.calls[0][0] as {
        snapshotBuffer?: Buffer
        snapshotMetadata?: string
      }
      expect(upload.snapshotBuffer).toEqual(Buffer.from('zip'))
      expect(upload.snapshotMetadata).toBe('{"projectName":"Demo"}')
    })

    it('does not build one for a runtime that would discard it', async () => {
      const buildUploadSnapshot = jest.fn()
      const context = makeUploadContext({ buildUploadSnapshot })
      const port = createEditorCompilerPlatformPort(makeHandlers(), context)

      await port.uploadRuntimeV4(
        { bundle: {}, context: deviceContext, supportsProjectSnapshot: false },
        () => undefined,
      )

      expect(buildUploadSnapshot).not.toHaveBeenCalled()
      const upload = (context.mainProcessBridge.makeRuntimeApiUpload as jest.Mock).mock.calls[0][0] as {
        snapshotBuffer?: Buffer
        snapshotMetadata?: string
      }
      expect(upload.snapshotBuffer).toBeUndefined()
      expect(upload.snapshotMetadata).toBeUndefined()
    })

    it('tells the user the project will not be retrievable from that device', async () => {
      // The skip is silent otherwise, and "I uploaded it, why can I not get it
      // back?" is the question this exists to pre-empt.
      const log = jest.fn()
      const port = createEditorCompilerPlatformPort(
        makeHandlers(),
        makeUploadContext({ buildUploadSnapshot: jest.fn() }),
      )

      await port.uploadRuntimeV4({ bundle: {}, context: deviceContext, supportsProjectSnapshot: false }, log)

      expect(log).toHaveBeenCalledWith(expect.stringContaining('does not store source projects'), 'warning')
    })

    it('still uploads the program when the project cannot be prepared', async () => {
      // The project is the optional half. A failure preparing it must never cost
      // the user the program upload itself.
      const context = makeUploadContext({
        buildUploadSnapshot: jest.fn().mockRejectedValue(new Error('disk full')),
      })
      const log = jest.fn()
      const port = createEditorCompilerPlatformPort(makeHandlers(), context)

      await port.uploadRuntimeV4({ bundle: {}, context: deviceContext, supportsProjectSnapshot: true }, log)

      // The program still goes, just without the project beside it. (The
      // overall result is not asserted: the deploy flow polls the device for
      // build status afterwards, which this harness does not stand up.)
      expect(context.mainProcessBridge.makeRuntimeApiUpload).toHaveBeenCalled()
      const upload = (context.mainProcessBridge.makeRuntimeApiUpload as jest.Mock).mock.calls[0][0] as {
        snapshotBuffer?: Buffer
      }
      expect(upload.snapshotBuffer).toBeUndefined()
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not prepare the project'), 'warning')
    })
  })
})
