import React, { LabelHTMLAttributes } from 'react';

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

const Label: React.FC<LabelProps> = ({ htmlFor, ...rest }) => {
  return (
    <label
      htmlFor={htmlFor}
      className="text-sm text-gray-500 flex items-center justify-between font-medium leading-6 dark:text-gray-400"
      {...rest}
    />
  );
};

export default Label;
