/**
 * The pre-compile offers C/C++ blocks every installed library, except one whose
 * `architectures=` excludes the board: its headers could shadow the core's
 * (the STM32 FreeRTOS port's portmacro.h over the ESP32's).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

jest.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { libraryServesArchitecture } from '../compiler-module'

describe('libraryServesArchitecture', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lib-arch-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const declare = (line: string) => writeFile(join(dir, 'library.properties'), `name=X\n${line}\nversion=1\n`)

  it('keeps a library out of a board its architectures exclude', async () => {
    await declare('architectures=stm32')
    expect(await libraryServesArchitecture(dir, 'esp32')).toBe(false)
    expect(await libraryServesArchitecture(dir, 'stm32')).toBe(true)
  })

  it('offers one that serves every board, lists the board, or its family', async () => {
    await declare('architectures=*')
    expect(await libraryServesArchitecture(dir, 'esp32')).toBe(true)
    await declare('architectures=avr, mbed')
    expect(await libraryServesArchitecture(dir, 'mbed_nano')).toBe(true)
    expect(await libraryServesArchitecture(dir, 'AVR')).toBe(true)
  })

  it('offers one that declares nothing, or has no properties file', async () => {
    expect(await libraryServesArchitecture(dir, 'esp32')).toBe(true)
    await declare('sentence=no architectures here')
    expect(await libraryServesArchitecture(dir, 'esp32')).toBe(true)
  })
})
