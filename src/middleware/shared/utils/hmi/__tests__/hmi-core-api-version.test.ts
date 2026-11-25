import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HMI_CORE_API_VERSION } from '../widget-libraries'

/** The HMI core header: `resources/sources` in the editor, `src/assets/firmware` in the web. */
function hmiCoreHeader(): string {
  const candidates = ['resources/sources/hmi/core/hmi_core.h', 'src/assets/firmware/hmi/core/hmi_core.h'].map((p) =>
    join(process.cwd(), p),
  )
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error(`hmi_core.h not found in ${candidates.join(' or ')}`)
  return readFileSync(found, 'utf8')
}

describe('HMI_CORE_API_VERSION', () => {
  it('equals the HMI_CORE_API_VERSION macro of the HMI core header', () => {
    const defines = [...hmiCoreHeader().matchAll(/^#define\s+HMI_CORE_API_VERSION\s+(\d+)u?\s*$/gm)]
    expect(defines).toHaveLength(1)
    expect(Number(defines[0][1])).toBe(HMI_CORE_API_VERSION)
  })
})
