/** @jest-environment node */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { HmiPreviewMechanisms } from '../../../../../middleware/shared/ports/hmi-preview-mechanisms'
import type { WasmCompileRequest, WasmCompileResult } from '../../../../../middleware/shared/ports/wasm-toolchain-types'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import { WIDGET_PREVIEW_SCREEN } from '../../unit/generate-hmi-unit'
import {
  buildHmiPreview,
  buildHmiPreviewRequest,
  HMI_PREVIEW_CXX_FLAGS,
  HMI_PREVIEW_LINK_FLAGS,
  type HmiPreviewResources,
} from '../build-hmi-preview'
import { createHmiPreviewPort, hmiPreviewResources } from '../hmi-preview-port'
import { testWorker } from './fixtures/support'

/* The bundled fonts: resources/sources/hmi/fonts in the editor, src/assets/firmware/hmi/fonts on the web. */
const FONTS =
  ['resources/sources/hmi/fonts', 'src/assets/firmware/hmi/fonts']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-bundled-fonts'
const readFont = (file: string) => Promise.resolve(new Uint8Array(readFileSync(join(FONTS, file))))
const stats = { units: 1, cached: 0, compileMs: 1, linkMs: 1 }

const resources: HmiPreviewResources = {
  runtimeHeaders: { 'iec_types.hpp': '// types' },
  hmiSources: { 'core/hmi_core.c': '// core', 'preview/hmi_preview_host.cpp': '// host' },
  readFont,
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
    'configuration.cpp': '// config',
  }
  const groups = {
    library: ['lib_standard_widgets.cpp'],
    widgets: [],
    screens: { Main: ['pou_MAIN.cpp', 'hmi_preview_0.cpp'] },
    glue: ['configuration.cpp'],
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
    expect(request.units.map((u) => [u.source, u.language, u.pch])).toEqual([
      ['hmi/core/hmi_core.c', 'c', undefined],
      ['hmi/core/hmi_theme.c', 'c', undefined],
      ['hmi/core/hmi_math.c', 'c', undefined],
      ['hmi/core/hmi_raster.c', 'c', undefined],
      ['hmi/core/hmi_text.c', 'c', undefined],
      ['unit/hmi_preview_fonts.c', 'c', undefined],
      ['groups/library.cpp', 'c++', 'unit/hmi_preview_pch.hpp'],
      ['groups/screen_Main.cpp', 'c++', 'unit/hmi_preview_pch.hpp'],
      ['groups/glue.cpp', 'c++', 'unit/hmi_preview_pch.hpp'],
      ['hmi/preview/hmi_preview_host.cpp', 'c++', 'unit/hmi_preview_pch.hpp'],
    ])
  })

  it("precompiles the core header and the runtime headers the unit's headers include, once", () => {
    expect(request.precompiledHeaders).toEqual([{ header: 'unit/hmi_preview_pch.hpp', language: 'c++' }])
    const pch = String(request.files['unit/hmi_preview_pch.hpp'])
    expect(pch.split('\n').filter((l) => l.startsWith('#include'))).toEqual([
      '#include "hmi_core.h"',
      '#include "iec_types.hpp"',
      '#include "iec_var.hpp"',
      '#include <array>',
    ])
    expect(request.cxxFlags).toBe(HMI_PREVIEW_CXX_FLAGS)
    expect(request.linkFlags).toBe(HMI_PREVIEW_LINK_FLAGS)
    expect(HMI_PREVIEW_LINK_FLAGS).toContain('-mexec-model=reactor')
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
          'assets/hmi/README.md': '# readme',
          'assets/hmi/fonts/A.ttf': font,
          'assets/hmi/fonts/B.ttf': 'not bytes',
          'elsewhere/x.c': '// other',
        },
      },
      { 'strucpp_runtime/include/iec_types.hpp': '// t' },
    )
    expect(read.hmiSources).toEqual({ 'core/hmi_core.c': '// c', 'core/hmi_core.h': '// h' })
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
    const mechanisms: HmiPreviewMechanisms = {
      readHmiSources: () => {
        reads++
        if (fail) return Promise.reject(new Error('offline'))
        return Promise.resolve({ root: '', files: { 'core/hmi_core.c': '// c', ...fonts } })
      },
      readStrucppRuntimeHeaders: () => Promise.resolve({}),
      compileToWasm: compile,
      startWorker: () => {
        workers++
        return testWorker()
      },
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
  })
})
