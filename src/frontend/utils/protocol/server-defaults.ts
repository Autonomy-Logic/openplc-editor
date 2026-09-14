/**
 * The values a newly created server starts with.
 *
 * Here rather than in the store slice because both the store's `createServer`
 * and the CLI's spec normalizer need them, and they sit in layers that cannot
 * import each other. A second copy would drift.
 *
 * Every protocol defaults to `enabled: false` — a server appears in the project
 * before it is switched on, and for Modbus and OPC-UA the enable flag decides
 * whether the runtime gets a config file at all.
 */

import type {
  OpcUaServerConfig,
  S7CommLogging,
  S7CommPlcIdentity,
  S7CommServerSettings,
} from '../../../middleware/shared/ports/types'

export const DEFAULT_MODBUS_SLAVE_CONFIG = {
  enabled: false,
  networkInterface: '0.0.0.0',
  port: 502,
} as const

export const DEFAULT_S7COMM_SERVER_SETTINGS: S7CommServerSettings = {
  enabled: false,
  bindAddress: '0.0.0.0',
  port: 102,
  maxClients: 32,
  workIntervalMs: 100,
  sendTimeoutMs: 3000,
  recvTimeoutMs: 3000,
  pingTimeoutMs: 10000,
  pduSize: 480,
}

export const DEFAULT_S7COMM_PLC_IDENTITY: S7CommPlcIdentity = {
  name: 'OpenPLC Runtime',
  moduleType: 'CPU 315-2 PN/DP',
  serialNumber: 'S C-OPENPLC01',
  copyright: 'OpenPLC Project',
  moduleName: 'OpenPLC',
}

export const DEFAULT_S7COMM_LOGGING: S7CommLogging = {
  logConnections: true,
  logDataAccess: false,
  logErrors: true,
}

export const DEFAULT_OPCUA_SERVER_CONFIG: OpcUaServerConfig = {
  server: {
    enabled: false,
    name: 'OpenPLC OPC UA Server',
    applicationUri: 'urn:openplc:opcua:server',
    productUri: 'urn:openplc:runtime',
    bindAddress: '0.0.0.0',
    port: 4840,
    endpointPath: '/openplc/opcua',
  },
  securityProfiles: [
    {
      id: 'default-insecure',
      name: 'insecure',
      enabled: true,
      securityPolicy: 'None',
      securityMode: 'None',
      authMethods: ['Anonymous'],
    },
  ],
  security: {
    serverCertificateStrategy: 'auto_self_signed',
    serverCertificateCustom: null,
    serverPrivateKeyCustom: null,
    trustedClientCertificates: [],
  },
  users: [],
  cycleTimeMs: 100,
  addressSpace: {
    namespaceUri: 'urn:openplc:opcua:namespace',
    nodes: [],
  },
}

/** What `createRemoteDevice` seeds a Modbus TCP device with. */
export const DEFAULT_MODBUS_TCP_DEVICE_CONFIG = {
  host: '127.0.0.1',
  port: 502,
  slaveId: 1,
  timeout: 1000,
} as const
