import { readGsdmlXml } from '../gsdml-xml'
import { parseGsdml } from '../index'
import { expectCatalog, expectError, readGsdmlFixture, replaceOnce } from './fixtures/gsdml-fixtures'

const BASE = readGsdmlFixture('structural-base.gsdml.xml')
const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>\n'
const DEVICE_INFO_TEXT = 'Value="Base device"'
const PROFILE_SOURCE = '<ProfileSource>Synthetic</ProfileSource>'
const PROFILE_BODY = '<ProfileBody>'

/** The structural base file with `value` as the device InfoText, written as an attribute value. */
function withDeviceInfoText(value: string): string {
  return replaceOnce(BASE, DEVICE_INFO_TEXT, `Value="${value}"`)
}

/** The structural base file with `content` as the character data of ProfileSource. */
function withProfileSource(content: string): string {
  return replaceOnce(BASE, PROFILE_SOURCE, `<ProfileSource>${content}</ProfileSource>`)
}

/** The structural base file with `markup` inserted right after the ProfileBody start tag. */
function withMarkupInProfileBody(markup: string): string {
  return replaceOnce(BASE, PROFILE_BODY, `${PROFILE_BODY}${markup}`)
}

/** The 1-based line and UTF-16 column of the first occurrence of `reference` in `text`, lines split at LF. */
function positionOf(text: string, reference: string): { line: number; column: number } {
  const index = text.indexOf(reference)
  if (index === -1) throw new Error(`${reference} does not occur in the input`)
  const before = text.slice(0, index)
  return { line: before.split('\n').length, column: index - (before.lastIndexOf('\n') + 1) + 1 }
}

/** The reason readGsdmlXml gives for `reference`, at its first occurrence in `text`. */
function undeclaredReason(text: string, reference: string): string {
  const { line, column } = positionOf(text, reference)
  return `undeclared entity reference ${reference} (line ${line}, column ${column})`
}

/** The parseGsdml error for `reference`, at its first occurrence in `text`. */
function undeclaredError(text: string, reference: string): string {
  return `GSDML XML is malformed: ${undeclaredReason(text, reference)}`
}

describe('parseGsdml: named entity references other than the five predefined ones are malformed XML', () => {
  it('rejects &nbsp; in an attribute value, naming it with its line and column', () => {
    const xml = withDeviceInfoText('a&nbsp;b')
    expect(positionOf(xml, '&nbsp;')).toEqual({ line: 110, column: 43 })
    expect(parseGsdml(xml)).toEqual({ success: false, error: undeclaredError(xml, '&nbsp;') })
  })

  it('rejects &copy; in the character data of an element, naming it with its line and column', () => {
    const xml = withProfileSource('Synthetic &copy; 2026')
    expect(parseGsdml(xml)).toEqual({ success: false, error: undeclaredError(xml, '&copy;') })
  })

  it.each(['&foo;', '&euro;', '&AMP;', '&Lt;', '&apos2;'])('rejects %s, naming that reference', (reference) => {
    const xml = withDeviceInfoText(`a${reference}b`)
    expect(parseGsdml(xml)).toEqual({ success: false, error: undeclaredError(xml, reference) })
  })

  it('names the first of two undeclared references in document order', () => {
    const xml = withDeviceInfoText('a&nbsp;b').replace(PROFILE_SOURCE, '<ProfileSource>x&euro;y</ProfileSource>')
    expect(positionOf(xml, '&euro;').line).toBeLessThan(positionOf(xml, '&nbsp;').line)
    expect(parseGsdml(xml)).toEqual({ success: false, error: undeclaredError(xml, '&euro;') })
  })

  it('names the first of two undeclared references on the same line', () => {
    const xml = withDeviceInfoText('a&foo;b&nbsp;c')
    expect(parseGsdml(xml)).toEqual({ success: false, error: undeclaredError(xml, '&foo;') })
  })

  it('counts the column in UTF-16 code units, so a character outside the BMP counts twice', () => {
    const xml = withDeviceInfoText('\u{1F600}&nbsp;b')
    expect(expectError(parseGsdml(xml))).toBe(
      'GSDML XML is malformed: undeclared entity reference &nbsp; (line 110, column 44)',
    )
  })

  it('rejects an undeclared reference after a predefined and a numeric one in the same value', () => {
    const xml = withDeviceInfoText('&amp;&#65;&nbsp;')
    expect(parseGsdml(xml)).toEqual({ success: false, error: undeclaredError(xml, '&nbsp;') })
  })

  it.each([
    ['a comment', '<!-- note -->'],
    ['a CDATA section', '<Note><![CDATA[note]]></Note>'],
    ['a processing instruction', '<?openplc-note note?>'],
  ])('still rejects an undeclared reference that follows %s', (_construct, markup) => {
    const xml = replaceOnce(withDeviceInfoText('a&nbsp;b'), '<ProfileHeader>', `<ProfileHeader>${markup}`)
    expect(parseGsdml(xml)).toEqual({ success: false, error: undeclaredError(xml, '&nbsp;') })
  })

  it('reports the DOCTYPE error, not the reference, for a file with a DOCTYPE', () => {
    const xml = replaceOnce(
      withDeviceInfoText('a&nbsp;b'),
      XML_DECLARATION,
      `${XML_DECLARATION}<!DOCTYPE ISO15745Profile>\n`,
    )
    expect(parseGsdml(xml)).toEqual({
      success: false,
      error: 'GSDML must not contain a DOCTYPE declaration; the file was not parsed.',
    })
  })
})

describe('readGsdmlXml: undeclared named entity references', () => {
  it('returns the reason naming the reference, its line and its column, without throwing', () => {
    const xml = withProfileSource('a&nbsp;b')
    expect(readGsdmlXml(xml)).toEqual({ ok: false, reason: undeclaredReason(xml, '&nbsp;') })
  })
})

describe('parseGsdml: references that stay accepted', () => {
  it('decodes the five predefined references and numeric references in one attribute value', () => {
    const catalog = expectCatalog(parseGsdml(withDeviceInfoText('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;')))
    expect(catalog.identity.infoText).toBe('<>&"\'AB')
  })

  it.each([
    ['a comment', '<!-- a&nbsp;b&foo; -->'],
    ['a CDATA section', '<Note><![CDATA[a&nbsp;b&foo;]]></Note>'],
    ['a processing instruction', '<?openplc-note a&nbsp;b&foo;?>'],
  ])('parses &nbsp; and &foo; inside %s', (_construct, markup) => {
    expect(parseGsdml(withMarkupInProfileBody(markup)).success).toBe(true)
  })

  it('keeps an ampersand followed by whitespace, which is no named reference, as before', () => {
    const catalog = expectCatalog(parseGsdml(withDeviceInfoText('a & b;')))
    expect(catalog.identity.infoText).toBe('a & b;')
  })

  it('leaves an unterminated comment holding &nbsp; to the well-formedness check', () => {
    const error = expectError(parseGsdml(replaceOnce(BASE, PROFILE_SOURCE, '<!-- a&nbsp;b')))
    expect(error.startsWith('GSDML XML is malformed: ')).toBe(true)
    expect(error).not.toContain('undeclared entity reference')
  })
})
