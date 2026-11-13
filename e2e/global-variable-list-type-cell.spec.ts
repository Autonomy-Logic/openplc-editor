import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { z } from 'zod'

import {
  launch,
  RendererErrors,
  saveProject,
  shutdown,
  writeProfile,
  writeRuntimeDevice,
} from './helpers/electron-editor'

const ROOT = mkdtempSync(join(realpathSync(tmpdir()), 'openplc-e2e-gvl-type-cell-'))
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const PROJECT_NAME = 'gvl-type-cell'
const LIST = 'Plant'
const PROGRAM = 'main'

const typeSchema = z.object({ definition: z.string(), value: z.string() }).passthrough()
const variableSchema = z.object({ name: z.string(), type: typeSchema }).passthrough()
const projectSchema = z.object({
  data: z.object({
    globalVariableLists: z.array(z.object({ name: z.string(), variables: z.array(variableSchema) })),
    configuration: z.object({ resource: z.object({ globalVariables: z.array(variableSchema) }) }).optional(),
    configurations: z.object({ resource: z.object({ globalVariables: z.array(variableSchema) }) }).optional(),
  }),
})

type VariableType = z.infer<typeof typeSchema>

const INT: VariableType = { definition: 'base-type', value: 'INT' }

const arrayOf = (dimension: string, baseType: string): VariableType => ({
  definition: 'array',
  value: `ARRAY [${dimension}] OF ${baseType}`,
  data: { baseType: { definition: 'base-type', value: baseType }, dimensions: [{ dimension }] },
})

const variable = (name: string, type: VariableType, variableClass?: 'global') => ({
  name,
  ...(variableClass === undefined ? {} : { class: variableClass }),
  type,
  location: '',
  documentation: '',
  initialValue: null,
})

const PROGRAM_SOURCE = `PROGRAM ${PROGRAM}
  VAR_EXTERNAL
    Speed : INT;
    Level : INT;
  END_VAR

END_PROGRAM
`

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
        globalVariableLists: [
          {
            name: LIST,
            variables: [
              variable('M0', INT, 'global'),
              variable('M1', arrayOf('1..5', 'REAL'), 'global'),
              variable('Speed', INT, 'global'),
            ],
          },
        ],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: PROGRAM, task: 'task0' }],
            globalVariables: [variable('R0', INT), variable('Speed', INT), variable('Level', INT), variable('R3', INT)],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(join(FIXTURE, 'pous', 'programs', `${PROGRAM}.st`), PROGRAM_SOURCE)
  writeRuntimeDevice(FIXTURE)
  writeProfile(USER_DATA, PROJECT_NAME, FIXTURE)
}

/** The saved project, or undefined while a save is still writing it. */
function savedProject(): z.infer<typeof projectSchema> | undefined {
  try {
    return projectSchema.parse(JSON.parse(readFileSync(join(FIXTURE, 'project.json'), 'utf-8')))
  } catch {
    return undefined
  }
}

const savedMemberType = (name: string) =>
  savedProject()
    ?.data.globalVariableLists.find((list) => list.name === LIST)
    ?.variables.find((member) => member.name === name)?.type.value

const savedResourceGlobalType = (name: string) => {
  const data = savedProject()?.data
  return (data?.configuration ?? data?.configurations)?.resource.globalVariables.find((global) => global.name === name)
    ?.type.value
}

/** The type declared for `name` in the program's VAR_EXTERNAL block on disk, or undefined while a save is writing it. */
function savedExternalType(name: string): string | undefined {
  try {
    const text = readFileSync(join(FIXTURE, 'pous', 'programs', `${PROGRAM}.st`), 'utf-8')
    const block = /VAR_EXTERNAL([\s\S]*?)END_VAR/.exec(text)?.[1] ?? ''
    return new RegExp(`\\b${name}\\s*:\\s*([^;]+);`).exec(block)?.[1].trim()
  } catch {
    return undefined
  }
}

let app: ElectronApplication
let page: Page
let errors: RendererErrors

/** Opens `label` from the project explorer and waits for its table. */
async function openTable(label: string): Promise<void> {
  await page.getByText(label, { exact: true }).first().click()
  await errors.waitFor(page.locator('table:visible').first())
}

/** The visible table row whose name cell holds `name`. */
const rowOf = (name: string): Locator =>
  page
    .locator('table:visible tbody tr')
    .filter({ has: page.locator('td:nth-child(2)', { hasText: new RegExp(`^${name}$`) }) })

/** The type cell of the row named `name`; columns 1..4 are #, Name, Class and Type. */
const typeCellOf = (name: string) => rowOf(name).locator('td:nth-child(4)')

/** Selects the row named `name`, which makes its cells editable, and opens its type menu. */
async function openTypeMenu(name: string): Promise<void> {
  await rowOf(name).locator('td:nth-child(1)').click()
  await typeCellOf(name).locator('[aria-haspopup="menu"]').click()
}

