/** @jest-environment node */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { HmiPreviewMechanisms } from '../../../../../middleware/shared/ports/hmi-preview-mechanisms'
import { sha256Hex } from '../../../wasm-toolchain/content-digest'
import { WASM_TOOLCHAIN_IDENTITY } from '../../../wasm-toolchain/toolchain-identity'
import type { WasmCompileRequest, WasmCompileResult } from '../../../../../middleware/shared/ports/wasm-toolchain-types'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import { installedWidgetArchives } from '../../unit/__tests__/fixtures/widget-libraries'
import { WIDGET_PREVIEW_SCREEN } from '../../unit/generate-hmi-unit'
import {
  buildHmiPreview,
  buildHmiPreviewRequest,
  HMI_PREVIEW_CXX_FLAGS,
  HMI_PREVIEW_LINK_FLAGS,
  HMI_PREVIEW_PRELUDE_FLAGS,
  type HmiPreviewResources,
} from '../build-hmi-preview'
import { encodeHmiPrelude, HMI_PRELUDE_PCH, HMI_PRELUDE_SOURCE, type HmiPrelude, hmiPreludeText } from '../hmi-prelude'
import { createHmiPreviewPort, HMI_TOOLCHAIN_HOLDER, hmiPreviewResources } from '../hmi-preview-port'
import { testWorker } from './fixtures/support'

/* The bundled fonts: resources/sources/hmi/fonts in the editor, src/assets/firmware/hmi/fonts on the web. */
const FONTS =
  ['resources/sources/hmi/fonts', 'src/assets/firmware/hmi/fonts']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-bundled-fonts'
const readFont = (file: string) => Promise.resolve(new Uint8Array(readFileSync(join(FONTS, file))))
const stats = { units: 1, cached: 0 }

const resources: HmiPreviewResources = {
  runtimeHeaders: { 'iec_types.hpp': '// types' },
  hmiSources: { 'core/hmi_core.c': '// core', 'preview/hmi_preview_host.cpp': '// host' },
  readFont,
  projectLibraries: installedWidgetArchives(),
}

const built: WasmCompileResult = { ok: true, wasm: new Uint8Array([0, 97, 115, 109]), stats, diagnostics: [] }

function capture(result: WasmCompileResult = built) {
  const requests: WasmCompileRequest[] = []
  const compile = (request: WasmCompileRequest): Promise<WasmCompileResult> => {
    requests.push(request)
    return Promise.resolve(result)
  }
  return { requests, compile }
}

