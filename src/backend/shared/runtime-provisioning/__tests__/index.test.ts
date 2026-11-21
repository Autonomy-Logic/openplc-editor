import * as audit from '../audit'
import * as commands from '../commands'
import * as hostKeyFile from '../host-key-file'
import * as provisioning from '../index'
import * as inspection from '../inspection'
import * as installer from '../installer'
import * as output from '../output'
import * as runtimeNames from '../runtime-names'

describe('runtime-provisioning building blocks index', () => {
  it.each([
    ['runtime-names', runtimeNames],
    ['host-key-file', hostKeyFile],
    ['commands', commands],
    ['inspection', inspection],
    ['output', output],
    ['audit', audit],
    ['installer', installer],
  ])('re-exports every value of %s', (_, module) => {
    expect(Object.keys(module).length).toBeGreaterThan(0)
    expect(provisioning).toEqual(expect.objectContaining({ ...module }))
  })
})
