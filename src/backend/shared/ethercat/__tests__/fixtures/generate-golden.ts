/**
 * Helper to regenerate the golden JSON fixtures.  Run with:
 *   npx ts-node --transpile-only src/backend/shared/ethercat/__tests__/fixtures/generate-golden.ts
 * when the generator's expected output changes (be sure a reviewer walks the diff).
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { generateEtherdogConfigs } from '../../generate-ethercat-config'
import { deltaMultiModeProject } from './delta-multimode-project'
import { ur20ModularProject } from './ur20-modular-project'

const dir = __dirname

const write = (name: string, project: Parameters<typeof generateEtherdogConfigs>[0]) => {
  const result = generateEtherdogConfigs(project)
  if (result === null) {
    console.error(`generator returned null for ${name}`)
    process.exit(1)
  }
  writeFileSync(join(dir, `${name}.busconfig.golden.json`), result.busconfig + '\n')
  writeFileSync(join(dir, `${name}.iomapping.golden.json`), result.iomapping + '\n')
  console.log(`regenerated ${name}.*.golden.json`)
}

write('delta-multimode', deltaMultiModeProject)
write('ur20-modular', ur20ModularProject)