describe('buildHmiPreviewRequest', () => {
  const unitFiles = {
    'hmi_unit.hpp': '#include "iec_types.hpp"\n#include <array>\n#include "hmi_core.h"\nnamespace hmi {}',
    'hmi_unit_libraries.hpp': '#include "iec_var.hpp"\n#include <array>',
    'lib_standard_widgets.cpp': '#include "hmi_unit_libraries.hpp"\n#include <vector>',
    'pou_MAIN.cpp': '// main',
    'hmi_preview_0.cpp': '// setters',
    'hmi_preview_factory.cpp': '// factory',
    'configuration.cpp': '// config',
  }
  const groups = {
    library: ['lib_standard_widgets.cpp'],
    widgets: [],
    screens: { Main: ['pou_MAIN.cpp', 'hmi_preview_0.cpp'] },
    glue: ['configuration.cpp'],
    factory: ['hmi_preview_factory.cpp'],
  }
  const request = buildHmiPreviewRequest(unitFiles, groups, '// fonts', resources)

  it('lays out the runtime headers, the HMI sources, the unit and the font table', () => {
    expect(Object.keys(request.files)).toEqual(
      expect.arrayContaining([
        'strucpp_runtime/include/iec_types.hpp',
        'hmi/core/hmi_core.c',
        'hmi/preview/hmi_preview_host.cpp',
        'unit/pou_MAIN.cpp',
        'unit/hmi_preview_fonts.c',
      ]),
    )
    expect(request.files['unit/hmi_preview_fonts.c']).toBe('// fonts')
  })

  it('compiles each group of unit files that change together as one unit, with the core and fonts apart', () => {
    expect(request.files['groups/screen_Main.cpp']).toBe('#include "pou_MAIN.cpp"\n#include "hmi_preview_0.cpp"\n')
    expect(request.files['groups/library.cpp']).toBe('#include "lib_standard_widgets.cpp"\n')
    expect(request.files).not.toHaveProperty(['groups/widgets.cpp'])
    expect(request.units.map((u) => [u.source, u.language])).toEqual([
      ['hmi/core/hmi_core.c', 'c'],
      ['hmi/core/hmi_theme.c', 'c'],
      ['hmi/core/hmi_math.c', 'c'],
      ['hmi/core/hmi_raster.c', 'c'],
      ['hmi/core/hmi_text.c', 'c'],
      ['unit/hmi_preview_fonts.c', 'c'],
      ['groups/library.cpp', 'c++'],
      ['groups/screen_Main.cpp', 'c++'],
      ['groups/glue.cpp', 'c++'],
      ['groups/factory.cpp', 'c++'],
      ['hmi/preview/hmi_preview_host.cpp', 'c++'],
      ['hmi/preview/hmi_preview_live.cpp', 'c++'],
    ])
  })

  it("compiles the factory table alone, and the live elements' code against the unit's libraries without a base library", () => {
    expect(request.files['groups/factory.cpp']).toBe('#include "hmi_preview_factory.cpp"\n')
    expect(request.files['unit/hmi_preview_widgets.hpp']).toBe('#include "hmi_unit_libraries.hpp"\n')
    expect(request.units.find((u) => u.source === 'hmi/preview/hmi_preview_live.cpp')).toEqual({
      source: 'hmi/preview/hmi_preview_live.cpp',
      language: 'c++',
    })
    expect(request.units.filter((u) => u.flags !== undefined)).toHaveLength(0)
  })

  it('compiles every unit with its headers included directly, with no precompiled header', () => {
    expect(Object.keys(request.files).filter((path) => path.endsWith('.pch') || path.includes('_pch'))).toEqual([])
    expect(request.cxxFlags).toBe(HMI_PREVIEW_CXX_FLAGS)
    expect(request.linkFlags).toBe(HMI_PREVIEW_LINK_FLAGS)
    expect(HMI_PREVIEW_LINK_FLAGS).toContain('-mexec-model=reactor')
  })
})

describe('buildHmiPreviewRequest with the shipped prelude', () => {
  const opening = '#pragma once\n#include "iec_types.hpp"\n#include "hmi_unit_libraries.hpp"\n'
  const libraries = '#pragma once\nnamespace hmi {}\n'
  const prelude: HmiPrelude = { header: opening, libraries, pch: new Uint8Array([7]), flags: HMI_PREVIEW_PRELUDE_FLAGS }
  const groups = {
    library: [],
    widgets: [],
    screens: { Main: ['pou_MAIN.cpp'] },
    glue: ['configuration.cpp'],
    factory: ['hmi_preview_factory.cpp'],
  }
  const unitFiles = {
    'hmi_unit.hpp': `${opening}namespace hmi { class MAIN; }\n`,
    'hmi_unit_libraries.hpp': libraries,
    'pou_MAIN.cpp': '// main',
    'configuration.cpp': '// config',
    'hmi_preview_factory.cpp': '// factory',
  }
  const flagsOf = (request: WasmCompileRequest) =>
    Object.fromEntries(request.units.map((u) => [u.source, u.flags ?? null]))

  it('starts every group but the factory from the precompiled header when the unit fits it', () => {
    const request = buildHmiPreviewRequest(unitFiles, groups, '// fonts', { ...resources, prelude })
    expect(request.files[HMI_PRELUDE_SOURCE]).toBe(opening)
    expect(request.files[HMI_PRELUDE_PCH]).toBe(prelude.pch)
    expect(flagsOf(request)).toMatchObject({
      'groups/screen_Main.cpp': ['-include-pch', HMI_PRELUDE_PCH],
      'groups/glue.cpp': ['-include-pch', HMI_PRELUDE_PCH],
      'groups/factory.cpp': null,
      'hmi/preview/hmi_preview_host.cpp': null,
      'hmi/core/hmi_core.c': null,
    })
  })

  it('compiles as without one when the unit does not fit it', () => {
    const other = { ...unitFiles, 'hmi_unit_libraries.hpp': `${libraries}namespace hmi { class X; }\n` }
    const request = buildHmiPreviewRequest(other, groups, '// fonts', { ...resources, prelude })
    expect(request.files).not.toHaveProperty([HMI_PRELUDE_PCH])
    expect(request.files).not.toHaveProperty([HMI_PRELUDE_SOURCE])
    expect(request.units.filter((u) => u.flags !== undefined)).toEqual([])
  })

  it('compiles as without one when the prelude was built with other C++ flags than the preview units use', () => {
    for (const flags of [HMI_PREVIEW_CXX_FLAGS, [...HMI_PREVIEW_PRELUDE_FLAGS, '-O2']]) {
      const request = buildHmiPreviewRequest(unitFiles, groups, '// fonts', {
        ...resources,
        prelude: { ...prelude, flags },
      })
      expect(request.files).not.toHaveProperty([HMI_PRELUDE_PCH])
      expect(request.units.filter((u) => u.flags !== undefined)).toEqual([])
    }
  })
})

