import type { PLCServer, S7CommSlaveConfig } from '../../../../middleware/shared/ports/types'
import { generateS7CommConfig } from '../index'

const makeMinimalS7CommConfig = (): S7CommSlaveConfig => ({
  server: {
    enabled: true,
    bindAddress: '0.0.0.0',
    port: 102,
    maxClients: 10,
    workIntervalMs: 100,
    sendTimeoutMs: 5000,
    recvTimeoutMs: 5000,
    pingTimeoutMs: 30000,
    pduSize: 480,
  },
  dataBlocks: [
    {
      dbNumber: 1,
      description: 'Data Block 1',
      sizeBytes: 256,
      mapping: {
        type: 'output',
        startBuffer: 0,
        bitAddressing: false,
      },
    },
  ],
})

const makeFullS7CommConfig = (): S7CommSlaveConfig => ({
  ...makeMinimalS7CommConfig(),
  plcIdentity: {
    name: 'OpenPLC',
    moduleType: 'IM 151-8 PN/DP CPU',
    serialNumber: 'S C-C2UR28922012',
    copyright: 'Original Siemens Equipment',
    moduleName: 'CPU 315-2 PN/DP',
  },
  systemAreas: {
    peArea: {
      enabled: true,
      sizeBytes: 128,
      mapping: {
        type: 'input',
        startBuffer: 0,
        bitAddressing: false,
      },
    },
    paArea: {
      enabled: true,
      sizeBytes: 128,
      mapping: {
        type: 'output',
        startBuffer: 0,
        bitAddressing: false,
      },
    },
    mkArea: {
      enabled: true,
      sizeBytes: 256,
      mapping: {
        type: 'memory',
        startBuffer: 0,
        bitAddressing: false,
      },
    },
  },
  logging: {
    logConnections: true,
    logDataAccess: false,
    logErrors: true,
  },
})

const makeS7CommServer = (config?: S7CommSlaveConfig): PLCServer => ({
  name: 'S7CommServer',
  protocol: 's7comm',
  s7commSlaveConfig: config || makeMinimalS7CommConfig(),
})

