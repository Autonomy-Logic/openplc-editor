import { useCallback, useState } from 'react'
import * as MenuPrimitive from '@radix-ui/react-menubar'

import { i18n } from '@utils/i18n'
import { cn } from '@utils/cn'
import { useOpenPLCStore } from '@root/renderer/store'

export const MenuBar = () => {
	const { updateTheme, shouldUseDarkMode } = useOpenPLCStore()

	const handleChangeTheme = async () => {
		await window.bridge.toggleTheme()
		updateTheme()
	}

	const triggerDefaultStyle =
		'w-fit dark:aria-[expanded="true"]:bg-neutral-900 h-fit px-2 py-px aria-[expanded="true"]:bg-brand-medium text-white font-caption font-light text-xs rounded-sm bg-brand-dark dark:bg-neutral-950  hover:bg-brand-medium-dark hover:shadow-2xl hover:dark:bg-neutral-900 transition-colors'
	const contentDefaultStyle =
		'w-80 flex flex-col relative z-50 drop-shadow-lg  px-4 py-4 gap-2 bg-white dark:bg-neutral-900 dark:border-brand-dark rounded-md shadow-inner backdrop-blur-2xl border border-brand-light'
	const itemDefaultStyle =
		'px-2 py-1 text-neutral-850 dark:aria-[expanded="true"]:bg-neutral-700 aria-[expanded="true"]:bg-neutral-100 outline-none font-normal font-caption text-xs dark:text-white flex items-center justify-between hover:bg-neutral-100 hover:dark:bg-neutral-700 rounded-sm cursor-pointer data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent'
	const acceleratorDefaultStyle = 'opacity-50 capitalize '
	const separatorDefaultStyle = 'border-b border-b-neutral-400'
	const checkboxDefaultStyle =
		'w-3 h-3 bg-neutral-400 dark:bg-neutral-500 text-brand flex justify-center items-center'

	//each root is a menu
	return (
		<MenuPrimitive.Root className='h-full flex-1 flex items-center gap-2'>
			<MenuPrimitive.Menu>
				<MenuPrimitive.Trigger className={triggerDefaultStyle}>
					{i18n.t('menu:file.label')}
				</MenuPrimitive.Trigger>
				<MenuPrimitive.Portal>
					<MenuPrimitive.Content sideOffset={4} className={contentDefaultStyle}>
						<MenuPrimitive.Item className={itemDefaultStyle}>
							<span>{i18n.t('menu:file.submenu.new')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + N'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle}>
							<span>{i18n.t('menu:file.submenu.open')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + O'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.save')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + S'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.saveAs')}</span>
							<span className={acceleratorDefaultStyle}>
								{'Ctrl + Shift + S'}
							</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.closeTab')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + W'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.closeProject')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl  + W'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.pageSetup')}</span>
							<span className={acceleratorDefaultStyle}>"Ctrl + Alt + P"</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.preview')}</span>
							<span className={acceleratorDefaultStyle}>
								{'Ctrl + Shift + P'}
							</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.print')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + P'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:file.submenu.updates')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + U'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle}>
							<span>{i18n.t('menu:file.submenu.quit')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + Q'}</span>
						</MenuPrimitive.Item>
					</MenuPrimitive.Content>
				</MenuPrimitive.Portal>
			</MenuPrimitive.Menu>

			{/*edit menu */}

			<MenuPrimitive.Menu>
				<MenuPrimitive.Trigger className={triggerDefaultStyle}>
					{i18n.t('menu:edit.label')}
				</MenuPrimitive.Trigger>
				<MenuPrimitive.Portal>
					<MenuPrimitive.Content sideOffset={4} className={contentDefaultStyle}>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.undo')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + Z'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.redo')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + Y'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.cut')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + X'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.copy')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + C'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.paste')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + V'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.find')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + F'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.findNext')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + K'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.findPrevious')}</span>
							<span className={acceleratorDefaultStyle}>
								{'Ctrl + Shift + K'}
							</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.findInProject')}</span>
							<span className={acceleratorDefaultStyle}>
								{'Ctrl + Shift + F'}
							</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />

						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.addElement.label')}</span>
							<span className={acceleratorDefaultStyle}>{''}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.selectAll')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + A'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:edit.submenu.delete')}</span>
							<span className={acceleratorDefaultStyle}>{''}</span>
						</MenuPrimitive.Item>
					</MenuPrimitive.Content>
				</MenuPrimitive.Portal>
			</MenuPrimitive.Menu>

			{/*display menu */}

			<MenuPrimitive.Menu>
				<MenuPrimitive.Trigger className={triggerDefaultStyle}>
					{i18n.t('menu:display.label')}
				</MenuPrimitive.Trigger>
				<MenuPrimitive.Portal>
					<MenuPrimitive.Content sideOffset={4} className={contentDefaultStyle}>
						<MenuPrimitive.Item className={itemDefaultStyle}>
							<span>{i18n.t('menu:display.submenu.refresh')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + R '}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.clearErrors')}</span>
							<span className={acceleratorDefaultStyle}>{''}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.zoomIn')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + + '}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.zoomOut')}</span>
							<span className={acceleratorDefaultStyle}>{'Ctrl + - '}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.switchPerspective')}</span>
							<span className={acceleratorDefaultStyle}>{'F12 '}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
							<span className={acceleratorDefaultStyle}>{'Shift + F12 '}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Separator className={separatorDefaultStyle} />
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.resetPerspective')}</span>
							<span className={acceleratorDefaultStyle}>{'Shift + F12 '}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.fullScreen')}</span>
							<span className={acceleratorDefaultStyle}>{'F11'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:display.submenu.sortAlpha')}</span>
							<span className={acceleratorDefaultStyle}>{'F10'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Sub>
							<MenuPrimitive.SubTrigger className={itemDefaultStyle}>
								<span>{i18n.t('menu:display.submenu.theme.label')}</span>
								<span className={acceleratorDefaultStyle}>
									{shouldUseDarkMode ? 'dark' : 'light'}
								</span>
							</MenuPrimitive.SubTrigger>

							<MenuPrimitive.Portal>
								<MenuPrimitive.SubContent
									sideOffset={18}
									className={contentDefaultStyle}
								>
									<MenuPrimitive.Item
										onClick={() => {
											handleChangeTheme()
										}}
										className={itemDefaultStyle}
									>
										<span>
											{i18n.t('menu:display.submenu.theme.submenu.light')}
										</span>

										{!shouldUseDarkMode ? (
											<div className={checkboxDefaultStyle}>✓</div>
										) : (
											''
										)}
									</MenuPrimitive.Item>
									<MenuPrimitive.Item
										onClick={() => {
											handleChangeTheme()
										}}
										className={itemDefaultStyle}
									>
										<span>
											{i18n.t('menu:display.submenu.theme.submenu.dark')}
										</span>
										{shouldUseDarkMode ? (
											<div className={checkboxDefaultStyle}>✓</div>
										) : (
											''
										)}
									</MenuPrimitive.Item>
								</MenuPrimitive.SubContent>
							</MenuPrimitive.Portal>
						</MenuPrimitive.Sub>
					</MenuPrimitive.Content>
				</MenuPrimitive.Portal>
			</MenuPrimitive.Menu>

			{/*** help */}

			<MenuPrimitive.Menu>
				<MenuPrimitive.Trigger className={triggerDefaultStyle}>
					{i18n.t('menu:help.label')}
				</MenuPrimitive.Trigger>
				<MenuPrimitive.Portal>
					<MenuPrimitive.Content sideOffset={4} className={contentDefaultStyle}>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:help.submenu.communitySupport')}</span>
							<span className={acceleratorDefaultStyle}>{'F1'}</span>
						</MenuPrimitive.Item>
						<MenuPrimitive.Item className={itemDefaultStyle} disabled>
							<span>{i18n.t('menu:help.submenu.about')}</span>
							<span className={acceleratorDefaultStyle}>{'F1'}</span>
						</MenuPrimitive.Item>
					</MenuPrimitive.Content>
				</MenuPrimitive.Portal>
			</MenuPrimitive.Menu>
			<MenuPrimitive.Separator
				className={cn(
					separatorDefaultStyle,
					'bg-brand-light h-[1px] rotate-90 w-3'
				)}
			/>
			<MenuPrimitive.Menu>
				<MenuPrimitive.Trigger className={triggerDefaultStyle}>
					recent
				</MenuPrimitive.Trigger>
				<MenuPrimitive.Portal>
					<MenuPrimitive.Content sideOffset={4} className={contentDefaultStyle}>
						<MenuPrimitive.Item className={itemDefaultStyle}>
							<span>recent</span>
						</MenuPrimitive.Item>
					</MenuPrimitive.Content>
				</MenuPrimitive.Portal>
			</MenuPrimitive.Menu>
		</MenuPrimitive.Root>
	)
}
