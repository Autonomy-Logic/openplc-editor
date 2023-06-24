import {
  DetailedHTMLProps,
  FC,
  LiHTMLAttributes,
  PropsWithChildren,
} from 'react'

export type ItemProps = PropsWithChildren<
  DetailedHTMLProps<LiHTMLAttributes<HTMLLIElement>, HTMLLIElement>
>

const Item: FC<ItemProps> = ({ children, ...rest }) => {
  return <></>
}

export default Item
