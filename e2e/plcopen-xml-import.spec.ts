import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { launch, quitApp } from './helpers/ethercat-project'
import { writeStProgramProject } from './helpers/st-program-project'

const PROJECT_NAME = 'plcopen-import-target'

/** A PLCopen TC6 0201 project with one ST program, one enumerated type and one cyclic task. */
const PLCOPEN_XML = `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <fileHeader companyName="Example" productName="Example" productVersion="1" creationDateTime="2026-01-01T00:00:00"/>
  <contentHeader name="imported">
    <coordinateInfo>
      <fbd><scaling x="1" y="1"/></fbd>
      <ld><scaling x="1" y="1"/></ld>
      <sfc><scaling x="1" y="1"/></sfc>
    </coordinateInfo>
  </contentHeader>
  <types>
    <dataTypes>
      <dataType name="PumpMode">
        <baseType>
          <enum>
            <values>
              <value name="Off"/>
              <value name="Auto"/>
            </values>
          </enum>
        </baseType>
      </dataType>
    </dataTypes>
    <pous>
      <pou name="imported_prog" pouType="program">
        <interface>
          <localVars>
            <variable name="pump_count">
              <type><INT/></type>
            </variable>
          </localVars>
        </interface>
        <body>
          <ST>
            <xhtml:p><![CDATA[pump_count := pump_count + 1;]]></xhtml:p>
          </ST>
        </body>
      </pou>
    </pous>
  </types>
  <instances>
    <configurations>
      <configuration name="Config0">
        <resource name="Res0">
          <task name="fast_task" priority="2" interval="T#50ms">
            <pouInstance name="imported_inst" typeName="imported_prog"/>
          </task>
        </resource>
      </configuration>
    </configurations>
  </instances>
</project>
`

/** Every file under @p dir, as paths relative to it. */
function filesUnder(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesUnder(path, `${prefix}${entry}/`) : [`${prefix}${entry}`]
  })
}

/** Sends a native menu accelerator to the main window; Playwright's keyboard never reaches those. */
async function sendAccelerator(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, name) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send(name)
  }, channel)
}

/** The explorer entry named @p name. */
const explorerItem = (page: Page, name: string) => page.getByText(name, { exact: true }).first()

/** Writes the target project and the XML file to import, and returns their paths. */
function writeFixture(name: string): { project: string; userData: string; xmlFile: string } {
  const { project, userData } = writeStProgramProject(`${name}-${test.info().repeatEachIndex}`, {
    name: PROJECT_NAME,
    program: 'PROGRAM main\n  VAR\n    old_flag : BOOL;\n  END_VAR\n\nold_flag := TRUE;\n\nEND_PROGRAM\n',
    enums: [],
  })
  const xmlFile = join(project, '..', 'import.xml')
  writeFileSync(xmlFile, PLCOPEN_XML)
  return { project, userData, xmlFile }
}

/** Opens the target project, imports @p xmlFile through File > Import PLCopen XML and saves the project. */
async function importAndSave(app: ElectronApplication, page: Page, project: string, xmlFile: string): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] })
  }, xmlFile)
  await explorerItem(page, PROJECT_NAME).click({ timeout: 30000 })
  await expect(explorerItem(page, 'main')).toBeVisible({ timeout: 60000 })

  await sendAccelerator(app, 'project:import-plcopen-accelerator')
  await expect(page.getByText('Import PLCopen XML?')).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Import PLCopen XML', exact: true }).click()

  await expect(page.getByText('The PLCopen XML file was imported successfully.').first()).toBeVisible({
    timeout: 30000,
  })
  await expect(explorerItem(page, 'imported_prog')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('main', { exact: true })).toHaveCount(0)
  await expect(explorerItem(page, 'PumpMode')).toBeVisible()

  await sendAccelerator(app, 'project:save-accelerator')
  await expect
    .poll(() => readFileSync(join(project, 'project.json'), 'utf-8').includes('"fast_task"'), { timeout: 30000 })
    .toBe(true)
}

test('a PLCopen XML file replaces the open project and its elements are saved to disk', async () => {
  test.setTimeout(180000)
  const { project, userData, xmlFile } = writeFixture('openplc-e2e-plcopen-import')
  const { app, page } = await launch(userData)
  try {
    await importAndSave(app, page, project, xmlFile)

    const programFile = filesUnder(join(project, 'pous')).find((f) => f.includes('imported_prog')) ?? ''
    expect(programFile).not.toBe('')
    const program = readFileSync(join(project, 'pous', programFile), 'utf-8')
    expect(program).toContain('pump_count := pump_count + 1;')
    expect(program).toMatch(/pump_count\s*:\s*INT/)

    const dataType = readFileSync(join(project, 'datatypes', 'PumpMode.dt'), 'utf-8')
    expect(dataType).toMatch(/PumpMode\s*:\s*\(Off,\s*Auto\)/)
    const saved = readFileSync(join(project, 'project.json'), 'utf-8')
    expect(saved).toContain('"imported_inst"')
    expect(saved).not.toContain('"instance0"')
  } finally {
    await quitApp(app, page)
  }
})

test('the program a PLCopen import replaced does not come back when the saved project is reopened', async () => {
  test.setTimeout(180000)
  const { project, userData, xmlFile } = writeFixture('openplc-e2e-plcopen-import-reopen')
  let { app, page } = await launch(userData)
  try {
    await importAndSave(app, page, project, xmlFile)
    await quitApp(app, page)
    ;({ app, page } = await launch(userData))
    await explorerItem(page, PROJECT_NAME).or(explorerItem(page, 'imported')).click({ timeout: 30000 })
    await expect(explorerItem(page, 'imported_prog')).toBeVisible({ timeout: 60000 })
    await expect(page.getByText('main', { exact: true })).toHaveCount(0)
    expect(filesUnder(join(project, 'pous')).filter((f) => /(^|\/)main\.st$/.test(f))).toEqual([])
  } finally {
    await quitApp(app, page)
  }
})
