import { isSshGreeting } from '../ssh-greeting'

describe('isSshGreeting', () => {
  it.each([
    ['an OpenSSH 2.0 greeting', 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13\r\n'],
    ['a 1.99 compatibility greeting', 'SSH-1.99-Cisco-1.25\r\n'],
    ['a greeting with no line ending', 'SSH-2.0-dropbear_2022.83'],
    ['a greeting ending with LF only', 'SSH-2.0-dropbear_2022.83\n'],
    ['a greeting after banner lines', 'Welcome to the PLC\r\nAuthorized use only\r\nSSH-2.0-OpenSSH_8.4\r\n'],
    ['a bare version prefix', 'SSH-2.0-'],
  ])('recognizes %s', (_, text) => {
    expect(isSshGreeting(text)).toBe(true)
  })

  it.each([
    ['empty text', ''],
    ['an HTTP reply', 'HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'],
    ['an SSH 1.5 greeting', 'SSH-1.5-x\r\n'],
    ['a lowercase prefix', 'ssh-2.0-OpenSSH_9.6\r\n'],
    ['a greeting not at the start of a line', 'banner SSH-2.0-OpenSSH_9.6\r\n'],
    ['a greeting after a leading space', ' SSH-2.0-OpenSSH_9.6\r\n'],
    ['lines separated by CR only', 'Welcome\rSSH-2.0-OpenSSH_9.6'],
    ['a version without its trailing dash', 'SSH-2.0\r\n'],
    ['random bytes', '\u0000\u0001\u0002binary'],
  ])('refuses %s', (_, text) => {
    expect(isSshGreeting(text)).toBe(false)
  })
})
