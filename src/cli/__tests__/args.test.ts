import { boolFlag, listFlag, parseArgs, stringFlag } from '../args'

const BOOLEANS = ['json', 'quiet', 'upload-if-needed', 'all'] as const
const SUBCOMMANDS = ['debug'] as const

const parse = (argv: string[]) => parseArgs(argv, { booleanFlags: BOOLEANS, commandsWithSubcommands: SUBCOMMANDS })

describe('parseArgs', () => {
  it('reads a command with no arguments', () => {
    expect(parse(['compile'])).toEqual({ command: 'compile', subcommand: undefined, positionals: [], flags: {} })
  })

  it('treats the second token as a subcommand only for commands that take one', () => {
    expect(parse(['debug', 'open']).subcommand).toBe('open')
    // `compile` takes a path, not a subcommand — it must stay positional.
    expect(parse(['compile', './proj']).subcommand).toBeUndefined()
    expect(parse(['compile', './proj']).positionals).toEqual(['./proj'])
  })

  it('accepts --flag value and --flag=value identically', () => {
    expect(parse(['compile', '--target', 'Runtime v4']).flags.target).toBe('Runtime v4')
    expect(parse(['compile', '--target=Runtime v4']).flags.target).toBe('Runtime v4')
  })

  it('does not let a declared boolean flag swallow the next token', () => {
    // The bug this guards: `--upload-if-needed` consuming `--target`'s value,
    // or worse, consuming a bare positional and leaving target unset.
    const args = parse(['debug', 'open', '--upload-if-needed', '--target', 'sim'])
    expect(args.flags['upload-if-needed']).toBe(true)
    expect(args.flags.target).toBe('sim')
  })

  it('reads --no-<flag> as false', () => {
    expect(parse(['compile', '--no-json']).flags.json).toBe(false)
  })

  it('treats a trailing flag and a flag followed by another flag as booleans', () => {
    expect(parse(['compile', '--verbose']).flags.verbose).toBe(true)
    expect(parse(['compile', '--verbose', '--target', 'x']).flags.verbose).toBe(true)
  })

  it('collects a repeated flag into a list', () => {
    const args = parse(['debug', 'read', '--var', 'a', '--var', 'b', '--var', 'c'])
    expect(listFlag(args, 'var')).toEqual(['a', 'b', 'c'])
  })

  it('stops parsing flags after -- so values can look like flags', () => {
    const args = parse(['debug', 'exec', '--', '--not-a-flag', 'x'])
    expect(args.positionals).toEqual(['--not-a-flag', 'x'])
    expect(args.flags['not-a-flag']).toBeUndefined()
  })

  it('returns no command for empty argv', () => {
    expect(parse([]).command).toBeUndefined()
  })
})

describe('flag readers', () => {
  it('stringFlag takes the last value when a flag is repeated', () => {
    expect(stringFlag(parse(['compile', '--target', 'a', '--target', 'b']), 'target')).toBe('b')
  })

  it('stringFlag returns undefined for a missing or boolean flag', () => {
    expect(stringFlag(parse(['compile']), 'target')).toBeUndefined()
    expect(stringFlag(parse(['compile', '--json']), 'json')).toBeUndefined()
  })

  it('listFlag normalises a single value and a missing flag', () => {
    expect(listFlag(parse(['debug', 'read', '--var', 'a']), 'var')).toEqual(['a'])
    expect(listFlag(parse(['debug', 'read']), 'var')).toEqual([])
  })

  it('boolFlag honours the value-bearing negative forms', () => {
    expect(boolFlag(parse(['compile', '--json']), 'json')).toBe(true)
    expect(boolFlag(parse(['compile', '--json=false']), 'json')).toBe(false)
    expect(boolFlag(parse(['compile', '--json=0']), 'json')).toBe(false)
    expect(boolFlag(parse(['compile', '--json=yes']), 'json')).toBe(true)
    expect(boolFlag(parse(['compile']), 'json')).toBe(false)
  })
})
