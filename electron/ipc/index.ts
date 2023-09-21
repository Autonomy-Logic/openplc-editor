import { childWindowIpc } from './childWindow'
import { menu, menuIpc } from './menu'
import { pou, pouIpc } from './pou'
import { project, projectIpc } from './project'
import { themeIpc } from './theme'
import { toast } from './toast'

/**
 * Contains IPC related modules and utility functions.
 */
export const ipc = {
  /**
   * Sets up event listeners for various IPC modules.
   */
  setupListeners() {
    themeIpc()
    childWindowIpc()
    projectIpc()
    menuIpc()
    pouIpc()
  },
  /**
   * Provides access to the toast module's functionality.
   */
  toast,
  /**
   * Provides access to the pou module's functionality.
   */
  pou,
  /**
   * Provides access to the project module's functionality.
   */
  project,
  /**
   * Provides access to the menu module's functionality.
   */
  menu,
}
