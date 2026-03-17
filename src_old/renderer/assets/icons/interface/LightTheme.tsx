import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export const LightThemeIcon = (props: IIconProps) => {
  const { className, size = 'md', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]

  return (
    <svg
      viewBox='0 0 44 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <g clipPath='url(#clip0_1910_2557)'>
        <rect width='44' height='24' rx='12' fill='#F5F7F8' />
        <g filter='url(#filter0_dd_1910_2557)'>
          <circle cx='12' cy='12' r='10' fill='white' />
        </g>
        <path
          opacity='0.4'
          d='M15.127 12C15.127 13.7259 13.7278 15.125 12.002 15.125C10.2761 15.125 8.87695 13.7259 8.87695 12C8.87695 10.2741 10.2761 8.875 12.002 8.875C13.7278 8.875 15.127 10.2741 15.127 12Z'
          fill='#0464FB'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M12.002 5.28125C12.2608 5.28125 12.4707 5.49112 12.4707 5.75V7C12.4707 7.25888 12.2608 7.46875 12.002 7.46875C11.7431 7.46875 11.5332 7.25888 11.5332 7V5.75C11.5332 5.49112 11.7431 5.28125 12.002 5.28125Z'
          fill='#0464FB'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M12.002 16.5312C12.2608 16.5312 12.4707 16.7411 12.4707 17V18.25C12.4707 18.5089 12.2608 18.7188 12.002 18.7188C11.7431 18.7188 11.5332 18.5089 11.5332 18.25V17C11.5332 16.7411 11.7431 16.5312 12.002 16.5312Z'
          fill='#0464FB'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M17.8198 8.64057C17.9493 8.86477 17.8724 9.15145 17.6482 9.28089L16.5657 9.90589C16.3415 10.0353 16.0548 9.95852 15.9254 9.73432C15.796 9.51012 15.8728 9.22344 16.097 9.09399L17.1795 8.46899C17.4037 8.33955 17.6904 8.41637 17.8198 8.64057Z'
          fill='#0464FB'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M8.07715 14.2656C8.20659 14.4898 8.12977 14.7765 7.90557 14.9059L6.82304 15.5309C6.59884 15.6603 6.31216 15.5835 6.18272 15.3593C6.05328 15.1351 6.13009 14.8484 6.35429 14.719L7.43682 14.094C7.66102 13.9646 7.94771 14.0414 8.07715 14.2656Z'
          fill='#0464FB'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M6.18262 8.63995C6.31206 8.41575 6.59874 8.33893 6.82294 8.46837L7.90547 9.09337C8.12967 9.22282 8.20649 9.5095 8.07705 9.7337C7.94761 9.9579 7.66092 10.0347 7.43672 9.90527L6.35419 9.28027C6.12999 9.15083 6.05318 8.86415 6.18262 8.63995Z'
          fill='#0464FB'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M15.9248 14.2649C16.0542 14.0407 16.3409 13.9639 16.5651 14.0934L17.6477 14.7184C17.8719 14.8478 17.9487 15.1345 17.8192 15.3587C17.6898 15.5829 17.4031 15.6597 17.1789 15.5303L16.0964 14.9053C15.8722 14.7758 15.7954 14.4891 15.9248 14.2649Z'
          fill='#0464FB'
        />
      </g>
      <defs>
        <filter
          id='filter0_dd_1910_2557'
          x='-1'
          y='0'
          width='26'
          height='26'
          filterUnits='userSpaceOnUse'
          colorInterpolationFilters='sRGB'
        >
          <feFlood floodOpacity='0' result='BackgroundImageFix' />
          <feColorMatrix
            in='SourceAlpha'
            type='matrix'
            values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
            result='hardAlpha'
          />
          <feOffset dy='1' />
          <feGaussianBlur stdDeviation='1' />
          <feColorMatrix type='matrix' values='0 0 0 0 0.0627451 0 0 0 0 0.0941176 0 0 0 0 0.156863 0 0 0 0.06 0' />
          <feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow_1910_2557' />
          <feColorMatrix
            in='SourceAlpha'
            type='matrix'
            values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
            result='hardAlpha'
          />
          <feOffset dy='1' />
          <feGaussianBlur stdDeviation='1.5' />
          <feColorMatrix type='matrix' values='0 0 0 0 0.0627451 0 0 0 0 0.0941176 0 0 0 0 0.156863 0 0 0 0.1 0' />
          <feBlend mode='normal' in2='effect1_dropShadow_1910_2557' result='effect2_dropShadow_1910_2557' />
          <feBlend mode='normal' in='SourceGraphic' in2='effect2_dropShadow_1910_2557' result='shape' />
        </filter>
        <clipPath id='clip0_1910_2557'>
          <rect width='44' height='24' rx='12' fill='white' />
        </clipPath>
      </defs>
    </svg>
  )
}
