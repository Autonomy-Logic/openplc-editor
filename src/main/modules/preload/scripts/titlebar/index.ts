import { Titlebar, TitlebarColor } from 'custom-electron-titlebar';
import { logoIcon, darkThemeIcon } from './assets/base64Icons';

window.addEventListener('DOMContentLoaded', () => {
  const options = {
    containerOverflow: 'hidden',
    backgroundColor: TitlebarColor?.fromHex('#011E4B'),
    icon: logoIcon,
  };
  new Titlebar(options);

  const cetTitlebarLeft = document.createElement('div');
  cetTitlebarLeft.className = 'cet-titlebar-left';
  const cetIcon = document.querySelector('.cet-icon');
  const cetMenubar = document.querySelector('.cet-menubar');
  cetTitlebarLeft.appendChild(cetIcon);
  cetTitlebarLeft.appendChild(cetMenubar);
  const cetDragRegion = document.querySelector('.cet-drag-region');
  cetDragRegion.parentNode.insertBefore(cetTitlebarLeft, cetDragRegion.nextSibling);

  const cetTitleCenter = document.querySelector('.cet-title');

  const cetToggleContainer = document.createElement('div');
  cetToggleContainer.className = 'cet-toggle-container';
  const toggThemeleIcon = document.createElement('img');
  toggThemeleIcon.src = darkThemeIcon;
  toggThemeleIcon.className = 'cet-toggle-theme-icon';
  cetToggleContainer.appendChild(toggThemeleIcon);
  cetTitleCenter.appendChild(cetToggleContainer);

  const cetTitlebarRight = document.createElement('div');
  cetTitlebarRight.className = 'cet-titlebar-right';

  cetTitleCenter.insertAdjacentElement('afterend', cetTitlebarRight);

  const cetTitlebarControlsContainer = document.createElement('div');
  cetTitlebarControlsContainer.className = 'cet-titlebar-controls-container';

  const cetWindowControls = document.querySelector('.cet-window-controls');
  cetTitlebarControlsContainer.appendChild(cetWindowControls);

  cetTitlebarRight.insertAdjacentElement('afterend', cetTitlebarControlsContainer);

  const currentURL = window.location.pathname;

  if (currentURL === '/') {
    
    const cetMenubar = document.querySelector('.cet-menubar');
    cetMenubar.style.display = 'none';

    const cetToggleContainer = document.querySelector('.cet-toggle-container');
    cetToggleContainer.style.display = 'none';
  }
});
