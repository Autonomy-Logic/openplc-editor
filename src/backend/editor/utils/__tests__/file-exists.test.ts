/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from '@jest/globals'

import { fileExists } from '../file-exists'

const scratch = mkdtempSync(join(tmpdir(), 'file-exists-'))
const file = join(scratch, 'present.txt')
const folder = join(scratch, 'folder')
writeFileSync(file, 'x')
mkdirSync(folder)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('fileExists', () => {
  it('resolves true for a file', async () => {
    await expect(fileExists(file)).resolves.toBe(true)
  })

  it('resolves true for a directory', async () => {
    await expect(fileExists(folder)).resolves.toBe(true)
  })

  it('resolves false for a missing file', async () => {
    await expect(fileExists(join(scratch, 'missing.txt'))).resolves.toBe(false)
  })

  it('resolves false for a path under a missing directory, without rejecting', async () => {
    await expect(fileExists(join(scratch, 'no-such-dir', 'nested', 'file.txt'))).resolves.toBe(false)
  })

  it('resolves false instead of rejecting for a path through a file', async () => {
    await expect(fileExists(join(file, 'child'))).resolves.toBe(false)
  })
})
