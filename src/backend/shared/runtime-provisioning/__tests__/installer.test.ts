import { classifyInstallerExit, isSafeInstallerDir, parseInstallerPoll, parsePrepareInstaller } from '../installer'

describe('isSafeInstallerDir', () => {
  it.each([
    ['a mktemp directory under /tmp', '/tmp/tmp.Xy7Qa9Zk2B'],
    ['a mktemp directory under /var/tmp', '/var/tmp/tmp.k3J_9-q'],
    ['a name containing two dots inside a segment', '/tmp/a..b'],
    ['the longest allowed path', `/${'a'.repeat(255)}`],
  ])('accepts %s', (_, path) => {
    expect(isSafeInstallerDir(path)).toBe(true)
  })

  it.each([
    ['an empty path', ''],
    ['the root alone', '/'],
    ['a relative path', 'tmp/tmp.Xy7Qa9Zk2B'],
    ['a parent segment in the middle', '/tmp/../etc'],
    ['a parent segment at the end', '/tmp/x/..'],
    ['a parent segment alone', '/..'],
    ['a space', '/tmp/tmp X'],
    ['a single quote', "/tmp/tmp'x"],
    ['a semicolon', '/tmp/x;reboot'],
    ['a command substitution', '/tmp/$(reboot)'],
    ['a backtick', '/tmp/`id`'],
    ['a newline', '/tmp/x\n/etc'],
    ['a path one character too long', `/${'a'.repeat(256)}`],
  ])('refuses %s', (_, path) => {
    expect(isSafeInstallerDir(path)).toBe(false)
  })
})

describe('parsePrepareInstaller', () => {
  it('reads the directory of a successful download', () => {
    expect(parsePrepareInstaller('dir=/tmp/tmp.Xy7Qa9Zk2B\ndownload=ok\n')).toEqual({
      kind: 'ready',
      dir: '/tmp/tmp.Xy7Qa9Zk2B',
    })
  })

  it('reports a failed download', () => {
    expect(parsePrepareInstaller('dir=/tmp/tmp.Xy7Qa9Zk2B\ndownload=failed\n')).toEqual({ kind: 'download-failed' })
  })

  it.each([
    ['a missing directory', 'download=ok\n'],
    ['an empty directory', 'dir=\ndownload=ok\n'],
    ['an unsafe directory', 'dir=/tmp/x;reboot\ndownload=ok\n'],
    ['a relative directory', 'dir=tmp.Xy7Qa9Zk2B\ndownload=ok\n'],
    ['a parent segment in the directory', 'dir=/tmp/../etc\ndownload=ok\n'],
    ['two directories', 'dir=/tmp/tmp.A\ndir=/tmp/tmp.B\ndownload=ok\n'],
    ['empty output', ''],
  ])('reports %s as invalid', (_, stdout) => {
    expect(parsePrepareInstaller(stdout)).toEqual({ kind: 'invalid' })
  })
})

describe('parseInstallerPoll', () => {
  it('reads a running installer and the log text after the separator', () => {
    expect(parseInstallerPoll('exit=running\nsize=120\nfrom=0\n---\nhello\nworld\n')).toEqual({
      exit: 'running',
      size: 120,
      from: 0,
      text: 'hello\nworld\n',
    })
  })

  it.each([
    ['0', 0],
    ['1', 1],
    ['127', 127],
  ])('reads exit status %s', (code, exit) => {
    expect(parseInstallerPoll(`exit=${code}\nsize=70000\nfrom=4464\n---\ntail\n`)).toEqual({
      exit,
      size: 70000,
      from: 4464,
      text: 'tail\n',
    })
  })

  it('reads an empty log read', () => {
    expect(parseInstallerPoll('exit=running\nsize=0\nfrom=0\n---\n')).toEqual({
      exit: 'running',
      size: 0,
      from: 0,
      text: '',
    })
  })

  it('keeps log text that looks like the header verbatim', () => {
    const text = 'exit=0\nsize=1\n---\nfrom=9\n'

    expect(parseInstallerPoll(`exit=running\nsize=300\nfrom=10\n---\n${text}`)).toEqual({
      exit: 'running',
      size: 300,
      from: 10,
      text,
    })
  })

  it.each([
    ['empty output', ''],
    ['no separator', 'exit=running\nsize=120\nfrom=0\n'],
    ['a missing exit', 'size=120\nfrom=0\n---\nx\n'],
    ['a missing size', 'exit=running\nfrom=0\n---\nx\n'],
    ['a missing offset', 'exit=running\nsize=120\n---\nx\n'],
    ['an exit that is not a number', 'exit=done\nsize=120\nfrom=0\n---\nx\n'],
    ['a negative size', 'exit=running\nsize=-1\nfrom=0\n---\nx\n'],
    ['a fractional offset', 'exit=running\nsize=120\nfrom=1.5\n---\nx\n'],
    ['a size that is not a number', 'exit=running\nsize=big\nfrom=0\n---\nx\n'],
  ])('returns null for %s', (_, stdout) => {
    expect(parseInstallerPoll(stdout)).toBeNull()
  })
})

describe('classifyInstallerExit', () => {
  const pullFailure =
    '\u001b[31m[ERROR]\u001b[0m Could not pull ghcr.io/autonomy-logic/openplc-runtime:latest, and no local copy is present.'

  it('reports exit status 0 as ok, whatever the output says', () => {
    expect(classifyInstallerExit(0, ['Could not download the Docker installer.'])).toBe('ok')
  })

  it.each([
    [
      'the Docker installer download failure',
      ['Installing Docker', '[ERROR] Could not download the Docker installer.'],
    ],
    [
      'an image pull failure with no local copy',
      ['Pulling images', pullFailure, 'Nothing on this device has been changed.'],
    ],
  ])('reports a non-zero exit after %s as a download failure', (_, lines) => {
    expect(classifyInstallerExit(1, lines)).toBe('download-failed')
  })

  it.each([
    ['no marker', ['Configuring the runtime', 'Error: port 8443 is in use']],
    ['no output', []],
    ['only the first half of the pull marker', ['Could not pull ghcr.io/x:latest; retrying']],
    ['only the second half of the pull marker', ['cache: and no local copy is present']],
    [
      'the two halves of the pull marker on separate lines',
      ['Could not pull ghcr.io/x:latest,', 'and no local copy is present.'],
    ],
  ])('reports a non-zero exit with %s as an installer failure', (_, lines) => {
    expect(classifyInstallerExit(2, lines)).toBe('installer-failed')
  })
})
