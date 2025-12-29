const fs = require('fs');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'db', 'media-archive.db');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');
let serverInstance = null;

function initializeDatabase() {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  const existing = db.prepare('SELECT user_id FROM users LIMIT 1').get();
  if (!existing) {
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

  return db;
}

const db = initializeDatabase();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function now() {
  return new Date().toISOString();
}

function safeExistsSync(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch (error) {
    return false;
  }
}

function getOwnerId() {
  const row = db.prepare('SELECT user_id FROM users ORDER BY created_at LIMIT 1').get();
  return row ? row.user_id : null;
}

function ensureTagIds(userId, tagNames) {
  if (!Array.isArray(tagNames) || tagNames.length === 0) {
    return [];
  }
  const selectStmt = db.prepare('SELECT tag_id FROM tags WHERE user_id = ? AND tag_name = ?');
  const insertStmt = db.prepare('INSERT INTO tags (tag_id, user_id, tag_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  return tagNames.map((name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = selectStmt.get(userId, trimmed);
    if (existing) return existing.tag_id;
    const tagId = uuidv4();
    const timestamp = now();
    insertStmt.run(tagId, userId, trimmed, timestamp, timestamp);
    return tagId;
  }).filter(Boolean);
}

app.get('/api/bootstrap', (req, res) => {
  const userId = getOwnerId();
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  const devices = db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at').all(userId);
  const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY created_at').all(userId);
  const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY tag_name').all(userId);
  res.json({ user, devices, folders, tags });
});

