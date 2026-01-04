const fs = require('fs');
const path = require('path');
const express = require('express');
const os = require('os');
const multer = require('multer');
const contentDisposition = require('content-disposition');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { fileURLToPath } = require('url');

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

function ensureSyncSupport(db) {
  // Improve sync performance for updated_at based pulls.
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_updated_at ON media_items(updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_storage_locations_updated_at ON storage_locations(updated_at)');
}

function ensureDeviceTransferSupport(db) {
  const hasLanUrl = columnExists(db, 'devices', 'lan_url');
  if (!hasLanUrl) {
    db.exec('ALTER TABLE devices ADD COLUMN lan_url TEXT');
  }
  const hasTransferToken = columnExists(db, 'devices', 'transfer_token');
  if (!hasTransferToken) {
    db.exec('ALTER TABLE devices ADD COLUMN transfer_token TEXT');
  }
  const hasDeviceKey = columnExists(db, 'devices', 'device_key');
  if (!hasDeviceKey) {
    db.exec('ALTER TABLE devices ADD COLUMN device_key TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_devices_user_id_updated_at ON devices(user_id, updated_at)');
  // Stable device identity (e.g. Android ANDROID_ID) helps prevent duplicates after reinstall.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_device_key ON devices(user_id, device_key) WHERE device_key IS NOT NULL');
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
  ensureSyncSupport(db);
  ensureDeviceTransferSupport(db);

  const existing = db.prepare('SELECT user_id FROM users LIMIT 1').get();
  if (!existing) {
    const userId = uuidv4();
    db.prepare('INSERT INTO users (user_id, username) VALUES (?, ?)')
      .run(userId, 'owner');

    const deviceId = uuidv4();
    const hostLabel = (() => {
      try {
        const h = (os.hostname?.() || '').toString().trim();
        return h || '本机设备';
      } catch {
        return '本机设备';
      }
    })();
    db.prepare('INSERT INTO devices (device_id, user_id, device_name, device_type, last_sync_time) VALUES (?, ?, ?, ?, ?)')
      .run(deviceId, userId, hostLabel, 'PC', new Date().toISOString());

    const folderId = uuidv4();
    db.prepare('INSERT INTO folders (folder_id, user_id, parent_id, folder_name) VALUES (?, ?, ?, ?)')
      .run(folderId, userId, null, '默认文件夹');
  }

  return db;
}

const db = initializeDatabase();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Desktop-to-desktop sync is triggered from the Web UI / Electron renderer.
// When syncing with another machine, it becomes a cross-origin request and must pass CORS.
function applySyncCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

app.use('/api/sync', applySyncCors);

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
    // explorer.exe is generally more reliable than `cmd /c start` for paths with special chars.
    const child = spawn('explorer.exe', [targetPath], { detached: true, stdio: 'ignore', windowsHide: true });
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

function isAndroidUriPath(location) {
  const access = (location?.access_info || '').toString();
  const p = (location?.path || '').toString();
  return access === 'android_uri' || /^content:\/\//i.test(p);
}

function safeParseHttpUrl(raw) {
  const text = (raw || '').toString().trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

app.get('/api/server/lan-urls', (req, res) => {
  try {
    const addr = serverInstance?.address?.();
    const port = typeof addr === 'object' && addr ? addr.port : Number(process.env.PORT || 4000);
    const urls = listLanUrls(port);
    res.json({ urls });
  } catch {
    res.json({ urls: [] });
  }
});

app.get('/api/server/lan-qr', async (req, res) => {
  const url = (req.query.url || '').toString().trim();
  if (!url) {
    res.status(400).json({ error: 'Missing url' });
    return;
  }
  if (url.length > 2048) {
    res.status(400).json({ error: 'URL too long' });
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'Only http/https URLs are supported' });
    return;
  }

  try {
    const png = await QRCode.toBuffer(url, {
      type: 'png',
      margin: 1,
      scale: 6,
      errorCorrectionLevel: 'M'
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'QR encode failed' });
  }
});

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

  if (isAndroidUriPath(location)) {
    res.status(400).json({
      error: 'Android content:// location cannot be previewed on desktop. Open it on the phone or upload/import to desktop uploads.'
    });
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

  if (isAndroidUriPath(location)) {
    res.status(400).json({
      error: 'Android content:// location cannot be downloaded from desktop server (file is on the phone). Upload/import it to desktop uploads or provide a Web link.'
    });
    return;
  }

  const candidate = resolveExistingPath(location.path);
  if (!candidate) {
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

  if (isAndroidUriPath(location)) {
    res.status(400).json({
      error: 'Android content:// location cannot be opened on desktop (file is on the phone). Open it on the phone or upload/import to desktop uploads.'
    });
    return;
  }

  const candidate = resolveExistingPath(location.path);
  if (!candidate) {
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

// On-demand LAN file transfer: pull an Android content:// location from the phone
// (phone runs an in-app LAN file server) and import it to desktop uploads.
function resolvePhoneFileUrlFromDevice(locationId) {
  const loc = db.prepare('SELECT * FROM storage_locations WHERE location_id = ? LIMIT 1').get(locationId);
  if (!loc) return { error: 'Location not found' };
  if (!isAndroidUriPath(loc)) return { error: 'Location is not an Android content:// uri' };

  const deviceId = asNonEmptyString(loc.device_id);
  if (!deviceId) return { error: 'Android location has no device_id' };

  const dev = db.prepare('SELECT * FROM devices WHERE device_id = ? LIMIT 1').get(deviceId);
  const lanUrlRaw = asNonEmptyString(dev?.lan_url);
  const token = asNonEmptyString(dev?.transfer_token);
  const lanUrl = safeParseHttpUrl(lanUrlRaw);
  if (!lanUrl) return { error: 'Phone LAN URL missing. Open phone app once and run sync to publish its LAN address.' };

  // Normalize to origin; keep token from db.
  const origin = lanUrl.origin;
  const url = `${origin}/api/ma/location?locationId=${encodeURIComponent(locationId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  return { url, device: dev, location: loc };
}

app.get('/api/transfer/stream-from-device', (req, res) => {
  const locationId = asNonEmptyString(req.query?.locationId);
  if (!locationId) {
    res.status(400).json({ error: 'Missing locationId' });
    return;
  }

  const resolved = resolvePhoneFileUrlFromDevice(locationId);
  if (resolved.error) {
    res.status(400).json({ error: resolved.error });
    return;
  }

  // Redirect to the phone server stream URL. Browser will handle Range itself.
  res.redirect(302, resolved.url);
});

app.post('/api/transfer/pull-from-phone', async (req, res) => {
  // Security: only allow localhost to trigger pulling files onto this machine.
  const remote = req.socket?.remoteAddress || req.ip;
  if (!isLoopbackAddress(remote)) {
    res.status(403).json({ error: 'This operation is only allowed from localhost.' });
    return;
  }

  const locationId = (req.body?.locationId || '').toString().trim();
  if (!locationId) {
    res.status(400).json({ error: 'Missing locationId' });
    return;
  }
  const resolved = resolvePhoneFileUrlFromDevice(locationId);
  if (resolved.error) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const fileUrl = resolved.url;
  const androidLoc = resolved.location;

  const userId = getOwnerId();
  const deviceRow = db.prepare('SELECT device_id FROM devices WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId);
  const defaultDeviceId = deviceRow?.device_id || null;

  try {
    const controller = new AbortController();
    const timeoutMs = 20_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(fileUrl, {
      method: 'GET',
      headers: {
        'Accept': '*/*'
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      res.status(502).json({ error: `Phone server error: ${resp.status} ${text || ''}`.trim() });
      return;
    }

    const filenameHeader = resp.headers.get('x-ma-filename') || resp.headers.get('X-MA-Filename');
    const originalName = (filenameHeader || '').toString().trim() || 'file';
    const ext = safeFileExtension(originalName);
    const destName = `${uuidv4()}${ext}`;
    const destPath = path.join(getUploadsDir(), destName);
    const destAbs = path.resolve(destPath);

    if (!resp.body) {
      res.status(502).json({ error: 'Phone server returned empty body' });
      return;
    }

    await pipeline(Readable.fromWeb(resp.body), fs.createWriteStream(destAbs));

    const newLocationId = uuidv4();
    const itemId = androidLoc.item_id;
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO storage_locations (location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at)
        VALUES (?, ?, ?, 'Local', ?, NULL, 1, ?, ?)
      `).run(newLocationId, itemId, defaultDeviceId, destAbs, now(), now());

      db.prepare('UPDATE media_items SET updated_at = ? WHERE item_id = ?').run(now(), itemId);
    });
    tx();

    res.json({ ok: true, item_id: itemId, location_id: newLocationId, path: destAbs });
  } catch (e) {
    const message = e?.name === 'AbortError'
      ? 'Phone fetch timed out. Ensure phone and PC are on the same Wi‑Fi and the phone app is open.'
      : (e?.message || 'Failed to pull from phone');
    res.status(502).json({
      error: message,
      hint: 'Check phone LAN URL (devices.lan_url), firewall, and that the phone in-app LAN server is reachable.'
    });
  }
});

