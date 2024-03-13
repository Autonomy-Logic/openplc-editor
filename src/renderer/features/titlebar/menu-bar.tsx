import { useState } from "react";
import { FlyoutMenu } from "./menu/flyout";
import { MenuButton } from "./menu/menu-button";

import * as MenuPrimitive from "@radix-ui/react-menubar";

import { i18n } from "~utils/i18n";

export const MenuBar = () => {
  const prefersDarkMode = window.matchMedia?.(
    "(prefers-color-scheme: dark)",
  ).matches;

  const [isDark, setIsDark] = useState(prefersDarkMode);

  const handleChangeTheme = async (variant: "light" | "dark") => {
    if (variant === "dark" && isDark) {
      return;
    } else if (variant === "light" && !isDark) {
      return;
    } else {
      const res = await window.bridge.toggleTheme();
      setIsDark(res);
    }
  };
  //each root is a menu
  return (
    <MenuPrimitive.Root className="h-full flex-1 flex items-center gap-2">
      <MenuPrimitive.Menu>
        <MenuPrimitive.Trigger>
          {i18n.t("menu:file.label")}
        </MenuPrimitive.Trigger>
        <MenuPrimitive.Portal>
          <MenuPrimitive.Content>
            <MenuPrimitive.Item asChild>
              <p>
                <span>{i18n.t("menu:file.submenu.new")}</span>
                <span>{"Ctrl + N"}</span>
              </p>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item asChild>
              <p>
                <span>{i18n.t("menu:file.submenu.open")}</span>
                <span>{"Ctrl + O"}</span>
              </p>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item asChild>
              <p>
                <span>{i18n.t("menu:file.submenu.save")}</span>
                <span>{"Ctrl + S"}</span>
              </p>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item asChild>
              <p>
                <span>{i18n.t("menu:file.submenu.saveAs")}</span>
                <span>{"Ctrl + Shift + S"}</span>
              </p>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item asChild>
              <p>
                <span>{i18n.t("menu:file.submenu.closeTab")}</span>
                <span>{"Ctrl + W"}</span>
              </p>
            </MenuPrimitive.Item>
            <MenuPrimitive.Item asChild>
              <p>
                <span>{i18n.t("menu:file.submenu.closeProject")}</span>
                <span>{"Ctrl  + W"}</span>
              </p>
            </MenuPrimitive.Item>

            <MenuPrimitive.Separator />
          </MenuPrimitive.Content>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Menu>

      {/* <FlyoutMenu.root label={i18n.t("menu:file.label")}>
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:file.submenu.open"),
              label: i18n.t("menu:file.submenu.open"),
              accelerator: "Ctrl + O",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:file.submenu.save"),
              label: i18n.t("menu:file.submenu.save"),
              accelerator: "Ctrl + S",
            },
            {
              id: i18n.t("menu:file.submenu.saveAs"),
              label: i18n.t("menu:file.submenu.saveAs"),
              accelerator: "Ctrl + Shift + S",
            },
            {
              id: i18n.t("menu:file.submenu.closeTab"),
              label: i18n.t("menu:file.submenu.closeTab"),
              accelerator: "Ctrl + W",
            },
            {
              id: i18n.t("menu:file.submenu.closeProject"),
              label: i18n.t("menu:file.submenu.closeProject"),
              accelerator: "Ctrl + W",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:file.submenu.pageSetup"),
              label: i18n.t("menu:file.submenu.pageSetup"),
              accelerator: "Ctrl + Alt + P",
            },
            {
              id: i18n.t("menu:file.submenu.preview"),
              label: i18n.t("menu:file.submenu.preview"),
              accelerator: "Ctrl + Shift + P",
            },
            {
              id: i18n.t("menu:file.submenu.print"),
              label: i18n.t("menu:file.submenu.print"),
              accelerator: "Ctrl + P",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:file.submenu.updates"),
              label: i18n.t("menu:file.submenu.updates"),
              accelerator: "Ctrl + U",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:file.submenu.quit"),
              label: i18n.t("menu:file.submenu.quit"),
              accelerator: "Ctrl + Q",
            },
          ]}
          hasSibling={false}
        />
      </FlyoutMenu.root>
      <FlyoutMenu.root label={i18n.t("menu:edit.label")}>
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:edit.submenu.undo"),
              label: i18n.t("menu:edit.submenu.undo"),
              accelerator: "Ctrl + Z",
            },
            {
              id: i18n.t("menu:edit.submenu.redo"),
              label: i18n.t("menu:edit.submenu.redo"),
              accelerator: "Ctrl + Y",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:edit.submenu.cut"),
              label: i18n.t("menu:edit.submenu.cut"),
              accelerator: "Ctrl + X",
            },
            {
              id: i18n.t("menu:edit.submenu.copy"),
              label: i18n.t("menu:edit.submenu.copy"),
              accelerator: "Ctrl + C",
            },
            {
              id: i18n.t("menu:edit.submenu.paste"),
              label: i18n.t("menu:edit.submenu.paste"),
              accelerator: "Ctrl + V",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:edit.submenu.find"),
              label: i18n.t("menu:edit.submenu.find"),
              accelerator: "Ctrl + F",
            },
            {
              id: i18n.t("menu:edit.submenu.findNext"),
              label: i18n.t("menu:edit.submenu.findNext"),
              accelerator: "Ctrl + K",
            },
            {
              id: i18n.t("menu:edit.submenu.findPrevious"),
              label: i18n.t("menu:edit.submenu.findPrevious"),
              accelerator: "Ctrl + Shift + K",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:edit.submenu.findInProject"),
              label: i18n.t("menu:edit.submenu.findInProject"),
              accelerator: "Ctrl + Shift + F",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:edit.submenu.addElement.label"),
              label: i18n.t("menu:edit.submenu.addElement.label"),
              accelerator: "",
            },
            {
              id: i18n.t("menu:edit.submenu.selectAll"),
              label: i18n.t("menu:edit.submenu.selectAll"),
              accelerator: "Ctrl + A",
            },
            {
              id: i18n.t("menu:edit.submenu.delete"),
              label: i18n.t("menu:edit.submenu.delete"),
              accelerator: "",
            },
          ]}
        />
      </FlyoutMenu.root>
      <FlyoutMenu.root label={i18n.t("menu:display.label")}>
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:display.submenu.refresh"),
              label: i18n.t("menu:display.submenu.refresh"),
              accelerator: "Ctrl + R",
            },
            {
              id: i18n.t("menu:display.submenu.clearErrors"),
              label: i18n.t("menu:display.submenu.clearErrors"),
              accelerator: "",
            },
          ]}
          hasSibling
        />
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:display.submenu.zoomIn"),
              label: i18n.t("menu:display.submenu.zoomIn"),
              accelerator: "Ctrl + +",
            },
            {
              id: i18n.t("menu:display.submenu.zoomOut"),
              label: i18n.t("menu:display.submenu.zoomOut"),
              accelerator: "Ctrl + -",
            },
            {
              id: i18n.t("menu:display.submenu.switchPerspective"),
              label: i18n.t("menu:display.submenu.switchPerspective"),
              accelerator: "F12",
            },
            {
              id: i18n.t("menu:display.submenu.resetPerspective"),
              label: i18n.t("menu:display.submenu.resetPerspective"),
              accelerator: "Shift + F12",
            },
            {
              id: i18n.t("menu:display.submenu.fullScreen"),
              label: i18n.t("menu:display.submenu.fullScreen"),
              accelerator: "F11",
            },
            {
              id: i18n.t("menu:display.submenu.sortAlpha"),
              label: i18n.t("menu:display.submenu.sortAlpha"),
              accelerator: "F10",
            },
            {
              id: i18n.t("menu:display.submenu.theme.label"),
              label: i18n.t("menu:display.submenu.theme.label"),
              submenu: [
                {
                  id: i18n.t("menu:display.submenu.theme.submenu.light"),
                  label: i18n.t("menu:display.submenu.theme.submenu.light"),
                  accelerator: "",
                  selected: isDark ? false : true,
                  action: () => {
                    handleChangeTheme("light");
                  },
                },
                {
                  id: i18n.t("menu:display.submenu.theme.submenu.dark"),
                  label: i18n.t("menu:display.submenu.theme.submenu.dark"),
                  accelerator: "",
                  selected: isDark ? true : false,
                  action: () => {
                    handleChangeTheme("dark");
                  },
                },
              ],
            },
          ]}
        />
      </FlyoutMenu.root>
      <FlyoutMenu.root label={i18n.t("menu:help.label")}>
        <FlyoutMenu.section
          section={[
            {
              id: i18n.t("menu:help.submenu.communitySupport"),
              label: i18n.t("menu:help.submenu.communitySupport"),
              accelerator: "",
            },
            {
              id: i18n.t("menu:help.submenu.about"),
              label: i18n.t("menu:help.submenu.about"),
              accelerator: "",
            },
          ]}
        />
      </FlyoutMenu.root>
      <div className="bg-brand-light h-[1px] rotate-90 w-3" />
      <MenuButton>Recent</MenuButton> */}
    </MenuPrimitive.Root>
  );
};
