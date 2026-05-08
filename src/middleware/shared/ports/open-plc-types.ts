/**
 * PLC project types used by the XML generator and related frontend utilities.
 *
 * These mirror the editor's Zod-inferred shapes from types/PLC/open-plc.ts
 * and are the canonical format for PLC project data in both repos.
 */

import type {
  OpcUaFieldConfig,
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  OpcUaTrustedCertificate,
  OpcUaUser,
  PLCDataType,
  PLCInstance,
  PLCRemoteDevice,
  PLCServer,
  PLCTask,
  PLCVariable,
} from './types'

// ---------------------------------------------------------------------------
// POU body — discriminated by language
// ---------------------------------------------------------------------------

export type PLCBody =
  | { language: 'il'; value: string }
  | { language: 'st'; value: string }
  | { language: 'ld'; value: { name: string; rungs: unknown[] } }
  | { language: 'fbd'; value: { name: string; rung: unknown } }
  | { language: 'sfc'; value: string }
  | { language: 'python'; value: string }
  | { language: 'cpp'; value: string }

// ---------------------------------------------------------------------------
// POU variants
// ---------------------------------------------------------------------------

export interface PLCProgram {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
  name: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCFunction {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
  name: string
  returnType: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCFunctionBlock {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
  name: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

// ---------------------------------------------------------------------------
// Discriminated-union POU
// ---------------------------------------------------------------------------

export type PLCPou =
  | { type: 'program'; data: PLCProgram }
  | { type: 'function'; data: PLCFunction }
  | { type: 'function-block'; data: PLCFunctionBlock }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PLCConfiguration {
  resource: {
    tasks: PLCTask[]
    instances: PLCInstance[]
    globalVariables: PLCVariable[]
  }
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface PLCProjectData {
  dataTypes: PLCDataType[]
  pous: PLCPou[]
  configuration: PLCConfiguration
  servers?: PLCServer[]
  remoteDevices?: PLCRemoteDevice[]
  debugVariables?: Record<string, unknown>
  deletedPous?: Array<{
    name: string
    type: 'program' | 'function' | 'function-block'
    language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
  }>
  deletedServers?: Array<{ name: string; protocol: string }>
  deletedRemoteDevices?: Array<{ name: string; protocol: string }>
}

export interface PLCProjectMeta {
  name: string
  type: 'plc-project' | 'plc-library'
}

export interface PLCProject {
  meta: PLCProjectMeta
  data: PLCProjectData
}

// ---------------------------------------------------------------------------
// Re-exports from ports/types.ts for convenience
// ---------------------------------------------------------------------------

export type {
  OpcUaFieldConfig,
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  OpcUaTrustedCertificate,
  OpcUaUser,
  PLCDataType,
  PLCInstance,
  PLCRemoteDevice,
  PLCServer,
  PLCTask,
  PLCVariable,
}