describe('buildHmiPreview with the shipped prelude', () => {
  const failed: WasmCompileResult = {
    ok: false,
    error: 'Compilation failed in 1 of 9 file(s)',
    stats,
    diagnostics: [{ level: 'error', message: 'groups/glue.cpp: error: invalid precompiled header' }],
  }
  /** A prelude that fits the sample project's unit header. */
  async function fittingPrelude(): Promise<HmiPrelude> {
    const { requests, compile } = capture()
    await buildHmiPreview(sampleProject(), resources, compile)
    const header = hmiPreludeText(String(requests[0].files['unit/hmi_unit.hpp']))
    if (header === null) throw new Error('the sample unit header has no prelude')
    const libraries = String(requests[0].files['unit/hmi_unit_libraries.hpp'])
    return { header, libraries, pch: new Uint8Array([5]), flags: HMI_PREVIEW_PRELUDE_FLAGS }
  }
  /** A compile that answers each request in turn with the next of `results`. */
  function answering(...results: WasmCompileResult[]) {
    const requests: WasmCompileRequest[] = []
    const compile = (request: WasmCompileRequest): Promise<WasmCompileResult> => {
      requests.push(request)
      return Promise.resolve(results[Math.min(requests.length, results.length) - 1])
    }
    return { requests, compile }
  }

  it('compiles once more without the prelude when the build that used it fails, and returns that build', async () => {
    const prelude = await fittingPrelude()
    const { requests, compile } = answering(failed, built)
    const build = await buildHmiPreview(sampleProject(), { ...resources, prelude }, compile)
    expect(build.ok).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0].files[HMI_PRELUDE_PCH]).toBe(prelude.pch)
    expect(requests[1].files).not.toHaveProperty([HMI_PRELUDE_PCH])
    expect(requests[1].units.filter((u) => u.flags?.includes('-include-pch'))).toEqual([])
  })

  it('reports the failure of the build without the prelude when that one fails too', async () => {
    const prelude = await fittingPrelude()
    const plain: WasmCompileResult = { ...failed, diagnostics: [{ level: 'error', message: 'pou_MAIN.cpp: error: x' }] }
    const { requests, compile } = answering(failed, plain)
    const build = await buildHmiPreview(sampleProject(), { ...resources, prelude }, compile)
    expect(requests).toHaveLength(2)
    expect(build).toMatchObject({ ok: false, errors: [{ message: 'pou_MAIN.cpp: error: x' }] })
  })

  it('does not compile again when a build without the prelude fails', async () => {
    const { requests, compile } = answering(failed, built)
    const build = await buildHmiPreview(sampleProject(), resources, compile)
    expect(build.ok).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it('compiles once when the build that used the prelude succeeds', async () => {
    const prelude = await fittingPrelude()
    const { requests, compile } = answering(built)
    expect((await buildHmiPreview(sampleProject(), { ...resources, prelude }, compile)).ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0].files[HMI_PRELUDE_PCH]).toBe(prelude.pch)
  })
})

