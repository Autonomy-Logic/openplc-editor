import { childWindowIpc } from './childWindow'
import { menu, menuIpc } from './menu'
import { pou, pouIpc } from './pou'
import { project, projectIpc } from './project'
import { themeIpc } from './theme'
import { toast } from './toast'
import userConfigIpc from './userConfig'

/**
 * Contains IPC related modules and utility functions.
 */
export const bridge = {
  /**
   * Sets up event listeners for various IPC modules.
   */
  // Ipc responsible for theme related functions.
  themeIpc,
  // Ipc responsible for child window related functions.
  childWindowIpc,
  // Ipc responsible for project related functions.
  projectIpc,
  // Ipc responsible for menu related functions.
  menuIpc,
  // Ipc responsible for pou related functions.
  pouIpc,
  // Ipc responsible for infos related functions.
  userConfigIpc,
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
  // /**
  //  * Provides access to the info module's functionality.
  //  */
  // info,
}
