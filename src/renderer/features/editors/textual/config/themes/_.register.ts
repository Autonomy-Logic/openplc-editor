import * as monaco from 'monaco-editor'

export type IThemeData = monaco.editor.IStandaloneThemeData

/**
 * Registers a theme with Monaco editor.
 *
 * @param {IThemeImp} theme - The theme object containing the name and data.
 * @return {void} This function does not return anything.
 */
export function registerTheme(themeName: string, themeData: IThemeData): void {
  monaco.editor.defineTheme(themeName, themeData)
}
