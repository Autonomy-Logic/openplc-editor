import { cliArgv } from '../argv'

describe('cliArgv', () => {
  it('takes everything after the --cli marker, discarding launcher switches', () => {
    // The shim passes Chromium switches on Linux. Feeding them to the CLI's own
    // parser broke it: `--disable-gpu` is not a declared boolean, so it consumed
    // the next token and `install-cli` vanished as its value.
    const argv = [
      '/opt/app/open-plc-editor',
      '--no-sandbox',
      '--ozone-platform=headless',
      '--disable-gpu',
      '--cli',
      'install-cli',
      '--no-json',
    ]
    expect(cliArgv(argv)).toEqual(['install-cli', '--no-json'])
  })

  it('keeps the user arguments intact, including ones that look like switches', () => {
    const argv = ['/opt/app/x', '--cli', 'debug', 'read', '--var', 'main:counter']
    expect(cliArgv(argv)).toEqual(['debug', 'read', '--var', 'main:counter'])
  })

  it('drops a leading script path when there is no marker (development bundle)', () => {
    expect(cliArgv(['/path/electron', '/repo/openplc-cli.dev.js', 'devices'])).toEqual(['devices'])
  })

  it('keeps the first argument when it is not a script path', () => {
    expect(cliArgv(['/path/electron', 'devices', '--timeout', '2000'])).toEqual(['devices', '--timeout', '2000'])
  })

  it('returns nothing for a bare launch', () => {
    expect(cliArgv(['/opt/app/x', '--cli'])).toEqual([])
  })
})
