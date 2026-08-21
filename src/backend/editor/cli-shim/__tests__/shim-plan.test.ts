import {
  candidateDirectories,
  describeUnstableLocation,
  isOnPath,
  mayReplace,
  pathHint,
  planShimInstall,
  renderShim,
  resolveShimTarget,
  SHIM_MARKER,
  platformSwitches,
  shimFileName,
  type ShimEnvironment,
} from '../shim-plan'

const posix = (overrides: Partial<ShimEnvironment> = {}): ShimEnvironment => ({
  platform: 'linux',
  home: '/home/dev',
  pathVariable: '/usr/bin:/bin',
  ...overrides,
})

const windows = (overrides: Partial<ShimEnvironment> = {}): ShimEnvironment => ({
  platform: 'win32',
  home: 'C:\\Users\\dev',
  pathVariable: 'C:\\Windows\\system32',
  localAppData: 'C:\\Users\\dev\\AppData\\Local',
  ...overrides,
})

const allWritable = { isWritable: () => true }
const noneWritable = { isWritable: () => false }

describe('shimFileName', () => {
  it('gives Windows an extension the shell will execute', () => {
    expect(shimFileName('win32')).toBe('openplc-cli.cmd')
    expect(shimFileName('darwin')).toBe('openplc-cli')
    expect(shimFileName('linux')).toBe('openplc-cli')
  })
})

describe('candidateDirectories', () => {
  it('offers only user-writable locations — never /usr/local/bin or Program Files', () => {
    // A convenience command must not require an elevation prompt at first launch.
    const linux = candidateDirectories(posix())
    expect(linux).toEqual(['/home/dev/.local/bin', '/home/dev/bin'])
    expect(linux.join(' ')).not.toContain('/usr/local')

    const win = candidateDirectories(windows())
    expect(win).toEqual(['C:\\Users\\dev\\AppData\\Local\\Programs\\openplc-cli'])
    expect(win.join(' ')).not.toMatch(/Program Files/)
  })

  it('falls back to a derived LOCALAPPDATA when the variable is missing', () => {
    expect(candidateDirectories(windows({ localAppData: undefined }))).toEqual([
      'C:\\Users\\dev\\AppData\\Local\\Programs\\openplc-cli',
    ])
  })
})

describe('isOnPath', () => {
  it('matches ignoring a trailing separator, so no duplicate entry is added', () => {
    expect(isOnPath('/home/dev/bin', posix({ pathVariable: '/usr/bin:/home/dev/bin/' }))).toBe(true)
  })

  it('is case-insensitive on Windows only', () => {
    expect(isOnPath('C:\\Tools', windows({ pathVariable: 'c:\\tools' }))).toBe(true)
    expect(isOnPath('/home/Dev/bin', posix({ pathVariable: '/home/dev/bin' }))).toBe(false)
  })

  it('ignores empty entries and an empty directory', () => {
    expect(isOnPath('/home/dev/bin', posix({ pathVariable: '::/home/dev/bin' }))).toBe(true)
    expect(isOnPath('', posix({ pathVariable: '::' }))).toBe(false)
  })
})

describe('planShimInstall', () => {
  it('prefers a writable directory that is already on PATH', () => {
    // ~/bin is second in preference but already on PATH, so it wins — the user
    // gets a working command with no profile edit.
    const plan = planShimInstall(posix({ pathVariable: '/usr/bin:/home/dev/bin' }), allWritable)
    expect(plan?.directory).toBe('/home/dev/bin')
    expect(plan?.onPath).toBe(true)
    expect(plan?.shimPath).toBe('/home/dev/bin/openplc-cli')
  })

  it('falls back to the first writable directory and reports it is not on PATH', () => {
    const plan = planShimInstall(posix(), allWritable)
    expect(plan?.directory).toBe('/home/dev/.local/bin')
    expect(plan?.onPath).toBe(false)
  })

  it('skips a directory it cannot write to', () => {
    const plan = planShimInstall(posix(), { isWritable: (d) => d === '/home/dev/bin' })
    expect(plan?.directory).toBe('/home/dev/bin')
  })

  it('returns undefined when nothing is writable, rather than pretending', () => {
    expect(planShimInstall(posix(), noneWritable)).toBeUndefined()
  })

  it('reports PATH as editable only on Windows', () => {
    expect(planShimInstall(windows(), allWritable)?.canUpdatePath).toBe(true)
    expect(planShimInstall(posix(), allWritable)?.canUpdatePath).toBe(false)
  })

  it('joins Windows paths with a backslash', () => {
    expect(planShimInstall(windows(), allWritable)?.shimPath).toBe(
      'C:\\Users\\dev\\AppData\\Local\\Programs\\openplc-cli\\openplc-cli.cmd',
    )
  })
})

