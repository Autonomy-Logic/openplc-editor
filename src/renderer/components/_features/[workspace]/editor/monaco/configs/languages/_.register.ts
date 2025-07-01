import * as monaco from 'monaco-editor'

/**
 * Information about a new language
 */
export type TLang = {
  def: {
    id: string
    extensions: string[]
    aliases: string[]
    mimetypes: string[]
  }
}

interface ILangImp extends TLang {
  conf: monaco.languages.LanguageConfiguration
  language: monaco.languages.IMonarchLanguage
}
/**
 * Registers or updates a language in the Monaco editor with the provided configuration and Monarch tokenizer.
 *
 * If the language is not already registered, it is added to Monaco. The language configuration and Monarch tokens provider are always set or updated for the given language ID.
 */
export function registerLanguage({ def, conf, language }: ILangImp): void {
  const languageId = def.id
  if (!monaco.languages.getLanguages().some((lang) => lang.id === languageId)) {
    monaco.languages.register(def)
  }
  monaco.languages.setLanguageConfiguration(languageId, conf)
  monaco.languages.setMonarchTokensProvider(languageId, language)
}