function now() {
  return new Date().toISOString();
}

function stripWrappingQuotes(raw) {
  const text = (raw ?? '').toString().trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function normalizeIncomingPath(raw) {
  let text = stripWrappingQuotes(raw);
  if (!text) return '';

  if (/^file:\/\//i.test(text)) {
    try {
      return fileURLToPath(text);
    } catch {
      // fall through
    }
  }

  return text;
}

function safeExistsSync(targetPath) {
  try {
    return fs.existsSync(normalizeIncomingPath(targetPath));
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
  const normalized = path.normalize(normalizeIncomingPath(targetPath));
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
  // Prefer the user that actually owns most data. This protects against accidental
  // multi-user rows introduced by desktop-to-desktop import.
  const row = db.prepare(
    `
    SELECT
      u.user_id,
      COALESCE(mi.cnt, 0) AS media_cnt,
      COALESCE(dv.cnt, 0) AS device_cnt
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(1) AS cnt
      FROM media_items
      GROUP BY user_id
    ) mi ON mi.user_id = u.user_id
    LEFT JOIN (
      SELECT user_id, COUNT(1) AS cnt
      FROM devices
      GROUP BY user_id
    ) dv ON dv.user_id = u.user_id
    ORDER BY media_cnt DESC, device_cnt DESC, u.created_at ASC
    LIMIT 1
    `
  ).get();
  return row?.user_id || null;
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

function asNonEmptyString(value) {
  const s = (value ?? '').toString().trim();
  return s ? s : null;
}

function safeIsoOrNow(value) {
  const s = asNonEmptyString(value);
  if (!s) return now();
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : now();
}

function parseIsoMs(value) {
  const s = asNonEmptyString(value);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function upsertDeviceForOwner(device) {
  const userId = getOwnerId();
  if (!userId) return null;

  const deviceId = asNonEmptyString(device?.device_id) || uuidv4();
  const deviceName = asNonEmptyString(device?.device_name) || '未命名设备';
  const deviceType = asNonEmptyString(device?.device_type) || 'Unknown';
  const deviceKey = asNonEmptyString(device?.device_key);
  const lanUrl = asNonEmptyString(device?.lan_url);
  const transferToken = asNonEmptyString(device?.transfer_token);
  const timestamp = now();

  // If device_key exists and matches an existing device for this user, merge into that device_id.
  if (deviceKey) {
    let existingByKey = db
      .prepare('SELECT device_id FROM devices WHERE user_id = ? AND device_key = ? LIMIT 1')
      .get(userId, deviceKey);

    // Backfill/attach device_key for legacy rows: if there is exactly one likely Android device
    // with the same name and no device_key yet, treat it as canonical.
    if (!existingByKey && deviceType === 'Android') {
      const candidates = db.prepare(
        'SELECT device_id FROM devices WHERE user_id = ? AND device_type = ? AND device_name = ? AND device_key IS NULL ORDER BY created_at ASC'
      ).all(userId, 'Android', deviceName);

      if (Array.isArray(candidates) && candidates.length === 1 && candidates[0]?.device_id) {
        const canonical = candidates[0].device_id;
        try {
          db.prepare('UPDATE devices SET device_key = ?, updated_at = ? WHERE user_id = ? AND device_id = ?')
            .run(deviceKey, timestamp, userId, canonical);
          existingByKey = { device_id: canonical };
        } catch {
          // ignore
        }
      }
    }

    let canonicalDeviceId = existingByKey?.device_id || deviceId;

    // If not found by key, and this looks like Android, adopt the oldest legacy row (same name, null key)
    // and assign it the new device_key so future syncs are stable.
    if (!existingByKey && deviceType === 'Android') {
      const legacyRows = db.prepare(
        'SELECT device_id FROM devices WHERE user_id = ? AND device_type = ? AND device_name = ? AND device_key IS NULL ORDER BY created_at ASC'
      ).all(userId, 'Android', deviceName);

      if (Array.isArray(legacyRows) && legacyRows.length >= 1 && legacyRows[0]?.device_id) {
        canonicalDeviceId = legacyRows[0].device_id;
        try {
          db.prepare('UPDATE devices SET device_key = COALESCE(device_key, ?), updated_at = ? WHERE user_id = ? AND device_id = ?')
            .run(deviceKey, timestamp, userId, canonicalDeviceId);
        } catch {
          // ignore
        }
      }
    }

    // Merge duplicates:
    // - rows with same device_key (should be rare, but may exist from older bugs)
    // - legacy rows with null device_key but same Android model name
    // - the incoming random device_id (after reinstall)
    const mergeCandidates = new Set();
    try {
      const sameKey = db.prepare(
        'SELECT device_id FROM devices WHERE user_id = ? AND device_key = ? AND device_id != ?'
      ).all(userId, deviceKey, canonicalDeviceId);
      (sameKey || []).forEach((r) => r?.device_id && mergeCandidates.add(r.device_id));
    } catch {
      // ignore
    }

    if (deviceType === 'Android') {
      try {
        const legacySameName = db.prepare(
          'SELECT device_id FROM devices WHERE user_id = ? AND device_type = ? AND device_name = ? AND device_key IS NULL AND device_id != ?'
        ).all(userId, 'Android', deviceName, canonicalDeviceId);
        (legacySameName || []).forEach((r) => r?.device_id && mergeCandidates.add(r.device_id));
      } catch {
        // ignore
      }
    }

    if (canonicalDeviceId !== deviceId) {
      mergeCandidates.add(deviceId);
    }

    for (const dupId of mergeCandidates) {
      if (!dupId || dupId === canonicalDeviceId) continue;
      const dup = db.prepare('SELECT device_id FROM devices WHERE user_id = ? AND device_id = ? LIMIT 1').get(userId, dupId);
      if (!dup) continue;
      try {
        db.prepare(
          `
          UPDATE storage_locations
          SET device_id = ?
          WHERE device_id = ?
            AND item_id IN (SELECT item_id FROM media_items WHERE user_id = ?)
          `
        ).run(canonicalDeviceId, dupId, userId);
      } catch {
        // ignore
      }
      try {
        db.prepare('DELETE FROM devices WHERE user_id = ? AND device_id = ?').run(userId, dupId);
      } catch {
        // ignore
      }
    }

    const existsCanonical = db
      .prepare('SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?')
      .get(canonicalDeviceId, userId);

    if (existsCanonical) {
      db.prepare(
        'UPDATE devices SET device_name = ?, device_type = ?, device_key = COALESCE(?, device_key), lan_url = COALESCE(?, lan_url), transfer_token = COALESCE(?, transfer_token), updated_at = ? WHERE device_id = ?'
      ).run(deviceName, deviceType, deviceKey, lanUrl, transferToken, timestamp, canonicalDeviceId);
    } else {
      db.prepare(
        'INSERT INTO devices (device_id, user_id, device_name, device_type, last_sync_time, created_at, updated_at, device_key, lan_url, transfer_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(canonicalDeviceId, userId, deviceName, deviceType, null, timestamp, timestamp, deviceKey, lanUrl, transferToken);
    }

    return db.prepare('SELECT * FROM devices WHERE device_id = ?').get(canonicalDeviceId);
  }

  const existing = db.prepare('SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?').get(deviceId, userId);
  if (existing) {
    db.prepare('UPDATE devices SET device_name = ?, device_type = ?, lan_url = COALESCE(?, lan_url), transfer_token = COALESCE(?, transfer_token), updated_at = ? WHERE device_id = ?')
      .run(deviceName, deviceType, lanUrl, transferToken, timestamp, deviceId);
  } else {
    db.prepare(
      'INSERT INTO devices (device_id, user_id, device_name, device_type, last_sync_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(deviceId, userId, deviceName, deviceType, null, timestamp, timestamp);

    if (lanUrl || transferToken) {
      db.prepare('UPDATE devices SET lan_url = ?, transfer_token = ? WHERE device_id = ?')
        .run(lanUrl, transferToken, deviceId);
    }
  }
  return db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
}

function upsertMediaItemForOwner(item) {
  const userId = getOwnerId();
  if (!userId) return null;

  const itemId = asNonEmptyString(item?.item_id);
  if (!itemId) return null;

  const title = asNonEmptyString(item?.title) || '未命名';
  const mediaType = asNonEmptyString(item?.media_type);
  const description = asNonEmptyString(item?.description);
  const folderId = asNonEmptyString(item?.folder_id);

  const incomingUpdatedAt = safeIsoOrNow(item?.updated_at);
  const incomingUpdatedMs = parseIsoMs(incomingUpdatedAt) ?? 0;

  const existing = db.prepare('SELECT item_id, updated_at FROM media_items WHERE item_id = ? AND user_id = ?').get(itemId, userId);
  if (!existing) {
    const createdAt = safeIsoOrNow(item?.created_at);
    db.prepare(
      `
      INSERT INTO media_items (item_id, user_id, folder_id, title, media_type, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(itemId, userId, folderId ?? null, title, mediaType ?? null, description ?? null, createdAt, incomingUpdatedAt);
    return true;
  }

  const existingMs = parseIsoMs(existing.updated_at) ?? 0;
  if (incomingUpdatedMs >= existingMs) {
    db.prepare(
      `
      UPDATE media_items
      SET folder_id = ?, title = ?, media_type = ?, description = ?, updated_at = ?
      WHERE item_id = ? AND user_id = ?
      `
    ).run(folderId ?? null, title, mediaType ?? null, description ?? null, incomingUpdatedAt, itemId, userId);
  }
  return true;
}

function upsertStorageLocation(location, itemId, deviceIdFallback) {
  const locationId = asNonEmptyString(location?.location_id);
  if (!locationId) return null;

  const storageType = asNonEmptyString(location?.storage_type) || 'Web';
  const pathValue = asNonEmptyString(normalizeIncomingPath(location?.path));
  if (!pathValue) return null;

  const deviceIdRaw = asNonEmptyString(location?.device_id);
  const fallbackId = asNonEmptyString(deviceIdFallback);

  const deviceExists = (candidateId) => {
    const id = asNonEmptyString(candidateId);
    if (!id) return false;
    const row = db.prepare('SELECT device_id FROM devices WHERE device_id = ? LIMIT 1').get(id);
    return !!row;
  };

  let deviceId = deviceIdRaw || fallbackId || null;

  // Prevent FK failures when client sends a device_id that the server merged/deleted.
  if (deviceId && !deviceExists(deviceId)) {
    if (fallbackId && deviceExists(fallbackId)) {
      deviceId = fallbackId;
    } else {
      // For Local locations we prefer a device_id, but allowing NULL is better than failing sync.
      deviceId = null;
    }
  }
  const accessInfo = asNonEmptyString(location?.access_info);
  const isAvailable = Number.isFinite(Number(location?.is_available)) ? Number(location.is_available) : 1;
  const createdAt = safeIsoOrNow(location?.created_at);
  const updatedAt = safeIsoOrNow(location?.updated_at);

  const existing = db.prepare('SELECT location_id FROM storage_locations WHERE location_id = ?').get(locationId);
  if (existing) {
    db.prepare(
      `
      UPDATE storage_locations
      SET item_id = ?, device_id = ?, storage_type = ?, path = ?, access_info = ?, is_available = ?, updated_at = ?
      WHERE location_id = ?
      `
    ).run(itemId, deviceId, storageType, pathValue, accessInfo, isAvailable, updatedAt, locationId);
  } else {
    db.prepare(
      `
      INSERT INTO storage_locations (location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(locationId, itemId, deviceId, storageType, pathValue, accessInfo, isAvailable, createdAt, updatedAt);
  }
  return true;
}

// 移动端 ↔ 电脑端：元数据同步（最小闭环）
// - pull: 拉取服务端媒体条目 + 存储位置
// - push: 推送客户端媒体条目 + 存储位置（可包含 content:// 等移动端 URI）
app.get('/api/sync/pull', (req, res) => {
  const userId = getOwnerId();
  const since = asNonEmptyString(req.query?.since);
  const sinceMs = since ? (parseIsoMs(since) ?? 0) : null;

  const filters = ['user_id = ?', 'deleted_at IS NULL'];
  const params = [userId];
  if (sinceMs) {
    filters.push('updated_at > ?');
    params.push(new Date(sinceMs).toISOString());
  }

  const items = db.prepare(
    `
    SELECT item_id, user_id, folder_id, title, media_type, description, created_at, updated_at
    FROM media_items
    WHERE ${filters.join(' AND ')}
    ORDER BY updated_at DESC
    `
  ).all(...params);

  const locationsStmt = db.prepare(
    `
    SELECT location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at
    FROM storage_locations
    WHERE item_id = ?
    ORDER BY created_at ASC
    `
  );

  const results = items.map((item) => ({
    ...item,
    locations: locationsStmt.all(item.item_id)
  }));

  const devices = db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at').all(userId);
  res.json({ server_time: now(), user_id: userId, devices, items: results });
});

app.post('/api/sync/push', (req, res) => {
  try {
    const payload = req.body || {};
    const userId = getOwnerId();
    const device = upsertDeviceForOwner(payload.device);
    const deviceId = device?.device_id || null;
    const incomingDeviceId = asNonEmptyString(payload?.device?.device_id);

    const deletedItemIds = normalizeItemIds(payload.deleted_item_ids);

    const items = Array.isArray(payload.items) ? payload.items : [];

    const deviceExistsForUser = (candidateId) => {
      const id = asNonEmptyString(candidateId);
      if (!id || !userId) return false;
      const row = db.prepare('SELECT device_id FROM devices WHERE user_id = ? AND device_id = ? LIMIT 1').get(userId, id);
      return !!row;
    };

    const tx = db.transaction(() => {
      if (deletedItemIds.length) {
        const userId = getOwnerId();
        const mark = db.prepare(
          'UPDATE media_items SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE user_id = ? AND item_id = ?'
        );
        const ts = now();
        deletedItemIds.forEach((id) => {
          mark.run(ts, ts, userId, id);
        });
      }

      items.forEach((item) => {
        const ok = upsertMediaItemForOwner(item);
        if (!ok) return;
        const itemId = asNonEmptyString(item?.item_id);
        if (!itemId) return;

        const locations = Array.isArray(item.locations) ? item.locations : [];
        locations.forEach((loc) => {
          const storageType = asNonEmptyString(loc?.storage_type);
          const locDeviceId = asNonEmptyString(loc?.device_id);

          // IMPORTANT:
          // When Android reinstalls, it may generate a new random device_id while keeping the same device_key.
          // The server merges into a canonical device_id and may delete the incoming device_id row.
          // If we keep the old loc.device_id, SQLite FK checks can fail.
          let normalizedLoc = loc;

          if (storageType === 'Local' && deviceId) {
            normalizedLoc = { ...loc, device_id: deviceId };
          } else if (locDeviceId && deviceId) {
            if ((incomingDeviceId && locDeviceId === incomingDeviceId) || !deviceExistsForUser(locDeviceId)) {
              normalizedLoc = { ...loc, device_id: deviceId };
            }
          }

          upsertStorageLocation(normalizedLoc, itemId, deviceId);
        });
      });

      if (deviceId) {
        db.prepare('UPDATE devices SET last_sync_time = ?, updated_at = ? WHERE device_id = ?')
          .run(now(), now(), deviceId);
      }
    });

    tx();
    res.json({ ok: true, device, received_items: items.length, server_time: now() });
  } catch (error) {
    const payload = req.body || {};
    res.status(400).json({
      error: error?.message || 'Invalid payload',
      hint: 'Check device_id/device_key merge and location foreign keys',
      debug: {
        device_id: asNonEmptyString(payload?.device?.device_id),
        device_key: asNonEmptyString(payload?.device?.device_key),
        items_count: Array.isArray(payload?.items) ? payload.items.length : 0
      }
    });
  }
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

app.delete('/api/tags/:id', (req, res) => {
  const userId = getOwnerId();
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Missing tag id' });
    return;
  }

  const exists = db.prepare('SELECT tag_id FROM tags WHERE user_id = ? AND tag_id = ?').get(userId, id);
  if (!exists) {
    res.status(404).json({ error: 'Tag not found' });
    return;
  }

  const used = db.prepare(`
    SELECT COUNT(1) AS cnt
    FROM media_tags mt
    JOIN tags t ON t.tag_id = mt.tag_id
    WHERE t.user_id = ? AND t.tag_id = ?
  `).get(userId, id);
  const cnt = Number(used?.cnt || 0);
  if (cnt > 0) {
    res.status(400).json({ error: 'Tag is in use by media items' });
    return;
  }

  db.prepare('DELETE FROM tags WHERE user_id = ? AND tag_id = ?').run(userId, id);
  res.json({ ok: true });
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

app.put('/api/devices/:id', (req, res) => {
  const userId = getOwnerId();
  const { id } = req.params;
  const name = (req.body?.deviceName || '').toString().trim();
  if (!id) {
    res.status(400).json({ error: 'Missing device id' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'Missing deviceName' });
    return;
  }
  const exists = db.prepare('SELECT device_id FROM devices WHERE user_id = ? AND device_id = ?').get(userId, id);
  if (!exists) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }
  db.prepare('UPDATE devices SET device_name = ?, updated_at = ? WHERE user_id = ? AND device_id = ?')
    .run(name, now(), userId, id);
  res.json({ ok: true });
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
  const cleanedPath = normalizeIncomingPath(mediaPath);
  db.prepare(`
    INSERT INTO storage_locations (location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    locationId,
    itemId,
    deviceId || null,
    storageType,
    cleanedPath,
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
  const cleanedPath = normalizeIncomingPath(mediaPath);
  db.prepare(`
    INSERT INTO storage_locations (location_id, item_id, device_id, storage_type, path, access_info, is_available, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    locationId,
    id,
    deviceId || null,
    storageType,
    cleanedPath,
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

app.post('/api/media/batch/hardDelete', (req, res) => {
  const userId = getOwnerId();
  const itemIds = normalizeItemIds(req.body?.itemIds);
  if (!itemIds.length) {
    res.status(400).json({ error: 'Missing itemIds' });
    return;
  }

  // Safety: only allow hard-delete for items already in trash.
  const del = db.prepare('DELETE FROM media_items WHERE user_id = ? AND item_id = ? AND deleted_at IS NOT NULL');
  const tx = db.transaction(() => {
    itemIds.forEach((id) => del.run(userId, id));
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

  const ownerId = getOwnerId();
  if (!ownerId) {
    res.status(500).json({ error: 'Missing owner user_id' });
    return;
  }

  const tables = [
    { name: 'devices', key: 'device_id' },
    { name: 'folders', key: 'folder_id' },
    { name: 'tags', key: 'tag_id' },
    { name: 'media_items', key: 'item_id' },
    { name: 'storage_locations', key: 'location_id' }
  ];

  // NOTE: Do NOT use INSERT OR REPLACE here.
  // In SQLite, REPLACE performs DELETE+INSERT, which can break foreign-key constraints
  // (e.g. folders.parent_id uses ON DELETE RESTRICT) and can also cascade-delete children.
  const upsertKnown = (table, pk, allowedCols, row) => {
    if (!row || typeof row !== 'object') return;
    const columns = allowedCols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!columns.includes(pk)) return;
    const placeholders = columns.map(() => '?').join(',');
    const updateCols = columns.filter((c) => c !== pk);
    const updateClause = updateCols.length
      ? `DO UPDATE SET ${updateCols.map((c) => `${c} = excluded.${c}`).join(',')}`
      : 'DO NOTHING';

    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT(${pk}) ${updateClause}`;
    db.prepare(sql).run(...columns.map((c) => row[c]));
  };

  const existsById = (table, idColumn, idValue) => {
    if (!idValue) return false;
    try {
      const row = db.prepare(`SELECT 1 AS ok FROM ${table} WHERE ${idColumn} = ? LIMIT 1`).get(idValue);
      return !!row;
    } catch {
      return false;
    }
  };

  const safeRowObject = (row) => (row && typeof row === 'object' ? { ...row } : null);

  try {
    const transaction = db.transaction(() => {
      // 1) devices
      (payload.devices || []).forEach((row) => {
        const r = safeRowObject(row);
        if (!r) return;
        if (Object.prototype.hasOwnProperty.call(r, 'user_id')) r.user_id = ownerId;
        upsertKnown(
          'devices',
          'device_id',
          ['device_id', 'user_id', 'device_name', 'device_type', 'device_key', 'lan_url', 'transfer_token', 'last_sync_time', 'created_at', 'updated_at'],
          r
        );
      });

      // 2) folders (two-phase to avoid parent_id FK failures)
      const folderRows = Array.isArray(payload.folders) ? payload.folders.map(safeRowObject).filter(Boolean) : [];
      const folderParentById = new Map();
      folderRows.forEach((r) => {
        if (!r?.folder_id) return;
        folderParentById.set(r.folder_id, (r.parent_id || '').toString().trim() || null);
      });

      // Phase 1: upsert shells with parent_id = NULL (no FK required)
      folderRows.forEach((orig) => {
        const r = { ...orig };
        if (Object.prototype.hasOwnProperty.call(r, 'user_id')) r.user_id = ownerId;
        r.parent_id = null;
        upsertKnown(
          'folders',
          'folder_id',
          ['folder_id', 'user_id', 'parent_id', 'folder_name', 'sort_order', 'created_at', 'updated_at'],
          r
        );
      });

      // Phase 2: backfill parent_id (only if parent exists)
      folderRows.forEach((orig) => {
        const r = { ...orig };
        if (Object.prototype.hasOwnProperty.call(r, 'user_id')) r.user_id = ownerId;
        const wantedParent = folderParentById.get(r.folder_id) || null;
        r.parent_id = wantedParent && existsById('folders', 'folder_id', wantedParent) ? wantedParent : null;
        upsertKnown(
          'folders',
          'folder_id',
          ['folder_id', 'user_id', 'parent_id', 'folder_name', 'sort_order', 'created_at', 'updated_at'],
          r
        );
      });

      // 3) tags
      (payload.tags || []).forEach((row) => {
        const r = safeRowObject(row);
        if (!r) return;
        if (Object.prototype.hasOwnProperty.call(r, 'user_id')) r.user_id = ownerId;
        upsertKnown(
          'tags',
          'tag_id',
          ['tag_id', 'user_id', 'tag_name', 'created_at', 'updated_at'],
          r
        );
      });

      // 4) media_items (sanitize folder_id FK)
      (payload.media_items || []).forEach((row) => {
        const r = safeRowObject(row);
        if (!r) return;
        if (Object.prototype.hasOwnProperty.call(r, 'user_id')) r.user_id = ownerId;
        const folderId = (r.folder_id || '').toString().trim() || null;
        r.folder_id = folderId && existsById('folders', 'folder_id', folderId) ? folderId : null;
        upsertKnown(
          'media_items',
          'item_id',
          ['item_id', 'user_id', 'folder_id', 'title', 'media_type', 'description', 'created_at', 'updated_at', 'deleted_at'],
          r
        );
      });

      // 5) storage_locations (sanitize item_id/device_id FK)
      (payload.storage_locations || []).forEach((row) => {
        const r = safeRowObject(row);
        if (!r) return;
        const itemId = (r.item_id || '').toString().trim();
        if (!itemId || !existsById('media_items', 'item_id', itemId)) return;
        const deviceId = (r.device_id || '').toString().trim() || null;
        r.device_id = deviceId && existsById('devices', 'device_id', deviceId) ? deviceId : null;
        // Keep path normalization consistent with the rest of the server.
        if (Object.prototype.hasOwnProperty.call(r, 'path')) {
          r.path = normalizeIncomingPath(r.path);
        }
        upsertKnown(
          'storage_locations',
          'location_id',
          ['location_id', 'item_id', 'device_id', 'storage_type', 'path', 'access_info', 'is_available', 'created_at', 'updated_at'],
          r
        );
      });

      // 6) media_tags (sanitize FK)
      if (Array.isArray(payload.media_tags)) {
        payload.media_tags.forEach((row) => {
          const itemId = (row?.item_id || '').toString().trim();
          const tagId = (row?.tag_id || '').toString().trim();
          if (!itemId || !tagId) return;
          if (!existsById('media_items', 'item_id', itemId)) return;
          if (!existsById('tags', 'tag_id', tagId)) return;
          db.prepare('INSERT OR IGNORE INTO media_tags (item_id, tag_id) VALUES (?, ?)')
            .run(itemId, tagId);
        });
      }
    });

    transaction();
    res.json({ ok: true, imported_at: now() });
  } catch (error) {
    res.status(500).json({
      error: error?.message || 'Import failed',
      hint: 'This is usually caused by foreign key constraints during import (e.g., folder parent inserted after child). Please retry after updating both clients.'
    });
  }
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

  const isCli = require.main === module;
  const server = app.listen(resolvedPort, resolvedHost, () => {
    const actualPort = server?.address?.()?.port ?? resolvedPort;
    server.port = actualPort;

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

  // Prevent unhandled 'error' from crashing Electron main-process.
  server.on('error', (err) => {
    // Reset singleton so callers can retry with a different port.
    if (serverInstance === server) {
      serverInstance = null;
    }

    const code = err?.code;
    if (code === 'EADDRINUSE') {
      console.error(`启动失败：端口被占用 ${resolvedHost}:${resolvedPort}`);
    } else {
      console.error('启动失败：', err);
    }

    // In CLI mode, exit with non-zero so scripts/terminals show failure clearly.
    if (isCli) {
      try {
        process.exit(1);
      } catch {
        // ignore
      }
    }
  });

  serverInstance = server;
  return server;
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