describe('renderShim', () => {
  it('execs the target and forwards arguments intact on POSIX', () => {
    const shim = renderShim(
      { command: '/Applications/OpenPLC Editor.app/Contents/MacOS/OpenPLC Editor', leadingArgs: ['--cli'] },
      'darwin',
    )
    expect(shim).toContain('#!/bin/sh')
    // `exec` so the shim does not linger and the exit code passes through;
    // `"$@"` so a project path containing spaces survives.
    expect(shim).toContain('exec "/Applications/OpenPLC Editor.app/Contents/MacOS/OpenPLC Editor" "--cli" "$@"')
    expect(shim).toContain(SHIM_MARKER)
  })

  it('quotes the target and forwards %* on Windows, with CRLF endings', () => {
    const shim = renderShim(
      { command: 'C:\\Program Files\\OpenPLC Editor\\OpenPLC Editor.exe', leadingArgs: ['--cli'] },
      'win32',
    )
    expect(shim).toContain('@echo off')
    expect(shim).toContain('"C:\\Program Files\\OpenPLC Editor\\OpenPLC Editor.exe" "--cli" %*')
    expect(shim).toContain('\r\n')
  })

  describe('resolveShimTarget', () => {
    it('points at the AppImage FILE, not the ephemeral mount', () => {
      // The mount path changes every launch; $APPIMAGE is where the user keeps the
      // file, and the AppImage runtime forwards arguments to the app.
      const target = resolveShimTarget('/tmp/.mount_OpenPLxYz/openplc-editor', {
        ...posix(),
        appImagePath: '/home/dev/Applications/OpenPLC-Editor.AppImage',
      })
      expect(target).toBe('/home/dev/Applications/OpenPLC-Editor.AppImage')
    })

    it('uses the running executable when there is no AppImage', () => {
      expect(resolveShimTarget('/opt/openplc/openplc-editor', posix())).toBe('/opt/openplc/openplc-editor')
    })

    it('ignores $APPIMAGE off Linux, where it means nothing', () => {
      const target = resolveShimTarget('/Applications/X.app/Contents/MacOS/X', {
        ...posix({ platform: 'darwin' }),
        appImagePath: '/somewhere/Weird.AppImage',
      })
      expect(target).toBe('/Applications/X.app/Contents/MacOS/X')
    })
  })

  describe('describeUnstableLocation', () => {
    it('refuses a macOS disk image and says to install to Applications', () => {
      const reason = describeUnstableLocation('/Volumes/OpenPLC Editor/OpenPLC Editor.app/Contents/MacOS/x', 'darwin')
      expect(reason).toMatch(/disk image/i)
      expect(reason).toMatch(/Applications/)
    })

    it('refuses a Gatekeeper-translocated app, which looks like a normal launch', () => {
      const reason = describeUnstableLocation(
        '/private/var/folders/ab/AppTranslocation/UUID/d/OpenPLC Editor.app/Contents/MacOS/x',
        'darwin',
      )
      expect(reason).toMatch(/quarantined|randomised/i)
    })

    it('refuses a temporary AppImage mount only when $APPIMAGE gave nothing', () => {
      expect(describeUnstableLocation('/tmp/.mount_abc/openplc', 'linux')).toMatch(/APPIMAGE/)
      // With the file path resolved, the location is stable and allowed.
      expect(describeUnstableLocation('/home/dev/Apps/OpenPLC.AppImage', 'linux')).toBeUndefined()
    })

    it('allows an installed app, and never blocks Windows', () => {
      expect(describeUnstableLocation('/Applications/OpenPLC Editor.app/Contents/MacOS/x', 'darwin')).toBeUndefined()
      expect(describeUnstableLocation('C:\\Program Files\\OpenPLC\\x.exe', 'win32')).toBeUndefined()
    })
  })

  describe('mayReplace', () => {
    it('writes when nothing is there, and replaces only our own shim', () => {
      expect(mayReplace(undefined)).toBe(true)
      expect(mayReplace(`#!/bin/sh\n# ${SHIM_MARKER}\n`)).toBe(true)
      // Someone else's openplc-cli on PATH is not ours to overwrite.
      expect(mayReplace('#!/bin/sh\nexec /opt/mine/openplc-cli "$@"\n')).toBe(false)
    })
  })

  describe('pathHint', () => {
    it('says nothing when the directory is already on PATH', () => {
      const plan = planShimInstall(posix({ pathVariable: '/home/dev/.local/bin' }), allWritable)
      expect(plan && pathHint(plan, 'linux')).toBeUndefined()
    })

    it('gives a copyable line on POSIX instead of editing a shell profile', () => {
      const plan = planShimInstall(posix(), allWritable)
      const hint = plan && pathHint(plan, 'linux')
      expect(hint).toContain('/home/dev/.local/bin')
      expect(hint).toContain('~/.profile')
    })

    it('tells Windows users a new terminal is needed', () => {
      const plan = planShimInstall(windows(), allWritable)
      expect(plan && pathHint(plan, 'win32')).toMatch(/new terminal/i)
    })
  })

  it('repeats a development script path, or the shim runs plain Electron', () => {
    // Without the script, `openplc-cli --version` answered with Electron's own
    // version and looked like it had worked.
    const shim = renderShim(
      { command: '/repo/node_modules/electron/dist/Electron', leadingArgs: ['/repo/openplc-cli.dev.js', '--cli'] },
      'linux',
    )
    // Switches precede the script path, which is where Electron expects them.
    expect(shim).toContain(
      'exec "/repo/node_modules/electron/dist/Electron" "--no-sandbox" "--ozone-platform=headless" ' +
        '"--disable-gpu" "/repo/openplc-cli.dev.js" "--cli" "$@"',
    )
  })
})

describe('platformSwitches', () => {
  it('passes the Linux switches Chromium reads before our script runs', () => {
    // Set from JS they are too late: the SUID sandbox and Ozone both initialise
    // during startup, so `appendSwitch` never gets a chance. The shim IS the
    // command line, which is why they live here.
    expect(platformSwitches('linux')).toEqual(['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'])
  })

  it('adds nothing on macOS or Windows, which have neither problem', () => {
    expect(platformSwitches('darwin')).toEqual([])
    expect(platformSwitches('win32')).toEqual([])
  })

  it('renders them into the Linux shim ahead of the CLI marker', () => {
    const shim = renderShim({ command: '/home/dev/App.AppImage', leadingArgs: ['--cli'] }, 'linux')
    expect(shim).toContain(
      'exec "/home/dev/App.AppImage" "--no-sandbox" "--ozone-platform=headless" "--disable-gpu" "--cli" "$@"',
    )
  })
})
