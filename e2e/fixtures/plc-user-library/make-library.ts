/**
 * Writes a user PLC library for the e2e suite: user-delay, one function block that uses the bundled TON, compiled like
 * any library against iec-standard-fb.
 * Usage: ts-node -T -r tsconfig-paths/register e2e/fixtures/plc-user-library/make-library.ts <out.stlib>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadStrucpp } from '../../../src/backend/shared/library/strucpp-runtime'

const [out] = process.argv.slice(2)
if (!out) throw new Error('usage: make-library.ts <out.stlib>')
const strucpp = loadStrucpp()
const standard = strucpp.loadStlibFromString(
  readFileSync(join(process.cwd(), 'node_modules', 'strucpp', 'libs', 'iec-standard-fb.stlib'), 'utf8'),
  'iec-standard-fb',
)
const compiled = strucpp.compileStlib(
  [
    {
      fileName: 'delay.st',
      source: `FUNCTION_BLOCK UserDelay
  VAR_INPUT IN : BOOL; END_VAR
  VAR_OUTPUT Q : BOOL; COUNT : DINT; END_VAR
  VAR t : TON; END_VAR
  t(IN := IN, PT := T#100ms);
  Q := t.Q;
  IF t.Q THEN COUNT := COUNT + 1; END_IF;
END_FUNCTION_BLOCK
`,
    },
  ],
  { name: 'user-delay', version: '1.0.0', namespace: 'user_delay', dependencies: [standard] },
)
if (compiled.errors.length > 0) throw new Error(compiled.errors.map((e) => e.message).join('\n'))
writeFileSync(out, JSON.stringify(compiled.archive))
