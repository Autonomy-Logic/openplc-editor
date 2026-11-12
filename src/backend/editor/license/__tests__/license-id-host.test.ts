/**
 * @jest-environment node
 */
/**
 * Builds the Baremetal board-ID layer on the host with the system C compiler and
 * runs its C host tests.
 */
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const HOST_DIR = resolve(__dirname, 'license-id-host')

const hasTool = (tool: string): boolean => spawnSync(tool, ['--version'], { stdio: 'ignore' }).status === 0
const describeHost = hasTool('cc') && hasTool('make') ? describe : describe.skip

describeHost('Baremetal board-ID layer on the host', () => {
  let out: string

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'license-id-host-'))
  })

  afterAll(() => {
    rmSync(out, { recursive: true, force: true })
  })

  it('passes the C host tests', () => {
    expect(() => execFileSync('make', ['-s', `OUT=${out}`, 'check'], { cwd: HOST_DIR, stdio: 'pipe' })).not.toThrow()
  })
})
