import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const dataDir = resolve(process.env.DATA_DIR || 'data');
const source = join(dataDir, 'nexus.db');
if (!existsSync(source)) {
  console.error(`未找到数据库：${source}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dataDir, `backup-${stamp}.db`);
const db = new DatabaseSync(source);
try {
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  console.log(`备份完成：${target}`);
} finally {
  db.close();
}
