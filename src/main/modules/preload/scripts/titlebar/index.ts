// import { Titlebar, TitlebarColor } from "custom-electron-titlebar";
// import { logoIcon } from "./assets/base64Icons";

// window.addEventListener("DOMContentLoaded", () => {
//   const options = {
//     containerOverflow: "hidden",
//     backgroundColor: TitlebarColor?.fromHex("#011E4B"),
//     icon: logoIcon,
//   };
//   new Titlebar(options);
//   window.addEventListener("load", () => {
//     const cetTitlebarLeft = document.createElement("div");
//     cetTitlebarLeft.className = "cet-titlebar-left";
//     const cetIcon = document.querySelector(".cet-icon");
//     const cetMenubar = document.querySelector(".cet-menubar");
//     cetTitlebarLeft.appendChild(cetIcon);
//     cetTitlebarLeft.appendChild(cetMenubar);

//     const cetDragRegion = document.querySelector(".cet-drag-region");
//     cetDragRegion.parentNode.insertBefore(
//       cetTitlebarLeft,
//       cetDragRegion.nextSibling,
//     );

//     const cetTitleCenter = document.querySelector(".cet-title");

//     const cetTitlebarRight = document.createElement("div");
//     cetTitlebarRight.className = "cet-titlebar-right";

//     cetTitleCenter.insertAdjacentElement("afterend", cetTitlebarRight);

//     const cetTitlebarControlsContainer = document.createElement("div");
//     cetTitlebarControlsContainer.className = "cet-titlebar-controls-container";

//     const cetWindowControls = document.querySelector(".cet-window-controls");
//     cetTitlebarControlsContainer.appendChild(cetWindowControls);

//     cetTitlebarRight.insertAdjacentElement(
//       "afterend",
//       cetTitlebarControlsContainer,
//     );

//     const menuButton = document.querySelectorAll(".cet-menubar-menu-button");
//     const divider = document.createElement("div");
//     divider.className = "menu-divider";
//     const menuDivider = menuButton.item(4);
//     if (menuDivider) {
//       menuDivider.insertAdjacentElement("beforebegin", divider);
//     }
//   });
// });
