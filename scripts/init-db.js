const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '..', 'db', 'media-archive.db');
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

const schema = fs.readFileSync(schemaPath, 'utf8');
const db = new Database(dbPath);

db.exec(schema);

const userRow = db.prepare('SELECT user_id FROM users LIMIT 1').get();
if (!userRow) {
  const userId = uuidv4();
  db.prepare('INSERT INTO users (user_id, username) VALUES (?, ?)')
    .run(userId, 'owner');

  const deviceId = uuidv4();
  db.prepare('INSERT INTO devices (device_id, user_id, device_name, device_type, last_sync_time) VALUES (?, ?, ?, ?, ?)')
    .run(deviceId, userId, '本机设备', 'PC', new Date().toISOString());

  const folderId = uuidv4();
  db.prepare('INSERT INTO folders (folder_id, user_id, parent_id, folder_name) VALUES (?, ?, ?, ?)')
    .run(folderId, userId, null, '默认文件夹');
}

db.close();
console.log('Database initialized at', dbPath);