async function pickBaseType(name: string, baseType: string): Promise<void> {
  await openTypeMenu(name)
  await page.getByRole('menuitem', { name: 'Base Type' }).click()
  const item = page.getByRole('menuitem', { name: baseType, exact: true })
  await expect(item, 'the Base Type submenu is open').toBeVisible()
  await item.click()
}

const arrayDialog = () => page.getByRole('dialog').filter({ hasText: 'Array type definition' })

async function openArrayDialog(name: string): Promise<void> {
  await openTypeMenu(name)
  await page.getByRole('menuitem', { name: 'Array', exact: true }).click()
  await errors.race(expect(arrayDialog()).toBeVisible())
}

const dimensionInputs = () => arrayDialog().getByLabel('Array dimension input').locator('input')

/** Adds `dimension` with the dialog's default base type DINT and presses Save. */
async function saveArray(dimension: string): Promise<void> {
  await arrayDialog().getByLabel('Add table row button').click()
  const input = dimensionInputs().last()
  await input.fill(dimension)
  await input.press('Tab')
  await arrayDialog().getByRole('button', { name: 'Save', exact: true }).click()
  await expect(arrayDialog(), 'Save closes the array dialog').toHaveCount(0)
}

/** Saves the project until `read` sees `expected` on disk. */
const expectSaved = (read: () => unknown, expected: unknown) =>
  expect
    .poll(
      async () => {
        await saveProject(app)
        return read()
      },
      { timeout: 30000, intervals: [1000] },
    )
    .toBe(expected)

const typeChangeDialog = () => page.getByText('Type Change: Impact Analysis', { exact: true })

test.describe.configure({ mode: 'default', timeout: 120000 })

test.beforeAll(async () => {
  test.setTimeout(180000)
  writeFixture()
  ;({ app, page } = await launch(USER_DATA))
  errors = new RendererErrors(page)
  await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 60000 })
  await errors.waitFor(page.getByText(LIST, { exact: true }).first())
})

test.afterEach(() => {
  expect(errors.messages, 'the renderer threw').toEqual([])
})

test.afterAll(async () => {
  if (app) await shutdown(app)
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 10 })
})

test('an array set from the GVL table is saved on the GVL member and not on the Resource global of the same row', async () => {
  await openTable(LIST)
  await openArrayDialog('M0')
  await saveArray('0..9')

  await expect(typeCellOf('M0')).toHaveText('ARRAY [0..9] OF DINT')
  await expectSaved(() => savedMemberType('M0'), 'ARRAY [0..9] OF DINT')
  await expect.poll(() => savedResourceGlobalType('R0'), 'the Resource global at row 0 is unchanged').toBe('INT')
})

test('the array dialog opened on a GVL array member shows its own dimensions and base type', async () => {
  await openTable(LIST)
  await openArrayDialog('M1')

  await expect(dimensionInputs()).toHaveCount(1)
  await expect(dimensionInputs().first()).toHaveValue('1..5')
  await expect(arrayDialog().locator('[aria-haspopup="menu"]').first()).toHaveText(/REAL/)
  await arrayDialog().getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(arrayDialog()).toHaveCount(0)
})

test('a GVL member type change from the dropdown leaves the POU VAR_EXTERNAL of the same name unchanged', async () => {
  await openTable(LIST)
  await pickBaseType('Speed', 'REAL')

  await expect(typeCellOf('Speed')).toHaveText('REAL')
  await expect(typeChangeDialog(), 'no type-change impact dialog').toHaveCount(0)
  await expectSaved(() => savedMemberType('Speed'), 'REAL')
  await expect.poll(() => savedExternalType('Speed'), 'the VAR_EXTERNAL is unchanged').toBe('INT')
  await expect.poll(() => savedResourceGlobalType('Speed'), 'the Resource global is unchanged').toBe('INT')
})

test('an array set from the Resource table is saved on that Resource global', async () => {
  await openTable('Resource')
  await openArrayDialog('R3')
  await saveArray('0..3')

  await expect(typeCellOf('R3')).toHaveText('ARRAY [0..3] OF DINT')
  await expectSaved(() => savedResourceGlobalType('R3'), 'ARRAY [0..3] OF DINT')
})

test('a Resource global type change still updates the POU VAR_EXTERNAL of the same name', async () => {
  await openTable('Resource')
  await pickBaseType('Level', 'REAL')
  await errors.race(expect(typeChangeDialog()).toBeVisible())
  await page.getByRole('button', { name: 'Proceed with Type Change', exact: true }).click()

  await expect(typeCellOf('Level')).toHaveText('REAL')
  await expectSaved(() => savedExternalType('Level'), 'REAL')
  await expect.poll(() => savedResourceGlobalType('Level')).toBe('REAL')
})
