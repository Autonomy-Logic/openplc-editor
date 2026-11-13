import { describe, expect, it } from '@jest/globals'

import { buildStrucppWasmRequest, compileStrucppToWasm } from '../compile-strucpp-to-wasm'
import { FakeRunner } from './fixtures/fake-runner'

const strucppFiles = {
  'generated.hpp': '#include "iec_std_lib.hpp"',
  'generated.cpp': '#include "generated.hpp"',
  'POU_A.cpp': '#include "generated.hpp"',
  'debug-map.json': '{}',
}
const runtimeHeaders = { 'iec_std_lib.hpp': '/* runtime */', 'iec_types.hpp': '/* types */' }

describe('buildStrucppWasmRequest', () => {
  it('places STruC++ output and runtime headers and compiles every generated C++ file', () => {
    const req = buildStrucppWasmRequest({ strucppFiles, runtimeHeaders })
    expect(Object.keys(req.files).sort()).toEqual([
      'strucpp/POU_A.cpp',
      'strucpp/debug-map.json',
      'strucpp/generated.cpp',
      'strucpp/generated.hpp',
      'strucpp_runtime/include/iec_std_lib.hpp',
      'strucpp_runtime/include/iec_types.hpp',
    ])
    expect(req.units).toEqual([
      { source: 'strucpp/POU_A.cpp', language: 'c++' },
      { source: 'strucpp/generated.cpp', language: 'c++' },
    ])
    expect(req.cxxFlags).toEqual(['-std=gnu++17', '-Istrucpp_runtime/include', '-Istrucpp'])
  })

  it('adds the caller units, files and flags after the STruC++ ones', () => {
    const req = buildStrucppWasmRequest({
      strucppFiles,
      runtimeHeaders,
      extraFiles: { 'core/core.c': 'int x;', 'host/host.cpp': 'int y;' },
      extraUnits: [
        { source: 'core/core.c', language: 'c' },
        { source: 'host/host.cpp', language: 'c++' },
      ],
      cFlags: ['-std=c99'],
      cxxFlags: ['-O1', '-fno-exceptions'],
      linkFlags: ['-mexec-model=reactor'],
      output: 'preview.wasm',
    })
    expect(req.units.map((u) => u.source)).toEqual([
      'strucpp/POU_A.cpp',
      'strucpp/generated.cpp',
      'core/core.c',
      'host/host.cpp',
    ])
    expect(req.cxxFlags?.slice(-2)).toEqual(['-O1', '-fno-exceptions'])
    expect(req).toMatchObject({ cFlags: ['-std=c99'], linkFlags: ['-mexec-model=reactor'], output: 'preview.wasm' })
  })

  it('refuses an extra file that would overwrite a STruC++ file', () => {
    expect(() =>
      buildStrucppWasmRequest({ strucppFiles, runtimeHeaders, extraFiles: { 'strucpp/generated.cpp': 'x' } }),
    ).toThrow("Extra file 'strucpp/generated.cpp' collides with a STruC++ file")
  })
})

describe('compileStrucppToWasm', () => {
  it('compiles the laid-out request into a module', async () => {
    const runner = new FakeRunner()
    const result = await compileStrucppToWasm({ strucppFiles, runtimeHeaders }, { runner })
    expect(result.ok).toBe(true)
    expect(runner.jobs).toHaveLength(3)
    expect(FakeRunner.text(runner.jobs[0].tree, 'strucpp_runtime/include/iec_std_lib.hpp')).toBe('/* runtime */')
  })

  it('reports a layout error as a failed compile', async () => {
    const runner = new FakeRunner()
    const log: Array<[string, string]> = []
    const result = await compileStrucppToWasm(
      { strucppFiles, runtimeHeaders, extraFiles: { 'strucpp/generated.hpp': 'x' } },
      { runner, log: (m, l) => log.push([m, l]) },
    )
    expect(result.ok).toBe(false)
    expect(log).toEqual([["Extra file 'strucpp/generated.hpp' collides with a STruC++ file", 'error']])
    expect(runner.jobs).toHaveLength(0)
  })
})
