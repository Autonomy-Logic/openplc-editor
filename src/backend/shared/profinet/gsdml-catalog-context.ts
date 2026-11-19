import type { GsdmlParameterEnumOption } from '@root/middleware/shared/ports/gsdml-types'

import { gsdmlNotice, type GsdmlNoticeLog } from './gsdml-notices'
import { requireAttribute } from './gsdml-structure'
import type { GsdmlTextResolver } from './gsdml-text'
import { GSDML_SUPPORTED_SCHEMA_VERSION, isNewerSchemaVersion } from './gsdml-version'
import { attributeValue, childElement, childElements, type GsdmlXmlElement, listItems } from './gsdml-xml'

/** One Assign of a ValueItem, with its text id still unresolved. */
interface ValueAssignment {
  readonly content: string
  readonly textId: string
}

/** The ValueItems of ApplicationProcess/ValueList, resolved to enum options on first use. */
export class GsdmlValueList {
  private readonly assignments: ReadonlyMap<string, readonly ValueAssignment[]>
  private readonly resolved = new Map<string, readonly GsdmlParameterEnumOption[]>()

  private constructor(assignments: ReadonlyMap<string, readonly ValueAssignment[]>) {
    this.assignments = assignments
  }

  /**
   * Reads ApplicationProcess/ValueList.
   *
   * @throws {GsdmlStructureError} When a ValueItem lacks ID or an Assign lacks Content.
   */
  static read(applicationProcess: GsdmlXmlElement): GsdmlValueList {
    const assignments = new Map<string, readonly ValueAssignment[]>()
    for (const item of listItems(applicationProcess, 'ValueList', 'ValueItem')) {
      const id = requireAttribute(item, 'ValueItem', 'ID')
      const assigns = childElements(childElement(item, 'Assignments') ?? {}, 'Assign').map((assign) => ({
        content: requireAttribute(assign, 'Assign', 'Content'),
        textId: attributeValue(assign, 'TextId') ?? '',
      }))
      if (!assignments.has(id)) assignments.set(id, assigns)
    }
    return new GsdmlValueList(assignments)
  }

  /** Whether a ValueItem has the given ID. */
  has(id: string): boolean {
    return this.assignments.has(id)
  }

  /** The enum options of a ValueItem; empty when no ValueItem has the ID. */
  options(id: string, texts: GsdmlTextResolver): readonly GsdmlParameterEnumOption[] {
    const cached = this.resolved.get(id)
    if (cached !== undefined) return cached
    const options = (this.assignments.get(id) ?? []).map((assign) => ({
      value: assign.content,
      text: texts.resolve(assign.textId),
    }))
    this.resolved.set(id, options)
    return options
  }
}

/** What every catalog builder reads besides the element it builds. */
export interface GsdmlCatalogContext {
  readonly texts: GsdmlTextResolver
  readonly notices: GsdmlNoticeLog
  readonly valueList: GsdmlValueList
  /** The IDs of the ModuleItems, split by whether the catalog holds them. */
  readonly moduleIds: GsdmlTargetIds
  /** The IDs of the SubmoduleList entries, split by whether the catalog holds them. */
  readonly submoduleIds: GsdmlTargetIds
  /**
   * Whether the file's schema version is newer than the supported one (Annex A.3.3 compatibility mode); false when the
   * schema location names no version.
   */
  readonly compatibilityMode: boolean
}

/** The IDs of the elements a reference may name, split by whether the catalog holds them. */
export interface GsdmlTargetIds {
  /** IDs of at least one element the catalog holds. */
  readonly kept: ReadonlySet<string>
  /** IDs whose every element was skipped for its RequiredSchemaVersion; none of them is in `kept`. */
  readonly skipped: ReadonlySet<string>
}

/** The RequiredSchemaVersion of an object when it is newer than the supported one; undefined otherwise. */
function newerRequiredSchemaVersion(element: GsdmlXmlElement): string | undefined {
  const required = attributeValue(element, 'RequiredSchemaVersion')
  return required !== undefined && isNewerSchemaVersion(required) ? required : undefined
}

/** Splits the IDs of the given elements into those the catalog holds and those skipped for their schema version. */
export function targetIdsOf(elements: readonly GsdmlXmlElement[]): GsdmlTargetIds {
  const kept = new Set<string>()
  const skipped = new Set<string>()
  for (const element of elements) {
    const id = attributeValue(element, 'ID')
    if (id === undefined) continue
    if (newerRequiredSchemaVersion(element) === undefined) kept.add(id)
    else skipped.add(id)
  }
  for (const id of kept) skipped.delete(id)
  return { kept, skipped }
}

/**
 * Whether an object requires a schema version newer than the supported one. Such an object is left out unchecked,
 * with one `object-skipped` notice.
 */
export function isSkippedForSchemaVersion(
  element: GsdmlXmlElement,
  elementName: string,
  context: GsdmlCatalogContext,
): boolean {
  const required = newerRequiredSchemaVersion(element)
  if (required === undefined) return false
  const id = attributeValue(element, 'ID')
  const subject = id === undefined ? elementName : `${elementName} "${id}"`
  context.notices.add(
    gsdmlNotice(
      'object-skipped',
      `${subject} requires schema version ${required}, newer than the supported ${GSDML_SUPPORTED_SCHEMA_VERSION}; it was left out.`,
      id,
      required,
    ),
  )
  return true
}

/** Records a `dangling-reference` notice for a reference that names no element. */
export function noteDanglingReference(
  context: GsdmlCatalogContext,
  reference: string,
  target: string,
  targetElement: string,
  ownerId: string,
): void {
  context.notices.add(
    gsdmlNotice(
      'dangling-reference',
      `${reference} "${target}" of "${ownerId}" names no ${targetElement}.`,
      ownerId,
      target,
    ),
  )
}

/** The texts and release values of the ModuleInfo of an element. */
export interface GsdmlModuleInfo {
  readonly name: string
  readonly infoText: string
  readonly orderNumber: string
  readonly hardwareRelease: string
  readonly softwareRelease: string
}

/** The Value attribute of a ModuleInfo child; empty when absent. */
function valueOf(moduleInfo: GsdmlXmlElement | undefined, childName: string): string {
  const child = moduleInfo === undefined ? undefined : childElement(moduleInfo, childName)
  return child === undefined ? '' : (attributeValue(child, 'Value') ?? '')
}

/** Reads the ModuleInfo of an element; the name falls back to the element's own TextId when ModuleInfo has no Name. */
export function readModuleInfo(element: GsdmlXmlElement, context: GsdmlCatalogContext): GsdmlModuleInfo {
  const moduleInfo = childElement(element, 'ModuleInfo')
  const nameElement = moduleInfo === undefined ? undefined : childElement(moduleInfo, 'Name')
  return {
    name: context.texts.resolveTextIdOf(nameElement ?? element),
    infoText: moduleInfo === undefined ? '' : context.texts.resolveChild(moduleInfo, 'InfoText'),
    orderNumber: valueOf(moduleInfo, 'OrderNumber'),
    hardwareRelease: valueOf(moduleInfo, 'HardwareRelease'),
    softwareRelease: valueOf(moduleInfo, 'SoftwareRelease'),
  }
}
