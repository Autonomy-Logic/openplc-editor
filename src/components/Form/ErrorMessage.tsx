import React from 'react';
import { useFormContext } from 'react-hook-form';

interface ErrorMessageProps {
  field: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (obj: Record<any, any>, path: string) => {
  const travel = (regexp: RegExp) =>
    String.prototype.split
      .call(path, regexp)
      .filter(Boolean)
      .reduce((res, key) => (res !== null && res !== undefined ? res[key] : res), obj);

  const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/);

  return result;
};

const ErrorMessage: React.FC<ErrorMessageProps> = ({ field }) => {
  const {
    formState: { errors },
  } = useFormContext();

  const fieldError = get(errors, field);

  if (!fieldError) {
    return <div className="h-4 mt-1" />;
  }

  return (
    <span className="text-xs text-red-500 mt-1">{fieldError.message?.toString()}</span>
  );
};

export default ErrorMessage;
