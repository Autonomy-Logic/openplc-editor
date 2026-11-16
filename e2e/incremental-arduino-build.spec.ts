import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  ARDUINO_MEGA,
  arduinoCacheDir,
  buildAndWait,
  elfPath,
  missingPrerequisite,
  mtimeOf,
  objectTimes,
  PROJECT_NAME,
  recordCompileArgs,
  runDebugCompile,
  SLM_CPU_0,
  writeArduinoProject,
} from './helpers/arduino-build-project'
import { launch, quitApp } from './helpers/ethercat-project'

const STATIC_FILES = ['examples/Baremetal/hal_conf_extra.h', 'src/iec_types.hpp']
const GENERATED_FILES = ['src/defines.h', 'src/pou_MAIN.cpp']

function linkMap(sketchDir: string): string {
  const elf = elfPath(sketchDir)
  return elf === undefined ? '' : readFileSync(elf.replace(/\.elf$/, '.map'), 'utf-8')
}

test('SLM-CPU-0: a rebuild or a debug session reuses the core and a deleted POU drops out', async () => {
  test.skip(missingPrerequisite(SLM_CPU_0) !== undefined, missingPrerequisite(SLM_CPU_0) ?? '')
  test.setTimeout(1200000)
  const { userData, buildDir, sketchDir } = writeArduinoProject('openplc-e2e-incremental-slm', SLM_CPU_0)
  const { app, page } = await launch(userData)
  try {
    await recordCompileArgs(app)
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })

    await buildAndWait(page, sketchDir, 'Build only')
    expect(existsSync(join(buildDir, 'src', 'pou_EXTRA_FB.cpp'))).toBe(true)
    const cache = arduinoCacheDir(sketchDir)
    expect(cache).toBeDefined()
    const coreObjects = objectTimes(join(cache ?? '', 'libraries', 'SrcWrapper'))
    expect(coreObjects.size).toBeGreaterThan(50)
    const staticTimes = STATIC_FILES.map((file) => mtimeOf(join(buildDir, file)))
    const generatedTimes = GENERATED_FILES.map((file) => mtimeOf(join(buildDir, file)))

    await buildAndWait(page, sketchDir, 'Build only')
    expect(STATIC_FILES.map((file) => mtimeOf(join(buildDir, file)))).toEqual(staticTimes)
    GENERATED_FILES.forEach((file, index) =>
      expect(mtimeOf(join(buildDir, file))).toBeGreaterThan(generatedTimes[index]),
    )
    expect(objectTimes(join(cache ?? '', 'libraries', 'SrcWrapper'))).toEqual(coreObjects)
    expect(linkMap(sketchDir)).toMatch(/EXTRA_FB/i)

    const debugMap = join(buildDir, 'src', 'debug-map.json')
    const debugMapTime = mtimeOf(debugMap)
    expect(await runDebugCompile(app)).toMatch(/completed successfully/)
    expect(mtimeOf(debugMap)).toBeGreaterThan(debugMapTime)
    expect(STATIC_FILES.map((file) => mtimeOf(join(buildDir, file)))).toEqual(staticTimes)
    await buildAndWait(page, sketchDir, 'Build only')
    expect(STATIC_FILES.map((file) => mtimeOf(join(buildDir, file)))).toEqual(staticTimes)
    expect(objectTimes(join(cache ?? '', 'libraries', 'SrcWrapper'))).toEqual(coreObjects)

    const leaf = page.locator('li', { hasText: /^extra_fb$/i }).first()
    await leaf.hover({ timeout: 30000 })
    await leaf.locator('button').last().click()
    await page.getByText('Delete', { exact: true }).click({ timeout: 10000 })
    await page.getByRole('button', { name: 'Delete', exact: true }).click({ timeout: 10000 })
    await expect(page.getByText('POU deleted success!').first()).toBeVisible({ timeout: 15000 })

    await buildAndWait(page, sketchDir, 'Build only')
    expect(existsSync(join(buildDir, 'src', 'pou_EXTRA_FB.cpp'))).toBe(false)
    expect(linkMap(sketchDir)).not.toMatch(/EXTRA_FB/i)
    expect(objectTimes(join(cache ?? '', 'libraries', 'SrcWrapper'))).toEqual(coreObjects)
  } finally {
    await quitApp(app, page)
  }
})

test('Arduino Mega: a rebuild keeps the static files and Clean build recompiles the core', async () => {
  test.skip(missingPrerequisite(ARDUINO_MEGA) !== undefined, missingPrerequisite(ARDUINO_MEGA) ?? '')
  test.setTimeout(1200000)
  const { userData, buildDir, sketchDir } = writeArduinoProject('openplc-e2e-incremental-mega', ARDUINO_MEGA)
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })

    await buildAndWait(page, sketchDir, 'Build only')
    const staticTimes = STATIC_FILES.map((file) => mtimeOf(join(buildDir, file)))

    await buildAndWait(page, sketchDir, 'Build only')
    expect(STATIC_FILES.map((file) => mtimeOf(join(buildDir, file)))).toEqual(staticTimes)

    const beforeClean = Date.now()
    await buildAndWait(page, sketchDir, 'Clean build and upload')
    STATIC_FILES.forEach((file, index) => expect(mtimeOf(join(buildDir, file))).toBeGreaterThan(staticTimes[index]))
    const cache = arduinoCacheDir(sketchDir)
    expect(cache).toBeDefined()
    const coreObjects = [...objectTimes(join(cache ?? '', 'core')).values()]
    expect(coreObjects.length).toBeGreaterThan(10)
    for (const time of coreObjects) expect(time).toBeGreaterThan(beforeClean)
    expect(readdirSync(join(buildDir, 'src')).some((file) => file.startsWith('pou_'))).toBe(true)
  } finally {
    await quitApp(app, page)
  }
})
