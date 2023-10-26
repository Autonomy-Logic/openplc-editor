/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable react/function-component-definition */
/* eslint-disable import/no-cycle */
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
} from 'react';

import { Titlebar } from 'custom-electron-titlebar';
import { useFullScreen } from '../hooks';
/**
 * Destructure necessary properties from the CONSTANTS module.
 */
/**
 * Type representing the props of the custom Titlebar.
 */
export type TitlebarProps = InstanceType<typeof Titlebar>;
/**
 * Context data type for managing the custom Titlebar.
 */
export type TitlebarContextData = {
  /**
   * The custom Titlebar instance.
   */
  titlebar?: TitlebarProps | null;
  /**
   * Function to dispose of the custom Titlebar.
   */
  dispose: () => void;
};
/**
 * Context for managing the custom Titlebar state.
 */
export const TitlebarContext = createContext<TitlebarContextData>(
  {} as TitlebarContextData,
);
/**
 * Provider component for managing the custom Titlebar.
 * @returns A JSX Component with the titlebar context provider
 */
const TitlebarProvider: FC<PropsWithChildren> = ({ children }) => {
  // TODO: Retrieve the custom Titlebar instance
  /**
   * State to hold the custom Titlebar instance
   */
  // const [titlebar, setTitlebar] = useState<TitlebarProps>();
  /**
   * TODO: Fix this
   * Get project data from hooks
   */
  //   const { project } = useProject();
  /**
   * Get fullscreen mode state from hooks
   */
  const { isFullScreen } = useFullScreen();
  /**
   * TODO: Depends on titlebar custom element
   * Disposes of the custom Titlebar instance.
   */
  // const dispose = useCallback(() => titlebar && titlebar.dispose(), [titlebar]);

  // TODO: Enable process communication
  // useEffect(() => {
  //   /**
  //    * Updates the menu when the project is updated.
  //    */
  //   const updateMenu = async () => {
  //     if (titlebar && project) {
  //       const { ok } = await invoke(set.UPDATE_MENU_PROJECT);
  //       if (ok) titlebar.refreshMenu();
  //     }
  //   };
  //   updateMenu();
  // }, [invoke, titlebar, project]);

  useEffect(() => {
    /**
     * Updates the container style based on fullscreen mode.
     */
    const titlebarIterator = Array.from(
      document.getElementsByClassName('cet-titlebar'),
    );
    const containerIterator = Array.from(
      document.getElementsByClassName('cet-container'),
    );
    const [titlebar] = titlebarIterator;
    const [container] = containerIterator;

    if (titlebar && container) {
      if (isFullScreen) {
        container.classList.replace('!top-16', '!top-0');
      } else {
        container.classList.add('!top-16');
        container.classList.replace('!top-0', '!top-16');
      }
    }
  }, [isFullScreen]);

  const dispose = useCallback(() => {}, []);
  const titlebarValue = null;
  const defaultValues = useMemo(
    () => ({ dispose, titlebarValue }),
    [dispose, titlebarValue],
  );
  /**
   * Provide the context with Titlebar data.
   */
  return (
    <TitlebarContext.Provider value={defaultValues}>
      {children}
    </TitlebarContext.Provider>
  );
};

export default TitlebarProvider;
