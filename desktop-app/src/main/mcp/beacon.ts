import {app} from 'electron';
import fs from 'fs';
import path from 'path';
import {
  MCP_BEACON_FILENAME,
  MCP_BRIDGE_DIR,
  MCP_BRIDGE_FILENAME,
  McpBeacon,
} from '../../common/mcp';

/**
 * Returns a bridge entry point that outlives this process. The bridge is
 * copied into userData on EVERY platform so agent configs can reference a
 * stable absolute path (the app bundle may move; AppImage mounts are
 * transient on Linux). On non-packaged dev builds there is no bridge.
 */
const stableBridgeEntry = (): string | undefined => {
  if (!app.isPackaged) {
    return undefined;
  }
  const packagedEntry = path.join(process.resourcesPath, MCP_BRIDGE_DIR, MCP_BRIDGE_FILENAME);
  if (!fs.existsSync(packagedEntry)) {
    return undefined;
  }
  const stableDir = path.join(app.getPath('userData'), MCP_BRIDGE_DIR);
  fs.mkdirSync(stableDir, {recursive: true});
  [MCP_BRIDGE_FILENAME, 'manifest.json'].forEach((file) => {
    const src = path.join(process.resourcesPath, MCP_BRIDGE_DIR, file);
    if (!fs.existsSync(src)) {
      return;
    }
    // Copy via tmp + rename so a concurrently-reading agent never sees a partial bridge.
    const dest = path.join(stableDir, file);
    const tmp = `${dest}.pokefix-${process.pid}.tmp`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dest);
  });
  return path.join(stableDir, MCP_BRIDGE_FILENAME);
};

export const writeMcpBeacon = (mcpPort: number): void => {
  try {
    const beacon: McpBeacon = {
      // AppImage process.execPath points into a transient mount; $APPIMAGE is
      // the real file the user keeps.
      binaryPath: process.env.APPIMAGE ?? process.execPath,
      ...(app.isPackaged ? {resourcesPath: process.resourcesPath} : {}),
      bridgeEntry: stableBridgeEntry(),
      version: app.getVersion(),
      mcpPort,
      writtenAt: new Date().toISOString(),
    };
    const userDataDir = app.getPath('userData');
    fs.mkdirSync(userDataDir, {recursive: true});
    const beaconPath = path.join(userDataDir, MCP_BEACON_FILENAME);
    const tmp = `${beaconPath}.pokefix-${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(beacon, null, 2));
    fs.renameSync(tmp, beaconPath);
  } catch (error) {
    console.warn('[mcp] Could not write the app-location beacon:', error);
  }
};
