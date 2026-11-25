/**
 * Builds the WebAssembly fixtures of the preview runtime's Jest tests from its C source, with the toolchain the editor
 * ships: node tests/hmi-preview/build-fixture.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runClang } from '@yowasp/clang'

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'backend',
  'shared',
  'hmi',
  'preview',
  '__tests__',
  'fixtures',
)
for (const name of ['fake-preview-host', 'foreign-import']) {
  const out = await runClang(
    [
      'clang',
      '--target=wasm32-wasip1',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-mexec-model=reactor',
      `${name}.c`,
      '-o',
      `${name}.wasm`,
    ],
    { [`${name}.c`]: readFileSync(join(DIR, `${name}.c`), 'utf8') },
  )
  writeFileSync(join(DIR, `${name}.wasm`), out[`${name}.wasm`])
  console.log(`${name}.wasm: ${out[`${name}.wasm`].length} bytes`)
}
