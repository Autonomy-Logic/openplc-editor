import React, { PropsWithChildren } from 'react';

import { classNames } from '@/utils';

export type TooltipProps = {
  label?: string;
  position?: 'start' | 'center' | 'end';
};

const Tooltip: React.FC<PropsWithChildren<TooltipProps>> = ({
  children,
  label,
  position = 'center',
}) => {
  if (!label) return <>{children}</>;
  return (
    <div
      className={classNames(
        `flex items-center justify-${position}`,
        !!label && 'has-tooltip',
      )}
    >
      <span className="tooltip inline-block px-2 py-1 text-xs font-medium mt-16 whitespace-nowrap text-gray-500 transition-opacity duration-300 bg-white rounded-lg shadow dark:bg-gray-900 dark:text-gray-400">
        {label}
      </span>
      {children}
    </div>
  );
};

export default Tooltip;
