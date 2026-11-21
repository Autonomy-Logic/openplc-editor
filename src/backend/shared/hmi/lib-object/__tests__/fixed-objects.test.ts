/** @jest-environment node */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { HMI_FONT_VARIANTS } from '../../../../../middleware/shared/utils/hmi/settings'
import { FakeRunner } from '../../../wasm-toolchain/__tests__/fixtures/fake-runner'
import type { CachedWasmObject } from '../../../wasm-toolchain/compile-to-wasm'
import { readShippedObjects } from '../../../wasm-toolchain/shipped-objects'
import { WASM_TOOLCHAIN_IDENTITY } from '../../../wasm-toolchain/toolchain-identity'
import { HMI_PREVIEW_CXX_FLAGS, hmiPreviewFixedFiles } from '../../preview/build-hmi-preview'
import {
  HMI_PRELUDE_FILE,
  HMI_PRELUDE_INDEX,
  HMI_PRELUDE_PCH,
  HMI_PRELUDE_SOURCE,
  loadHmiPrelude,
} from '../../preview/hmi-prelude'
import { hmiPreviewResources } from '../../preview/hmi-preview-port'
import { installedWidgetArchives } from '../../unit/__tests__/fixtures/widget-libraries'
import { buildHmiShippedObjects, fixedHmiObjects, isFixedHmiPath } from '../fixed-objects'

const object = (paths: string[]): CachedWasmObject => ({
  object: new Uint8Array([1]),
  digest: paths.join('|'),
  dependencies: paths.map((path) => [path, 'd']),
  includeNames: [],
  shadowDigest: '',
})

describe('fixed HMI objects', () => {
  it('counts the runtime headers, the HMI sources, the library units and the font tables as fixed', () => {
    for (const path of [
      'strucpp_runtime/include/iec_types.hpp',
      'hmi/core/hmi_core.c',
      'hmilib/standard-widgets/library.cpp',
      'unit/hmi_preview_fonts.c',
      'unit/hmi_fonts.c',
    ])
      expect(isFixedHmiPath(path)).toBe(true)
    for (const path of [
      'unit/hmi_unit.hpp',
      'unit/hmi_preview_pch.hpp',
      'groups/glue.cpp',
      'unit/pou_MAIN.cpp',
      'hmilibx/a.cpp',
    ])
      expect(isFixedHmiPath(path)).toBe(false)
  })

  it("keeps only objects built from fixed files: never a project's unit, never a linked module", () => {
    const core = { key: 'core', entry: object(['hmi/core/hmi_core.c', 'hmi/core/hmi_core.h']) }
    const screen = { key: 'screen', entry: object(['groups/screen_A.cpp', 'unit/hmi_unit.hpp', 'hmi/core/hmi_core.h']) }
    const module = { key: 'module', entry: object([]) }
    expect(fixedHmiObjects([core, screen, module])).toEqual([core])
  })
})

/* The bundled HMI sources: resources/sources/hmi in the editor, src/assets/firmware/hmi on the web. */
const HMI_DIR =
  ['resources/sources/hmi', 'src/assets/firmware/hmi']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-sources'

function readAll(dir: string, prefix = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, readAll(path, `${prefix}${entry.name}/`))
    else out[`${prefix}${entry.name}`] = new Uint8Array(readFileSync(path))
  }
  return out
}

describe('buildHmiShippedObjects', () => {
  const hmiFiles = readAll(HMI_DIR)
  const runtimeHeaders = { 'iec_types.hpp': '#pragma once\n', 'iec_var.hpp': '#pragma once\n' }
  const preview = {
    ...hmiPreviewResources({ root: '', files: hmiFiles }, runtimeHeaders),
    projectLibraries: installedWidgetArchives(),
  }
  /* The prelude reads the runtime headers and the HMI core header, as clang would list them. */
  const runner = new FakeRunner(4, () => ({ exitCode: 0 }), null, {
    [HMI_PRELUDE_SOURCE]: [
      'strucpp_runtime/include/iec_types.hpp',
      'hmi/core/hmi_core.h',
      'unit/hmi_unit_libraries.hpp',
    ],
    'groups/glue.cpp': [HMI_PRELUDE_PCH],
  })
  const shipped = buildHmiShippedObjects(runner, {
    preview,
    hmiSources: hmiFiles,
    runtimeHeaders: { 'strucpp_runtime/include/iec_types.hpp': '#pragma once\n' },
  })
  const source = (files: Record<string, Uint8Array>) => ({
    read: (name: string) => Promise.resolve(files[name] ?? null),
  })

  it('compiles the prelude from the gallery unit header with the preview C++ flags', async () => {
    await shipped
    const prelude = runner.jobs.filter((job) => job.argv.includes(HMI_PRELUDE_SOURCE))
    expect(prelude).toHaveLength(1)
    expect(prelude[0].argv).toEqual(expect.arrayContaining([...HMI_PREVIEW_CXX_FLAGS, '-x', 'c++-header']))
  })

  it('ships the prelude, which the preview loads from the same files', async () => {
    const files = await shipped
    const loaded = await loadHmiPrelude(
      files[HMI_PRELUDE_INDEX],
      files[HMI_PRELUDE_FILE],
      WASM_TOOLCHAIN_IDENTITY,
      hmiPreviewFixedFiles(preview),
    )
    expect(loaded?.header).toMatch(/#include "hmi_unit_libraries\.hpp"\n$/)
    expect(
      await loadHmiPrelude(files[HMI_PRELUDE_INDEX], files[HMI_PRELUDE_FILE], WASM_TOOLCHAIN_IDENTITY, {
        ...hmiPreviewFixedFiles(preview),
        'hmi/core/hmi_core.h': '// changed',
      }),
    ).toBeNull()
  })

  it("starts the gallery's groups from the prelude and ships every object of the gallery, its module too", async () => {
    const files = await shipped
    const compiled = (unit: string) => runner.jobs.filter((job) => job.argv.includes(unit))
    expect(compiled('groups/glue.cpp').every((job) => job.argv.includes('-include-pch'))).toBe(true)
    expect(compiled('groups/factory.cpp').some((job) => job.argv.includes('-include-pch'))).toBe(false)
    const objects = await readShippedObjects(source(files), WASM_TOOLCHAIN_IDENTITY)
    const builtFrom = (path: string) => objects.filter(({ entry }) => entry.dependencies.some(([p]) => p === path))
    expect(builtFrom('groups/glue.cpp').length).toBeGreaterThan(0)
    expect(builtFrom('groups/factory.cpp').length).toBeGreaterThan(0)
    expect(builtFrom(HMI_PRELUDE_PCH).length).toBeGreaterThan(0)
    expect(objects.filter(({ entry }) => entry.dependencies.length === 0).length).toBe(HMI_FONT_VARIANTS.length)
  })
})
