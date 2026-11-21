/** @jest-environment node */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { HMI_FONT_VARIANTS } from '../../../../../middleware/shared/utils/hmi/settings'
import { FakeRunner } from '../../../wasm-toolchain/__tests__/fixtures/fake-runner'
import type { CachedWasmObject } from '../../../wasm-toolchain/compile-to-wasm'
import { readShippedObjects } from '../../../wasm-toolchain/shipped-objects'
import { WASM_TOOLCHAIN_IDENTITY } from '../../../wasm-toolchain/toolchain-identity'
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
  it('ships every object of the gallery, its linked module too', async () => {
    const hmiFiles = readAll(HMI_DIR)
    const runner = new FakeRunner(4)
    const files = await buildHmiShippedObjects(runner, {
      preview: {
        ...hmiPreviewResources({ root: '', files: hmiFiles }, { 'iec_types.hpp': '#pragma once\n' }),
        projectLibraries: installedWidgetArchives(),
      },
      hmiSources: hmiFiles,
      runtimeHeaders: { 'strucpp_runtime/include/iec_types.hpp': '#pragma once\n' },
    })
    const objects = await readShippedObjects(
      { read: (name) => Promise.resolve(files[name] ?? null) },
      WASM_TOOLCHAIN_IDENTITY,
    )
    const builtFrom = (path: string) => objects.filter(({ entry }) => entry.dependencies.some(([p]) => p === path))
    expect(builtFrom('groups/glue.cpp').length).toBeGreaterThan(0)
    expect(builtFrom('groups/factory.cpp').length).toBeGreaterThan(0)
    expect(objects.filter(({ entry }) => entry.dependencies.length === 0).length).toBe(HMI_FONT_VARIANTS.length)
  })
})
