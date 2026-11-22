import {BrowserWindow, MenuItemConstructorOptions, ipcMain, shell} from 'electron';

import {EnvironmentInfo, getEnvironmentInfo} from '../util';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {AppUpdater, AppUpdaterStatus} from '../app-updater';

export interface AboutDialogArgs {
  environmentInfo: EnvironmentInfo;
  updaterStatus: AppUpdaterStatus;
}

export const subMenuHelp = (
  mainWindow: BrowserWindow,
  appUpdater: AppUpdater
): MenuItemConstructorOptions => {
  const environmentInfo = getEnvironmentInfo();
  // Menus are rebuilt per window; keep the handler registration idempotent.
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.GET_ABOUT_INFO);
  ipcMain.handle(IPC_MAIN_CHANNELS.GET_ABOUT_INFO, async (_): Promise<AboutDialogArgs> => {
    return {
      environmentInfo,
      updaterStatus: appUpdater.getStatus(),
    };
  });

  return {
    label: 'Help',
    submenu: [
      {
        label: 'Repository',
        click() {
          shell.openExternal('https://github.com/defdis/PokeFix');
        },
      },
      {
        label: 'Report an Issue',
        click() {
          shell.openExternal('https://github.com/defdis/PokeFix/issues');
        },
      },
      {
        type: 'separator',
      },
      {
        label: 'About',
        accelerator: 'F1',
        click: () => {
          mainWindow.webContents.send(IPC_MAIN_CHANNELS.OPEN_ABOUT_DIALOG, {
            environmentInfo,
            updaterStatus: appUpdater.getStatus(),
          });
        },
      },
    ],
  };
};
