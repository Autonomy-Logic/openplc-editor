// Review this eslint rule
/* eslint-disable @typescript-eslint/no-shadow */
// Review this eslint rule
/* eslint-disable no-unused-expressions */
// Review this eslint rule
/* eslint-disable react/require-default-props */
import { Menu, Transition } from '@headlessui/react';
import { FC, Fragment, PropsWithChildren, useEffect, useRef } from 'react';

import { classNames } from '../../utils';
/**
 * Defines the structure of a dropdown option.
 */
type DropdownOption = {
  label: string;
  onClick: () => void;
};
/**
 * Props for the Dropdown component.
 */
type DropdownProps = {
  show: boolean;
  options: DropdownOption[];
  onClick?: () => void;
  onAuxClick?: () => void;
  onClose?: () => void;
};
/**
 * Dropdown component that displays a list of options in a dropdown menu.
 */
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const Dropdown: FC<PropsWithChildren<DropdownProps>> = ({
  children,
  options,
  show,
  onClick,
  onAuxClick,
  onClose,
}) => {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /**
     * Event handler for detecting clicks outside the dropdown.
     */
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        show &&
        divRef.current &&
        !divRef.current.contains(event.target as Node)
      ) {
        // Review eslint rule
        // eslint-disable-next-line no-unused-expressions
        onClose && onClose();
      }
    };
    /**
     * Add event listener to handle outside clicks
     */
    document.addEventListener('click', handleOutsideClick);
    /**
     * Remove event listener when component unmounts
     */
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [onClose, show]);

  return (
    <Menu
      as="div"
      className="relative z-10 inline-block text-left"
      ref={divRef}
    >
      <div>
        <Menu.Button onClick={onClick} onAuxClick={onAuxClick}>
          {children}
        </Menu.Button>
      </div>

      <Transition
        show={show}
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items
          static
          className="nodrag absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
        >
          <div className="py-1">
            {options.map(({ onClick, label }, index) => (
              // Review eslint rule
              // eslint-disable-next-line react/no-array-index-key
              <Menu.Item key={index}>
                {({ active }) => (
                  // Review eslint rule
                  // eslint-disable-next-line react/button-has-type
                  <button
                    onClick={() => {
                      onClick && onClick();
                      onClose && onClose();
                    }}
                    className={classNames(
                      'block w-full px-4 py-2 text-left text-sm transition-colors duration-300',
                      active
                        ? 'bg-brand text-gray-50'
                        : 'text-gray-500 dark:text-gray-400',
                    )}
                  >
                    {label}
                  </button>
                )}
              </Menu.Item>
            ))}
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
};

export default Dropdown;
