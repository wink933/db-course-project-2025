const fs = require('fs');
const path = require('path');
const express = require('express');
const os = require('os');
const multer = require('multer');
const contentDisposition = require('content-disposition');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'db', 'media-archive.db');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');
let serverInstance = null;

function columnExists(db, tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((r) => r && r.name === columnName);
}

function ensureFolderSortOrder(db) {
  const hasSortOrder = columnExists(db, 'folders', 'sort_order');
  if (!hasSortOrder) {
    db.exec('ALTER TABLE folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_folders_user_parent_sort ON folders(user_id, parent_id, sort_order)');

  const hasNonZero = db.prepare('SELECT folder_id FROM folders WHERE sort_order != 0 LIMIT 1').get();
  if (hasNonZero) return;

  const parents = db.prepare('SELECT DISTINCT parent_id FROM folders').all();
  const updateStmt = db.prepare('UPDATE folders SET sort_order = ?, updated_at = ? WHERE folder_id = ?');
  const tx = db.transaction(() => {
    parents.forEach(({ parent_id }) => {
      const siblings = db
        .prepare('SELECT folder_id FROM folders WHERE parent_id IS ? ORDER BY created_at, folder_id')
        .all(parent_id ?? null);
      siblings.forEach((row, index) => {
        updateStmt.run(index, now(), row.folder_id);
      });
    });
  });
  tx();
}

function ensureMediaDeletedAt(db) {
  const hasDeletedAt = columnExists(db, 'media_items', 'deleted_at');
  if (!hasDeletedAt) {
    db.exec('ALTER TABLE media_items ADD COLUMN deleted_at TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_deleted_at ON media_items(deleted_at)');
}

function initializeDatabase() {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  ensureFolderSortOrder(db);
  ensureMediaDeletedAt(db);

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

function ensureDirSync(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function getUploadsDir() {
  const dir = path.join(path.dirname(dbPath), 'uploads');
  ensureDirSync(dir);
  return dir;
}

function safeFileExtension(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (!ext) return '';
  if (!/^\.[a-z0-9]{1,12}$/.test(ext)) return '';
  return ext;
}

function inferMediaTypeFromUpload(file, providedType) {
  const type = (providedType || '').toString().trim();
  if (type) return type;
  const mime = (file?.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('video/')) return 'Video';
  return 'Doc';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, getUploadsDir());
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = safeFileExtension(file?.originalname);
      cb(null, `${uuidv4()}${ext}`);
    }
  })
});

function findLocalLocationByPath(candidatePath) {
  if (!candidatePath) return null;
  const normalized = path.normalize(candidatePath);
  if (!path.isAbsolute(normalized)) return null;

  let realPath = normalized;
  try {
    realPath = fs.realpathSync.native(normalized);
  } catch {
    // ignore
  }

  const row = db.prepare(`
    SELECT *
    FROM storage_locations
    WHERE storage_type = 'Local'
      AND (path = ? OR path = ?)
    LIMIT 1
  `).get(normalized, realPath);

  if (!row) return null;
  return { location: row, normalized, realPath };
}

