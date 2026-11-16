import type {
  GsdmlDeviceAccessPoint,
  GsdmlModule,
  GsdmlModulePlacement,
  GsdmlSubmodulePlacement,
} from '@root/middleware/shared/ports/gsdml-types'

import {
  type GsdmlCatalogContext,
  type GsdmlTargetIds,
  isSkippedForSchemaVersion,
  noteDanglingReference,
  readModuleInfo,
  targetIdsOf,
} from './gsdml-catalog-context'
import { readSystemDefinedSubmodules, readVirtualSubmodules } from './gsdml-catalog-submodules'
import {
  optionalSlotSet,
  requireAttribute,
  requireIdent,
  requireSlotSet,
  UNSIGNED32_HEX_DIGITS,
} from './gsdml-structure'
import { attributeValue, type GsdmlXmlElement, listItems } from './gsdml-xml'

/**
 * Whether a placement stays in the catalog. A target skipped for its RequiredSchemaVersion drops it without a notice;
 * a target that names no element keeps it, with one `dangling-reference` notice.
 */
function keepsPlacement(
  ids: GsdmlTargetIds,
  context: GsdmlCatalogContext,
  reference: string,
  target: string,
  targetElement: string,
  ownerId: string,
): boolean {
  if (ids.kept.has(target)) return true
  if (ids.skipped.has(target)) return false
  noteDanglingReference(context, reference, target, targetElement, ownerId)
  return true
}

/**
 * Reads UseableModules/ModuleItemRef of a device access point, leaving out the ones whose ModuleItem was skipped and
 * noting each target that names no ModuleItem.
 */
function readModulePlacements(
  dap: GsdmlXmlElement,
  dapId: string,
  context: GsdmlCatalogContext,
): GsdmlModulePlacement[] {
  const placements: GsdmlModulePlacement[] = []
  for (const ref of listItems(dap, 'UseableModules', 'ModuleItemRef')) {
    const moduleId = requireAttribute(ref, 'ModuleItemRef', 'ModuleItemTarget')
    if (!keepsPlacement(context.moduleIds, context, 'ModuleItemTarget', moduleId, 'ModuleItem', dapId)) continue
    placements.push({
      moduleId,
      allowedInSlots: optionalSlotSet(ref, 'AllowedInSlots'),
      fixedInSlots: optionalSlotSet(ref, 'FixedInSlots'),
      usedInSlots: optionalSlotSet(ref, 'UsedInSlots'),
    })
  }
  return placements
}

/**
 * Reads UseableSubmodules/SubmoduleItemRef, leaving out the ones whose SubmoduleList entry was skipped and noting each
 * target that names no SubmoduleList entry.
 */
function readSubmodulePlacements(
  parent: GsdmlXmlElement,
  parentId: string,
  context: GsdmlCatalogContext,
): GsdmlSubmodulePlacement[] {
  const placements: GsdmlSubmodulePlacement[] = []
  for (const ref of listItems(parent, 'UseableSubmodules', 'SubmoduleItemRef')) {
    const submoduleId = requireAttribute(ref, 'SubmoduleItemRef', 'SubmoduleItemTarget')
    const entry = 'SubmoduleList entry'
    if (!keepsPlacement(context.submoduleIds, context, 'SubmoduleItemTarget', submoduleId, entry, parentId)) continue
    placements.push({
      submoduleId,
      allowedInSubslots: optionalSlotSet(ref, 'AllowedInSubslots'),
      fixedInSubslots: optionalSlotSet(ref, 'FixedInSubslots'),
      usedInSubslots: optionalSlotSet(ref, 'UsedInSubslots'),
    })
  }
  return placements
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

/** The IDs of the ModuleItems, split by whether the catalog holds them or skips them for their schema version. */
export function moduleListIds(applicationProcess: GsdmlXmlElement): GsdmlTargetIds {
  return targetIdsOf(listItems(applicationProcess, 'ModuleList', 'ModuleItem'))
}
