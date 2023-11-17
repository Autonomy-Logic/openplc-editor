// Review this eslint rule
/* eslint-disable react/function-component-definition */
// Review this eslint rule
/* eslint-disable react/require-default-props */
import { Switch } from '@headlessui/react';
import { FC, ReactElement } from 'react';

import { classNames } from '../../shared/utils';
/**
 * Props for the Toggle component.
 */
export type ToggleProps = {
  enabled: boolean;
  setEnabled: () => void;
  icons?: {
    enabled: ReactElement;
    disabled: ReactElement;
  };
};
/**
 * Toggle component to create a switch with customizable icons.
 * @returns a JSX component of a toggle with customizable icons
 */
const Toggle: FC<ToggleProps> = ({ enabled, setEnabled, icons }) => {
  return (
    <Switch
      checked={enabled}
      onChange={setEnabled}
      className={classNames(
        enabled ? 'bg-open-plc-blue' : 'bg-gray-200',
        'press-animated relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-open-plc-blue focus:ring-offset-2',
      )}
    >
      <span className="sr-only">Use setting</span>
      <span
        className={classNames(
          enabled ? 'translate-x-5' : 'translate-x-0',
          'pointer-events-none relative inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
        )}
      >
        <span
          className={classNames(
            enabled
              ? 'opacity-0 duration-100 ease-out'
              : 'opacity-100 duration-200 ease-in',
            'absolute inset-0 flex h-full w-full items-center justify-center transition-opacity',
          )}
          aria-hidden="true"
        >
          {icons?.disabled}
        </span>
        <span
          className={classNames(
            enabled
              ? 'opacity-100 duration-200 ease-in'
              : 'opacity-0 duration-100 ease-out',
            'absolute inset-0 flex h-full w-full items-center justify-center transition-opacity',
          )}
          aria-hidden="true"
        >
          {icons?.enabled}
        </span>
      </span>
    </Switch>
  );
};

export default Toggle;
