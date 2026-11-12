import { parseSshPortInput } from '../ssh-port-input'

describe('parseSshPortInput', () => {
  it.each([
    ['1', 1],
    ['22', 22],
    ['2222', 2222],
    ['65535', 65535],
    [' 22 ', 22],
    ['\t2222\n', 2222],
  ])('accepts %p as port %p', (text, port) => {
    expect(parseSshPortInput(text)).toEqual({ ok: true, port })
  })

  it.each(['0', '65536', '22.5', 'ssh', '', '   ', '-22', '+22', '2e3', '0x16', '22 22', '99999999999999999999', '२२'])(
    'refuses %p',
    (text) => {
      expect(parseSshPortInput(text)).toEqual({ ok: false })
    },
  )
})
