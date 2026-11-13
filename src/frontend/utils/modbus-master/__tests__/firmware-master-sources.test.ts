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
