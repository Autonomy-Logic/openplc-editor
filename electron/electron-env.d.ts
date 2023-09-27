/// <reference types="vite-electron-plugin/electron-env" />
/**
 * Augments the `NodeJS.ProcessEnv` interface with additional properties.
 */
declare namespace NodeJS {
  /**
   * Interface for extending the `ProcessEnv` interface.
   */
  interface ProcessEnv {
    /**
     * Indicates whether Visual Studio Code debugging is enabled.
     */
    VSCODE_DEBUG?: 'true'
    /**
     * Specifies the path to the Electron distribution folder.
     */
    DIST_ELECTRON: string
    /**
     * Specifies the path to the general distribution folder.
     */
    DIST: string
    /**
     * Specifies the path to the public distribution folder (either `/dist/` or `/public/`).
     */
    PUBLIC: string
  }
}
