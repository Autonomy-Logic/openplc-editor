import { INSTALLER_DOWNLOAD_FAILURE_MARKERS } from './runtime-names'

const SAFE_DIR = /^\/[A-Za-z0-9._/-]{1,255}$/
const POLL_HEADER =
  /^exit=(running|[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\nsize=(0|[1-9][0-9]{0,14})\nfrom=(0|[1-9][0-9]{0,14})\n---\n/

export function isSafeInstallerDir(path: string): boolean {
  return SAFE_DIR.test(path) && !path.split('/').includes('..')
}

function fieldValues(fields: string[][], key: string): string[] {
  return fields.filter(([name]) => name === key).map((field) => field.slice(1).join('='))
}

export function parsePrepareInstaller(
  stdout: string,
): { kind: 'ready'; dir: string } | { kind: 'download-failed' } | { kind: 'invalid' } {
  const fields = stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('='))
  const knownFields = fields.every(([name, ...value]) => (name === 'dir' || name === 'download') && value.length > 0)
  const downloads = fieldValues(fields, 'download')
  const dirs = fieldValues(fields, 'dir')
  const downloadIs = (result: string): boolean => knownFields && downloads.length === 1 && downloads[0] === result
  if (downloadIs('failed')) return { kind: 'download-failed' }
  const ready = downloadIs('ok') && dirs.length === 1 && isSafeInstallerDir(dirs[0])
  return ready ? { kind: 'ready', dir: dirs[0] } : { kind: 'invalid' }
}

export function parseInstallerPoll(
  stdout: string,
): { exit: number | 'running'; size: number; from: number; text: string } | null {
  const header = POLL_HEADER.exec(stdout)
  if (header === null) return null
  const [matched, exitText, sizeText, fromText] = header
  const exit = exitText === 'running' ? 'running' : Number(exitText)
  return { exit, size: Number(sizeText), from: Number(fromText), text: stdout.slice(matched.length) }
}

function containsInOrder(line: string, fragments: readonly string[]): boolean {
  let position = 0
  for (const fragment of fragments) {
    const found = line.indexOf(fragment, position)
    if (found < 0) return false
    position = found + fragment.length
  }
  return true
}

export function classifyInstallerExit(
  exitCode: number,
  lines: string[],
): 'ok' | 'download-failed' | 'installer-failed' {
  if (exitCode === 0) return 'ok'
  const downloadFailed = lines.some((line) =>
    INSTALLER_DOWNLOAD_FAILURE_MARKERS.some((marker) => containsInOrder(line, marker)),
  )
  return downloadFailed ? 'download-failed' : 'installer-failed'
}
