import { raiseRecordedMtime, shouldReportExternalChange } from '../own-write'

describe('shouldReportExternalChange', () => {
  it.each([
    ['the file did not change', 1000, 1000, 1000, false],
    ['the poll saw an older time than the previous one', 2000, 1000, 1000, false],
    ['the change is the one the app recorded as its own', 1000, 2000, 2000, false],
    ['the change is older than the one the app recorded', 1000, 1500, 2000, false],
    ['the change is newer than both the previous and the recorded time', 1000, 3000, 2000, true],
  ])('is %s: %s', (_label, prevMtimeMs, currMtimeMs, recordedMtimeMs, expected) => {
    expect(shouldReportExternalChange({ prevMtimeMs, currMtimeMs, recordedMtimeMs })).toBe(expected)
  })
})

describe('raiseRecordedMtime', () => {
  it('takes the observed time when it is newer', () => {
    expect(raiseRecordedMtime(1000, 2000)).toBe(2000)
  })

  it.each([
    ['older', 2000, 1000],
    ['equal', 2000, 2000],
  ])('keeps the recorded time when the observed one is %s', (_label, recorded, observed) => {
    expect(raiseRecordedMtime(recorded, observed)).toBe(2000)
  })
})
