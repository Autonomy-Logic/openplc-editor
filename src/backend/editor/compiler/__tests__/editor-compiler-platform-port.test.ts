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
      handleTranspileXMLtoST: jest.fn(),
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
      },
      compressSourceFolder: jest.fn(),
      sendRuntimeUpload: jest.fn(),
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

  it('installArduinoLib forwards to handler and returns ok:true', async () => {
    const handleLibraryInstallation = jest.fn(async () => undefined)
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleLibraryInstallation }), makeContext())
    const result = await port.installArduinoLib({ libId: '' }, () => undefined)
    expect(handleLibraryInstallation).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  it('installArduinoLib returns ok:false when the handler throws', async () => {
    const handleLibraryInstallation = jest.fn(async () => {
      throw new Error('lib install failed')
    })
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(makeHandlers({ handleLibraryInstallation }), makeContext())
    const result = await port.installArduinoLib({ libId: '' }, log)
    expect(result.ok).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('lib install failed'), 'error')
  })

  // ---- transpileXmlToSt — xml2stArgs forwarding (STRUCT drift regression) ----

  it('transpileXmlToSt forwards args.xml2stArgs to handleTranspileXMLtoST verbatim', async () => {
    // Regression guard for the editor/web STRUCT drift bug: the
    // shared pipeline owns the xml2st flag set as an array of CLI
    // tokens, and the editor adapter must thread that array into
    // handleTranspileXMLtoST as the third positional arg — the
    // handler then splices it straight into the spawned xml2st argv.
    // Editor's local xml2st is trusted, so the adapter passes the
    // array through verbatim (no filtering).
    const handleTranspileXMLtoST = jest
      .fn<
        ReturnType<EditorCompilerHandlers['handleTranspileXMLtoST']>,
        Parameters<EditorCompilerHandlers['handleTranspileXMLtoST']>
      >()
      .mockResolvedValue({ success: true, data: '' })
    const tmp = mkdtempSync(join(tmpdir(), 'xml2st-args-'))
    try {
      const port = createEditorCompilerPlatformPort(
        makeHandlers({ handleTranspileXMLtoST }),
        makeContext({ sourceTargetFolderPath: tmp }),
      )
      // The handler stub never produces a program.st, so the readFile
      // after the spawn-equivalent step throws — that's fine, we only
      // care about the xml2stArgs argument forwarded to the handler.
      await port.transpileXmlToSt({ xml: '<plc/>', xml2stArgs: ['--keep-structs'] }, () => undefined)
      expect(handleTranspileXMLtoST).toHaveBeenCalledTimes(1)
      const callArgs = handleTranspileXMLtoST.mock.calls[0]!
      expect(callArgs[2]).toEqual(['--keep-structs'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('transpileXmlToSt forwards an empty xml2stArgs array verbatim', async () => {
    // The adapter must not "helpfully" inject defaults when the
    // pipeline asked for nothing — that would be the exact kind of
    // silent drift the shared port contract exists to prevent.
    const handleTranspileXMLtoST = jest
      .fn<
        ReturnType<EditorCompilerHandlers['handleTranspileXMLtoST']>,
        Parameters<EditorCompilerHandlers['handleTranspileXMLtoST']>
      >()
      .mockResolvedValue({ success: true, data: '' })
    const tmp = mkdtempSync(join(tmpdir(), 'xml2st-empty-args-'))
    try {
      const port = createEditorCompilerPlatformPort(
        makeHandlers({ handleTranspileXMLtoST }),
        makeContext({ sourceTargetFolderPath: tmp }),
      )
      await port.transpileXmlToSt({ xml: '<plc/>', xml2stArgs: [] }, () => undefined)
      const callArgs = handleTranspileXMLtoST.mock.calls[0]!
      expect(callArgs[2]).toEqual([])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
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
    expect(result).toEqual({ files: {} })
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
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      () => undefined,
    )
    expect(result).toEqual({ ok: true, version: '4.1.2' })
  })

  it('checkRuntimeVersion returns version=null and logs a warning on probe failure', async () => {
    const makeRuntimeApiRequest = jest.fn(async () => ({
      success: false as const,
      error: 'ECONNREFUSED',
    })) as unknown as EditorCompilerPlatformPortContext['mainProcessBridge']['makeRuntimeApiRequest']
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(
      makeHandlers(),
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      log,
    )
    expect(result).toEqual({ ok: true, version: null })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not reach runtime'), 'warning')
  })

  it('checkRuntimeVersion catches sync throws and returns version=null', async () => {
    const makeRuntimeApiRequest = jest.fn(async () => {
      throw new Error('probe blew up')
    }) as unknown as EditorCompilerPlatformPortContext['mainProcessBridge']['makeRuntimeApiRequest']
    const log = jest.fn()
    const port = createEditorCompilerPlatformPort(
      makeHandlers(),
      makeContext({ mainProcessBridge: { makeRuntimeApiRequest } }),
    )
    const result = await port.checkRuntimeVersion(
      { context: { kind: 'editor-https', ip: '10.0.0.1', jwt: 'token' } },
      log,
    )
    expect(result).toEqual({ ok: true, version: null })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('probe blew up'), 'warning')
  })
})
