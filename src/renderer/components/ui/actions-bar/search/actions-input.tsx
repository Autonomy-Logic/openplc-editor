/* eslint-disable react/jsx-props-no-spreading */
import { cn } from '@/utils';

type ActionsInputProps = {
  placeholder: string;
  type: string;
  id: string;
  className?: string;
};
export default function Input({ placeholder, type, id, ...props }: ActionsInputProps) {
  const { className } = props;
  return <input placeholder={placeholder} type={type} id={id} className={cn(className)} />;
}
