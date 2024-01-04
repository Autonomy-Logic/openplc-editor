import { HTMLAttributes, ReactNode } from 'react';

export type ExampleHeaderProps = HTMLAttributes<HTMLElement> & {
  title: string;
  children: ReactNode;
};

/**
 * Render the header component with the given props.
 *
 * @param {ExamplesHeaderProps} props - The props for the header component.
 * @returns {JSX.Element} The rendered header component.
 */
export default function Header(props: ExampleHeaderProps): ReactNode {
  const { title, children, ...restProps } = props;
  return (
    <header
      className='flex flex-1 w-full mb-6 justify-between text-xl leading-6 font-medium font-caption text-neutral-1000 dark:text-white'
      {...restProps}
    >
      <h1 className='cursor-default'>{title}</h1>
      <nav className='flex w-fit gap-6'>{children}</nav>
    </header>
  );
}

export type ExampleHeader = typeof Header;