describe('buildHmiPreview', () => {
  it('builds the screens with every library whole and returns their pages, setters and element ids', async () => {
    const { requests, compile } = capture()
    const build = await buildHmiPreview(sampleProject(), resources, compile)
    expect(build.ok).toBe(true)
    if (!build.ok) return
    expect(build.pages).toEqual({ Overview: 0, Details: 1 })
    expect(build.setters['Overview.Level.Caption']).toMatchObject({ screen: 0, kind: 'str' })
    expect(build.elementIds.length).toBeGreaterThan(0)
    expect(requests).toHaveLength(1)
    expect(Object.keys(requests[0].files)).toContain('groups/screen_Overview.cpp')
    expect(String(requests[0].files['unit/hmi_preview_fonts.c'])).toContain('hmi_font_table')
  })

  it("compiles each screen against a header without the other screens' classes", async () => {
    const { requests, compile } = capture()
    await buildHmiPreview(sampleProject(), resources, compile)
    const files = requests[0].files
    const overview = String(files['unit/hmi_screen_OVERVIEW.hpp'])
    expect(overview).toContain('class OVERVIEW : public HMISCREEN {')
    expect(overview).not.toContain('class DETAILS : public')
    expect(String(files['unit/pou_OVERVIEW.cpp'])).toContain('#include "hmi_screen_OVERVIEW.hpp"')
    expect(String(files['unit/hmi_preview_0.cpp'])).toContain('#include "hmi_screen_OVERVIEW.hpp"')
    expect(String(files['unit/hmi_unit_glue.cpp'])).toContain('#include "hmi_unit.hpp"')
  })

  it('returns the widget types the module adds without a build', async () => {
    const { compile } = capture()
    const build = await buildHmiPreview(sampleProject(), resources, compile)
    if (!build.ok) throw new Error('the build failed')
    expect(build.factory.types.HMILABEL?.setters.TEXT).toMatchObject({ kind: 'str' })
    expect(build.factory.types.BADGE).toBeDefined()
  })

  it('builds a widget block on its own screen after the project screens', async () => {
    const { compile } = capture()
    const build = await buildHmiPreview({ ...sampleProject(), screens: [], widgetPreview: 'Badge' }, resources, compile)
    expect(build.ok && build.pages).toEqual({ [WIDGET_PREVIEW_SCREEN]: 0 })
  })

  it('reports the screens that do not compile without running the toolchain', async () => {
    const { requests, compile } = capture()
    const project = sampleProject()
    const build = await buildHmiPreview(
      {
        ...project,
        screens: [
          {
            name: 'Overview',
            source: 'FUNCTION_BLOCK Overview EXTENDS HmiScreen VAR x : Missing; END_VAR END_FUNCTION_BLOCK',
          },
          project.screens[1],
        ],
      },
      resources,
      compile,
    )
    expect(build.ok).toBe(false)
    expect(requests).toEqual([])
  })

  it("reports the toolchain's errors, or its failure when it gave none", async () => {
    const withErrors = capture({
      ok: false,
      error: 'Compilation failed',
      stats,
      diagnostics: [
        { message: 'x.cpp:1: error: boom', level: 'error' },
        { message: 'x.cpp:2: warning: hm', level: 'warning' },
      ],
    })
    const failed = await buildHmiPreview(sampleProject(), resources, withErrors.compile)
    expect(!failed.ok && failed.errors).toEqual([{ file: 'HMI', message: 'x.cpp:1: error: boom' }])
    const bare = capture({ ok: false, error: 'Link failed', stats, diagnostics: [] })
    const linkFailed = await buildHmiPreview(sampleProject(), resources, bare.compile)
    expect(!linkFailed.ok && linkFailed.errors).toEqual([{ file: 'HMI', message: 'Link failed' }])
  })

  it('reports a font it cannot read', async () => {
    const { compile } = capture()
    const build = await buildHmiPreview(
      sampleProject(),
      { ...resources, readFont: () => Promise.reject(new Error('gone')) },
      compile,
    )
    expect(!build.ok && build.errors).toEqual([{ file: 'HMI', message: 'gone' }])
  })
})

