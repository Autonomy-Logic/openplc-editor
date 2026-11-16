import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { buildFromMenu, launch, quitApp } from './helpers/ethercat-project'
import {
  buildLibrary,
  builtLibraryPath,
  consoleOf,
  type LibraryFixture,
  readLibraryArchive,
  writeConsumerProject,
  writeLibraryProject,
} from './helpers/library-project'

const MOTOR_LIB: LibraryFixture = {
  name: 'motor_lib',
  globals: [
    { name: 'MotorCmd', type: 'bool' },
    { name: 'KMax', type: 'int', initialValue: '10', flag: 'constant' },
  ],
  lists: [{ name: 'Motors', variables: [{ name: 'Cmd', type: 'bool' }] }],
  functionBlocks: {
    DOL_Starter:
      'FUNCTION_BLOCK DOL_Starter\n  VAR_EXTERNAL\n    MotorCmd : BOOL;\n  END_VAR\n  VAR_OUTPUT\n    Run : BOOL;\n  END_VAR\n\n' +
      'Run := MotorCmd OR Motors.Cmd;\n\nEND_FUNCTION_BLOCK\n',
  },
}

const HIDDEN_CODE =
  '1;\nEND_VAR\nFUNCTION_BLOCK EVIL\n  VAR x : INT; END_VAR\n  x := 1;\nEND_FUNCTION_BLOCK\nVAR_GLOBAL\n  Pad : INT'

const GAIN_LIB: LibraryFixture = {
  name: 'gain_lib',
  globals: [{ name: 'Gain', type: 'int', initialValue: HIDDEN_CODE }],
  lists: [],
  functionBlocks: {
    SCALE: 'FUNCTION_BLOCK SCALE\n  VAR\n    x : INT;\n  END_VAR\n\nx := 1;\n\nEND_FUNCTION_BLOCK\n',
  },
}

const CONSUMER_PROGRAM =
  'PROGRAM main\n  VAR\n    b : BOOL;\n    k : INT;\n    starter : DOL_Starter;\n  END_VAR\n\n' +
  'b := MotorCmd OR Motors.Cmd;\nk := KMax;\nstarter();\n\nEND_PROGRAM\n'

const refusal = (kind: string, name: string): string =>
  `Library build refused: the built library would export the ${kind} "${name}", which the library project does not declare.`

async function buildMotorLibrary(rootName: string): Promise<string> {
  const { project, userData } = writeLibraryProject(rootName, MOTOR_LIB)
  const { app, page } = await launch(userData)
  try {
    await page.getByText(MOTOR_LIB.name, { exact: true }).first().click({ timeout: 30000 })
    await buildLibrary(page)
    await expect(
      consoleOf(page).getByText(`Library built successfully: build/${MOTOR_LIB.name}.stlib`).first(),
    ).toBeVisible({ timeout: 60000 })
    await expect(consoleOf(page).getByText(/Library build refused/)).toHaveCount(0)
  } finally {
    await quitApp(app, page)
  }
  return builtLibraryPath(project, MOTOR_LIB.name)
}

test('Build Library ships the resource globals and the GVL of a library whose block reads a global', async () => {
  test.setTimeout(180000)
  const stlib = await buildMotorLibrary('openplc-e2e-library-globals')

  const archive = readLibraryArchive(stlib)
  expect(archive.manifest.functionBlocks.map((entry) => entry.name)).toEqual(['DOL_STARTER'])
  expect(archive.manifest.functions).toEqual([])
  expect(archive.manifest.globals.map((entry) => entry.name).sort()).toEqual(['KMAX', 'MOTORCMD', 'MOTORS'])
  expect(archive.manifest.globals.find((entry) => entry.name === 'KMAX')?.constant).toBe(true)
  expect(archive.manifest.globals.find((entry) => entry.name === 'MOTORCMD')?.constant).toBeUndefined()

  const globalsSource = archive.sources.find((source) => source.fileName === '_globals.st')?.source ?? ''
  const headers = globalsSource
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('VAR_GLOBAL'))
  expect(headers).toContain('VAR_GLOBAL')
  expect(headers).toContain('VAR_GLOBAL CONSTANT')

  const shipped = archive.sources.map((source) => source.source).join('\n')
  expect(shipped).not.toMatch(/\bCONFIGURATION\b/)
  expect(shipped).not.toMatch(/\bRESOURCE\b/)
})

test('a consumer project reads the globals of a library built by the editor', async () => {
  test.setTimeout(300000)
  const stlib = await buildMotorLibrary('openplc-e2e-library-globals-source')

  const { project, userData } = writeConsumerProject('openplc-e2e-library-globals-consumer', {
    name: 'motor_consumer',
    program: CONSUMER_PROGRAM,
    library: { name: MOTOR_LIB.name, archive: readFileSync(stlib, 'utf-8') },
  })
  const { app, page } = await launch(userData)
  try {
    await page.getByText('motor_consumer', { exact: true }).first().click({ timeout: 30000 })
    await buildFromMenu(page, 'Build only')

    await expect(consoleOf(page).getByText('Compile only mode — skipping upload to runtime.').first()).toBeVisible({
      timeout: 180000,
    })
    await expect(consoleOf(page).getByText(/Undeclared variable/)).toHaveCount(0)
  } finally {
    await quitApp(app, page)
  }

  const generated = join(project, 'build', 'OpenPLC Runtime v4', 'src')
  const header = readFileSync(join(generated, 'generated.hpp'), 'utf-8')
  expect(header).toMatch(/\binline IEC_BOOL MOTORCMD\b/)
  expect(header).toMatch(/\bMOTORS_TYPE MOTORS\b/)
  expect(header).toMatch(/\bconst inline IEC_INT KMAX\b/)
  const program = readFileSync(join(generated, 'pou_MAIN.cpp'), 'utf-8')
  expect(program).toMatch(/\bB = \(MOTORCMD\) \| \(MOTORS\.CMD\);/)
  expect(program).toMatch(/\bK = KMAX;/)
})

test('Build Library refuses a library that would export code hidden in a global initial value', async () => {
  test.setTimeout(180000)
  const { project, userData } = writeLibraryProject('openplc-e2e-library-refusal', GAIN_LIB)
  const { app, page } = await launch(userData)
  try {
    await page.getByText(GAIN_LIB.name, { exact: true }).first().click({ timeout: 30000 })
    await buildLibrary(page)

    await expect(consoleOf(page).getByText(refusal('function block', 'EVIL')).first()).toBeVisible({
      timeout: 60000,
    })
    await expect(consoleOf(page).getByText(refusal('global', 'PAD')).first()).toBeVisible()
    await expect(consoleOf(page).getByText(/Library built successfully/)).toHaveCount(0)
    expect(existsSync(builtLibraryPath(project, GAIN_LIB.name))).toBe(false)
  } finally {
    await quitApp(app, page)
  }
})