app.get('/api/media', (req, res) => {
  const userId = getOwnerId();
  const { search, folderId, deviceId, mediaType, tagId } = req.query;

  const filters = ['m.user_id = ?'];
  const params = [userId];

  if (search) {
    filters.push('(m.title LIKE ? OR m.description LIKE ? OR sl.path LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (folderId) {
    filters.push('m.folder_id = ?');
    params.push(folderId);
  }
  if (mediaType) {
    filters.push('m.media_type = ?');
    params.push(mediaType);
  }
  if (deviceId) {
    filters.push('sl.device_id = ?');
    params.push(deviceId);
  }
  if (tagId) {
    filters.push('mt.tag_id = ?');
    params.push(tagId);
  }

  const sql = `
    SELECT DISTINCT
      m.item_id,
      m.title,
      m.media_type,
      m.description,
      m.folder_id,
      m.created_at,
      m.updated_at
    FROM media_items m
    LEFT JOIN storage_locations sl ON sl.item_id = m.item_id
    LEFT JOIN media_tags mt ON mt.item_id = m.item_id
    WHERE ${filters.join(' AND ')}
    ORDER BY m.created_at DESC
  `;

  const items = db.prepare(sql).all(...params);
  const locationsStmt = db.prepare('SELECT * FROM storage_locations WHERE item_id = ? ORDER BY created_at');
  const tagStmt = db.prepare(`
    SELECT t.*
    FROM tags t
    JOIN media_tags mt ON mt.tag_id = t.tag_id
    WHERE mt.item_id = ?
    ORDER BY t.tag_name
  `);

  const results = items.map((item) => ({
    ...item,
    locations: locationsStmt.all(item.item_id).map((location) => {
      if (location.storage_type === 'Local') {
        const available = safeExistsSync(location.path) ? 1 : 0;
        if (available !== location.is_available) {
          db.prepare('UPDATE storage_locations SET is_available = ?, updated_at = ? WHERE location_id = ?')
            .run(available, now(), location.location_id);
          return { ...location, is_available: available };
        }
      }
      return location;
    }),
    tags: tagStmt.all(item.item_id)
  }));

  res.json(results);
});

app.post('/api/folders', (req, res) => {
  const userId = getOwnerId();
  const { folderName, parentId } = req.body;
  const folderId = uuidv4();
  db.prepare(`
    INSERT INTO folders (folder_id, user_id, parent_id, folder_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(folderId, userId, parentId || null, folderName, now(), now());
  res.json({ folder_id: folderId });
});

app.post('/api/tags', (req, res) => {
  const userId = getOwnerId();
  const { tagName } = req.body;
  const tagId = uuidv4();
  db.prepare(`
    INSERT INTO tags (tag_id, user_id, tag_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tagId, userId, tagName, now(), now());
  res.json({ tag_id: tagId });
});

app.post('/api/devices', (req, res) => {
  const userId = getOwnerId();
  const { deviceName, deviceType } = req.body;
  const deviceId = uuidv4();
  db.prepare(`
    INSERT INTO devices (device_id, user_id, device_name, device_type, last_sync_time, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(deviceId, userId, deviceName, deviceType || null, now(), now(), now());
  res.json({ device_id: deviceId });
});

app.post('/api/media', (req, res) => {
  const userId = getOwnerId();
  const {
    title,
    mediaType,
    description,
    folderId,
    tags,
    storageType,
    path: mediaPath,
    accessInfo,
    deviceId,
    isAvailable
  } = req.body;

  const availability = isAvailable === false ? 0 : 1;

  const itemId = uuidv4();
  db.prepare(`
    INSERT INTO media_items (item_id, user_id, folder_id, title, media_type, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, userId, folderId || null, title, mediaType, description || null, now(), now());

  const locationId = uuidv4();
  db.prepare(`
    INSERT INTO storage_locations (location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    locationId,
    itemId,
    deviceId || null,
    storageType,
    mediaPath,
    accessInfo || null,
    availability,
    now(),
    now()
  );

  if (Array.isArray(tags)) {
    const insertTag = db.prepare('INSERT OR IGNORE INTO media_tags (item_id, tag_id) VALUES (?, ?)');
    const tagIds = ensureTagIds(userId, tags);
    tagIds.forEach((tagId) => insertTag.run(itemId, tagId));
  }

  res.json({ item_id: itemId });
});

app.put('/api/media/:id', (req, res) => {
  const { id } = req.params;
  const { title, mediaType, description, folderId } = req.body;
  db.prepare(`
    UPDATE media_items
    SET title = ?, media_type = ?, description = ?, folder_id = ?, updated_at = ?
    WHERE item_id = ?
  `).run(title, mediaType, description, folderId || null, now(), id);
  res.json({ ok: true });
});

app.post('/api/media/:id/tags', (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;
  db.prepare('DELETE FROM media_tags WHERE item_id = ?').run(id);
  if (Array.isArray(tags)) {
    const userId = getOwnerId();
    const insertTag = db.prepare('INSERT OR IGNORE INTO media_tags (item_id, tag_id) VALUES (?, ?)');
    const tagIds = ensureTagIds(userId, tags);
    tagIds.forEach((tagId) => insertTag.run(id, tagId));
  }
  db.prepare('UPDATE media_items SET updated_at = ? WHERE item_id = ?').run(now(), id);
  res.json({ ok: true });
});

app.post('/api/media/:id/location', (req, res) => {
  const { id } = req.params;
  const { storageType, path: mediaPath, accessInfo, deviceId, isAvailable } = req.body;
  const availability = isAvailable === false ? 0 : 1;
  const locationId = uuidv4();
  db.prepare(`
    INSERT INTO storage_locations (location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    locationId,
    id,
    deviceId || null,
    storageType,
    mediaPath,
    accessInfo || null,
    availability,
    now(),
    now()
  );
  db.prepare('UPDATE media_items SET updated_at = ? WHERE item_id = ?').run(now(), id);
  res.json({ location_id: locationId });
});

app.delete('/api/media/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM media_items WHERE item_id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/storage/refresh', (req, res) => {
  const locations = db.prepare('SELECT location_id, path, storage_type, is_available FROM storage_locations').all();
  const updateStmt = db.prepare('UPDATE storage_locations SET is_available = ?, updated_at = ? WHERE location_id = ?');
  let updated = 0;
  locations.forEach((location) => {
    if (location.storage_type !== 'Local') return;
    const available = safeExistsSync(location.path) ? 1 : 0;
    if (available !== location.is_available) {
      updateStmt.run(available, now(), location.location_id);
      updated += 1;
    }
  });
  res.json({ updated });
});

app.get('/api/sync/export', (req, res) => {
  const { since } = req.query;
  const filter = since ? 'updated_at > ?' : '1=1';
  const params = since ? [since] : [];

  const payload = {
    users: db.prepare(`SELECT * FROM users WHERE ${filter}`).all(...params),
    devices: db.prepare(`SELECT * FROM devices WHERE ${filter}`).all(...params),
    folders: db.prepare(`SELECT * FROM folders WHERE ${filter}`).all(...params),
    tags: db.prepare(`SELECT * FROM tags WHERE ${filter}`).all(...params),
    media_items: db.prepare(`SELECT * FROM media_items WHERE ${filter}`).all(...params),
    storage_locations: db.prepare(`SELECT * FROM storage_locations WHERE ${filter}`).all(...params),
    media_tags: db.prepare('SELECT * FROM media_tags').all()
  };

  res.json({ exported_at: now(), payload });
});

app.post('/api/sync/import', (req, res) => {
  const { payload } = req.body;
  if (!payload) {
    res.status(400).json({ error: 'Missing payload' });
    return;
  }

  const tables = [
    { name: 'users', key: 'user_id' },
    { name: 'devices', key: 'device_id' },
    { name: 'folders', key: 'folder_id' },
    { name: 'tags', key: 'tag_id' },
    { name: 'media_items', key: 'item_id' },
    { name: 'storage_locations', key: 'location_id' }
  ];

  const insertOrReplace = (table, row) => {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(',');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
    db.prepare(sql).run(...columns.map((col) => row[col]));
  };

  const transaction = db.transaction(() => {
    tables.forEach(({ name }) => {
      const rows = payload[name] || [];
      rows.forEach((row) => insertOrReplace(name, row));
    });

    if (Array.isArray(payload.media_tags)) {
      payload.media_tags.forEach((row) => {
        db.prepare('INSERT OR IGNORE INTO media_tags (item_id, tag_id) VALUES (?, ?)')
          .run(row.item_id, row.tag_id);
      });
    }
  });

  transaction();

  res.json({ ok: true, imported_at: now() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 4000;

function startServer(options = {}) {
  if (serverInstance) {
    return serverInstance;
  }
  const resolvedPort = options.port || port;
  serverInstance = app.listen(resolvedPort, () => {
    console.log(`MediArchive Pro running at http://localhost:${resolvedPort}`);
  });
  return serverInstance;
}

function stopServer() {
  if (!serverInstance) return;
  serverInstance.close(() => {
    serverInstance = null;
  });
}

function closeDatabase() {
  db.close();
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  db,
  startServer,
  stopServer,
  closeDatabase
};
