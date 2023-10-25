/* eslint-disable react/button-has-type */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable react/function-component-definition */
/* eslint-disable no-empty-pattern */
/* eslint-disable import/no-cycle */
import { FC, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { IconType } from 'react-icons';
import { CgRedo, CgUndo } from 'react-icons/cg';
import {
  HiArrowDownOnSquareStack,
  HiArrowDownTray,
  HiArrowsPointingIn,
  HiArrowsPointingOut,
  HiArrowUturnLeft,
  HiArrowUturnRight,
  HiClipboard,
  HiDocumentDuplicate,
  HiDocumentMagnifyingGlass,
  HiDocumentPlus,
  HiFolderOpen,
  HiPrinter,
  HiScissors,
} from 'react-icons/hi2';
import { CONSTANTS } from '../../../constants';

import { CreatePOU, Tabs, Tooltip } from '../../components';
import { useFullScreen, useModal, useToast } from '../../hooks';
/**
 * Destructure necessary values from the CONSTANTS module
 */
const {} = CONSTANTS;
/**
 * Type for data passed to the handleCreateProjectFromToolbar function
 * @typedef {Object} CreateProjectFromToolbarProps
 * @property {boolean} ok - Whether the creation was successful or not
 * @property {Object} [reason] - Reason for failure with title and description
 * @property {string} [data] - Additional data related to the creation
 */
type CreateProjectFromToolbarProps = {
  ok: boolean;
  reason?: { title: string; description?: string };
  data?: string;
};
/**
 * Type for individual tools in the toolbar
 * @typedef {Object} ToolsProps
 * @property {number} id - Unique identifier for the tool
 * @property {IconType} icon - Icon component representing the tool
 * @property {string} [className] - Additional CSS class for the tool
 * @property {Function} [onClick] - Function to execute on tool click
 * @property {string} tooltip - Tooltip text for the tool
 */
export type ToolsProps = {
  id: number;
  icon: IconType;
  className?: string;
  onClick?: () => void;
  tooltip: string;
  divider?: boolean;
};
/**
 * Functional component for displaying tools in the toolbar
 * @component
 */
const Tools: FC = () => {
  /**
   * Access the translation function from 'react-i18next'
   * @useTranslation
   */
  const { t } = useTranslation('tools');
  /**
   * Access the createToast function from custom hook
   * @useToast
   */
  const { createToast } = useToast();
  /**
   * Access fullscreen-related functions and states from custom hook
   * @useFullScreen
   */
  const { requestFullscreen, exitFullScreen, isFullScreen } = useFullScreen();
  /**
   * Access IPC render function for creating a project from custom hook
   * @useIpcRender
   */

  /**
   * Access project-related functions from custom hook
   * @useProject
   */

  /**
   * Access modal-related functions from custom hook and open a modal for creating a POU
   * @useModal
   */
  const { handleOpenModal } = useModal({
    content: <CreatePOU />,
    hideCloseButton: true,
  });
  /**
   * Handle click event for tools that are not yet implemented
   * @function
   */
  const onClick = () => console.log('will be created soon');
  /**
   * Handle the creation of a project from the toolbar
   * @async
   * @function
   */
  // const handleCreateProjectFromToolbar = async () => {
  //   const { ok, reason, data } = await createProjectFromToolbar(
  //     set.CREATE_PROJECT_FROM_TOOLBAR,
  //   );
  //   if (!ok && reason) {
  //     createToast({
  //       type: 'error',
  //       ...reason,
  //     });
  //   } else if (ok && data) {
  //     handleOpenModal();
  //     await getProject(data);
  //   }
  // };
  /**
   * Array of tool objects with their respective properties
   * @type {ToolsProps[]}
   */
  const tools: ToolsProps[] = [
    // {
    //   id: 1,
    //   onClick: handleCreateProjectFromToolbar,
    //   icon: HiDocumentPlus,
    //   tooltip: t('menuToolbar.new'),
    // },
    // {
    //   id: 2,
    //   onClick,
    //   icon: HiFolderOpen,
    //   tooltip: t('menuToolbar.open'),
    // },
    // {
    //   id: 3,
    //   onClick,
    //   icon: HiArrowDownTray,
    //   tooltip: t('menuToolbar.save'),
    // },
    // {
    //   id: 4,
    //   onClick,
    //   icon: HiArrowDownOnSquareStack,
    //   tooltip: t('menuToolbar.saveAs'),
    // },
    // {
    //   id: 5,
    //   onClick,
    //   icon: HiPrinter,
    //   tooltip: t('menuToolbar.print'),
    // },
    {
      id: 6,
      onClick,
      icon: CgUndo,
      tooltip: t('menuToolbar.undo'),
      divider: true,
    },
    {
      id: 7,
      onClick,
      icon: CgRedo,
      tooltip: t('menuToolbar.redo'),
    },
    // {
    //   id: 8,
    //   onClick,
    //   icon: HiScissors,
    //   tooltip: t('menuToolbar.cut'),
    // },
    // {
    //   id: 9,
    //   onClick,
    //   icon: HiDocumentDuplicate,
    //   tooltip: t('menuToolbar.copy'),
    // },
    // {
    //   id: 10,
    //   onClick,
    //   icon: HiClipboard,
    //   tooltip: t('menuToolbar.paste'),
    // },
    // {
    //   id: 11,
    //   onClick,
    //   icon: HiDocumentMagnifyingGlass,
    //   tooltip: t('menuToolbar.search'),
    // },
    // {
    //   id: 12,
    //   onClick: () => (isFullScreen ? exitFullScreen() : requestFullscreen()),
    //   icon: isFullScreen ? HiArrowsPointingIn : HiArrowsPointingOut,
    //   tooltip: t('menuToolbar.fullScreen'),
    // },
  ];

  return (
    <>
      {/* <Tabs
        tabs={[
          {
            id: t('common.tabName'),
            title: t('common.tabName'),
            current: true,
          },
        ]}
      /> */}
      <div className="absolute z-10 m-4 flex gap-2 rounded-lg bg-white p-3 shadow-lg dark:bg-gray-900">
        {tools.map(
          ({ id, onClick, icon: Icon, className, tooltip, divider }) => (
            <Fragment key={id}>
              <Tooltip id={tooltip} label={tooltip} place="bottom">
                <button
                  className="press-animated border-none outline-none"
                  onClick={() => onClick && onClick()}
                >
                  <Icon
                    className={`h-6 w-6 text-gray-400 hover:opacity-90 ${className}`}
                  />
                </button>
              </Tooltip>
              {divider && <div className="h-6 w-[1px] bg-gray-300" />}
            </Fragment>
          ),
        )}
      </div>
    </>
  );
};

export default Tools;
