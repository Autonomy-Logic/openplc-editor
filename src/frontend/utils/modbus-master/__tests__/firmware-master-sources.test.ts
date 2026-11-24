import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const FIRMWARE_ROOT = FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'arduino', 's7comm_config.h')))

if (FIRMWARE_ROOT === undefined) {
  throw new Error(`Firmware sources not found. Looked in:\n${FIRMWARE_ROOTS.join('\n')}`)
}

const BAREMETAL_DIR = join(FIRMWARE_ROOT, 'Baremetal')
const ARDUINO_DIR = join(FIRMWARE_ROOT, 'arduino')

const MASTER_FILES = ['modbus_master.h', 'modbus_master.cpp', 'modbus_master_tcp.h', 'modbus_master_tcp.cpp']

const SOURCE_FILE = /\.(h|hpp|c|cpp|ino)$/

/** C and C++ source with comments, string and character literals blanked, so only code is searched. */
const codeOf = (source: string): string =>
  source
    .replace(/\\\r?\n/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, '')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")

const readBaremetal = (name: string): string => readFileSync(join(BAREMETAL_DIR, name), 'utf-8')

/** Every C and C++ source of the firmware, as `[folder, file name]`. */
const FIRMWARE_SOURCES: Array<[string, string]> = [BAREMETAL_DIR, ARDUINO_DIR].flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => SOURCE_FILE.test(name))
    .map((name): [string, string] => [dir === BAREMETAL_DIR ? 'Baremetal' : 'arduino', name]),
)

const readSource = (folder: string, name: string): string =>
  readFileSync(join(folder === 'Baremetal' ? BAREMETAL_DIR : ARDUINO_DIR, name), 'utf-8')

/** The identifiers and headers that name a concrete network stack. */
const NETWORK_NAMES = [
  'WiFiClient',
  'WiFiServer',
  'WiFiSSLClient',
  'WiFiUDP',
  'WiFiNINA',
  'WiFiS3',
  'EthernetClient',
  'EthernetServer',
  'EthernetUDP',
  'EthernetENC',
  'NetworkClient',
  'NetworkServer',
  'TCPSocket',
  'SocketAddress',
  'ESP8266WiFi',
  'WiFi',
  'Ethernet',
  'ETH',
  'O_NONBLOCK',
  'fcntl',
  'set_blocking',
  'setConnectionTimeout',
  'ServerDrv',
  'WiFiSocketBuffer',
]

const NETWORK_HEADER = /#\s*include\s*<\s*(?:WiFi|Ethernet|ESP8266WiFi|NetworkClient|Network\.h|SPI\.h|lwip\/|mbed)/

const DNS_NAMES = [
  'hostByName',
  'gethostbyname',
  'gethostbyname_r',
  'getaddrinfo',
  'dns_gethostbyname',
  'netconn_gethostbyname',
  'DNSClient',
]

const MARKERS = /\b(TODO|FIXME|XXX|HACK)\b/

describe('Modbus master firmware modules', () => {
  it.each(MASTER_FILES)('ships Baremetal/%s', (name) => {
    expect(existsSync(join(BAREMETAL_DIR, name))).toBe(true)
  })
})

describe('NFR10: only baremetal_net names a network class', () => {
  it.each(MASTER_FILES)('%s names no concrete network class or network mechanism', (name) => {
    const code = codeOf(readBaremetal(name))
    const named = NETWORK_NAMES.filter((identifier) => new RegExp(`\\b${identifier}\\b`).test(code))
    expect(named).toEqual([])
  })

  it.each(MASTER_FILES)('%s includes no network library header', (name) => {
    expect(codeOf(readBaremetal(name))).not.toMatch(NETWORK_HEADER)
  })
})

