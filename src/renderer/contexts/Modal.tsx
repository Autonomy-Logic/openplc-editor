import {
  createContext,
  FC,
  PropsWithChildren,
  ReactElement,
  ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';

import { Modal } from '../components';
/**
 * Type representing the data structure of the modal context
 * @interface ModalContextData
 */
export type ModalContextData = {
  isOpen: boolean;
  handleOpenModal: () => void;
  handleCloseModal: () => void;
  setModalContent?: (content: ReactNode | ReactElement) => void;
  setModalHideCloseButton?: (value: boolean) => void;
};
/**
 * Create a context for the modal functionality
 * @context
 */
export const ModalContext = createContext<ModalContextData>(
  {} as ModalContextData,
);
/**
 * Define a React component that provides the configured modal.
 * @returns A JSX Component with the modal context provider
 */
// Review eslint rule
// eslint-disable-next-line react/function-component-definition
const ModalProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * State to manage the content of the modal
   */
  const [content, setContent] = useState<ReactNode | ReactElement>();
  /**
   * State to track the open/close state of the modal
   */
  const [open, setOpen] = useState(false);
  /**
   * State to control whether the close button of the modal is hidden
   */
  const [hideCloseButton, setHideCloseButton] = useState(false);
  /**
   * Set the content of the modal
   */
  const setModalContent = useCallback(
    // Review eslint rule
    // eslint-disable-next-line @typescript-eslint/no-shadow
    (content: ReactNode | ReactElement) => setContent(content),
    [],
  );
  /**
   * Function to open the modal
   */
  const handleOpenModal = useCallback(() => setOpen(true), []);
  /**
   * Function to close the modal
   */
  const handleCloseModal = useCallback(() => setOpen(false), []);
  /**
   * Set whether the close button of the modal should be hidden
   */
  const setModalHideCloseButton = useCallback(
    (value: boolean) => setHideCloseButton(value),
    [],
  );
  /**
   * Memoize the current modal context data.
   */
  const defaultValue = useMemo(
    () => ({
      isOpen: open,
      handleOpenModal,
      handleCloseModal,
      setModalContent,
      setModalHideCloseButton,
    }),
    [
      open,
      handleOpenModal,
      handleCloseModal,
      setModalContent,
      setModalHideCloseButton,
    ],
  );
  /**
   * Provide the context with modal data.
   */
  return (
    <ModalContext.Provider value={defaultValue}>
      {children}
      {content && (
        <Modal
          open={open}
          onClose={setOpen}
          content={content}
          hideCloseButton={hideCloseButton}
        />
      )}
    </ModalContext.Provider>
  );
};

export default ModalProvider;
