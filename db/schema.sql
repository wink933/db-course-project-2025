PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    device_type TEXT,
    device_key TEXT,
    lan_url TEXT,
    transfer_token TEXT,
    last_sync_time TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folders (
    folder_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    parent_id TEXT,
    folder_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES folders(folder_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tags (
    tag_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(user_id, tag_name)
);

CREATE TABLE IF NOT EXISTS media_items (
    item_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    folder_id TEXT,
    title TEXT NOT NULL,
    media_type TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(folder_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS storage_locations (
    location_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    device_id TEXT,
    storage_type TEXT NOT NULL CHECK (storage_type IN ('Local', 'Web')),
    path TEXT NOT NULL,
    access_info TEXT,
    is_available INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (item_id) REFERENCES media_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_tags (
    item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_id),
    FOREIGN KEY (item_id) REFERENCES media_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_media_items_folder_id ON media_items(folder_id);
CREATE INDEX IF NOT EXISTS idx_storage_locations_item_id ON storage_locations(item_id);
CREATE INDEX IF NOT EXISTS idx_storage_locations_device_id ON storage_locations(device_id);
CREATE INDEX IF NOT EXISTS idx_media_items_title ON media_items(title);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_tags_tag_name ON tags(tag_name);

CREATE VIEW IF NOT EXISTS v_media_library AS
SELECT
    m.item_id,
    m.title,
    m.media_type,
    m.created_at,
    f.folder_name,
    COUNT(sl.location_id) as copy_count
FROM media_items m
LEFT JOIN folders f ON m.folder_id = f.folder_id
LEFT JOIN storage_locations sl ON m.item_id = sl.item_id
GROUP BY m.item_id;

CREATE VIEW IF NOT EXISTS v_local_files AS
SELECT
    m.item_id,
    m.title,
    sl.path,
    sl.device_id
FROM media_items m
JOIN storage_locations sl ON m.item_id = sl.item_id
WHERE sl.storage_type = 'Local' AND sl.is_available = 1;
