import { CONSTANTS } from '@shared/constants';
import { z } from 'zod';

const { paths } = CONSTANTS;

export const childWindowSchema = z.object({
  path: z.string().refine((theme) => Object.values(paths).includes(theme)),
  hideMenuBar: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  center: z.boolean().optional(),
  minWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxWidth: z.number().optional(),
  maxHeight: z.number().optional(),
  resizable: z.boolean().optional(),
  movable: z.boolean().optional(),
  minimizable: z.boolean().optional(),
  maximizable: z.boolean().optional(),
  closable: z.boolean().optional(),
  focusable: z.boolean().optional(),
  alwaysOnTop: z.boolean().optional(),
  fullscreen: z.boolean().optional(),
  fullscreenable: z.boolean().optional(),
  simpleFullscreen: z.boolean().optional(),
  skipTaskbar: z.boolean().optional(),
  title: z.string().optional(),
  frame: z.boolean().optional(),
  modal: z.boolean().optional(),
  autoHideMenuBar: z.boolean().optional(),
  backgroundColor: z.string().optional(),
  hasShadow: z.boolean().optional(),
  opacity: z.number().optional(),
  transparent: z.boolean().optional(),
  type: z.string().optional(),
  titleBarStyle: z
    .enum(['default', 'hidden', 'hiddenInset', 'customButtonsOnHover'])
    .optional(),
});

export type ChildWindowProps = z.infer<typeof childWindowSchema>;
