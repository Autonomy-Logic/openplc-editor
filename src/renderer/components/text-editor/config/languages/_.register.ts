import * as monaco from 'monaco-editor';

/**
 * Information about a new language
 */
export type TLang = {
  def: {
    id: string;
    extensions: string[];
    aliases: string[];
    mimetypes: string[];
  };
};

interface ILangImp extends TLang {
  conf: monaco.languages.LanguageConfiguration;
  language: monaco.languages.IMonarchLanguage;
}
/**
 * Registers a new language with Monaco editor.
 *
 * @param {ILangImp} options - The language definition, configuration, and Monarch providers.
 * @return {void} This function does not return anything.
 */
export function registerLanguage({ def, conf, language }: ILangImp): void {
  const languageId = def.id;
  if (!monaco.languages.getLanguages().some((lang) => lang.id === languageId)) {
    monaco.languages.register(def);
    monaco.languages.setLanguageConfiguration(languageId, conf);
    monaco.languages.setMonarchTokensProvider(languageId, language);
  }
}
