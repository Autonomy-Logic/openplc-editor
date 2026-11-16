import type {
  GsdmlDeviceAccessPoint,
  GsdmlModule,
  GsdmlModulePlacement,
  GsdmlSubmodulePlacement,
} from '@root/middleware/shared/ports/gsdml-types'

import {
  type GsdmlCatalogContext,
  isSkippedForSchemaVersion,
  noteDanglingReference,
  readModuleInfo,
} from './gsdml-catalog-context'
import { readSystemDefinedSubmodules, readVirtualSubmodules } from './gsdml-catalog-submodules'
import { optionalSlotSet, requireAttribute, requireIdent, requireSlotSet } from './gsdml-structure'
import { attributeValue, type GsdmlXmlElement, listItems } from './gsdml-xml'

const UNSIGNED32_HEX_DIGITS = 8

/** Reads UseableModules/ModuleItemRef of a device access point, noting each target that names no ModuleItem. */
function readModulePlacements(
  dap: GsdmlXmlElement,
  dapId: string,
  context: GsdmlCatalogContext,
): GsdmlModulePlacement[] {
  return listItems(dap, 'UseableModules', 'ModuleItemRef').map((ref) => {
    const moduleId = requireAttribute(ref, 'ModuleItemRef', 'ModuleItemTarget')
    if (!context.moduleIds.has(moduleId)) {
      noteDanglingReference(context, 'ModuleItemTarget', moduleId, 'ModuleItem', dapId)
    }
    return {
      moduleId,
      allowedInSlots: optionalSlotSet(ref, 'AllowedInSlots'),
      fixedInSlots: optionalSlotSet(ref, 'FixedInSlots'),
      usedInSlots: optionalSlotSet(ref, 'UsedInSlots'),
    }
  })
}

/** Reads UseableSubmodules/SubmoduleItemRef, noting each target that names no SubmoduleList entry. */
function readSubmodulePlacements(
  parent: GsdmlXmlElement,
  parentId: string,
  context: GsdmlCatalogContext,
): GsdmlSubmodulePlacement[] {
  return listItems(parent, 'UseableSubmodules', 'SubmoduleItemRef').map((ref) => {
    const submoduleId = requireAttribute(ref, 'SubmoduleItemRef', 'SubmoduleItemTarget')
    if (!context.submoduleIds.has(submoduleId)) {
      noteDanglingReference(context, 'SubmoduleItemTarget', submoduleId, 'SubmoduleList entry', parentId)
    }
    return {
      submoduleId,
      allowedInSubslots: optionalSlotSet(ref, 'AllowedInSubslots'),
      fixedInSubslots: optionalSlotSet(ref, 'FixedInSubslots'),
      usedInSubslots: optionalSlotSet(ref, 'UsedInSubslots'),
    }
  })
}

/** Reads one DeviceAccessPointItem. */
function readDeviceAccessPoint(dap: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlDeviceAccessPoint {
  const element = 'DeviceAccessPointItem'
  const id = requireAttribute(dap, element, 'ID')
  const identNumber = requireIdent(dap, element, 'ModuleIdentNumber', UNSIGNED32_HEX_DIGITS)
  const physicalSlots = requireSlotSet(dap, element, 'PhysicalSlots')
  const fixedInSlots = requireSlotSet(dap, element, 'FixedInSlots')
  const info = readModuleInfo(dap, context)
  return {
    id,
    identNumber,
    name: info.name,
    infoText: info.infoText,
    orderNumber: info.orderNumber,
    requiredSchemaVersion: attributeValue(dap, 'RequiredSchemaVersion') ?? null,
    physicalSlots,
    fixedInSlots,
    useableModules: readModulePlacements(dap, id, context),
    virtualSubmodules: readVirtualSubmodules(dap, context),
    systemDefinedSubmodules: readSystemDefinedSubmodules(dap, context),
    useableSubmodules: readSubmodulePlacements(dap, id, context),
  }
}

/**
 * Reads DeviceAccessPointList/DeviceAccessPointItem, leaving out the ones newer than the supported schema version.
 *
 * @throws {GsdmlStructureError} When a device access point or one of its children lacks a required attribute.
 */
export function readDeviceAccessPoints(
  applicationProcess: GsdmlXmlElement,
  context: GsdmlCatalogContext,
): GsdmlDeviceAccessPoint[] {
  return listItems(applicationProcess, 'DeviceAccessPointList', 'DeviceAccessPointItem')
    .filter((dap) => !isSkippedForSchemaVersion(dap, 'DeviceAccessPointItem', context))
    .map((dap) => readDeviceAccessPoint(dap, context))
}

/** Reads one ModuleItem. */
function readModule(item: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlModule {
  const id = requireAttribute(item, 'ModuleItem', 'ID')
  const identNumber = requireIdent(item, 'ModuleItem', 'ModuleIdentNumber', UNSIGNED32_HEX_DIGITS)
  const info = readModuleInfo(item, context)
  return {
    id,
    identNumber,
    name: info.name,
    infoText: info.infoText,
    orderNumber: info.orderNumber,
    hardwareRelease: info.hardwareRelease,
    softwareRelease: info.softwareRelease,
    requiredSchemaVersion: attributeValue(item, 'RequiredSchemaVersion') ?? null,
    virtualSubmodules: readVirtualSubmodules(item, context),
    useableSubmodules: readSubmodulePlacements(item, id, context),
  }
}

/**
 * Reads ModuleList/ModuleItem, leaving out the ones newer than the supported schema version.
 *
 * @throws {GsdmlStructureError} When a module or one of its children lacks a required attribute.
 */
export function readModules(applicationProcess: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlModule[] {
  return listItems(applicationProcess, 'ModuleList', 'ModuleItem')
    .filter((item) => !isSkippedForSchemaVersion(item, 'ModuleItem', context))
    .map((item) => readModule(item, context))
}

/** The IDs of every ModuleItem, whatever its schema version. */
export function moduleListIds(applicationProcess: GsdmlXmlElement): Set<string> {
  const ids = new Set<string>()
  for (const item of listItems(applicationProcess, 'ModuleList', 'ModuleItem')) {
    const id = attributeValue(item, 'ID')
    if (id !== undefined) ids.add(id)
  }
  return ids
}