describe('generateS7CommConfig', () => {
  it('returns null for undefined servers', () => {
    expect(generateS7CommConfig(undefined)).toBeNull()
  })

  it('returns null for empty servers array', () => {
    expect(generateS7CommConfig([])).toBeNull()
  })

  it('returns null when no s7comm server exists', () => {
    const servers: PLCServer[] = [{ name: 'Modbus', protocol: 'modbus-tcp' }]
    expect(generateS7CommConfig(servers)).toBeNull()
  })

  it('returns null when s7comm server has no slave config', () => {
    const servers: PLCServer[] = [{ name: 'S7', protocol: 's7comm' }]
    expect(generateS7CommConfig(servers)).toBeNull()
  })

  it('generates minimal config with server and data blocks', () => {
    const result = generateS7CommConfig([makeS7CommServer()])

    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)

    // Server config
    expect(parsed.server.enabled).toBe(true)
    expect(parsed.server.bind_address).toBe('0.0.0.0')
    expect(parsed.server.port).toBe(102)
    expect(parsed.server.max_clients).toBe(10)
    expect(parsed.server.work_interval_ms).toBe(100)
    expect(parsed.server.send_timeout_ms).toBe(5000)
    expect(parsed.server.recv_timeout_ms).toBe(5000)
    expect(parsed.server.ping_timeout_ms).toBe(30000)
    expect(parsed.server.pdu_size).toBe(480)

    // Data blocks
    expect(parsed.data_blocks).toHaveLength(1)
    expect(parsed.data_blocks[0].db_number).toBe(1)
    expect(parsed.data_blocks[0].description).toBe('Data Block 1')
    expect(parsed.data_blocks[0].size_bytes).toBe(256)
    expect(parsed.data_blocks[0].mapping.type).toBe('output')
    expect(parsed.data_blocks[0].mapping.start_buffer).toBe(0)
  })

  it('does not include bit_addressing when bitAddressing is false', () => {
    const result = generateS7CommConfig([makeS7CommServer()])
    const parsed = JSON.parse(result!)

    expect(parsed.data_blocks[0].mapping.bit_addressing).toBeUndefined()
  })

  it('includes bit_addressing when bitAddressing is true', () => {
    const config = makeMinimalS7CommConfig()
    config.dataBlocks[0].mapping.bitAddressing = true

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.data_blocks[0].mapping.bit_addressing).toBe(true)
  })

  it('includes plc_identity when present', () => {
    const result = generateS7CommConfig([makeS7CommServer(makeFullS7CommConfig())])
    const parsed = JSON.parse(result!)

    expect(parsed.plc_identity).toBeDefined()
    expect(parsed.plc_identity.name).toBe('OpenPLC')
    expect(parsed.plc_identity.module_type).toBe('IM 151-8 PN/DP CPU')
    expect(parsed.plc_identity.serial_number).toBe('S C-C2UR28922012')
    expect(parsed.plc_identity.copyright).toBe('Original Siemens Equipment')
    expect(parsed.plc_identity.module_name).toBe('CPU 315-2 PN/DP')
  })

  it('omits plc_identity when not present', () => {
    const result = generateS7CommConfig([makeS7CommServer()])
    const parsed = JSON.parse(result!)

    expect(parsed.plc_identity).toBeUndefined()
  })

  it('includes all system areas when present', () => {
    const result = generateS7CommConfig([makeS7CommServer(makeFullS7CommConfig())])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas).toBeDefined()
    expect(parsed.system_areas.pe_area.enabled).toBe(true)
    expect(parsed.system_areas.pe_area.size_bytes).toBe(128)
    expect(parsed.system_areas.pe_area.mapping.type).toBe('input')
    expect(parsed.system_areas.pe_area.mapping.start_buffer).toBe(0)

    expect(parsed.system_areas.pa_area.enabled).toBe(true)
    expect(parsed.system_areas.pa_area.size_bytes).toBe(128)
    expect(parsed.system_areas.pa_area.mapping.type).toBe('output')

    expect(parsed.system_areas.mk_area.enabled).toBe(true)
    expect(parsed.system_areas.mk_area.size_bytes).toBe(256)
    expect(parsed.system_areas.mk_area.mapping.type).toBe('memory')
  })

  it('omits system_areas when not present', () => {
    const result = generateS7CommConfig([makeS7CommServer()])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas).toBeUndefined()
  })

  it('includes logging when present', () => {
    const result = generateS7CommConfig([makeS7CommServer(makeFullS7CommConfig())])
    const parsed = JSON.parse(result!)

    expect(parsed.logging).toBeDefined()
    expect(parsed.logging.log_connections).toBe(true)
    expect(parsed.logging.log_data_access).toBe(false)
    expect(parsed.logging.log_errors).toBe(true)
  })

  it('omits logging when not present', () => {
    const result = generateS7CommConfig([makeS7CommServer()])
    const parsed = JSON.parse(result!)

    expect(parsed.logging).toBeUndefined()
  })

  it('handles system areas with only peArea defined', () => {
    const config = makeMinimalS7CommConfig()
    config.systemAreas = {
      peArea: {
        enabled: true,
        sizeBytes: 64,
        mapping: { type: 'input', startBuffer: 0, bitAddressing: false },
      },
    }

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas).toBeDefined()
    expect(parsed.system_areas.pe_area).toBeDefined()
    expect(parsed.system_areas.pa_area).toBeUndefined()
    expect(parsed.system_areas.mk_area).toBeUndefined()
  })

  it('handles system areas with only paArea defined', () => {
    const config = makeMinimalS7CommConfig()
    config.systemAreas = {
      paArea: {
        enabled: false,
        sizeBytes: 32,
        mapping: { type: 'output', startBuffer: 10, bitAddressing: false },
      },
    }

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas.pa_area.enabled).toBe(false)
    expect(parsed.system_areas.pa_area.size_bytes).toBe(32)
    expect(parsed.system_areas.pa_area.mapping.start_buffer).toBe(10)
  })

  it('handles system areas with only mkArea defined', () => {
    const config = makeMinimalS7CommConfig()
    config.systemAreas = {
      mkArea: {
        enabled: true,
        sizeBytes: 512,
      },
    }

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas.mk_area.enabled).toBe(true)
    expect(parsed.system_areas.mk_area.size_bytes).toBe(512)
    expect(parsed.system_areas.mk_area.mapping).toBeUndefined()
  })

  it('omits system_areas when systemAreas object has no areas defined', () => {
    const config = makeMinimalS7CommConfig()
    config.systemAreas = {}

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas).toBeUndefined()
  })

  it('handles system area without mapping', () => {
    const config = makeMinimalS7CommConfig()
    config.systemAreas = {
      peArea: {
        enabled: true,
        sizeBytes: 64,
      },
    }

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas.pe_area.enabled).toBe(true)
    expect(parsed.system_areas.pe_area.size_bytes).toBe(64)
    expect(parsed.system_areas.pe_area.mapping).toBeUndefined()
  })

  it('handles multiple data blocks', () => {
    const config = makeMinimalS7CommConfig()
    config.dataBlocks.push({
      dbNumber: 2,
      description: 'Data Block 2',
      sizeBytes: 512,
      mapping: { type: 'memory', startBuffer: 256, bitAddressing: true },
    })

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.data_blocks).toHaveLength(2)
    expect(parsed.data_blocks[1].db_number).toBe(2)
    expect(parsed.data_blocks[1].mapping.bit_addressing).toBe(true)
  })

  it('finds the s7comm server in a mixed servers array', () => {
    const servers: PLCServer[] = [
      { name: 'Modbus', protocol: 'modbus-tcp' },
      makeS7CommServer(),
      { name: 'OPC-UA', protocol: 'opcua' },
    ]

    const result = generateS7CommConfig(servers)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.server.port).toBe(102)
  })

  it('generates valid JSON output', () => {
    const result = generateS7CommConfig([makeS7CommServer(makeFullS7CommConfig())])
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  it('handles paArea without mapping', () => {
    const config = makeMinimalS7CommConfig()
    config.systemAreas = {
      paArea: { enabled: true, sizeBytes: 64 },
    }

    const result = generateS7CommConfig([makeS7CommServer(config)])
    const parsed = JSON.parse(result!)

    expect(parsed.system_areas.pa_area.mapping).toBeUndefined()
  })
})
