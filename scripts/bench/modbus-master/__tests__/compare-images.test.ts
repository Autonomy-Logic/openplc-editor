import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

import { normalizeSymbolName } from '../compare-images'

/** Repository root, four levels above this test's folder. */
const REPO_ROOT = path.resolve(__dirname, '../../../..')

describe('normalizeSymbolName', () => {
  test('maps two GCC constprop clones of one function to one name', () => {
    assert.equal(normalizeSymbolName('x.constprop.5'), normalizeSymbolName('x.constprop.6'))
  })

  test('removes a constprop suffix', () => {
    assert.equal(normalizeSymbolName('x.constprop.5'), 'x')
  })

  test('removes chained clone suffixes', () => {
    assert.equal(normalizeSymbolName('x.isra.0.constprop.3'), 'x')
  })

  for (const suffix of ['.part.1', '.isra.0', '.lto_priv.2', '.cold']) {
    test(`removes the ${suffix} suffix`, () => {
      assert.equal(normalizeSymbolName(`x${suffix}`), 'x')
    })
  }

  test('maps LTO renumberings of one static constructor to one name', () => {
    assert.equal(
      normalizeSymbolName('_GLOBAL__I_65535_0_modbus_crc.cpp.o.1942'),
      normalizeSymbolName('_GLOBAL__I_65535_0_modbus_crc.cpp.o.1915'),
    )
  })

  test('removes the numeric tail of a _GLOBAL__ name ending in .o.<n>', () => {
    assert.equal(normalizeSymbolName('_GLOBAL__I_65535_0_modbus_crc.cpp.o.1942'), '_GLOBAL__I_65535_0_modbus_crc.cpp.o')
  })

  for (const name of ['mb_rs485_pin', 'x.cpp']) {
    test(`leaves ${name} untouched`, () => {
      assert.equal(normalizeSymbolName(name), name)
    })
  }
})

describe('compare-images.ts as a module', () => {
  test('runs nothing when imported', () => {
    const run = spawnSync(
      process.execPath,
      ['--require', 'ts-node/register', '-e', "require('./scripts/bench/modbus-master/compare-images.ts')"],
      { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } },
    )
    assert.deepEqual(
      { status: run.status, stderr: run.stderr, stdout: run.stdout },
      { status: 0, stderr: '', stdout: '' },
    )
  })

  test('is run by npm run test:bench', () => {
    const manifest: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    const scripts =
      typeof manifest === 'object' && manifest !== null && 'scripts' in manifest ? manifest.scripts : undefined
    const testBench =
      typeof scripts === 'object' && scripts !== null && 'test:bench' in scripts ? String(scripts['test:bench']) : ''
    assert.match(testBench, /scripts\/bench\/modbus-master\/__tests__\/\*\.test\.ts/)
  })
})
