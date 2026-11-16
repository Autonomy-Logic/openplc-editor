import { gsdmlNotice, type GsdmlNoticeLog } from './gsdml-notices'
import { requireAttribute } from './gsdml-structure'
import { attributeValue, childElement, childElements, type GsdmlXmlElement } from './gsdml-xml'

/** Resolves text ids through ExternalTextList, recording one notice per distinct unresolved id. */
export class GsdmlTextResolver {
  private readonly texts: ReadonlyMap<string, string>
  private readonly notices: GsdmlNoticeLog

  /**
   * @param texts - Text id to text, in the language order of {@link readExternalTexts}.
   * @param notices - The notice log of the parse.
   */
  constructor(texts: ReadonlyMap<string, string>, notices: GsdmlNoticeLog) {
    this.texts = texts
    this.notices = notices
  }

  /** The text of an id; empty for an empty id, and empty with an `unresolved-text` notice for an unknown one. */
  resolve(textId: string): string {
    if (textId === '') return ''
    const text = this.texts.get(textId)
    if (text !== undefined) return text
    this.notices.add(
      gsdmlNotice('unresolved-text', `Text id "${textId}" is not defined in ExternalTextList.`, undefined, textId),
    )
    return ''
  }

  /** The text named by the TextId attribute of an element; empty when the element or the attribute is absent. */
  resolveTextIdOf(element: GsdmlXmlElement | undefined): string {
    return element === undefined ? '' : this.resolve(attributeValue(element, 'TextId') ?? '')
  }

  /** The text named by the TextId of the first child element with the given name, such as `Name` or `Help`. */
  resolveChild(element: GsdmlXmlElement, childName: string): string {
    return this.resolveTextIdOf(childElement(element, childName))
  }
}

/** Adds the Text entries of one language block, keeping a text id already present. */
function addLanguage(texts: Map<string, string>, language: GsdmlXmlElement): void {
  for (const text of childElements(language, 'Text')) {
    const textId = requireAttribute(text, 'Text', 'TextId')
    const value = requireAttribute(text, 'Text', 'Value')
    if (!texts.has(textId)) texts.set(textId, value)
  }
}

/**
 * Reads ExternalTextList: PrimaryLanguage first, then each Language whose `xml:lang` starts with `en`, then the
 * other Language blocks in document order. The first text found for an id wins.
 *
 * @throws {GsdmlStructureError} When a Text lacks TextId or Value.
 */
export function readExternalTexts(applicationProcess: GsdmlXmlElement): Map<string, string> {
  const texts = new Map<string, string>()
  const list = childElement(applicationProcess, 'ExternalTextList')
  if (list === undefined) return texts
  for (const primary of childElements(list, 'PrimaryLanguage')) addLanguage(texts, primary)
  const languages = childElements(list, 'Language')
  const isEnglish = (language: GsdmlXmlElement): boolean =>
    (attributeValue(language, 'xml:lang') ?? '').trim().toLowerCase().startsWith('en')
  for (const language of languages.filter(isEnglish)) addLanguage(texts, language)
  for (const language of languages.filter((language) => !isEnglish(language))) addLanguage(texts, language)
  return texts
}
