import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { buildFromMenu, launch, quitApp } from './helpers/ethercat-project'
import { consoleOf } from './helpers/library-project'
import { type StProgramFixture, writeStProgramProject } from './helpers/st-program-project'

const PROJECT_NAME = 'st_features'

const program = (rtcSetInput: 'SET' | 'IN'): string =>
  'PROGRAM main\n' +
  '  VAR\n' +
  '    clock : RTC;\n' +
  '    now : DT;\n' +
  '    label : STRING[20];\n' +
  '    level : REAL := 1.5;\n' +
  '    scaled : REAL;\n' +
  '    code : INT := 1;\n' +
  '    state : Mode;\n' +
  '  END_VAR\n\n' +
  `clock(${rtcSetInput} := TRUE, PDT := DT#2026-01-01-00:00:00);\n` +
  'now := clock.CDT;\n' +
  "label := 'running';\n" +
  'scaled := level * 2.0 + 0.25;\n' +
  'state := TO_Mode(code);\n\n' +
  'END_PROGRAM\n'

const fixture = (rtcSetInput: 'SET' | 'IN'): StProgramFixture => ({
  name: PROJECT_NAME,
  program: program(rtcSetInput),
  enums: [{ name: 'Mode', values: ['Idle', 'Running', 'Stopped'] }],
})

const COMPILE_ONLY_DONE = 'Compile only mode — skipping upload to runtime.'
const DECLARATION_REFUSAL = /do not parse|could not be loaded|declared length is not supported/
const RTC_IN_REFUSAL = /'RTC' has no input or output 'IN'/

test('Build only compiles a program that sets an RTC with SET and declares a STRING length', async () => {
  test.setTimeout(240000)
  const { project, userData } = writeStProgramProject('openplc-e2e-st-features', fixture('SET'))
  const generated = join(project, 'build', 'OpenPLC Runtime v4', 'src')
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await buildFromMenu(page, 'Build only')

    await expect(consoleOf(page).getByText(COMPILE_ONLY_DONE).first()).toBeVisible({ timeout: 180000 })
    await expect(consoleOf(page).getByText(DECLARATION_REFUSAL)).toHaveCount(0)
  } finally {
    await quitApp(app, page)
  }

  expect(existsSync(join(generated, 'pou_MAIN.cpp'))).toBe(true)
  const body = readFileSync(join(generated, 'pou_MAIN.cpp'), 'utf-8')
  expect(body).toMatch(/\bCLOCK\.SET = true;/)
  expect(body).toMatch(/\bSCALED = LEVEL \* 2\.0f? \+ 0\.25f?;/)
  expect(body).toMatch(/\bSTATE = TO_ENUM<MODE>\(CODE\);/)
  const header = readFileSync(join(generated, 'generated.hpp'), 'utf-8')
  expect(header).toMatch(/\bIECStringVar<20> LABEL;/)
})

test('Build only refuses a program that still wires the RTC input IN', async () => {
  test.setTimeout(240000)
  const { userData } = writeStProgramProject('openplc-e2e-st-features-rtc-in', fixture('IN'))
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await buildFromMenu(page, 'Build only')

    await expect(consoleOf(page).getByText(RTC_IN_REFUSAL).first()).toBeVisible({
      timeout: 180000,
    })
    await expect(consoleOf(page).getByText(COMPILE_ONLY_DONE)).toHaveCount(0)
  } finally {
    await quitApp(app, page)
  }
})
