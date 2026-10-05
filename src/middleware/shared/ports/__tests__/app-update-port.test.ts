import { toAppUpdateStatus } from '../app-update-port'

describe('toAppUpdateStatus', () => {
  it.each([
    [{ state: 'available', version: '4.3.3' }],
    [{ state: 'downloaded', version: '4.3.3' }],
    [{ state: 'downloading', version: '4.3.3', percent: 42 }],
  ])('keeps %p', (status) => {
    expect(toAppUpdateStatus(status)).toEqual(status)
  })

  it('keeps the percentage between 0 and 100', () => {
    expect(toAppUpdateStatus({ state: 'downloading', version: '4.3.3', percent: 140.2 })).toEqual({
      state: 'downloading',
      version: '4.3.3',
      percent: 100,
    })
  })

  it.each([
    ['none', { state: 'none' }],
    ['available without a version', { state: 'available' }],
    ['an empty version', { state: 'available', version: '' }],
    ['a non-string version', { state: 'available', version: 4 }],
    ['downloading without a percentage', { state: 'downloading', version: '4.3.3' }],
    ['an unknown state', { state: 'ready', version: '4.3.3' }],
    ['null', null],
    ['a string', 'available'],
    ['undefined', undefined],
  ])('reads %s as nothing to show', (_, value) => {
    expect(toAppUpdateStatus(value)).toEqual({ state: 'none' })
  })
})
