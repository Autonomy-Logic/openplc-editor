/**
 * Two policies a harness depends on and neither of which is visible from the
 * outside until it is wrong.
 *
 * `--idle-timeout` used to be `Number(raw) || DEFAULT`, which sent `0` — the
 * value that DISABLES the timeout — to the default, and turned a typo into a
 * silent 30 minutes. A session closing on its own releases its forces, so a soak
 * test that asked for no timeout got its outputs handed back mid-run.
 *
 * `exitCodeForError` is the contract callers are told to branch on. Two codes
 * had no case and fell through to 70, which this CLI documents as "a bug in the
 * CLI, not in the caller's input" — so a mistyped board name answered 3 from
 * `compile` and 70 from `debug open`.
 */

import { exitCodeForError, parseIdleTimeout } from '../commands/debug'
import { ErrorCode, ExitCode } from '../exit-codes'

describe('parseIdleTimeout', () => {
  it('defaults when the flag is absent', () => {
    expect(parseIdleTimeout(undefined)).toEqual({ value: 30 * 60 * 1000 })
  })

  it('keeps 0, which is how a caller asks for no idle timeout at all', () => {
    expect(parseIdleTimeout('0')).toEqual({ value: 0 })
  })

  it('takes a plain millisecond count', () => {
    expect(parseIdleTimeout('5000')).toEqual({ value: 5000 })
  })

  it.each(['5min', 'abc', '', 'NaN', 'Infinity', '-1'])('rejects %p rather than silently defaulting', (raw) => {
    const parsed = parseIdleTimeout(raw)
    expect(parsed).toHaveProperty('error')
  })
})

describe('exitCodeForError', () => {
  it('answers a target the build does not know the same way `compile` does', () => {
    expect(exitCodeForError(ErrorCode.TargetUnknown)).toBe(ExitCode.NotFound)
  })

  it('answers a project that is not compiled for the target as NotFound, not Internal', () => {
    expect(exitCodeForError(ErrorCode.ProjectInvalid)).toBe(ExitCode.NotFound)
    expect(exitCodeForError(ErrorCode.ProjectNotFound)).toBe(ExitCode.NotFound)
  })

  it('keeps the mappings that were already right', () => {
    expect(exitCodeForError(ErrorCode.SessionNotFound)).toBe(ExitCode.NotFound)
    expect(exitCodeForError(ErrorCode.NotConnected)).toBe(ExitCode.Connection)
    expect(exitCodeForError(ErrorCode.AuthRejected)).toBe(ExitCode.Auth)
    expect(exitCodeForError(ErrorCode.Timeout)).toBe(ExitCode.Timeout)
    expect(exitCodeForError(ErrorCode.InvalidArgument)).toBe(ExitCode.Usage)
    expect(exitCodeForError(ErrorCode.UploadRejected)).toBe(ExitCode.TargetError)
  })

  it('still reports something genuinely unanticipated as Internal', () => {
    expect(exitCodeForError('something-nobody-declared')).toBe(ExitCode.Internal)
  })
})
