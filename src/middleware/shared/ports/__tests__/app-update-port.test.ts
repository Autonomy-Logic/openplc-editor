import { toAppUpdateStatus } from '../app-update-port'

describe('toAppUpdateStatus', () => {
  it('keeps a ready status with its version', () => {
    expect(toAppUpdateStatus({ state: 'ready', version: '4.3.3' })).toEqual({ state: 'ready', version: '4.3.3' })
  })

  it.each([
    ['none', { state: 'none' }],
    ['ready without a version', { state: 'ready' }],
    ['ready with an empty version', { state: 'ready', version: '' }],
    ['ready with a non-string version', { state: 'ready', version: 4 }],
    ['an unknown state', { state: 'downloading', version: '4.3.3' }],
    ['null', null],
    ['a string', 'ready'],
    ['undefined', undefined],
  ])('reads %s as nothing to show', (_, value) => {
    expect(toAppUpdateStatus(value)).toEqual({ state: 'none' })
  })
})
