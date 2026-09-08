/**
 * Reading what the runtime said about the project an upload carried.
 *
 * The point of this module is that a refused project must not pass in silence:
 * the upload succeeds, the program runs, and without this nobody learns the
 * device is not storing anything until they try to retrieve it. So the tests
 * are about not losing the message, and about not inventing one.
 */

import { describeSnapshotUploadWarning, readSnapshotUploadWarning } from '../upload-snapshot-warning'

it('reads the reason the device gave', () => {
  const body = JSON.stringify({
    CompilationStatus: 'COMPILING',
    UploadFileFail: '',
    ProjectSnapshotWarning: 'Snapshot ignored: archive is too large (limit 104857600 bytes)',
  })

  expect(readSnapshotUploadWarning(body)).toBe('Snapshot ignored: archive is too large (limit 104857600 bytes)')
})

it('says nothing when the device had nothing to say', () => {
  // The ordinary case: the project was stored, so the field is empty.
  const body = JSON.stringify({ CompilationStatus: 'COMPILING', ProjectSnapshotWarning: '' })
  expect(readSnapshotUploadWarning(body)).toBeNull()
})

it('says nothing for a runtime too old to have the field', () => {
  expect(readSnapshotUploadWarning(JSON.stringify({ CompilationStatus: 'COMPILING' }))).toBeNull()
})

it('treats whitespace as nothing said', () => {
  expect(readSnapshotUploadWarning(JSON.stringify({ ProjectSnapshotWarning: '   ' }))).toBeNull()
})

it('does not fail an upload that already succeeded over an unreadable response', () => {
  // This runs on the success path. A response that will not parse is not worth
  // throwing over -- it just means there is no warning to show.
  expect(readSnapshotUploadWarning('not json at all')).toBeNull()
  expect(readSnapshotUploadWarning('null')).toBeNull()
  expect(readSnapshotUploadWarning(JSON.stringify({ ProjectSnapshotWarning: 42 }))).toBeNull()
})

it('explains what the refusal means for the person reading the log', () => {
  // The runtime's text says what went wrong; this says what it costs them.
  const described = describeSnapshotUploadWarning('Snapshot ignored: archive is too large')

  expect(described).toContain('Snapshot ignored: archive is too large')
  expect(described).toContain('running')
  expect(described).toContain('cannot be retrieved')
})
