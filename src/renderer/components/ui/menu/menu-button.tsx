/* eslint-disable react/jsx-props-no-spreading */
import { ButtonHTMLAttributes } from 'react';

import { cn } from '~/utils';

type IconsForMenu = string;
type MenuButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: unknown;
  label: string;
};

export default function Button({ icon, label, ...props }: MenuButtonProps) {
  const ButtonIcon = icon as IconsForMenu;
  const { className } = props;
  return (
    <button type='button' {...props} className={cn(className)}>
      {ButtonIcon}
      {label}
    </button>
  );
}