/** Whether `offset` in `code` lies inside the braces of a `namespace bm_net` block opened before it. */
function insideBmNet(code: string, offset: number): boolean {
  for (const opening of code.slice(0, offset).matchAll(/\bnamespace\s+bm_net\s*\{/g)) {
    const inner = code.slice((opening.index ?? 0) + opening[0].length, offset)
    let depth = 1
    for (const brace of inner) {
      if (brace === '{') depth += 1
      if (brace === '}') depth -= 1
      if (depth === 0) break
    }
    if (depth > 0) return true
  }
  return false
}

/** Names of the network link state the master must leave to the seam. */
const LINK_STATE_NAMES = ['WL_CONNECTED', 'linkStatus', 'linkUp', 'LinkOFF']

describe('MT-7: the master asks the seam for the link', () => {
  it('declares bool link_up() in namespace bm_net in baremetal_net.h', () => {
    const code = codeOf(readBaremetal('baremetal_net.h'))
    const declaration = /\bbool\s+link_up\s*\(\s*(?:void)?\s*\)\s*;/.exec(code)
    expect({
      declared: declaration !== null,
      inBmNet: declaration !== null && insideBmNet(code, declaration.index),
    }).toEqual({ declared: true, inBmNet: true })
  })

  it('calls bm_net::link_up() from modbus_master_tcp.cpp', () => {
    expect(codeOf(readBaremetal('modbus_master_tcp.cpp'))).toMatch(/\bbm_net::link_up\s*\(\s*\)/)
  })

  it.each(MASTER_FILES)('%s names no link state of a network library', (name) => {
    const code = codeOf(readBaremetal(name))
    expect(LINK_STATE_NAMES.filter((identifier) => new RegExp(`\\b${identifier}\\b`).test(code))).toEqual([])
  })
})

describe("M3: the master keeps its own buffers, never the server's frame", () => {
  it.each(MASTER_FILES)('%s does not touch mb_frame or mb_frame_len', (name) => {
    expect(codeOf(readBaremetal(name))).not.toMatch(/\bmb_frame(_len)?\b/)
  })
})

describe('NFR03: no DNS anywhere in the firmware', () => {
  it.each(FIRMWARE_SOURCES)('%s/%s resolves no host name', (folder, name) => {
    const code = codeOf(readSource(folder, name))
    const named = DNS_NAMES.filter((identifier) => new RegExp(`\\b${identifier}\\b`).test(code))
    expect(named).toEqual([])
  })
})

describe('no pending-work markers in the firmware sources', () => {
  it.each(FIRMWARE_SOURCES)('%s/%s carries no TODO, FIXME, XXX or HACK', (folder, name) => {
    expect(readSource(folder, name)).not.toMatch(MARKERS)
  })
})

describe('P07-1: WiFiNINA sends are metered', () => {
  it('leaves BM_NET_SEND_UNMETERED in no firmware source', () => {
    const naming = FIRMWARE_SOURCES.filter(([folder, name]) =>
      readSource(folder, name).includes('BM_NET_SEND_UNMETERED'),
    )
    expect(naming.map(([folder, name]) => `${folder}/${name}`)).toEqual([])
  })

  it("calls the module's waiting checkDataSent() from no Baremetal source", () => {
    const calling = FIRMWARE_SOURCES.filter(
      ([folder, name]) => folder === 'Baremetal' && /\bcheckDataSent\s*\(/.test(codeOf(readSource(folder, name))),
    )
    expect(calling.map(([, name]) => name)).toEqual([])
  })
})

const MASTER_UNITS = ['modbus_master.cpp', 'modbus_master_tcp.cpp', 'modbus_master_rtu.cpp']

const MASTER_HELPERS = ['reached', 'put16', 'get16']

const BAREMETAL_SOURCES = readdirSync(BAREMETAL_DIR).filter((name) => SOURCE_FILE.test(name))

/** A definition of `helper` at the start of a line: one or more type words, the name, its parameters, a brace. */
const definitionOf = (helper: string): RegExp =>
  new RegExp(`^[ \\t]*(?:[A-Za-z_][\\w:]*[ \\t*&]+)+${helper}\\s*\\([^()]*\\)\\s*\\{`, 'm')

/** The Baremetal files that define `helper`. */
const definersOf = (helper: string): string[] =>
  BAREMETAL_SOURCES.filter((name) => definitionOf(helper).test(codeOf(readBaremetal(name))))

/** The one Baremetal header that defines every master helper; throws when there is none. */
function masterHelperHeader(): string {
  const definers = MASTER_HELPERS.map(definersOf)
  const header = definers[0][0]
  if (
    header === undefined ||
    !header.endsWith('.h') ||
    !definers.every((files) => files.length === 1 && files[0] === header)
  ) {
    throw new Error(`no single Baremetal header defines ${MASTER_HELPERS.join(', ')}: ${JSON.stringify(definers)}`)
  }
  return header
}

/** Comments blanked but string literals kept, so quoted include names survive. */
const codeOfIncludes = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '')

/** The targets of every `#include` in `source`, as written, e.g. `<stdint.h>` or `"modbus_master.h"`. */
const includesOf = (source: string): string[] =>
  [...codeOfIncludes(source).matchAll(/^[ \t]*#\s*include\s*([<"][^>"]+[>"])/gm)].map((match) => match[1])

describe('P07-4: the master helpers live in one internal header', () => {
  it('defines reached, put16 and get16 in exactly one Baremetal file, a header', () => {
    const definers = Object.fromEntries(MASTER_HELPERS.map((helper) => [helper, definersOf(helper)]))
    const header = definers.reached[0] ?? '<none>'
    expect({ header: header.endsWith('.h'), definers }).toEqual({
      header: true,
      definers: { reached: [header], put16: [header], get16: [header] },
    })
  })

  it('defines each helper static inline', () => {
    const code = codeOf(readBaremetal(masterHelperHeader()))
    const notStaticInline = MASTER_HELPERS.filter((helper) => {
      const line = definitionOf(helper).exec(code)?.[0] ?? ''
      return !/\bstatic\b/.test(line) || !/\binline\b/.test(line)
    })
    expect(notStaticInline).toEqual([])
  })

  it('includes only <stdint.h> in the helper header', () => {
    expect(includesOf(readBaremetal(masterHelperHeader()))).toEqual(['<stdint.h>'])
  })

  it('opens the helper header with the SPDX line of the other firmware files', () => {
    expect(readBaremetal(masterHelperHeader()).split('\n')[0]).toBe('// SPDX-License-Identifier: GPL-3.0-only')
  })

  it.each(MASTER_UNITS)('%s includes the helper header', (name) => {
    expect(includesOf(readBaremetal(name))).toContain(`"${masterHelperHeader()}"`)
  })
})
