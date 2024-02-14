import { ComponentProps } from 'react'

type IILIconProps = ComponentProps<'svg'>
export const ILIcon = (props: IILIconProps) => {
	return (
		<svg
			role='button'
			viewBox='0 0 28 28'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
		>
			<path
				opacity='0.4'
				d='M3.49988 21.0002V7.0002C3.49988 4.42287 5.58922 2.33353 8.16655 2.33353H15.1665L24.4999 11.6669V21.0002C24.4999 23.5775 22.4105 25.6669 19.8332 25.6669H8.16654C5.58922 25.6669 3.49988 23.5775 3.49988 21.0002Z'
				fill='#DE8560'
			/>
			<path
				d='M15.1661 7.00026V2.3336L24.4995 11.6669H19.8328C17.2555 11.6669 15.1661 9.57759 15.1661 7.00026Z'
				fill='#DE8560'
			/>
			<path
				d='M8.23749 22.6275V17.5366H9.31384V21.7401H11.4964V22.6275H8.23749Z'
				fill='#DE8560'
			/>
			<path
				d='M7.35192 17.5366V22.6275H6.27557V17.5366H7.35192Z'
				fill='#DE8560'
			/>
		</svg>
	)
}
