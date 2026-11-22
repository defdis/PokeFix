// Removes leftover .map files from browser-sync's dist (kept out of the
// packaged app). Tolerates "nothing to remove": exits 0 either way.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', 'node_modules', 'browser-sync', 'dist');
let removed = 0;
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return; // browser-sync not installed (or layout changed) — nothing to prune
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.map')) {
      fs.rmSync(full, {force: true});
      removed += 1;
    }
  }
}
walk(root);
console.log(`prune-browser-sync-maps: removed ${removed} file(s)`);
