import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { z } from 'zod'

import {
  clickTop,
  launch,
  RendererErrors,
  saveProject,
  shutdown,
  writeProfile,
  writeRuntimeDevice,
} from './helpers/electron-editor'

const fbdFlowSchema = z.object({
  name: z.string(),
  rung: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        data: z.object({ executionControl: z.boolean().optional() }).passthrough(),
      }),
    ),
  }),
})

const ROOT = mkdtempSync(join(realpathSync(tmpdir()), 'openplc-e2e-fbd-element-dialog-'))
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const PROJECT_NAME = 'fbd-dialogs'
const POUS = ['fba', 'fbb'] as const

const VARS = `  VAR
    TON0 : TON;
  END_VAR
`

const blockId = (pou: string) => `BLOCK_${pou}`

/** A TON block, built by the editor's FBD block builder, with its id made unique to `pou`. */
function fbdBody(pou: string, index: number): string {
  const block: unknown = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'element-dialog', 'fbd-ton-block.json'), 'utf-8'),
  )
  const node = z
    .object({ data: z.object({}).passthrough() })
    .passthrough()
    .parse(block)
  return JSON.stringify({
    name: pou,
    rung: {
      comment: '',
      nodes: [{ ...node, id: blockId(pou), data: { ...node.data, numericId: String(1001 + index) } }],
      edges: [],
      selectedNodes: [],
    },
  })
}

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: POUS.map((pou, i) => ({ name: `instance${i}`, program: pou, task: 'task0' })),
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeRuntimeDevice(FIXTURE)
  POUS.forEach((pou, index) => {
    writeFileSync(
      join(FIXTURE, 'pous', 'programs', `${pou}.fbd`),
      `PROGRAM ${pou}\n${VARS}\n${fbdBody(pou, index)}\nEND_PROGRAM\n`,
    )
  })
  writeProfile(USER_DATA, PROJECT_NAME, FIXTURE)
}

/** The execution control saved on the only block of `pou`, or undefined while a save is still writing the file. */
function savedExecutionControl(pou: string): boolean | undefined {
  try {
    const text = readFileSync(join(FIXTURE, 'pous', 'programs', `${pou}.fbd`), 'utf-8')
    const json = text.slice(text.indexOf('END_VAR') + 'END_VAR'.length, text.lastIndexOf('END_PROGRAM'))
    return fbdFlowSchema.parse(JSON.parse(json)).rung.nodes.find((node) => node.type === 'block')?.data.executionControl
  } catch {
    return undefined
  }
}

/** The execution control saved on the block of `pou`, once no save is writing the file. */
async function settledExecutionControl(pou: string): Promise<boolean> {
  let value: boolean | undefined
  await expect.poll(() => (value = savedExecutionControl(pou))).not.toBeUndefined()
  if (value === undefined) throw new Error(`no block saved in ${pou}`)
  return value
}

let app: ElectronApplication
let page: Page
let errors: RendererErrors

test.describe.configure({ mode: 'default', timeout: 120000 })

test.beforeAll(async () => {
  test.setTimeout(180000)
  writeFixture()
  ;({ app, page } = await launch(USER_DATA))
  errors = new RendererErrors(page)
  await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 60000 })
  for (const pou of POUS) {
    await errors.waitFor(page.getByText(pou, { exact: true }).first())
    await page.getByText(pou, { exact: true }).first().click()
    await errors.waitFor(page.getByTestId(`rf__node-${blockId(pou)}`))
  }
})

test.afterEach(() => {
  expect(errors.messages, 'the renderer threw').toEqual([])
})

test.afterAll(async () => {
  if (app) await shutdown(app)
})

for (const pou of POUS) {
  test(`with two FBD tabs open, the block dialog of ${pou} renders once and switches execution control on`, async () => {
    const other = POUS.find((name) => name !== pou) ?? pou
    const otherBefore = await settledExecutionControl(other)

    await page.getByText(pou, { exact: true }).first().click()
    const block = page.getByTestId(`rf__node-${blockId(pou)}`)
    await expect(block).toHaveCount(1)
    await block.dblclick()

    const title = page.getByText('Block Properties', { exact: true })
    await errors.race(expect(title.first()).toBeVisible())
    await expect(title, 'one Block Properties dialog renders').toHaveCount(1)
    await clickTop(page, page.locator('[id="executionControlSwitch"]'))
    await clickTop(page, page.getByRole('button', { name: 'Ok', exact: true }))
    await expect(title, 'Ok applies the change and closes the dialog').toHaveCount(0)

    await expect
      .poll(
        async () => {
          await saveProject(app)
          return savedExecutionControl(pou)
        },
        { timeout: 30000, intervals: [1000] },
      )
      .toBe(true)
    await expect.poll(() => savedExecutionControl(other), `the block of ${other} is unchanged`).toBe(otherBefore)
  })
}
