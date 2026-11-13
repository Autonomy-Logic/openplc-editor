import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

const SCRIPT = join(process.cwd(), 'scripts', 'check-debug-seam-leak.mjs')
const MARKER = '__OPENPLC_E2E_DEBUG_SESSION__'

type Run = { status: number; output: string }

function run(args: string[]): Run {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' })
    return { status: 0, output }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('check-debug-seam-leak', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seam-leak-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('should pass on a bundle that does not carry the marker', () => {
    writeFileSync(join(root, 'renderer.js'), 'const a = 1\nexport default a\n')

    expect(run([root]).status).toBe(0)
  })

  it('should fail on a bundle that carries the marker', () => {
    writeFileSync(join(root, 'renderer.js'), `globalThis['${MARKER}'] = {}\n`)

    expect(run([root]).status).toBe(1)
  })

  it('should name the leaking file', () => {
    writeFileSync(join(root, 'renderer.js'), `globalThis['${MARKER}'] = {}\n`)

    expect(run([root]).output).toContain('renderer.js')
  })

  it('should search nested directories', () => {
    mkdirSync(join(root, 'assets', 'chunks'), { recursive: true })
    writeFileSync(join(root, 'assets', 'chunks', 'late.js'), `window['${MARKER}']\n`)

    const result = run([root])

    expect(result.status).toBe(1)
    expect(result.output).toContain('late.js')
  })

  it('should pass on an empty directory', () => {
    expect(run([root]).status).toBe(0)
  })

  it('should fail when the directory does not exist', () => {
    expect(run([join(root, 'missing')]).status).toBe(1)
  })

  it('should fail when no directory is given', () => {
    expect(run([]).status).toBe(1)
  })
})