describe('createHmiPreviewPort', () => {
  it('takes the HMI sources out of the stored files: sources as text, fonts as bytes, headers by file name', async () => {
    const font = new Uint8Array([1, 2])
    const read = hmiPreviewResources(
      {
        root: 'assets/hmi/',
        files: {
          'assets/hmi/core/hmi_core.c': new TextEncoder().encode('// c'),
          'assets/hmi/core/hmi_core.h': '// h',
          'assets/hmi/preview/hmi_preview_host.cpp': '// host',
          'assets/hmi/baremetal/hmi_baremetal.c': '// panel',
          'assets/hmi/client/hmi_browser_host.cpp': '// browser',
          'assets/hmi/README.md': '# readme',
          'assets/hmi/fonts/A.ttf': font,
          'assets/hmi/fonts/B.ttf': 'not bytes',
          'elsewhere/x.c': '// other',
        },
      },
      { 'strucpp_runtime/include/iec_types.hpp': '// t' },
    )
    expect(read.hmiSources).toEqual({
      'core/hmi_core.c': '// c',
      'core/hmi_core.h': '// h',
      'preview/hmi_preview_host.cpp': '// host',
    })
    expect(read.runtimeHeaders).toEqual({ 'iec_types.hpp': '// t' })
    await expect(read.readFont('A.ttf')).resolves.toBe(font)
    await expect(read.readFont('B.ttf')).rejects.toThrow('The HMI font B.ttf is not available')
  })

  it('reads the resources once, retries after a failed read, and runs sessions in the platform Workers', async () => {
    let reads = 0
    let fail = true
    const fonts: Record<string, Uint8Array> = {}
    for (const file of ['OpenPLCSans-Regular.ttf', 'OpenPLCSans-Bold.ttf'])
      fonts[`fonts/${file}`] = new Uint8Array(readFileSync(join(FONTS, file)))
    const { compile } = capture()
    let workers = 0
    const holds: [string, boolean][] = []
    const mechanisms: HmiPreviewMechanisms = {
      readHmiSources: () => {
        reads++
        if (fail) return Promise.reject(new Error('offline'))
        return Promise.resolve({ root: '', files: { 'core/hmi_core.c': '// c', ...fonts } })
      },
      readStrucppRuntimeHeaders: () => Promise.resolve({}),
      readShippedFile: () => Promise.resolve(null),
      compileToWasm: compile,
      startWorker: () => {
        workers++
        return testWorker()
      },
      holdToolchain: (holder, held) => {
        holds.push([holder, held])
        return Promise.resolve()
      },
      loadLibraries: () => Promise.resolve(installedWidgetArchives()),
      onLibrariesChanged: () => () => undefined,
    }
    const port = createHmiPreviewPort(mechanisms)
    const failed = await port.build(sampleProject())
    expect(!failed.ok && failed.errors).toEqual([
      { file: 'HMI', message: "The preview's files could not be read: offline" },
    ])
    fail = false
    expect((await port.build(sampleProject())).ok).toBe(true)
    expect((await port.build(sampleProject())).ok).toBe(true)
    expect(reads).toBe(2)
    const session = port.openSession()
    await expect(session.frame(0, { width: 1, height: 1, scale: 1 })).rejects.toThrow('No preview module is running')
    expect(workers).toBe(0)
    session.close()
    await port.holdToolchain(true)
    await port.holdToolchain(false)
    expect(holds).toEqual([
      [HMI_TOOLCHAIN_HOLDER, true],
      [HMI_TOOLCHAIN_HOLDER, false],
    ])
  })
})

