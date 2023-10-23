// Review this eslint rule
/* eslint-disable import/no-cycle */
import { ReactElement, ReactNode, useContext, useEffect } from 'react';

import { ModalContext } from '../contexts';
import { ModalContextData } from '../contexts/Modal';
/**
 * Define the properties for the useModal hook
 * @interface UseModalProps
 * @property {ReactNode | ReactElement} content - Content of the modal
 * @property {boolean} hideCloseButton - Indicates whether the close button should be hidden
 */
export type UseModalProps = {
  content?: ReactNode | ReactElement;
  hideCloseButton?: boolean;
};
/**
 * Custom hook to interact with the modal context
 * @function
 * @param {UseModalProps} props - Optional properties for controlling the modal
 * @returns {ModalContextData} - Modal context data
 */
const useModal = (props?: UseModalProps): ModalContextData => {
  /**
   * Get the modal context
   */
  const context = useContext(ModalContext);
  /**
   * Throw an error if the hook is not used within a ModalProvider
   */
  if (!context) throw new Error('useModal must be used within a ModalProvider');
  /**
   * Extract the setModalContent, setModalHideCloseButton, and other properties from the context
   */
  const { setModalContent, setModalHideCloseButton, ...rest } = context;
  /**
   * Set the modal content and hideCloseButton based on the provided props
   */
  useEffect(() => {
    if (props) {
      const { content, hideCloseButton } = props;
      if (content && setModalContent) setModalContent(content);
      if (hideCloseButton && setModalHideCloseButton)
        setModalHideCloseButton(hideCloseButton);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return rest;
};

export default useModal;
