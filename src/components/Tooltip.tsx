import React, { PropsWithChildren } from 'react';

import { classNames } from '@/utils';

export type TooltipProps = {
  label?: string;
};

const Tooltip: React.FC<PropsWithChildren<TooltipProps>> = ({ children, label }) => {
  if (!label) return <>{children}</>;
  return (
    <div
      className={classNames('flex items-center justify-start', !!label && 'has-tooltip')}
    >
      <span className="tooltip inline-block px-2 py-1 text-xs font-medium mt-16 whitespace-nowrap text-gray-800 transition-opacity duration-300 bg-white rounded-lg shadow dark:bg-gray-800 dark:text-gray-50">
        {label}
      </span>
      {children}
    </div>
  );
};

export default Tooltip;