describe('the preview port and the shipped prelude', () => {
  const sources = { 'core/hmi_core.c': '// c', 'core/hmi_core.h': '// h' }

  async function portWith(readShippedFile: HmiPreviewMechanisms['readShippedFile']) {
    const fonts: Record<string, Uint8Array> = {}
    for (const file of ['OpenPLCSans-Regular.ttf', 'OpenPLCSans-Bold.ttf'])
      fonts[`fonts/${file}`] = new Uint8Array(readFileSync(join(FONTS, file)))
    const { requests, compile } = capture()
    const port = createHmiPreviewPort({
      readHmiSources: () => Promise.resolve({ root: '', files: { ...sources, ...fonts } }),
      readStrucppRuntimeHeaders: () => Promise.resolve({ 'include/iec_types.hpp': '// t' }),
      readShippedFile,
      compileToWasm: compile,
      startWorker: () => testWorker(),
      holdToolchain: () => Promise.resolve(),
      loadLibraries: () => Promise.resolve(installedWidgetArchives()),
      onLibrariesChanged: () => () => undefined,
    })
    expect((await port.build(sampleProject())).ok).toBe(true)
    return requests[0]
  }

  /** The shipped files of a prelude of the sample project's unit header, built from `inputs`. */
  async function shippedPrelude(
    inputs: Record<string, string>,
    flags: readonly string[] = HMI_PREVIEW_PRELUDE_FLAGS,
  ): Promise<Record<string, Uint8Array>> {
    const plain = await portWith(() => Promise.resolve(null))
    const header = hmiPreludeText(String(plain.files['unit/hmi_unit.hpp']))
    if (header === null) throw new Error('the sample unit header has no prelude')
    const libraries = String(plain.files['unit/hmi_unit_libraries.hpp'])
    const digests = await Promise.all(
      Object.entries(inputs).map(async ([path, text]): Promise<[string, string]> => [path, await sha256Hex(text)]),
    )
    return encodeHmiPrelude(WASM_TOOLCHAIN_IDENTITY, { header, libraries, pch: new Uint8Array([9, 9]), flags }, digests)
  }

  it('compiles the groups from the shipped prelude when it was built from the same files', async () => {
    const files = await shippedPrelude({
      'hmi/core/hmi_core.h': '// h',
      'strucpp_runtime/include/iec_types.hpp': '// t',
    })
    const request = await portWith((name) => Promise.resolve(files[name] ?? null))
    expect(request.files[HMI_PRELUDE_PCH]).toEqual(new Uint8Array([9, 9]))
    expect(request.units.find((u) => u.source === 'groups/glue.cpp')?.flags).toEqual(['-include-pch', HMI_PRELUDE_PCH])
  })

  it('compiles without it when it was built with other C++ flags than the preview units use', async () => {
    const inputs = { 'hmi/core/hmi_core.h': '// h', 'strucpp_runtime/include/iec_types.hpp': '// t' }
    const files = await shippedPrelude(inputs, [...HMI_PREVIEW_PRELUDE_FLAGS.filter((f) => f !== '-O1'), '-O2'])
    const request = await portWith((name) => Promise.resolve(files[name] ?? null))
    expect(request.files).not.toHaveProperty([HMI_PRELUDE_PCH])
    expect(request.units.filter((u) => u.flags?.includes('-include-pch'))).toEqual([])
  })

  it('compiles without it when it was built from another file, or cannot be read', async () => {
    const files = await shippedPrelude({ 'hmi/core/hmi_core.h': '// older h' })
    const stale = await portWith((name) => Promise.resolve(files[name] ?? null))
    expect(stale.files).not.toHaveProperty([HMI_PRELUDE_PCH])
    const unreadable = await portWith(() => Promise.reject(new Error('offline')))
    expect(unreadable.files).not.toHaveProperty([HMI_PRELUDE_PCH])
    expect(unreadable.units.filter((u) => u.flags?.includes('-include-pch'))).toEqual([])
  })
})
