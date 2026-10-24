// Safe online backup of the database (works while the app is running).
//   node server/backup.js            → DATA_DIR/backups/cafe-YYYYMMDD-HHMMSS.db, keeps the newest 30
//   KEEP=60 node server/backup.js    → keep 60 instead
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR || path.resolve("data");
const dbPath = process.env.DB_PATH || path.join(dataDir, "cafe.db");
const outDir = process.env.BACKUP_DIR || path.join(dataDir, "backups");
const keep = Math.max(1, Number(process.env.KEEP || 30));

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const file = path.join(outDir, `cafe-${stamp}.db`);

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written: ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);

// Keep only the newest backups made by this script.
const old = fs.readdirSync(outDir).filter((f) => /^cafe-\d{8}-\d{6}\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.rmSync(path.join(outDir, f));
if (old.length) console.log(`Removed ${old.length} old backup(s), keeping ${keep}.`);
