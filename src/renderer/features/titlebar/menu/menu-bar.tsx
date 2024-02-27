import { FlyoutMenu } from './flyout'
import { MenuButton } from './menu-button'

import { i18n } from '~utils/i18n'

export const MenuBar = () => {
	return (
		<div className='h-full flex-1 flex items-center gap-2'>
			<FlyoutMenu.root label={i18n.t('menu:file.label')}>
				<FlyoutMenu.section
					section={[
						{
							id: i18n.t('menu:file.submenu.new'),
							label: i18n.t('menu:file.submenu.new'),
							accelerator: 'Ctrl + N',
						},
						{
							id: i18n.t('menu:file.submenu.open'),
							label: i18n.t('menu:file.submenu.open'),
							accelerator: 'Ctrl + O',
						},
					]}
					hasSibling
				/>
				<FlyoutMenu.section
					section={[
						{
							id: i18n.t('menu:file.submenu.save'),
							label: i18n.t('menu:file.submenu.save'),
							accelerator: 'Ctrl + S',
						},
						{
							id: i18n.t('menu:file.submenu.saveAs'),
							label: i18n.t('menu:file.submenu.saveAs'),
							accelerator: 'Ctrl + Shift + S',
						},
						{
							id: i18n.t('menu:file.submenu.closeTab'),
							label: i18n.t('menu:file.submenu.closeTab'),
							accelerator: 'Ctrl + W',
						},
						{
							id: i18n.t('menu:file.submenu.closeProject'),
							label: i18n.t('menu:file.submenu.closeProject'),
							accelerator: 'Ctrl + W',
						},
					]}
					hasSibling
				/>
				<FlyoutMenu.section
					section={[
						{
							id: i18n.t('menu:file.submenu.pageSetup'),
							label: i18n.t('menu:file.submenu.pageSetup'),
							accelerator: 'Ctrl + Alt + P',
						},
						{
							id: i18n.t('menu:file.submenu.preview'),
							label: i18n.t('menu:file.submenu.preview'),
							accelerator: 'Ctrl + Shift + P',
						},
						{
							id: i18n.t('menu:file.submenu.print'),
							label: i18n.t('menu:file.submenu.print'),
							accelerator: 'Ctrl + P',
						},
					]}
					hasSibling
				/>
				<FlyoutMenu.section
					section={[
						{
							id: i18n.t('menu:file.submenu.updates'),
							label: i18n.t('menu:file.submenu.updates'),
							accelerator: 'Ctrl + U',
						},
					]}
					hasSibling
				/>
				<FlyoutMenu.section
					section={[
						{
							id: i18n.t('menu:file.submenu.quit'),
							label: i18n.t('menu:file.submenu.quit'),
							accelerator: 'Ctrl + Q',
						},
					]}
					hasSibling={false}
				/>
			</FlyoutMenu.root>
			<MenuButton>Edit</MenuButton>
			<MenuButton>Display</MenuButton>
			<MenuButton>Help</MenuButton>
			<tr className='bg-brand-light h-[1px] rotate-90 w-3' />
			<MenuButton>Recent</MenuButton>
		</div>
	)
}