function ensureFileExists(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function openWithDefaultApp(targetPath) {
  const platform = process.platform;
  if (platform === 'darwin') {
    const child = spawn('open', [targetPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  if (platform === 'win32') {
    const quoted = `"${targetPath}"`;
    const child = spawn('cmd', ['/c', 'start', '', quoted], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

function isLoopbackAddress(ip) {
  if (!ip) return false;
  const value = ip.toString();
  return (
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1'
  );
}

function setKnownContentType(res, filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (!ext) return;
  // iOS 常见格式：HEIC/HEIF 以及 QuickTime MOV
  const map = {
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mov': 'video/quicktime'
  };
  const known = map[ext];
  if (known) {
    res.setHeader('Content-Type', known);
  }
}

app.get('/api/file', (req, res) => {
  const target = req.query.path;
  if (!target) {
    res.status(400).json({ error: 'Missing path' });
    return;
  }

  const found = findLocalLocationByPath(target);
  if (!found) {
    res.status(403).json({ error: 'Path not registered' });
    return;
  }

  const candidate = ensureFileExists(found.realPath) ? found.realPath : found.normalized;
  if (!ensureFileExists(candidate)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(candidate, path.basename(candidate));
});

app.get('/api/file/view', (req, res) => {
  const target = req.query.path;
  if (!target) {
    res.status(400).json({ error: 'Missing path' });
    return;
  }

  const found = findLocalLocationByPath(target);
  if (!found) {
    res.status(403).json({ error: 'Path not registered' });
    return;
  }

  const candidate = ensureFileExists(found.realPath) ? found.realPath : found.normalized;
  if (!ensureFileExists(candidate)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.setHeader('Content-Disposition', contentDisposition(path.basename(candidate), { type: 'inline' }));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(candidate);
});

app.get('/api/media/:itemId/preview', (req, res) => {
  const { itemId } = req.params;
  const { locationId } = req.query;
  if (!itemId) {
    res.status(400).json({ error: 'Missing itemId' });
    return;
  }

  let location;
  if (locationId) {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE location_id = ? AND item_id = ? AND storage_type = 'Local'
      LIMIT 1
    `).get(locationId, itemId);
  } else {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE item_id = ? AND storage_type = 'Local'
      ORDER BY is_available DESC, created_at ASC
      LIMIT 1
    `).get(itemId);
  }

  if (!location) {
    res.status(404).json({ error: 'No local location for item' });
    return;
  }

  const normalized = path.normalize(location.path);
  if (!path.isAbsolute(normalized)) {
    res.status(400).json({ error: 'Invalid stored path' });
    return;
  }

  let candidate = normalized;
  try {
    const realPath = fs.realpathSync.native(normalized);
    if (ensureFileExists(realPath)) candidate = realPath;
  } catch {
    // ignore
  }

  if (!ensureFileExists(candidate)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  // 预览场景：避免 iOS/Safari 对带 filename 的 inline Content-Disposition 兼容性问题。
  // 同时为 iOS 常见格式补齐 Content-Type，配合 nosniff 才能正常渲染。
  setKnownContentType(res, candidate);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(candidate);
});

app.get('/api/media/:itemId/download', (req, res) => {
  const { itemId } = req.params;
  const { locationId } = req.query;
  if (!itemId) {
    res.status(400).json({ error: 'Missing itemId' });
    return;
  }

  let location;
  if (locationId) {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE location_id = ? AND item_id = ? AND storage_type = 'Local'
      LIMIT 1
    `).get(locationId, itemId);
  } else {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE item_id = ? AND storage_type = 'Local'
      ORDER BY is_available DESC, created_at ASC
      LIMIT 1
    `).get(itemId);
  }

  if (!location) {
    res.status(404).json({ error: 'No local location for item' });
    return;
  }

  const normalized = path.normalize(location.path);
  if (!path.isAbsolute(normalized)) {
    res.status(400).json({ error: 'Invalid stored path' });
    return;
  }

  let candidate = normalized;
  try {
    const realPath = fs.realpathSync.native(normalized);
    if (ensureFileExists(realPath)) candidate = realPath;
  } catch {
    // ignore
  }

  if (!ensureFileExists(candidate)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.setHeader('Content-Disposition', contentDisposition(path.basename(candidate), { type: 'attachment' }));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(candidate);
});

app.post('/api/media/:itemId/open', (req, res) => {
  const { itemId } = req.params;
  const { locationId } = req.query;
  if (!itemId) {
    res.status(400).json({ error: 'Missing itemId' });
    return;
  }

  // 安全保护：仅允许本机（localhost）触发“在电脑上打开默认应用”。
  // 移动端/其他设备访问时应使用 download。
  const remote = req.socket?.remoteAddress || req.ip;
  if (!isLoopbackAddress(remote)) {
    res.status(403).json({ error: 'Open is only allowed from localhost. Use download instead.' });
    return;
  }

  let location;
  if (locationId) {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE location_id = ? AND item_id = ? AND storage_type = 'Local'
      LIMIT 1
    `).get(locationId, itemId);
  } else {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE item_id = ? AND storage_type = 'Local'
      ORDER BY is_available DESC, created_at ASC
      LIMIT 1
    `).get(itemId);
  }

  if (!location) {
    res.status(404).json({ error: 'No local location for item' });
    return;
  }

  const normalized = path.normalize(location.path);
  if (!path.isAbsolute(normalized)) {
    res.status(400).json({ error: 'Invalid stored path' });
    return;
  }

  let candidate = normalized;
  try {
    const realPath = fs.realpathSync.native(normalized);
    if (ensureFileExists(realPath)) candidate = realPath;
  } catch {
    // ignore
  }

  if (!ensureFileExists(candidate)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    openWithDefaultApp(candidate);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Failed to open file' });
  }
});

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

function safeStatSync(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function resolveExistingPath(targetPath) {
  if (!targetPath) return null;
  const normalized = path.normalize(targetPath);
  if (!path.isAbsolute(normalized)) return null;
  try {
    const real = fs.realpathSync.native(normalized);
    if (ensureFileExists(real)) return real;
  } catch {
    // ignore
  }
  if (ensureFileExists(normalized)) return normalized;
  return null;
}

function getLocalFileMeta(targetPath) {
  const resolved = resolveExistingPath(targetPath);
  if (!resolved) return null;
  const stat = safeStatSync(resolved);
  if (!stat || !stat.isFile()) return null;
  return {
    file_size: stat.size,
    file_mtime: stat.mtime ? stat.mtime.toISOString() : null
  };
}

function revealInFileManager(targetPath) {
  const platform = process.platform;
  if (platform === 'darwin') {
    const child = spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  if (platform === 'win32') {
    const child = spawn('explorer.exe', ['/select,', targetPath], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return;
  }
  // Linux: fall back to opening the containing directory
  const dir = path.dirname(targetPath);
  const child = spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' });
  child.unref();
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
  const folders = db.prepare(`
    SELECT *
    FROM folders
    WHERE user_id = ?
    ORDER BY (parent_id IS NOT NULL) ASC, parent_id, sort_order, created_at
  `).all(userId);
  const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY tag_name').all(userId);
  res.json({ user, devices, folders, tags });
});

app.get('/api/media', (req, res) => {
  const userId = getOwnerId();
  const { search, folderId, deviceId, mediaType, tagId, trash } = req.query;

  const filters = ['m.user_id = ?'];
  const params = [userId];

  if (trash === '1' || trash === 'true') {
    filters.push('m.deleted_at IS NOT NULL');
  } else {
    filters.push('m.deleted_at IS NULL');
  }

  if (search) {
    filters.push('(m.title LIKE ? OR m.description LIKE ? OR sl.path LIKE ? OR t.tag_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
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
      m.updated_at,
      m.deleted_at
    FROM media_items m
    LEFT JOIN storage_locations sl ON sl.item_id = m.item_id
    LEFT JOIN media_tags mt ON mt.item_id = m.item_id
    LEFT JOIN tags t ON t.tag_id = mt.tag_id
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
          const meta = getLocalFileMeta(location.path);
          return { ...location, is_available: available, ...(meta || {}) };
        }
        const meta = getLocalFileMeta(location.path);
        if (meta) return { ...location, ...(meta || {}) };
      }
      return location;
    }),
    tags: tagStmt.all(item.item_id)
  }));

  res.json(results);
});

app.post('/api/media/:itemId/reveal', (req, res) => {
  const { itemId } = req.params;
  const { locationId } = req.query;
  if (!itemId) {
    res.status(400).json({ error: 'Missing itemId' });
    return;
  }

  // 安全保护：仅允许本机（localhost）触发“在资源管理器/Finder 中定位”。
  const remote = req.socket?.remoteAddress || req.ip;
  if (!isLoopbackAddress(remote)) {
    res.status(403).json({ error: 'Reveal is only allowed from localhost.' });
    return;
  }

  let location;
  if (locationId) {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE location_id = ? AND item_id = ? AND storage_type = 'Local'
      LIMIT 1
    `).get(locationId, itemId);
  } else {
    location = db.prepare(`
      SELECT *
      FROM storage_locations
      WHERE item_id = ? AND storage_type = 'Local'
      ORDER BY is_available DESC, created_at ASC
      LIMIT 1
    `).get(itemId);
  }

  if (!location) {
    res.status(404).json({ error: 'No local location for item' });
    return;
  }

  const candidate = resolveExistingPath(location.path);
  if (!candidate) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    revealInFileManager(candidate);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Failed to reveal file' });
  }
});

app.post('/api/media/upload', upload.single('file'), (req, res) => {
  const userId = getOwnerId();
  const uploaded = req.file;
  if (!uploaded) {
    res.status(400).json({ error: 'Missing file' });
    return;
  }

  const itemId = uuidv4();
  const locationId = uuidv4();

  const rawTitle = (req.body?.title || '').toString().trim();
  const fallbackTitle = (uploaded.originalname || '').replace(/\.[^./\\]+$/, '').trim();
  const title = rawTitle || fallbackTitle || '未命名';

  const folderId = (req.body?.folderId || '').toString().trim() || null;
  const description = (req.body?.description || '').toString().trim() || null;
  const mediaType = inferMediaTypeFromUpload(uploaded, req.body?.mediaType);

  let tagNames = [];
  const rawTags = req.body?.tags;
  if (Array.isArray(rawTags)) {
    tagNames = rawTags.map((t) => (t ?? '').toString().trim()).filter(Boolean);
  } else if (typeof rawTags === 'string' && rawTags.trim()) {
    try {
      const parsed = JSON.parse(rawTags);
      if (Array.isArray(parsed)) {
        tagNames = parsed.map((t) => (t ?? '').toString().trim()).filter(Boolean);
      } else {
        tagNames = rawTags.split(',').map((t) => t.trim()).filter(Boolean);
      }
    } catch {
      tagNames = rawTags.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }

  const savedPath = path.resolve(uploaded.path);
  if (!path.isAbsolute(savedPath)) {
    try {
      fs.unlinkSync(uploaded.path);
    } catch {}
    res.status(500).json({ error: 'Invalid saved path' });
    return;
  }

  const deviceRow = db.prepare('SELECT device_id FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId);
  const defaultDeviceId = deviceRow?.device_id || null;

  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO media_items (item_id, user_id, folder_id, title, media_type, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(itemId, userId, folderId, title, mediaType, description, now(), now());

      db.prepare(`
        INSERT INTO storage_locations (location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at)
        VALUES (?, ?, ?, 'Local', ?, NULL, 1, ?, ?)
      `).run(locationId, itemId, defaultDeviceId, savedPath, now(), now());

      if (tagNames.length) {
        const insertTag = db.prepare('INSERT OR IGNORE INTO media_tags (item_id, tag_id) VALUES (?, ?)');
        const tagIds = ensureTagIds(userId, tagNames);
        tagIds.forEach((tagId) => insertTag.run(itemId, tagId));
      }
    });
    tx();

    res.json({ item_id: itemId, location_id: locationId, path: savedPath });
  } catch (error) {
    try {
      fs.unlinkSync(uploaded.path);
    } catch {}
    res.status(500).json({ error: error?.message || 'Upload failed' });
  }
});

app.post('/api/folders', (req, res) => {
  const userId = getOwnerId();
  const { folderName, parentId } = req.body;
  if (!folderName) {
    res.status(400).json({ error: 'Missing folderName' });
    return;
  }
  const folderId = uuidv4();
  const resolvedParentId = parentId || null;
  const nextSortOrderRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM folders WHERE user_id = ? AND parent_id IS ?')
    .get(userId, resolvedParentId);
  const sortOrder = Number.isFinite(nextSortOrderRow?.next_order) ? nextSortOrderRow.next_order : 0;
  db.prepare(`
    INSERT INTO folders (folder_id, user_id, parent_id, folder_name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(folderId, userId, resolvedParentId, folderName, sortOrder, now(), now());
  res.json({ folder_id: folderId });
});

app.post('/api/folders/reorder', (req, res) => {
  const userId = getOwnerId();
  const { parentId, orderedIds } = req.body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    res.status(400).json({ error: 'Missing orderedIds' });
    return;
  }

  const unique = Array.from(new Set(orderedIds));
  if (unique.length !== orderedIds.length) {
    res.status(400).json({ error: 'Duplicate folder ids' });
    return;
  }

  const resolvedParentId = parentId || null;
  const placeholders = orderedIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT folder_id, parent_id FROM folders WHERE user_id = ? AND folder_id IN (${placeholders})`)
    .all(userId, ...orderedIds);

  if (rows.length !== orderedIds.length) {
    res.status(404).json({ error: 'One or more folders not found' });
    return;
  }

  const wrongParent = rows.find((r) => (r.parent_id || null) !== resolvedParentId);
  if (wrongParent) {
    res.status(400).json({ error: 'Folders must share the same parent' });
    return;
  }

  const updateStmt = db.prepare('UPDATE folders SET sort_order = ?, updated_at = ? WHERE user_id = ? AND folder_id = ?');
  const tx = db.transaction(() => {
    orderedIds.forEach((folderId, index) => {
      updateStmt.run(index, now(), userId, folderId);
    });
  });
  tx();

  res.json({ ok: true });
});

app.patch('/api/folders/:id', (req, res) => {
  const { id } = req.params;
  const { folderName } = req.body;
  if (!folderName) {
    res.status(400).json({ error: 'Missing folderName' });
    return;
  }
  const info = db.prepare(`
    UPDATE folders
    SET folder_name = ?, updated_at = ?
    WHERE folder_id = ?
  `).run(folderName, now(), id);
  if (!info || info.changes === 0) {
    res.status(404).json({ error: 'Folder not found' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/folders/:id', (req, res) => {
  const { id } = req.params;
  const child = db.prepare('SELECT folder_id FROM folders WHERE parent_id = ? LIMIT 1').get(id);
  if (child) {
    res.status(400).json({ error: 'Folder has children' });
    return;
  }
  db.prepare('DELETE FROM folders WHERE folder_id = ?').run(id);
  res.json({ ok: true });
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

app.delete('/api/devices/:id', (req, res) => {
  const userId = getOwnerId();
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Missing device id' });
    return;
  }

  const exists = db.prepare('SELECT device_id FROM devices WHERE user_id = ? AND device_id = ?').get(userId, id);
  if (!exists) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const used = db.prepare('SELECT COUNT(1) AS cnt FROM storage_locations WHERE device_id = ?').get(id);
  const cnt = Number(used?.cnt || 0);
  if (cnt > 0) {
    res.status(400).json({ error: 'Device is in use by storage locations' });
    return;
  }

  db.prepare('DELETE FROM devices WHERE user_id = ? AND device_id = ?').run(userId, id);
  res.json({ ok: true });
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
  const force = req.query?.force === '1' || req.query?.force === 'true';
  if (force) {
    db.prepare('DELETE FROM media_items WHERE item_id = ?').run(id);
    res.json({ ok: true, deleted: 'hard' });
    return;
  }
  const info = db.prepare('UPDATE media_items SET deleted_at = ?, updated_at = ? WHERE item_id = ? AND deleted_at IS NULL')
    .run(now(), now(), id);
  if (!info || info.changes === 0) {
    res.status(404).json({ error: 'Item not found or already deleted' });
    return;
  }
  res.json({ ok: true, deleted: 'soft' });
});

app.post('/api/media/:id/restore', (req, res) => {
  const { id } = req.params;
  const info = db.prepare('UPDATE media_items SET deleted_at = NULL, updated_at = ? WHERE item_id = ? AND deleted_at IS NOT NULL')
    .run(now(), id);
  if (!info || info.changes === 0) {
    res.status(404).json({ error: 'Item not found or not deleted' });
    return;
  }
  res.json({ ok: true });
});

function normalizeItemIds(itemIds) {
  if (!Array.isArray(itemIds)) return [];
  return Array.from(new Set(itemIds.map((x) => (x ?? '').toString().trim()).filter(Boolean)));
}

app.post('/api/media/batch/move', (req, res) => {
  const userId = getOwnerId();
  const itemIds = normalizeItemIds(req.body?.itemIds);
  const folderId = (req.body?.folderId || '').toString().trim() || null;
  if (!itemIds.length) {
    res.status(400).json({ error: 'Missing itemIds' });
    return;
  }

  const exists = db.prepare(`SELECT item_id FROM media_items WHERE user_id = ? AND item_id = ? LIMIT 1`);
  const update = db.prepare('UPDATE media_items SET folder_id = ?, updated_at = ? WHERE user_id = ? AND item_id = ? AND deleted_at IS NULL');
  const tx = db.transaction(() => {
    itemIds.forEach((id) => {
      const row = exists.get(userId, id);
      if (!row) return;
      update.run(folderId, now(), userId, id);
    });
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/media/batch/tags', (req, res) => {
  const userId = getOwnerId();
  const itemIds = normalizeItemIds(req.body?.itemIds);
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((t) => (t ?? '').toString().trim()).filter(Boolean)
    : [];

  if (!itemIds.length) {
    res.status(400).json({ error: 'Missing itemIds' });
    return;
  }
  if (!tags.length) {
    res.status(400).json({ error: 'Missing tags' });
    return;
  }

  const tagIds = ensureTagIds(userId, tags);
  const insertTag = db.prepare('INSERT OR IGNORE INTO media_tags (item_id, tag_id) VALUES (?, ?)');
  const touch = db.prepare('UPDATE media_items SET updated_at = ? WHERE user_id = ? AND item_id = ? AND deleted_at IS NULL');

  const tx = db.transaction(() => {
    itemIds.forEach((itemId) => {
      tagIds.forEach((tagId) => insertTag.run(itemId, tagId));
      touch.run(now(), userId, itemId);
    });
  });
  tx();

  res.json({ ok: true });
});

app.post('/api/media/batch/untag', (req, res) => {
  const userId = getOwnerId();
  const itemIds = normalizeItemIds(req.body?.itemIds);
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((t) => (t ?? '').toString().trim()).filter(Boolean)
    : [];
  if (!itemIds.length) {
    res.status(400).json({ error: 'Missing itemIds' });
    return;
  }
  if (!tags.length) {
    res.status(400).json({ error: 'Missing tags' });
    return;
  }

  const selectTag = db.prepare('SELECT tag_id FROM tags WHERE user_id = ? AND tag_name = ?');
  const tagIds = tags.map((name) => selectTag.get(userId, name)?.tag_id).filter(Boolean);
  if (!tagIds.length) {
    res.json({ ok: true, removed: 0 });
    return;
  }
  const del = db.prepare('DELETE FROM media_tags WHERE item_id = ? AND tag_id = ?');
  const touch = db.prepare('UPDATE media_items SET updated_at = ? WHERE user_id = ? AND item_id = ? AND deleted_at IS NULL');
  let removed = 0;
  const tx = db.transaction(() => {
    itemIds.forEach((itemId) => {
      tagIds.forEach((tagId) => {
        const info = del.run(itemId, tagId);
        removed += info?.changes || 0;
      });
      touch.run(now(), userId, itemId);
    });
  });
  tx();
  res.json({ ok: true, removed });
});

app.post('/api/media/batch/trash', (req, res) => {
  const userId = getOwnerId();
  const itemIds = normalizeItemIds(req.body?.itemIds);
  if (!itemIds.length) {
    res.status(400).json({ error: 'Missing itemIds' });
    return;
  }
  const update = db.prepare('UPDATE media_items SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND item_id = ? AND deleted_at IS NULL');
  const tx = db.transaction(() => {
    itemIds.forEach((id) => update.run(now(), now(), userId, id));
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/media/batch/restore', (req, res) => {
  const userId = getOwnerId();
  const itemIds = normalizeItemIds(req.body?.itemIds);
  if (!itemIds.length) {
    res.status(400).json({ error: 'Missing itemIds' });
    return;
  }
  const update = db.prepare('UPDATE media_items SET deleted_at = NULL, updated_at = ? WHERE user_id = ? AND item_id = ? AND deleted_at IS NOT NULL');
  const tx = db.transaction(() => {
    itemIds.forEach((id) => update.run(now(), userId, id));
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/trash/empty', (req, res) => {
  const userId = getOwnerId();
  const info = db.prepare('DELETE FROM media_items WHERE user_id = ? AND deleted_at IS NOT NULL').run(userId);
  res.json({ ok: true, deleted: info?.changes || 0 });
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
    folders: db.prepare(`SELECT * FROM folders WHERE ${filter} ORDER BY (parent_id IS NOT NULL) ASC, parent_id, sort_order, created_at`).all(...params),
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
const host = process.env.HOST || '127.0.0.1';

function listLanUrls(actualPort) {
  const ifaces = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (!addr || addr.family !== 'IPv4') continue;
      if (addr.internal) continue;
      urls.push(`http://${addr.address}:${actualPort}`);
    }
  }
  return urls;
}

function startServer(options = {}) {
  if (serverInstance) {
    return serverInstance;
  }
  const resolvedPort = options.port ?? port;
  const resolvedHost = options.host ?? host;
  serverInstance = app.listen(resolvedPort, resolvedHost, () => {
    const actualPort = serverInstance?.address?.()?.port ?? resolvedPort;
    serverInstance.port = actualPort;

    const baseHost = resolvedHost === '0.0.0.0' ? 'localhost' : resolvedHost;
    console.log(`MediArchive Pro running at http://${baseHost}:${actualPort}`);
    if (resolvedHost === '0.0.0.0') {
      const urls = listLanUrls(actualPort);
      if (urls.length) {
        console.log('LAN URLs:');
        urls.forEach((u) => console.log(`  ${u}`));
      }
    }
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
