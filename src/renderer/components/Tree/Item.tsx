// Review this eslint rule
/* eslint-disable react/jsx-props-no-spreading */
import {
  DetailedHTMLProps,
  LiHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from 'react';

/**
 * Props for the Item component, extending LIHTMLAttributes.
 */
export type ItemProps = PropsWithChildren<
  DetailedHTMLProps<LiHTMLAttributes<HTMLLIElement>, HTMLLIElement>
>;
/**
 * Item component used to represent an individual item within a list.
 * @param children - The content within the item.
 * @param rest - Additional attributes for the LI element.
 */
function Item({ children, ...rest }: ItemProps): ReactNode {
  return <li {...rest}>{children}</li>;
}

export default Item;
