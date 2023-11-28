import { Dialog, Transition } from '@headlessui/react';
import {
  Dispatch,
  FC,
  Fragment,
  PropsWithChildren,
  ReactElement,
  ReactNode,
  SetStateAction,
} from 'react';
import { HiXMark } from 'react-icons/hi2';
/**
 * Props for the Modal component.
 */
export type ModalProps = {
  /**
   * Determines whether the modal is open.
   */
  open: boolean;
  /**
   * Callback to close the modal.
   */
  onClose: Dispatch<SetStateAction<boolean>> | (() => void);
  /**
   * Content to be displayed in the modal.
   */
  content?: ReactNode | ReactElement;
  /**
   * Determines whether the close button is hidden.
   */
  hideCloseButton?: boolean;
};

/**
 * Modal component that displays content in a dialog.
 * @returns a JSX modal component.
 */
// Review eslint rule
// eslint-disable-next-line react/function-component-definition
const Modal: FC<PropsWithChildren<ModalProps>> = ({
  children,
  open,
  onClose,
  content,
  hideCloseButton = false,
}) => {
  /**
   * If there's no children and no content, render nothing
   */
  // Review eslint rule
  // eslint-disable-next-line react/jsx-no-useless-fragment
  if (!children && !content) return <></>;
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-20"
        onClose={() => {
          if (!hideCloseButton) onClose(false);
        }}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-20 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-0 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative flex transform flex-col items-center justify-center overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all dark:bg-gray-900 sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                {!hideCloseButton && (
                  <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                    <button
                      type="button"
                      className="press-animated border-none text-gray-400 hover:text-gray-500"
                      onClick={() => onClose(false)}
                    >
                      <span className="sr-only">Close</span>
                      <HiXMark className="h-6 w-6" aria-hidden="true" />
                    </button>
                  </div>
                )}
                {children || content}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
};
export default Modal;
