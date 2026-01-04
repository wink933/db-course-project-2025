const state = {
  user: null,
  devices: [],
  folders: [],
  tags: [],
  media: [],

  library: 'all',
  folderId: '',
  deviceId: '',
  selectedItemId: '',

  sortMode: 'created_desc',
  viewMode: 'list',

  selectedItemIds: new Set(),
  lastSelectedIndex: -1,

  detailSortKey: 'title', // title | media_type | file_size | file_mtime | path | tags
  detailSortDir: 'asc' // asc | desc
};

const elements = {
  libraryNav: document.getElementById('libraryNav'),
  folderList: document.getElementById('folderList'),
  deviceList: document.getElementById('deviceList'),

  folderNameInput: document.getElementById('folderNameInput'),
  folderParentSelect: document.getElementById('folderParentSelect'),
  addFolderBtn: document.getElementById('addFolderBtn'),

  deviceNameInput: document.getElementById('deviceNameInput'),
  deviceTypeInput: document.getElementById('deviceTypeInput'),
  addDeviceBtn: document.getElementById('addDeviceBtn'),

  syncEndpointInput: document.getElementById('syncEndpointInput'),
  syncBtn: document.getElementById('syncBtn'),
  refreshAvailabilityBtn: document.getElementById('refreshAvailabilityBtn'),

  showLanShareBtn: document.getElementById('showLanShareBtn'),
  lanSharePanel: document.getElementById('lanSharePanel'),

  searchInput: document.getElementById('searchInput'),
  searchScope: document.getElementById('searchScope'),
  searchScopeDevice: document.getElementById('searchScopeDevice'),
  searchChips: document.getElementById('searchChips'),
  mediaList: document.getElementById('mediaList'),

  sortBtn: document.getElementById('sortBtn'),
  viewToggleBtn: document.getElementById('viewToggleBtn'),
  emptyTrashBtn: document.getElementById('emptyTrashBtn'),

  breadcrumb: document.getElementById('breadcrumb'),

  bulkBar: document.getElementById('bulkBar'),
  bulkCount: document.getElementById('bulkCount'),
  bulkFolderSelect: document.getElementById('bulkFolderSelect'),
  bulkMoveBtn: document.getElementById('bulkMoveBtn'),
  bulkTagsInput: document.getElementById('bulkTagsInput'),
  bulkTagBtn: document.getElementById('bulkTagBtn'),
  bulkUntagBtn: document.getElementById('bulkUntagBtn'),
  bulkRestoreBtn: document.getElementById('bulkRestoreBtn'),
  bulkDeleteBtn: document.getElementById('bulkDeleteBtn'),

  inspectorEmpty: document.getElementById('inspectorEmpty'),
  inspector: document.getElementById('inspector'),
  previewBox: document.getElementById('previewBox'),
  detailTitle: document.getElementById('detailTitle'),
  restoreBtn: document.getElementById('restoreBtn'),
  detailLocations: document.getElementById('detailLocations'),
  detailTags: document.getElementById('detailTags'),
  tagPicker: document.getElementById('tagPicker'),
  tagAddInput: document.getElementById('tagAddInput'),
  detailNote: document.getElementById('detailNote'),
  openPrimaryBtn: document.getElementById('openPrimaryBtn'),
  shareBtn: document.getElementById('shareBtn'),
  openEditBtn: document.getElementById('openEditBtn'),
  deleteBtn: document.getElementById('deleteBtn'),

  addModal: document.getElementById('addModal'),
  openAddModalBtn: document.getElementById('openAddModalBtn'),
  closeAddModal: document.getElementById('closeAddModal'),
  mediaTitleInput: document.getElementById('mediaTitleInput'),
  mediaTypeInput: document.getElementById('mediaTypeInput'),
  mediaFolderInput: document.getElementById('mediaFolderInput'),
  mediaTagsInput: document.getElementById('mediaTagsInput'),
  storageTypeInput: document.getElementById('storageTypeInput'),
  mediaPathInput: document.getElementById('mediaPathInput'),
  mediaUploadInput: document.getElementById('mediaUploadInput'),
  mediaDeviceInput: document.getElementById('mediaDeviceInput'),
  mediaAccessInput: document.getElementById('mediaAccessInput'),
  mediaDescriptionInput: document.getElementById('mediaDescriptionInput'),
  addMediaBtn: document.getElementById('addMediaBtn'),

  editModal: document.getElementById('editModal'),
  closeEditModal: document.getElementById('closeEditModal'),
  editTitleInput: document.getElementById('editTitleInput'),
  editMediaTypeInput: document.getElementById('editMediaTypeInput'),
  editMediaFolderInput: document.getElementById('editMediaFolderInput'),
  editMediaTagsInput: document.getElementById('editMediaTagsInput'),
  editMediaDescriptionInput: document.getElementById('editMediaDescriptionInput'),
  editStorageTypeInput: document.getElementById('editStorageTypeInput'),
  editMediaDeviceInput: document.getElementById('editMediaDeviceInput'),
  editMediaPathInput: document.getElementById('editMediaPathInput'),
  editMediaAccessInput: document.getElementById('editMediaAccessInput'),
  saveEditBtn: document.getElementById('saveEditBtn'),

  transferModal: document.getElementById('transferModal'),
  closeTransferModal: document.getElementById('closeTransferModal'),
  transferModalDesc: document.getElementById('transferModalDesc'),
  transferDownloadBtn: document.getElementById('transferDownloadBtn'),
  transferStreamBtn: document.getElementById('transferStreamBtn'),

  dropOverlay: document.getElementById('dropOverlay'),
  folderContextMenu: document.getElementById('folderContextMenu'),
  mediaContextMenu: document.getElementById('mediaContextMenu')
};

let transferModalState = {
  item: null,
  loc: null
};

let editingId = null;
let folderContextTarget = null;
let renamingFolderId = null;
let renamingOriginalName = '';
let searchDebounceTimer = null;
let noteDebounceTimer = null;

const searchState = {
  scope: 'all', // all | currentFolder | local | web | device
  scopeDeviceId: '',
  chips: [] // { key, value }
};

let folderById = new Map();

let mediaContextTargetId = null;
let mediaContextLocationId = null;

let draggingMediaItemIds = null;

const FOLDER_COLLAPSED_KEY = 'folderCollapsedIds.v1';
let collapsedFolderIds = loadCollapsedFolderIds();

let draggingFolderId = null;
let draggingParentId = null;

function loadCollapsedFolderIds() {
  try {
    const raw = localStorage.getItem(FOLDER_COLLAPSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveCollapsedFolderIds() {
  try {
    localStorage.setItem(FOLDER_COLLAPSED_KEY, JSON.stringify(Array.from(collapsedFolderIds)));
  } catch {}
}

function stripWrappingQuotes(raw) {
  const text = (raw ?? '').toString().trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function normalizeUserPathInput(raw) {
  let text = stripWrappingQuotes(raw);
  if (!text) return '';

  // Support file:// URIs (sometimes used when copying paths).
  if (/^file:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      if (u.protocol === 'file:') {
        let p = decodeURIComponent(u.pathname || '');
        // Windows file URL: /C:/path -> C:/path
        if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
        return p;
      }
    } catch {
      // fall through
    }
  }

  return text;
}

function normalizeSyncEndpoint(raw) {
  let text = stripWrappingQuotes(raw);
  if (!text) return '';
  text = text.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) {
    text = `http://${text}`;
  }
  return text;
}

function openTransferModal(item, loc) {
  if (!elements.transferModal) return;
  transferModalState = { item, loc };
  elements.transferModalDesc.innerHTML = `该资源位于其他设备（例如手机）。\n\n请选择：\n- 下载到本机：把文件拉取并保存到本机 uploads\n- 流式传输：不落盘，直接从对端读取`;
  elements.transferModal.classList.remove('hidden');
}

function closeTransferModal() {
  if (!elements.transferModal) return;
  elements.transferModal.classList.add('hidden');
  transferModalState = { item: null, loc: null };
}

async function handleTransferDownload() {
  const item = transferModalState.item;
  const loc = transferModalState.loc;
  if (!item || !loc) return;

  try {
    const res = await fetch('/api/transfer/pull-from-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId: loc.location_id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || '下载失败');
      return;
    }

    await fetchMedia();
    closeTransferModal();

    // Optional: try to open the newly imported local copy.
    if (data?.location_id) {
      const openUrl = `/api/media/${encodeURIComponent(item.item_id)}/open?locationId=${encodeURIComponent(data.location_id)}`;
      await fetch(openUrl, { method: 'POST' }).catch(() => {});
    }
  } catch (e) {
    alert(`下载失败：${e?.message || e}`);
  }
}

function handleTransferStream() {
  const loc = transferModalState.loc;
  if (!loc) return;
  const url = `/api/transfer/stream-from-device?locationId=${encodeURIComponent(loc.location_id)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function openItemWithUx(item, loc) {
  if (!item || !loc) return;
  if (isWebLocation(loc)) {
    window.open(loc.path, '_blank', 'noopener,noreferrer');
    return;
  }

  // Android content:// on desktop: show download/stream modal.
  if (!isWebLocation(loc) && isAndroidUriLocation(loc)) {
    openTransferModal(item, loc);
    return;
  }

  // 移动端/非 localhost：下载到当前设备，而不是让电脑打开默认应用。
  if (shouldDownloadForLocalOpen()) {
    const downloadUrl = `/api/media/${encodeURIComponent(item.item_id)}/download?locationId=${encodeURIComponent(loc.location_id)}`;
    window.open(downloadUrl, '_blank');
    return;
  }

  try {
    const openUrl = `/api/media/${encodeURIComponent(item.item_id)}/open?locationId=${encodeURIComponent(loc.location_id)}`;
    const res = await fetch(openUrl, { method: 'POST' });
    if (res.ok) return;
  } catch {
    // ignore
  }

  const downloadUrl = `/api/media/${encodeURIComponent(item.item_id)}/download?locationId=${encodeURIComponent(loc.location_id)}`;
  window.open(downloadUrl, '_blank');
}

function toggleFolderCollapsed(folderId) {
  if (!folderId) return;
  if (collapsedFolderIds.has(folderId)) {
    collapsedFolderIds.delete(folderId);
  } else {
    collapsedFolderIds.add(folderId);
  }
  saveCollapsedFolderIds();
}

function rebuildFolderIndex() {
  folderById = new Map((state.folders || []).map((f) => [f.folder_id, f]));
}

function nowMs() {
  return Date.now();
}

function isWebLocation(loc) {
  return loc?.storage_type === 'Web' || /^https?:\/\//i.test(loc?.path || '');
}

function isAndroidUriLocation(loc) {
  const pathText = (loc?.path || '').toString();
  return loc?.access_info === 'android_uri' || /^content:\/\//i.test(pathText);
}

let cachedSharableOrigin = null;

async function getSharableOrigin() {
  if (cachedSharableOrigin) return cachedSharableOrigin;
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isLocalhost) {
    cachedSharableOrigin = location.origin;
    return cachedSharableOrigin;
  }

  try {
    const res = await fetch('/api/server/lan-urls');
    const data = await res.json().catch(() => ({}));
    const urls = Array.isArray(data?.urls) ? data.urls.filter(Boolean) : [];
    if (urls.length) {
      const u = new URL(urls[0]);
      cachedSharableOrigin = u.origin;
      return cachedSharableOrigin;
    }
  } catch {
    // ignore
  }

  cachedSharableOrigin = location.origin;
  return cachedSharableOrigin;
}

async function fetchLanUrls() {
  const res = await fetch('/api/server/lan-urls');
  if (!res.ok) throw new Error(`LAN URLs 请求失败：${res.status}`);
  const data = await res.json().catch(() => ({}));
  const urls = Array.isArray(data?.urls) ? data.urls.filter(Boolean) : [];
  return urls;
}

function lanQrSrc(url) {
  const encoded = encodeURIComponent(url);
  return `/api/server/lan-qr?url=${encoded}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function renderLanSharePanel(urls) {
  if (!elements.lanSharePanel) return;
  elements.lanSharePanel.innerHTML = '';

  const note = document.createElement('div');
  note.className = 'hint';
  note.textContent = '用途：把下面任一地址复制到手机 App 首页的“电脑端服务器地址”。若手机连不上，请用 HOST=0.0.0.0 启动服务并检查防火墙。';
  elements.lanSharePanel.appendChild(note);

  if (!urls.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = '未检测到可用的局域网地址（可能未连接 Wi‑Fi 或网卡被禁用）。';
    elements.lanSharePanel.appendChild(empty);
    return;
  }

  urls.forEach((url) => {
    const card = document.createElement('div');
    card.className = 'lan-card';

    const qrWrap = document.createElement('div');
    qrWrap.className = 'lan-qr';
    const img = document.createElement('img');
    img.alt = `QR ${url}`;
    img.src = lanQrSrc(url);
    qrWrap.appendChild(img);

    const right = document.createElement('div');
    right.className = 'lan-url-row';

    const a = document.createElement('a');
    a.className = 'lan-url';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = url;

    const actions = document.createElement('div');
    actions.className = 'lan-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary';
    copyBtn.type = 'button';
    copyBtn.textContent = '复制地址';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(url);
      alert(
        ok
          ? '已复制：粘贴到手机 App 的“电脑端服务器地址”（或用于电脑↔电脑同步的对端地址）。'
          : '复制失败，请手动选择复制'
      );
    });

    actions.appendChild(copyBtn);

    right.appendChild(a);
    right.appendChild(actions);

    card.appendChild(qrWrap);
    card.appendChild(right);
    elements.lanSharePanel.appendChild(card);
  });
}

function pickPrimaryLocation(item) {
  if (!item?.locations?.length) return null;
  const web = item.locations.find((l) => isWebLocation(l));
  if (web) return web;

  // Prefer a desktop-openable local location over Android-only content://.
  const nonAndroidAvailable = item.locations.find((l) => !isWebLocation(l) && !isAndroidUriLocation(l) && l.is_available);
  if (nonAndroidAvailable) return nonAndroidAvailable;
  const nonAndroidAny = item.locations.find((l) => !isWebLocation(l) && !isAndroidUriLocation(l));
  if (nonAndroidAny) return nonAndroidAny;

  return item.locations[0] || null;
}

function typeIcon(mediaType) {
  const t = (mediaType || '').toLowerCase();
  if (t === 'video') return '▶️';
  if (t === 'image') return '🖼️';
  if (t === 'web') return '🔗';
  return '📄';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

function sortModeLabel(mode) {
  if (mode === 'created_asc') return '最早';
  if (mode === 'title_asc') return '标题';
  return '最新';
}

function viewModeLabel(mode) {
  if (mode === 'grid') return '网格';
  if (mode === 'details') return '详细';
  return '列表';
}

function updateToolbarControls() {
  if (elements.sortBtn) elements.sortBtn.textContent = `排序：${sortModeLabel(state.sortMode)}`;
  if (elements.viewToggleBtn) elements.viewToggleBtn.textContent = `视图：${viewModeLabel(state.viewMode)}`;
  if (elements.emptyTrashBtn) {
    elements.emptyTrashBtn.classList.toggle('hidden', state.library !== 'trash');
  }
}

async function handleToggleLanShare() {
  if (!elements.lanSharePanel) return;
  const willShow = elements.lanSharePanel.classList.contains('hidden');
  elements.lanSharePanel.classList.toggle('hidden', !willShow);
  if (!willShow) return;

  elements.lanSharePanel.innerHTML = '<div class="hint">正在获取局域网地址…</div>';
  try {
    const urls = await fetchLanUrls();
    renderLanSharePanel(urls);
  } catch (e) {
    elements.lanSharePanel.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'hint';
    err.textContent = `获取失败：${e?.message || e}`;
    elements.lanSharePanel.appendChild(err);
  }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let idx = -1;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  return `${v.toFixed(v >= 10 ? 1 : 2)} ${units[idx]}`;
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function getPrimaryLocationDisplay(item) {
  const loc = pickPrimaryLocation(item);
  if (!loc) return '';
  return loc.path || '';
}

function getPrimaryLocationMeta(item) {
  const loc = pickPrimaryLocation(item);
  if (!loc) return { size: null, mtime: null, locationId: '' };
  if (isWebLocation(loc)) {
    return { size: null, mtime: null, locationId: loc.location_id || '' };
  }
  return {
    size: loc.file_size ?? null,
    mtime: loc.file_mtime ?? null,
    locationId: loc.location_id || ''
  };
}

function normalizeSortValue(v) {
  if (v == null) return '';
  return (v ?? '').toString();
}

function compareMaybeNumber(a, b) {
  const na = Number(a);
  const nb = Number(b);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return normalizeSortValue(a).localeCompare(normalizeSortValue(b), 'zh-Hans-CN');
}

function getDisplayedItems() {
  const items = filterByLibrary(state.media).slice();

  if (state.viewMode === 'details') {
    const dir = state.detailSortDir === 'desc' ? -1 : 1;
    const key = state.detailSortKey;
    items.sort((a, b) => {
      if (key === 'title') {
        return dir * (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN');
      }
      if (key === 'media_type') {
        return dir * (a.media_type || '').localeCompare(b.media_type || '', 'zh-Hans-CN');
      }
      if (key === 'file_size') {
        return dir * compareMaybeNumber(getPrimaryLocationMeta(a).size, getPrimaryLocationMeta(b).size);
      }
      if (key === 'file_mtime') {
        const at = new Date(getPrimaryLocationMeta(a).mtime || 0).getTime();
        const bt = new Date(getPrimaryLocationMeta(b).mtime || 0).getTime();
        return dir * (at - bt);
      }
      if (key === 'path') {
        return dir * (getPrimaryLocationDisplay(a) || '').localeCompare(getPrimaryLocationDisplay(b) || '', 'zh-Hans-CN');
      }
      if (key === 'tags') {
        const at = (a.tags || []).map((t) => t.tag_name).join(',');
        const bt = (b.tags || []).map((t) => t.tag_name).join(',');
        return dir * at.localeCompare(bt, 'zh-Hans-CN');
      }
      return 0;
    });
    return items;
  }

  if (state.sortMode === 'created_asc') {
    items.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  } else if (state.sortMode === 'title_asc') {
    items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN'));
  } else {
    items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }
  return items;
}

function setSelection(nextIds, primaryId, lastIndex) {
  state.selectedItemIds = new Set((nextIds || []).filter(Boolean));
  state.selectedItemId = primaryId || (Array.from(state.selectedItemIds)[0] || '');
  state.lastSelectedIndex = Number.isFinite(lastIndex) ? lastIndex : state.lastSelectedIndex;
  renderMediaList();
  renderInspector();
  renderBulkBar();
}

function clearSelection() {
  setSelection([], '', -1);
}

function renderBulkBar() {
  const count = state.selectedItemIds.size;
  if (!elements.bulkBar) return;
  elements.bulkBar.classList.toggle('hidden', count < 2);
  if (elements.bulkCount) {
    elements.bulkCount.textContent = count >= 2 ? `已选 ${count} 项` : '';
  }
  if (elements.bulkRestoreBtn) {
    elements.bulkRestoreBtn.classList.toggle('hidden', state.library !== 'trash');
  }
  if (elements.bulkDeleteBtn) {
    elements.bulkDeleteBtn.textContent = state.library === 'trash' ? '永久删除' : '删除';
  }
}

function buildFolderBreadcrumb(folderId) {
  const chain = [];
  let current = folderId ? folderById.get(folderId) : null;
  while (current) {
    chain.push(current);
    const pid = current.parent_id || '';
    current = pid ? folderById.get(pid) : null;
  }
  chain.reverse();
  return chain;
}

function renderBreadcrumb() {
  if (!elements.breadcrumb) return;
  elements.breadcrumb.innerHTML = '';

  const addSep = () => {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '›';
    elements.breadcrumb.appendChild(sep);
  };

  if (state.library === 'trash') {
    const root = document.createElement('span');
    root.className = 'crumb';
    root.textContent = '回收站';
    root.style.cursor = 'default';
    elements.breadcrumb.appendChild(root);
    return;
  }

  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'crumb';
  root.textContent = '全部文件';
  root.addEventListener('click', async () => {
    state.folderId = '';
    searchState.scope = 'all';
    updateScopeUI();
    renderFolders();
    await fetchMedia();
  });
  elements.breadcrumb.appendChild(root);

  const chain = buildFolderBreadcrumb(state.folderId);
  chain.forEach((f) => {
    addSep();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crumb';
    btn.textContent = f.folder_name || '';
    btn.addEventListener('click', async () => {
      state.folderId = f.folder_id;
      searchState.scope = 'currentFolder';
      updateScopeUI();
      renderFolders();
      await fetchMedia();
    });
    elements.breadcrumb.appendChild(btn);
  });
}

function parseSearchInput(raw) {
  const input = (raw || '').trim();
  if (!input) return { searchText: '', tagName: '' };

  // 支持语法：tag:旅行（可出现在任意位置）
  let tagName = '';
  const tagMatches = [];
  const rest = input.replace(/(^|\s)tag:([^\s]+)/gi, (m, lead, name) => {
    if (name) tagMatches.push(name);
    return lead || ' ';
  }).trim();
  if (tagMatches.length) {
    tagName = tagMatches[0].trim();
  }

  return { searchText: rest, tagName };
}

function normalizeLower(s) {
  return (s ?? '').toString().trim().toLowerCase();
}

function escapeHtml(s) {
  return (s ?? '').toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isLikelyMobileClient() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipod') || ua.includes('ipad')) return true;
  if (ua.includes('android')) return true;
  // iPadOS 有时伪装成 Macintosh
  if (ua.includes('macintosh') && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

function isLocalhostHost() {
  const host = (location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function shouldDownloadForLocalOpen() {
  // 非 localhost（例如通过局域网 IP 访问）时，“打开”会发生在服务器（电脑）上，
  // 对移动端/其他电脑而言应改为下载到当前设备。
  if (!isLocalhostHost()) return true;
  if (isLikelyMobileClient()) return true;
  return false;
}

function parseChipTokens(raw) {
  const input = (raw || '').trim();
  if (!input) return { chips: [], restText: '' };

  const parts = input.split(/\s+/).filter(Boolean);
  const chips = [];
  const rest = [];
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z]+):(.+)$/);
    if (!m) {
      rest.push(part);
      continue;
    }
    const key = (m[1] || '').toLowerCase();
    const value = (m[2] || '').trim();
    if (!value) {
      rest.push(part);
      continue;
    }
    if (!['tag', 'type', 'device', 'folder', 'date'].includes(key)) {
      rest.push(part);
      continue;
    }
    chips.push({ key, value });
  }
  return { chips, restText: rest.join(' ') };
}

function mergeChips(incoming) {
  const next = [...(searchState.chips || [])];
  for (const chip of incoming || []) {
    const k = normalizeLower(chip?.key);
    const v = (chip?.value ?? '').toString().trim();
    if (!k || !v) continue;
    const exists = next.some((c) => normalizeLower(c.key) === k && (c.value || '').trim() === v);
    if (!exists) next.push({ key: k, value: v });
  }
  searchState.chips = next;
}

function renderSearchChips() {
  if (!elements.searchChips) return;
  elements.searchChips.innerHTML = '';
  for (const chip of searchState.chips) {
    const el = document.createElement('div');
    el.className = 'chip';
    el.innerHTML = `<strong>${escapeHtml(chip.key)}:</strong><span>${escapeHtml(chip.value)}</span><button type="button" title="移除">×</button>`;
    el.querySelector('button')?.addEventListener('click', (e) => {
      e.preventDefault();
      searchState.chips = (searchState.chips || []).filter((c) => c !== chip);
      renderSearchChips();
      fetchMedia();
    });
    elements.searchChips.appendChild(el);
  }
}

function renderScopeDeviceOptions() {
  if (!elements.searchScopeDevice) return;
  const options = ['<option value="">选择设备</option>'];
  (state.devices || []).forEach((d) => {
    options.push(`<option value="${d.device_id}">${escapeHtml(d.device_name)}</option>`);
  });
  elements.searchScopeDevice.innerHTML = options.join('');
  if (searchState.scopeDeviceId) {
    elements.searchScopeDevice.value = searchState.scopeDeviceId;
  }
}

function updateScopeUI() {
  if (elements.searchScope) {
    elements.searchScope.value = searchState.scope;
  }
  if (elements.searchScopeDevice) {
    elements.searchScopeDevice.classList.toggle('hidden', searchState.scope !== 'device');
    if (searchState.scope !== 'device') return;
    if (!searchState.scopeDeviceId && (state.devices || []).length) {
      searchState.scopeDeviceId = state.devices[0].device_id;
      elements.searchScopeDevice.value = searchState.scopeDeviceId;
    }
  }
}

function convertInputTokensToChips() {
  if (!elements.searchInput) return;
  const raw = elements.searchInput.value || '';
  const { chips, restText } = parseChipTokens(raw);
  if (!chips.length) return;
  mergeChips(chips);
  elements.searchInput.value = restText;
  renderSearchChips();
}

function getFolderNameById(folderId) {
  if (!folderId) return '';
  const f = folderById.get(folderId);
  return f ? (f.folder_name || '') : '';
}

function itemHasStorageType(item, storageType) {
  const want = (storageType || '').toLowerCase();
  if (!want) return true;
  return (item.locations || []).some((l) => (l?.storage_type || '').toLowerCase() === want);
}

function parseDateRange(raw) {
  const text = (raw || '').trim();
  if (!text) return null;
  const toDate = (s) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  };
  if (text.includes('..')) {
    const [a, b] = text.split('..');
    const start = a ? toDate(a) : null;
    const end = b ? toDate(b) : null;
    return { start, end };
  }
  const d = toDate(text);
  if (!d) return null;
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function applyScopeAndChips(items) {
  let out = (items || []).slice();

  // scope filter (local/web client-side, device via API if possible)
  if (searchState.scope === 'local') {
    out = out.filter((m) => itemHasStorageType(m, 'local'));
  } else if (searchState.scope === 'web') {
    out = out.filter((m) => itemHasStorageType(m, 'web'));
  }

  const chips = searchState.chips || [];
  if (!chips.length) return out;

  const tagChips = chips.filter((c) => c.key === 'tag');
  const typeChips = chips.filter((c) => c.key === 'type');
  const deviceChips = chips.filter((c) => c.key === 'device');
  const folderChips = chips.filter((c) => c.key === 'folder');
  const dateChips = chips.filter((c) => c.key === 'date');

  return out.filter((m) => {
    // tag: AND
    for (const c of tagChips) {
      const want = normalizeLower(c.value);
      const ok = (m.tags || []).some((t) => normalizeLower(t.tag_name) === want);
      if (!ok) return false;
    }

    // type: AND
    for (const c of typeChips) {
      const want = normalizeLower(c.value);
      if (want && normalizeLower(m.media_type) !== want) return false;
    }

    // device: AND (match id or name contains)
    for (const c of deviceChips) {
      const want = (c.value || '').toString().trim();
      const wantLower = normalizeLower(want);
      const ok = (m.locations || []).some((l) => {
        const idOk = (l?.device_id || '') === want;
        const name = getDeviceName(l?.device_id);
        const nameOk = normalizeLower(name).includes(wantLower);
        return idOk || nameOk;
      });
      if (!ok) return false;
    }

    // folder: AND (match id or name contains)
    for (const c of folderChips) {
      const want = (c.value || '').toString().trim();
      const wantLower = normalizeLower(want);
      const idOk = (m.folder_id || '') === want;
      const fname = getFolderNameById(m.folder_id || '');
      const nameOk = normalizeLower(fname).includes(wantLower);
      if (!idOk && !nameOk) return false;
    }

    // date: AND
    for (const c of dateChips) {
      const r = parseDateRange(c.value);
      if (!r) continue;
      const t = new Date(m.created_at || 0);
      if (Number.isNaN(t.getTime())) return false;
      if (r.start && t < r.start) return false;
      if (r.end && t > r.end) return false;
    }

    return true;
  });
}

function findTagIdByName(tagName) {
  const trimmed = (tagName || '').trim();
  if (!trimmed) return '';
  const exact = (state.tags || []).find((t) => (t.tag_name || '') === trimmed);
  if (exact) return exact.tag_id;
  const lower = trimmed.toLowerCase();
  const ci = (state.tags || []).find((t) => (t.tag_name || '').toLowerCase() === lower);
  return ci ? ci.tag_id : '';
}

function getDeviceName(deviceId) {
  if (!deviceId) return '未指定设备';
  const d = state.devices.find((x) => x.device_id === deviceId);
  return d ? d.device_name : '未知设备';
}

function renderFolderOptions() {
  const byParent = new Map();
  for (const folder of state.folders || []) {
    const parentId = folder.parent_id || null;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(folder);
  }

  const sortSiblings = (a, b) => {
    const ao = Number.isFinite(a?.sort_order) ? a.sort_order : 0;
    const bo = Number.isFinite(b?.sort_order) ? b.sort_order : 0;
    if (ao !== bo) return ao - bo;
    return (a.folder_name || '').localeCompare(b.folder_name || '', 'zh-Hans-CN');
  };

  for (const list of byParent.values()) {
    list.sort(sortSiblings);
  }

  const optionRows = [];
  const walk = (parentId, depth) => {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      const indent = '\u00A0\u00A0'.repeat(depth) + (depth ? '↳ ' : '');
      optionRows.push({
        id: child.folder_id,
        label: `${indent}${escapeHtml(child.folder_name || '')}`
      });
      walk(child.folder_id, depth + 1);
    }
  };
  walk(null, 0);

  const mediaOptions = ['<option value="">未分类</option>'];
  optionRows.forEach((o) => mediaOptions.push(`<option value="${o.id}">${o.label}</option>`));

  const parentOptions = ['<option value="">根目录</option>'];
  optionRows.forEach((o) => parentOptions.push(`<option value="${o.id}">${o.label}</option>`));

  elements.folderParentSelect.innerHTML = parentOptions.join('');
  elements.mediaFolderInput.innerHTML = mediaOptions.join('');
  elements.editMediaFolderInput.innerHTML = mediaOptions.join('');

  if (elements.bulkFolderSelect) {
    elements.bulkFolderSelect.innerHTML = mediaOptions.join('');
  }
}

function renderDeviceOptions() {
  const options = ['<option value="">未指定</option>'];
  state.devices.forEach((device) => {
    options.push(`<option value="${device.device_id}">${device.device_name}</option>`);
  });
  elements.mediaDeviceInput.innerHTML = options.join('');
  elements.editMediaDeviceInput.innerHTML = options.join('');
}

function getDefaultDeviceId() {
  const first = (state.devices || [])[0];
  return first?.device_id || '';
}

function syncAddModalDeviceState() {
  if (!elements.mediaDeviceInput || !elements.mediaUploadInput || !elements.storageTypeInput) return;

  const hasFile = (elements.mediaUploadInput.files || []).length > 0;
  if (hasFile) {
    // Uploads are always saved to the machine running the server.
    if (elements.storageTypeInput.value !== 'Local') {
      elements.storageTypeInput.value = 'Local';
    }
    const defaultId = getDefaultDeviceId();
    if (defaultId) {
      elements.mediaDeviceInput.value = defaultId;
    }
    elements.mediaDeviceInput.disabled = true;
  } else {
    elements.mediaDeviceInput.disabled = false;
  }
}

function buildFolderTree() {
  const byParent = new Map();
  for (const folder of state.folders) {
    const parentId = folder.parent_id || null;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(folder);
  }

  const sortSiblings = (a, b) => {
    const ao = Number.isFinite(a?.sort_order) ? a.sort_order : 0;
    const bo = Number.isFinite(b?.sort_order) ? b.sort_order : 0;
    if (ao !== bo) return ao - bo;
    return (a.folder_name || '').localeCompare(b.folder_name || '', 'zh-Hans-CN');
  };

  for (const list of byParent.values()) {
    list.sort(sortSiblings);
  }

  const result = [];
  const walk = (parentId, depth) => {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      const directChildren = byParent.get(child.folder_id) || [];
      const hasChildren = directChildren.length > 0;
      const collapsed = hasChildren && collapsedFolderIds.has(child.folder_id);

      result.push({ folder: child, depth, hasChildren, collapsed });
      if (!collapsed) {
        walk(child.folder_id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return result;
}

function renderFolders() {
  elements.folderList.innerHTML = '';

  // Virtual root entry: clears folder filter to enable global search
  const allLi = document.createElement('li');
  allLi.dataset.id = '';
  allLi.dataset.parentId = '';
  allLi.draggable = false;
  allLi.style.paddingLeft = '12px';

  const allCaret = document.createElement('span');
  allCaret.className = 'folder-caret spacer';
  allCaret.textContent = '';

  const allName = document.createElement('span');
  allName.className = 'folder-name';
  allName.textContent = '全部文件';

  allLi.appendChild(allCaret);
  allLi.appendChild(allName);
  if (!state.folderId) {
    allLi.classList.add('active');
  }
  elements.folderList.appendChild(allLi);

  const rows = buildFolderTree();
  for (const { folder, depth, hasChildren, collapsed } of rows) {
    const li = document.createElement('li');
    li.dataset.id = folder.folder_id;
    li.dataset.parentId = folder.parent_id || '';
    li.draggable = true;
    li.style.paddingLeft = `${12 + depth * 16}px`;

    const caret = document.createElement('span');
    caret.className = 'folder-caret';
    if (hasChildren) {
      caret.textContent = collapsed ? '▸' : '▾';
      caret.title = collapsed ? '展开' : '折叠';
    } else {
      caret.textContent = '';
      caret.classList.add('spacer');
    }

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.folder_name;

    li.appendChild(caret);
    li.appendChild(name);
    if (folder.folder_id === state.folderId) {
      li.classList.add('active');
    }
    elements.folderList.appendChild(li);
  }
}

function cancelInlineRename() {
  if (!renamingFolderId) return;
  const li = elements.folderList.querySelector(`li[data-id="${renamingFolderId}"]`);
  if (li) {
    const name = li.querySelector('.folder-name');
    if (name) {
      name.textContent = renamingOriginalName;
    }
  }
  renamingFolderId = null;
  renamingOriginalName = '';
}

async function commitInlineRename(nextName) {
  const targetId = renamingFolderId;
  const originalName = renamingOriginalName;
  renamingFolderId = null;
  renamingOriginalName = '';

  const trimmed = (nextName || '').trim();
  if (!targetId) return;
  if (!trimmed || trimmed === originalName) {
    await fetchBootstrap();
    return;
  }

  try {
    const res = await fetch(`/api/folders/${targetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName: trimmed })
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      alert(msg.error || '重命名失败');
      await fetchBootstrap();
      return;
    }
    await fetchBootstrap();
    await fetchMedia();
  } catch (error) {
    alert(`重命名请求失败：${error?.message || '网络错误'}`);
    await fetchBootstrap();
  }
}

function startInlineRenameFolder(targetId) {
  if (!targetId) return;
  if (renamingFolderId && renamingFolderId !== targetId) {
    cancelInlineRename();
  }

  const li = elements.folderList.querySelector(`li[data-id="${targetId}"]`);
  if (!li) return;

  const name = li.querySelector('.folder-name');
  if (!name) return;

  renamingFolderId = targetId;
  renamingOriginalName = name.textContent || '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-rename-input';
  input.value = renamingOriginalName;

  name.textContent = '';
  name.appendChild(input);

  input.focus();
  input.select();

  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('contextmenu', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInlineRename(input.value);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineRename();
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => {
    if (!renamingFolderId) return;
    commitInlineRename(input.value);
  });
}

function renderDevices() {
  elements.deviceList.innerHTML = '';
  state.devices.forEach((device) => {
    const li = document.createElement('li');
    li.dataset.id = device.device_id;
    if (device.device_id === state.deviceId) {
      li.classList.add('active');
    }
    const lastSync = device.last_sync_time ? new Date(device.last_sync_time) : null;
    const isRecent = lastSync && (nowMs() - lastSync.getTime() < 5 * 60 * 1000);
    const statusDot = document.createElement('span');
    statusDot.className = `status-dot ${isRecent ? 'online' : 'offline'}`;

    const name = document.createElement('span');
    name.className = 'device-name';
    name.textContent = device.device_name;

    const type = document.createElement('span');
    type.className = 'device-type';
    type.textContent = `(${device.device_type || '未知'})`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'device-delete';
    del.title = '删除设备';
    del.textContent = '删除';

    li.appendChild(statusDot);
    li.appendChild(name);
    li.appendChild(type);
    li.appendChild(del);
    elements.deviceList.appendChild(li);
  });
}

function renderLibraryNav() {
  const items = Array.from(elements.libraryNav.querySelectorAll('.nav-item[data-library]'));
  items.forEach((btn) => {
    const key = btn.dataset.library;
    btn.classList.toggle('active', key === state.library);
  });
}

function filterByLibrary(items) {
  if (state.library === 'all') return items;
  if (state.library === 'web') {
    return items.filter((m) => m.locations?.some((l) => isWebLocation(l)));
  }
  if (state.library === 'local') {
    return items.filter((m) => m.locations?.some((l) => !isWebLocation(l)));
  }
  if (state.library === 'recent') {
    const cutoff = nowMs() - 7 * 24 * 60 * 60 * 1000;
    return items.filter((m) => {
      const t = new Date(m.created_at || 0).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
  }
  if (state.library === 'trash') {
    return items;
  }
  return items;
}

function renderMediaList() {
  elements.mediaList.innerHTML = '';
  const items = getDisplayedItems();

  // view mode
  elements.mediaList.classList.toggle('grid', state.viewMode === 'grid');
  elements.mediaList.classList.toggle('details', state.viewMode === 'details');

  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'resource-item';
    empty.style.cursor = 'default';
    empty.innerHTML = `<div class="item-info"><div class="item-title">暂无资源</div><div class="item-meta">尝试切换左侧库分类或修改搜索条件</div></div>`;
    elements.mediaList.appendChild(empty);
    return;
  }

  if (state.viewMode === 'details') {
    const header = document.createElement('li');
    header.className = 'resource-header';

    const mkBtn = (key, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.sort = key;
      const active = state.detailSortKey === key;
      btn.classList.toggle('active', active);
      const arrow = active ? (state.detailSortDir === 'asc' ? ' ▲' : ' ▼') : '';
      btn.textContent = `${label}${arrow}`;
      return btn;
    };

    const inner = document.createElement('div');
    inner.className = 'resource-header-inner';
    inner.innerHTML = '<div></div>';
    inner.appendChild(mkBtn('title', '名称'));
    inner.appendChild(mkBtn('media_type', '类型'));
    inner.appendChild(mkBtn('file_size', '大小'));
    inner.appendChild(mkBtn('file_mtime', '修改时间'));
    inner.appendChild(mkBtn('path', '位置'));
    inner.appendChild(mkBtn('tags', '标签'));
    header.appendChild(inner);
    elements.mediaList.appendChild(header);
  }

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'resource-item';
    li.dataset.id = item.item_id;
    li.dataset.index = String(index);
    li.draggable = true;
    if (item.item_id === state.selectedItemId) {
      li.classList.add('selected');
    }
    if (state.selectedItemIds.has(item.item_id)) {
      li.classList.add('multi-selected');
    }
    const icon = typeIcon(item.media_type);
    const primaryLoc = pickPrimaryLocation(item);
    const locText = primaryLoc
      ? (isWebLocation(primaryLoc)
        ? 'Web'
        : (isAndroidUriLocation(primaryLoc) ? `手机: ${primaryLoc.path}` : `本地: ${primaryLoc.path}`))
      : '';
    const tagPills = (item.tags || []).slice(0, 2).map((t) => `<span class="tag-pill">${t.tag_name}</span>`).join('');

    if (state.viewMode === 'details') {
      const meta = getPrimaryLocationMeta(item);
      const sizeText = meta.size != null ? formatBytes(meta.size) : '-';
      const mtimeText = meta.mtime ? formatDateTime(meta.mtime) : '-';
      const pathText = getPrimaryLocationDisplay(item);
      const tagsText = (item.tags || []).map((t) => t.tag_name).join(', ');
      li.innerHTML = `
        <div class="resource-row">
          <div class="resource-check"><input data-role="select" type="checkbox" ${state.selectedItemIds.has(item.item_id) ? 'checked' : ''} /></div>
          <div class="resource-cell">${escapeHtml(item.title || '')}</div>
          <div class="resource-cell muted">${escapeHtml(item.media_type || '')}</div>
          <div class="resource-cell muted">${escapeHtml(sizeText)}</div>
          <div class="resource-cell muted">${escapeHtml(mtimeText)}</div>
          <div class="resource-cell muted">${escapeHtml(pathText || '')}</div>
          <div class="resource-cell muted">${escapeHtml(tagsText || '')}</div>
        </div>
      `;
    } else {
      li.innerHTML = `
        <div class="item-icon">${icon}</div>
        <div class="item-info">
          <div class="item-title">${item.title || ''}</div>
          <div class="item-meta">
            <span>${item.media_type || ''}</span>
            <span>•</span>
            <span>${formatDate(item.created_at)}</span>
            ${tagPills ? `<span style="margin-left: 6px; display: inline-flex; gap: 6px;">${tagPills}</span>` : ''}
          </div>
        </div>
        <div class="item-loc">${locText}</div>
      `;
    }
    elements.mediaList.appendChild(li);
  });
}

function getSelectedItem() {
  if (!state.selectedItemId) return null;
  return state.media.find((m) => m.item_id === state.selectedItemId) || null;
}

function setInspectorVisible(visible) {
  elements.inspectorEmpty.style.display = visible ? 'none' : 'flex';
  elements.inspector.classList.toggle('hidden', !visible);
}

function renderInspector() {
  const item = getSelectedItem();
  if (!item) {
    setInspectorVisible(false);
    elements.openPrimaryBtn.disabled = true;
    elements.shareBtn.disabled = true;
    elements.deleteBtn.disabled = true;
    if (elements.restoreBtn) elements.restoreBtn.classList.add('hidden');
    return;
  }

  setInspectorVisible(true);

  const isTrashItem = state.library === 'trash' || !!item.deleted_at;
  if (elements.restoreBtn) {
    elements.restoreBtn.classList.toggle('hidden', !isTrashItem);
  }
  if (elements.deleteBtn) {
    elements.deleteBtn.textContent = isTrashItem ? '永久删除' : '删除';
  }

  const loc = pickPrimaryLocation(item);
  const mediaType = (item.media_type || '').toLowerCase();
  const isAndroidOnly = !!loc && !isWebLocation(loc) && isAndroidUriLocation(loc);

  if (loc) {
    if (isWebLocation(loc)) {
      elements.openPrimaryBtn.textContent = '打开';
    } else {
      elements.openPrimaryBtn.textContent = isAndroidOnly ? '打开' : (shouldDownloadForLocalOpen() ? '下载' : '打开');
    }
  } else {
    elements.openPrimaryBtn.textContent = '打开';
  }

  if (!loc) {
    elements.previewBox.innerHTML = `<div class="preview-empty">${typeIcon(item.media_type)} 预览</div>`;
  } else if (isWebLocation(loc)) {
    const url = loc.path || '';
    elements.previewBox.innerHTML = `
      <div class="preview-empty">
        ${typeIcon(item.media_type)}
        <div style="margin-top:8px; font-weight:600;">Web 资源</div>
        <a class="link-web" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
      </div>
    `;
  } else {
    if (isAndroidOnly) {
      elements.previewBox.innerHTML = `
        <div class="preview-empty">
          ${typeIcon(item.media_type)}
          <div style="margin-top:8px; font-weight:600;">手机本地文件</div>
          <div style="margin-top:6px; color: var(--muted); font-size: 12px;">
            该位置为 Android 的 <code>content://</code> URI，电脑端无法直接预览/打开。
          </div>
          <div style="margin-top:6px; color: var(--muted); font-size: 12px;">
            解决办法：在手机端打开；或通过手机浏览器上传/导入到电脑端（会保存到 uploads）。
          </div>
        </div>
      `;
    } else {
    const filePath = loc.path || '';
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    const src = `/api/media/${encodeURIComponent(item.item_id)}/preview?locationId=${encodeURIComponent(loc.location_id)}`;
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(ext);
    const isVideo = ['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext);
    const isPdf = ext === 'pdf';

    if (isImage) {
      elements.previewBox.innerHTML = `<img class="preview-media" src="${src}" alt="preview" />`;
    } else if (isVideo || mediaType === 'video') {
      elements.previewBox.innerHTML = `
        <video class="preview-media" controls preload="metadata">
          <source src="${src}" />
        </video>
      `;
    } else if (isPdf) {
      elements.previewBox.innerHTML = `<iframe class="preview-iframe" src="${src}" title="pdf"></iframe>`;
    } else {
      const actionLabel = shouldDownloadForLocalOpen() ? '下载' : '打开';
      elements.previewBox.innerHTML = `
        <div class="preview-empty">
          ${typeIcon(item.media_type)}
          <div style="margin-top:8px; font-weight:600;">无法预览该格式</div>
          <div style="margin-top:6px; color: var(--muted); font-size: 12px;">可点击“${actionLabel}”查看原文件</div>
        </div>
      `;
    }
    }
  }
  elements.detailTitle.textContent = item.title || '';

  const locLines = (item.locations || []).map((loc) => {
    const status = isWebLocation(loc)
      ? '在线'
      : (loc.is_available ? '可用' : '不可用');
    const dev = getDeviceName(loc.device_id);
    const pathText = loc.path || '';
    const pathHtml = isWebLocation(loc)
      ? `<a class="link-web" href="${pathText}" target="_blank" rel="noopener noreferrer">${pathText}</a>`
      : `<span>${pathText}</span>`;
    return `<div style="margin-bottom: 10px;">
      <div style="font-weight: 600;">${dev} · ${loc.storage_type}</div>
      <div style="color: #94a3b8; font-size: 12px;">${pathHtml}</div>
      <div style="color: #94a3b8; font-size: 12px;">状态：${status}</div>
    </div>`;
  }).join('');
  elements.detailLocations.innerHTML = locLines || '<div style="color:#94a3b8;">暂无位置</div>';

  elements.detailTags.innerHTML = '';
  (item.tags || []).forEach((t) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `<span>${t.tag_name}</span><button type="button" aria-label="remove">✕</button>`;
    pill.querySelector('button')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = (item.tags || []).map((x) => x.tag_name).filter((name) => name !== t.tag_name);
      await setItemTags(item.item_id, next);
    });
    elements.detailTags.appendChild(pill);
  });

  // 内置标签选择（多选）
  if (elements.tagPicker) {
    elements.tagPicker.innerHTML = '';
    const existing = new Set((item.tags || []).map((t) => t.tag_name));
    (state.tags || []).forEach((t) => {
      const wrap = document.createElement('span');
      wrap.className = 'tag-option-wrap';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-option';
      const selected = existing.has(t.tag_name);
      if (selected) btn.classList.add('selected');
      btn.textContent = `${selected ? '✓ ' : ''}${t.tag_name}`;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = new Set((item.tags || []).map((x) => x.tag_name));
        if (next.has(t.tag_name)) next.delete(t.tag_name);
        else next.add(t.tag_name);
        await setItemTags(item.item_id, Array.from(next));
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tag-delete';
      del.title = '删除标签';
      del.setAttribute('aria-label', `删除标签 ${t.tag_name}`);
      del.textContent = '✕';
      del.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await deleteTag(t);
      });

      wrap.appendChild(btn);
      wrap.appendChild(del);
      elements.tagPicker.appendChild(wrap);
    });
  }

  elements.detailNote.value = item.description || '';

  elements.openPrimaryBtn.disabled = !pickPrimaryLocation(item);
  elements.openPrimaryBtn.disabled = !pickPrimaryLocation(item);
  elements.shareBtn.disabled = !pickPrimaryLocation(item) || isAndroidOnly;
  elements.deleteBtn.disabled = false;
}

function selectItem(itemId) {
  const id = itemId || '';
  if (!id) {
    clearSelection();
    return;
  }
  setSelection([id], id, state.lastSelectedIndex);
}

async function setItemTags(itemId, tags) {
  await fetch(`/api/media/${itemId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags })
  });
  await fetchMedia();
}

async function deleteTag(tag) {
  const tagId = tag?.tag_id || '';
  const tagName = tag?.tag_name || '';
  if (!tagId) return;
  const ok = confirm(`删除标签“${tagName}”？\n仅当该标签未被任何资源使用时才可删除。`);
  if (!ok) return;

  const res = await fetch(`/api/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || '删除失败';
    if (/in use/i.test(msg)) {
      alert('该标签仍被资源使用，请先从相关资源中移除后再删除。');
    } else {
      alert(msg);
    }
    return;
  }

  await fetchBootstrap();
  await fetchMedia();
}

async function updateSelectedNote(nextNote) {
  const item = getSelectedItem();
  if (!item) return;
  await fetch(`/api/media/${item.item_id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: item.title,
      mediaType: item.media_type,
      description: nextNote,
      folderId: item.folder_id || ''
    })
  });
  await fetchMedia();
}

function openEditModal(item) {
  editingId = item.item_id;
  elements.editTitleInput.value = item.title || '';
  elements.editMediaTypeInput.value = item.media_type || 'Doc';
  elements.editMediaFolderInput.value = item.folder_id || '';
  elements.editMediaTagsInput.value = item.tags.map((t) => t.tag_name).join(', ');
  elements.editMediaDescriptionInput.value = item.description || '';
  elements.editMediaPathInput.value = '';
  elements.editMediaAccessInput.value = '';
  elements.editStorageTypeInput.value = 'Local';
  elements.editMediaDeviceInput.value = '';
  elements.editModal.classList.remove('hidden');
}

function closeEditModal() {
  editingId = null;
  elements.editModal.classList.add('hidden');
}

async function saveEdit() {
  if (!editingId) return;
  const title = elements.editTitleInput.value.trim();
  if (!title) return;

  const tags = elements.editMediaTagsInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  await fetch(`/api/media/${editingId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      mediaType: elements.editMediaTypeInput.value,
      description: elements.editMediaDescriptionInput.value.trim(),
      folderId: elements.editMediaFolderInput.value
    })
  });

  await fetch(`/api/media/${editingId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags })
  });

  const pathVal = normalizeUserPathInput(elements.editMediaPathInput.value);
  if (pathVal) {
    await fetch(`/api/media/${editingId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storageType: elements.editStorageTypeInput.value,
        path: pathVal,
        accessInfo: elements.editMediaAccessInput.value.trim(),
        deviceId: elements.editMediaDeviceInput.value || null
      })
    });
  }

  await fetchBootstrap();
  await fetchMedia();
  closeEditModal();
}

async function fetchBootstrap() {
  const res = await fetch('/api/bootstrap');
  const data = await res.json();
  state.user = data.user;
  state.devices = data.devices;
  state.folders = data.folders;
  state.tags = data.tags;
  rebuildFolderIndex();
  renderFolderOptions();
  renderDeviceOptions();
  renderLibraryNav();
  renderFolders();
  renderDevices();
  renderScopeDeviceOptions();
  updateScopeUI();
  renderSearchChips();
  updateToolbarControls();
}

async function fetchMedia() {
  const params = new URLSearchParams();

  if (state.library === 'trash') {
    params.set('trash', '1');
  }

  // Convert any typed tokens into chips before querying
  convertInputTokensToChips();

  const raw = (elements.searchInput?.value || '').trim();
  const { searchText } = parseSearchInput(raw);
  if (searchText) params.set('search', searchText);

  // Scope decides where we search, independent from sidebar selections.
  if (searchState.scope === 'currentFolder') {
    if (state.folderId) params.set('folderId', state.folderId);
  } else if (searchState.scope === 'device') {
    if (searchState.scopeDeviceId) params.set('deviceId', searchState.scopeDeviceId);
  }

  // If exactly one tag chip matches an existing tag, push down to API for performance.
  const tagChips = (searchState.chips || []).filter((c) => c.key === 'tag');
  if (tagChips.length === 1) {
    const tagId = findTagIdByName(tagChips[0].value);
    if (tagId) params.set('tagId', tagId);
  }

  const res = await fetch(`/api/media?${params.toString()}`);
  const serverItems = await res.json();

  state.media = applyScopeAndChips(serverItems);

  const visibleItems = filterByLibrary(state.media);

  // Keep multi-select consistent with what is currently visible.
  const visibleIdSet = new Set(visibleItems.map((m) => m.item_id));
  const nextSelected = Array.from(state.selectedItemIds).filter((id) => visibleIdSet.has(id));
  const primaryOk = state.selectedItemId && visibleIdSet.has(state.selectedItemId);

  if (!primaryOk) {
    const fallbackPrimary = nextSelected[0] || (visibleItems[0]?.item_id || '');
    setSelection(nextSelected.length ? nextSelected : (fallbackPrimary ? [fallbackPrimary] : []), fallbackPrimary, state.lastSelectedIndex);
  } else {
    // Ensure primary is included.
    const ensured = new Set(nextSelected);
    if (state.selectedItemId) ensured.add(state.selectedItemId);
    setSelection(Array.from(ensured), state.selectedItemId, state.lastSelectedIndex);
  }

  renderBreadcrumb();
  updateToolbarControls();
}

async function addFolder() {
  const name = elements.folderNameInput.value.trim();
  if (!name) return;
  await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName: name, parentId: elements.folderParentSelect.value })
  });
  elements.folderNameInput.value = '';
  await fetchBootstrap();
}

async function addDevice() {
  const name = elements.deviceNameInput.value.trim();
  if (!name) return;
  await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName: name, deviceType: elements.deviceTypeInput.value.trim() })
  });
  elements.deviceNameInput.value = '';
  elements.deviceTypeInput.value = '';
  await fetchBootstrap();
}

async function addMedia() {
  const selectedFile = elements.mediaUploadInput?.files?.[0] || null;
  if (selectedFile && elements.storageTypeInput.value !== 'Local') {
    alert('已选择文件时，“资源类型”必须是本地文件（Local）。');
    return false;
  }
  let title = elements.mediaTitleInput.value.trim();
  if (!title && selectedFile) {
    title = (selectedFile.name || '').replace(/\.[^./\\]+$/, '').trim();
  }

  const storageType = elements.storageTypeInput.value;
  const rawPath = normalizeUserPathInput(elements.mediaPathInput.value);
  if (!title && !selectedFile && rawPath) {
    const lastSeg = rawPath
      .replace(/[/\\]+$/, '')
      .split(/[/\\]+/)
      .filter(Boolean)
      .pop();
    title = (lastSeg || '').replace(/\.[^./\\]+$/, '').trim();
  }

  if (!title) {
    alert('请输入标题（或填写路径后自动生成标题）。');
    return false;
  }

  if (!selectedFile && storageType === 'Local' && !rawPath) {
    alert('索引本地文件时请填写“路径 / URL”。');
    return false;
  }

  const tagNames = elements.mediaTagsInput.value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (selectedFile && storageType === 'Local') {
    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('title', title);
    fd.append('mediaType', elements.mediaTypeInput.value);
    fd.append('description', elements.mediaDescriptionInput.value.trim());
    fd.append('folderId', elements.mediaFolderInput.value);
    fd.append('tags', JSON.stringify(tagNames));

    const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || '上传失败');
      return;
    }
    if (data?.item_id) {
      state.selectedItemId = data.item_id;
    }
  } else {
    const res = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        mediaType: elements.mediaTypeInput.value,
        description: elements.mediaDescriptionInput.value.trim(),
        folderId: elements.mediaFolderInput.value,
        tags: tagNames,
        storageType,
        path: rawPath,
        accessInfo: elements.mediaAccessInput.value.trim(),
        deviceId: elements.mediaDeviceInput.value
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error || '保存失败');
      return false;
    }
    if (data?.item_id) {
      state.selectedItemId = data.item_id;
    }
  }

  elements.mediaTitleInput.value = '';
  elements.mediaTagsInput.value = '';
  elements.mediaPathInput.value = '';
  if (elements.mediaUploadInput) elements.mediaUploadInput.value = '';
  elements.mediaAccessInput.value = '';
  elements.mediaDescriptionInput.value = '';

  await fetchBootstrap();
  await fetchMedia();

  return true;
}

function openAddModal() {
  elements.addModal.classList.remove('hidden');
  syncAddModalDeviceState();
  elements.mediaTitleInput.focus();
}

function closeAddModal() {
  elements.addModal.classList.add('hidden');
}

async function syncWithRemote() {
  const endpoint = normalizeSyncEndpoint(elements.syncEndpointInput.value);
  if (!endpoint) return;
  try {
    const exportRes = await fetch(`${endpoint}/api/sync/export`);
    if (!exportRes.ok) {
      const text = await exportRes.text().catch(() => '');
      alert(`同步失败：远端导出接口返回 ${exportRes.status} ${text || ''}`.trim());
      return;
    }
    const exportData = await exportRes.json().catch(() => ({}));
    if (!exportData?.payload) {
      alert('同步失败：远端导出数据格式不正确（缺少 payload）。');
      return;
    }

    const importRes = await fetch('/api/sync/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: exportData.payload })
    });
    if (!importRes.ok) {
      const text = await importRes.text().catch(() => '');
      alert(`同步失败：本机导入接口返回 ${importRes.status} ${text || ''}`.trim());
      return;
    }
  } catch (e) {
    alert(`同步失败：${e?.message || e}`);
    return;
  }

  await fetchBootstrap();
  await fetchMedia();
}

async function refreshAvailability() {
  await fetch('/api/storage/refresh', { method: 'POST' });
  await fetchMedia();
}

function bindEvents() {
    if (elements.sortBtn) {
      elements.sortBtn.addEventListener('click', async () => {
        const next = state.sortMode === 'created_desc'
          ? 'created_asc'
          : (state.sortMode === 'created_asc' ? 'title_asc' : 'created_desc');
        state.sortMode = next;
        updateToolbarControls();
        renderMediaList();
      });
    }

    if (elements.viewToggleBtn) {
      elements.viewToggleBtn.addEventListener('click', () => {
        state.viewMode = state.viewMode === 'list'
          ? 'grid'
          : (state.viewMode === 'grid' ? 'details' : 'list');
        updateToolbarControls();
        renderMediaList();
      });
    }
  elements.addFolderBtn.addEventListener('click', addFolder);
  elements.addDeviceBtn.addEventListener('click', addDevice);
  elements.openAddModalBtn.addEventListener('click', openAddModal);
  elements.closeAddModal.addEventListener('click', closeAddModal);
  if (elements.mediaUploadInput) {
    elements.mediaUploadInput.addEventListener('change', () => {
      syncAddModalDeviceState();
    });
  }
  if (elements.storageTypeInput) {
    elements.storageTypeInput.addEventListener('change', () => {
      syncAddModalDeviceState();
    });
  }
  elements.addModal.addEventListener('click', (e) => {
    if (e.target === elements.addModal.querySelector('.modal-backdrop')) {
      closeAddModal();
    }
  });
  elements.addMediaBtn.addEventListener('click', async () => {
    const ok = await addMedia();
    if (ok) closeAddModal();
  });
  elements.syncBtn.addEventListener('click', syncWithRemote);
  elements.refreshAvailabilityBtn.addEventListener('click', refreshAvailability);
  if (elements.showLanShareBtn) {
    elements.showLanShareBtn.addEventListener('click', handleToggleLanShare);
  }
  elements.closeEditModal.addEventListener('click', closeEditModal);
  elements.saveEditBtn.addEventListener('click', saveEdit);
  elements.editModal.addEventListener('click', (e) => {
    if (e.target === elements.editModal.querySelector('.modal-backdrop')) {
      closeEditModal();
    }
  });

  elements.libraryNav.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-library]');
    if (!btn) return;
    state.library = btn.dataset.library || 'all';
    renderLibraryNav();
    clearSelection();
    await fetchMedia();
  });

  elements.folderList.addEventListener('click', async (e) => {
    const caret = e.target.closest('.folder-caret');
    if (caret && !caret.classList.contains('spacer')) {
      const row = caret.closest('li[data-id]');
      if (!row) return;
      toggleFolderCollapsed(row.dataset.id);
      renderFolders();
      return;
    }
    const target = e.target.closest('li[data-id]');
    if (!target) return;
    cancelInlineRename();
    state.folderId = target.dataset.id;
    // Keep existing UX: folder navigation filters list by default.
    searchState.scope = state.folderId ? 'currentFolder' : 'all';
    updateScopeUI();
    renderFolders();
    await fetchMedia();
  });

  // Bulk bar actions
  if (elements.bulkMoveBtn) {
    elements.bulkMoveBtn.addEventListener('click', async () => {
      const folderId = elements.bulkFolderSelect?.value || '';
      if (!folderId) {
        alert('请选择目标文件夹');
        return;
      }
      const itemIds = Array.from(state.selectedItemIds);
      if (itemIds.length < 2) return;
      await fetch('/api/media/batch/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, folderId })
      });
      await fetchMedia();
    });
  }

  if (elements.bulkTagBtn) {
    elements.bulkTagBtn.addEventListener('click', async () => {
      const raw = elements.bulkTagsInput?.value || '';
      const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
      if (!tags.length) {
        alert('请输入标签（逗号分隔）');
        return;
      }
      const itemIds = Array.from(state.selectedItemIds);
      if (itemIds.length < 2) return;
      await fetch('/api/media/batch/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, tags })
      });
      await fetchMedia();
    });
  }

  if (elements.bulkUntagBtn) {
    elements.bulkUntagBtn.addEventListener('click', async () => {
      const raw = elements.bulkTagsInput?.value || '';
      const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
      if (!tags.length) {
        alert('请输入要移除的标签（逗号分隔）');
        return;
      }
      const itemIds = Array.from(state.selectedItemIds);
      if (itemIds.length < 2) return;
      await fetch('/api/media/batch/untag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, tags })
      });
      await fetchMedia();
    });
  }

  if (elements.bulkRestoreBtn) {
    elements.bulkRestoreBtn.addEventListener('click', async () => {
      const itemIds = Array.from(state.selectedItemIds);
      if (itemIds.length < 2) return;
      await fetch('/api/media/batch/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds })
      });
      clearSelection();
      await fetchMedia();
    });
  }

  if (elements.bulkDeleteBtn) {
    elements.bulkDeleteBtn.addEventListener('click', async () => {
      const itemIds = Array.from(state.selectedItemIds);
      if (itemIds.length < 2) return;
      const isTrash = state.library === 'trash';
      const ok = confirm(isTrash ? `永久删除 ${itemIds.length} 项？该操作不可恢复。` : `删除 ${itemIds.length} 项？（将移入回收站）`);
      if (!ok) return;

      if (isTrash) {
        await fetch('/api/media/batch/hardDelete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds })
        });
      } else {
        await fetch('/api/media/batch/trash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds })
        });
      }
      clearSelection();
      await fetchBootstrap();
      await fetchMedia();
    });
  }

  elements.folderList.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    if (!li.dataset.id) return;
    if (e.target.closest('.folder-rename-input')) return;
    cancelInlineRename();
    draggingFolderId = li.dataset.id;
    const folder = folderById.get(draggingFolderId);
    draggingParentId = folder?.parent_id || null;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', draggingFolderId);
    } catch {}
  });

  const clearDragOver = () => {
    elements.folderList.querySelectorAll('li.drag-over').forEach((el) => el.classList.remove('drag-over'));
  };

  elements.folderList.addEventListener('dragover', (e) => {
    if (!draggingFolderId && !draggingMediaItemIds) return;
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const targetId = li.dataset.id;
    if (!targetId) return;

    // Drag media onto folder: always allow (except trash mode).
    if (draggingMediaItemIds && !draggingFolderId) {
      if (state.library === 'trash') return;
      e.preventDefault();
      clearDragOver();
      li.classList.add('drag-over');
      return;
    }

    if (!draggingFolderId || targetId === draggingFolderId) return;

    const targetFolder = folderById.get(targetId);
    const targetParentId = targetFolder?.parent_id || null;
    if (targetParentId !== draggingParentId) return;

    e.preventDefault();
    clearDragOver();
    li.classList.add('drag-over');
  });

  elements.folderList.addEventListener('dragleave', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    li.classList.remove('drag-over');
  });

  elements.folderList.addEventListener('drop', async (e) => {
    if (!draggingFolderId && !draggingMediaItemIds) return;
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const targetId = li.dataset.id;
    if (!targetId) return;

    // Drop media onto folder to move.
    if (draggingMediaItemIds && !draggingFolderId) {
      if (state.library === 'trash') return;
      e.preventDefault();
      clearDragOver();
      const itemIds = draggingMediaItemIds.slice();
      draggingMediaItemIds = null;
      await fetch('/api/media/batch/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, folderId: targetId })
      });
      await fetchMedia();
      return;
    }

    if (!draggingFolderId || targetId === draggingFolderId) return;

    const targetFolder = folderById.get(targetId);
    const targetParentId = targetFolder?.parent_id || null;
    if (targetParentId !== draggingParentId) return;

    e.preventDefault();
    clearDragOver();

    const siblings = (state.folders || [])
      .filter((f) => (f.parent_id || null) === draggingParentId)
      .slice()
      .sort((a, b) => {
        const ao = Number.isFinite(a?.sort_order) ? a.sort_order : 0;
        const bo = Number.isFinite(b?.sort_order) ? b.sort_order : 0;
        if (ao !== bo) return ao - bo;
        return (a.folder_name || '').localeCompare(b.folder_name || '', 'zh-Hans-CN');
      });

    const fromIndex = siblings.findIndex((f) => f.folder_id === draggingFolderId);
    const toIndex = siblings.findIndex((f) => f.folder_id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const moved = siblings.splice(fromIndex, 1)[0];
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    siblings.splice(insertIndex, 0, moved);

    const orderedIds = siblings.map((f) => f.folder_id);

    try {
      const res = await fetch('/api/folders/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: draggingParentId, orderedIds })
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        alert(msg.error || '排序失败');
        return;
      }
      await fetchBootstrap();
    } finally {
      draggingFolderId = null;
      draggingParentId = null;
      clearDragOver();
    }
  });

  elements.folderList.addEventListener('dragend', () => {
    draggingFolderId = null;
    draggingParentId = null;
    draggingMediaItemIds = null;
    clearDragOver();
  });

  elements.deviceList.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('button.device-delete');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const li = delBtn.closest('li[data-id]');
      const deviceId = li?.dataset?.id || '';
      if (!deviceId) return;

      if (!confirm('确定删除该设备？（如果该设备仍被资源引用，将无法删除）')) {
        return;
      }

      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
      const msg = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(msg?.error || '删除失败');
        return;
      }

      if (state.deviceId === deviceId) {
        state.deviceId = '';
      }
      if (searchState.scope === 'device' && searchState.scopeDeviceId === deviceId) {
        searchState.scope = 'all';
        searchState.scopeDeviceId = '';
        updateScopeUI();
      }

      await fetchBootstrap();
      await fetchMedia();
      return;
    }

    const target = e.target.closest('li[data-id]');
    if (!target) return;
    state.deviceId = target.dataset.id;
    // Keep existing UX: device navigation filters list by default.
    searchState.scope = 'device';
    searchState.scopeDeviceId = state.deviceId;
    renderScopeDeviceOptions();
    updateScopeUI();
    renderDevices();
    await fetchMedia();
  });

  if (elements.searchScope) {
    elements.searchScope.addEventListener('change', () => {
      searchState.scope = elements.searchScope.value || 'all';
      updateScopeUI();
      fetchMedia();
    });
  }

  if (elements.searchScopeDevice) {
    elements.searchScopeDevice.addEventListener('change', () => {
      searchState.scopeDeviceId = elements.searchScopeDevice.value || '';
      fetchMedia();
    });
  }

  elements.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      convertInputTokensToChips();
      fetchMedia();
    }
  });

  elements.searchInput.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      // Auto convert tokens like tag:旅行 even if user doesn't press Enter.
      convertInputTokensToChips();
      fetchMedia();
    }, 180);
  });

  elements.mediaList.addEventListener('click', (e) => {
    const sortBtn = e.target.closest('button[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort || 'title';
      if (state.detailSortKey === key) {
        state.detailSortDir = state.detailSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.detailSortKey = key;
        state.detailSortDir = 'asc';
      }
      renderMediaList();
      return;
    }

    const checkbox = e.target.closest('input[data-role="select"]');
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const itemId = li.dataset.id;
    const index = Number(li.dataset.index);
    if (!itemId || !Number.isFinite(index)) return;

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    const displayed = getDisplayedItems();
    const rangeSelect = (from, to) => {
      const a = Math.max(0, Math.min(from, to));
      const b = Math.min(displayed.length - 1, Math.max(from, to));
      const ids = [];
      for (let i = a; i <= b; i += 1) ids.push(displayed[i].item_id);
      return ids;
    };

    // If user clicks checkbox, treat as toggle.
    if (checkbox) {
      e.preventDefault();
      e.stopPropagation();
      const next = new Set(state.selectedItemIds);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      setSelection(Array.from(next), itemId, index);
      return;
    }

    if (shift && state.lastSelectedIndex >= 0) {
      const ids = rangeSelect(state.lastSelectedIndex, index);
      const next = ctrl ? new Set(state.selectedItemIds) : new Set();
      ids.forEach((id) => next.add(id));
      setSelection(Array.from(next), itemId, index);
      return;
    }

    if (ctrl) {
      const next = new Set(state.selectedItemIds);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      setSelection(Array.from(next), itemId, index);
      return;
    }

    setSelection([itemId], itemId, index);
  });

  elements.mediaList.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const itemId = li.dataset.id;
    if (!itemId) return;
    e.preventDefault();

    // If right-clicked item isn't in selection, select it.
    if (!state.selectedItemIds.has(itemId)) {
      const index = Number(li.dataset.index);
      setSelection([itemId], itemId, Number.isFinite(index) ? index : state.lastSelectedIndex);
    }

    mediaContextTargetId = itemId;
    const item = getItemById(itemId);
    const loc = pickPrimaryLocation(item);
    mediaContextLocationId = loc?.location_id || null;
    showMediaContextMenu(e.clientX, e.clientY);
  });

  elements.mediaList.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const itemId = li.dataset.id;
    if (!itemId) return;

    // Ensure dragged item is selected.
    if (!state.selectedItemIds.has(itemId)) {
      const index = Number(li.dataset.index);
      setSelection([itemId], itemId, Number.isFinite(index) ? index : state.lastSelectedIndex);
    }

    draggingMediaItemIds = Array.from(state.selectedItemIds);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('application/x-mediarchive-itemids', JSON.stringify(draggingMediaItemIds));
    } catch {
      // ignore
    }
  });

  elements.mediaList.addEventListener('dragend', () => {
    draggingMediaItemIds = null;
  });

  elements.openPrimaryBtn.addEventListener('click', async () => {
    const item = getSelectedItem();
    if (!item) return;
    const loc = pickPrimaryLocation(item);
    if (!loc) return;

    await openItemWithUx(item, loc);
  });

  if (elements.transferModal) {
    elements.transferModal.addEventListener('click', (e) => {
      if (e.target?.classList?.contains('modal-backdrop')) closeTransferModal();
    });
  }
  if (elements.closeTransferModal) {
    elements.closeTransferModal.addEventListener('click', closeTransferModal);
  }
  if (elements.transferDownloadBtn) {
    elements.transferDownloadBtn.addEventListener('click', () => {
      void handleTransferDownload();
    });
  }
  if (elements.transferStreamBtn) {
    elements.transferStreamBtn.addEventListener('click', handleTransferStream);
  }

  elements.shareBtn.addEventListener('click', async () => {
    const item = getSelectedItem();
    if (!item) return;
    const loc = pickPrimaryLocation(item);
    if (!loc) return;
    if (!isWebLocation(loc) && isAndroidUriLocation(loc)) {
      alert('该资源位置是手机的 content:// URI，电脑端无法生成可下载链接。\n\n建议：在手机端分享文件；或先上传/导入到电脑端 uploads，再分享下载链接。');
      return;
    }
    let text = '';
    if (isWebLocation(loc)) {
      text = loc.path || '';
    } else if (loc.location_id) {
      const origin = await getSharableOrigin();
      text = `${origin}/api/media/${encodeURIComponent(item.item_id)}/download?locationId=${encodeURIComponent(loc.location_id)}`;
    } else {
      text = loc.path || '';
    }
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch (error) {
      alert('复制失败，请手动复制');
    }
  });

  elements.openEditBtn.addEventListener('click', () => {
    const item = getSelectedItem();
    if (!item) return;
    openEditModal(item);
  });

  elements.deleteBtn.addEventListener('click', async () => {
    const item = getSelectedItem();
    if (!item) return;
    const isTrash = state.library === 'trash' || !!item.deleted_at;
    const ok = confirm(isTrash
      ? `永久删除资源：${item.title || ''} ？该操作不可恢复。`
      : `删除资源：${item.title || ''} ？（将移入回收站）`
    );
    if (!ok) return;
    const url = isTrash
      ? `/api/media/${encodeURIComponent(item.item_id)}?force=1`
      : `/api/media/${encodeURIComponent(item.item_id)}`;
    await fetch(url, { method: 'DELETE' });
    clearSelection();
    await fetchBootstrap();
    await fetchMedia();
  });

  if (elements.restoreBtn) {
    elements.restoreBtn.addEventListener('click', async () => {
      const item = getSelectedItem();
      if (!item) return;
      await fetch(`/api/media/${encodeURIComponent(item.item_id)}/restore`, { method: 'POST' });
      clearSelection();
      await fetchBootstrap();
      await fetchMedia();
    });
  }

  if (elements.emptyTrashBtn) {
    elements.emptyTrashBtn.addEventListener('click', async () => {
      if (state.library !== 'trash') return;
      const ok = confirm('清空回收站？该操作不可恢复。');
      if (!ok) return;
      await fetch('/api/trash/empty', { method: 'POST' });
      clearSelection();
      await fetchBootstrap();
      await fetchMedia();
    });
  }

  elements.tagAddInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = elements.tagAddInput.value.trim();
    if (!value) return;
    const item = getSelectedItem();
    if (!item) return;
    const next = Array.from(new Set([...(item.tags || []).map((t) => t.tag_name), value]));
    elements.tagAddInput.value = '';
    await setItemTags(item.item_id, next);
  });

  elements.detailNote.addEventListener('input', () => {
    if (noteDebounceTimer) clearTimeout(noteDebounceTimer);
    noteDebounceTimer = setTimeout(() => {
      updateSelectedNote(elements.detailNote.value);
    }, 500);
  });

  document.addEventListener('dragover', (e) => {
    const types = Array.from(e.dataTransfer?.types || []);
    if (!types.includes('Files')) return;
    e.preventDefault();
    elements.dropOverlay.classList.remove('hidden');
  });

  document.addEventListener('dragleave', (e) => {
    if (e.target === document.documentElement || e.target === document.body) {
      elements.dropOverlay.classList.add('hidden');
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    elements.dropOverlay.classList.add('hidden');
    const files = e.dataTransfer?.files || [];
    if (!files.length) return;
    for (const file of files) {
      const filePath = normalizeUserPathInput(file.path);
      const title = (file?.name || '').toString().trim() || (filePath ? filePath.split(/[/\\]/).pop() : '未命名');

      // In standard browsers (or some hardened environments), file.path may be empty.
      // Fallback to uploading a copy so drag-drop still works.
      try {
        if (filePath) {
          const res = await fetch('/api/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title,
              mediaType: 'Doc',
              description: '',
              folderId: elements.mediaFolderInput.value,
              tags: [],
              storageType: 'Local',
              path: filePath,
              accessInfo: '',
              deviceId: elements.mediaDeviceInput.value || null
            })
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data?.error || '拖拽导入失败');
          }
        } else {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('title', title);
          fd.append('mediaType', 'Doc');
          fd.append('description', '');
          fd.append('folderId', elements.mediaFolderInput.value);
          fd.append('tags', JSON.stringify([]));

          const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(data?.error || '拖拽上传失败');
          }
        }
      } catch (err) {
        alert(`拖拽导入失败：${err?.message || err}`);
      }
    }
    await fetchBootstrap();
    await fetchMedia();
  });

  elements.folderList.addEventListener('contextmenu', (e) => {
    const target = e.target.closest('li[data-id]');
    if (!target) return;
    if (!target.dataset.id) return;
    e.preventDefault();
    folderContextTarget = target.dataset.id;
    showFolderContextMenu(e.clientX, e.clientY);
  });

  elements.folderList.addEventListener('dblclick', (e) => {
    const target = e.target.closest('li[data-id]');
    if (!target) return;
    if (!target.dataset.id) return;
    startInlineRenameFolder(target.dataset.id);
  });

  document.addEventListener('paste', async (e) => {
    const target = e.target;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    const isUrl = /^https?:\/\//i.test(text.trim());
    if (!isUrl) return;
    const url = text.trim();
    await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: url,
        mediaType: 'Web',
        description: '',
        folderId: elements.mediaFolderInput.value,
        tags: [],
        storageType: 'Web',
        path: url,
        accessInfo: '',
        deviceId: elements.mediaDeviceInput.value || null
      })
    });
    await fetchBootstrap();
    await fetchMedia();
  });

  document.addEventListener('click', (e) => {
    if (!elements.folderContextMenu.contains(e.target)) {
      hideFolderContextMenu();
    }
    if (elements.mediaContextMenu && !elements.mediaContextMenu.contains(e.target)) {
      hideMediaContextMenu();
    }
  });

  document.addEventListener('click', (e) => {
    const renameInput = elements.folderList.querySelector('.folder-rename-input');
    if (!renameInput) return;
    if (elements.folderContextMenu.contains(e.target)) return;
    if (!renameInput.contains(e.target)) {
      renameInput.blur();
    }
  });

  elements.folderContextMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    const action = btn ? btn.dataset.action : null;
    const targetId = folderContextTarget;
    if (!action || !targetId) return;
    if (action === 'rename') {
      hideFolderContextMenu();
      setTimeout(() => startInlineRenameFolder(targetId), 0);
      return;
    }
    if (action === 'delete') {
      cancelInlineRename();
      const ok = window.confirm('确定删除该文件夹？如有子文件夹将无法删除');
      if (ok) {
        const res = await fetch(`/api/folders/${targetId}`, { method: 'DELETE' });
        if (!res.ok) {
          const msg = await res.json().catch(() => ({}));
          alert(msg.error || '删除失败');
        } else {
          await fetchBootstrap();
          await fetchMedia();
        }
      }
    }
    hideFolderContextMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    elements.folderContextMenu.classList.add('hidden');
    hideMediaContextMenu();
    closeAddModal();
    closeEditModal();
    closeTransferModal();
    cancelInlineRename();
  });

  if (elements.mediaContextMenu) {
    elements.mediaContextMenu.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      const action = btn ? btn.dataset.action : null;
      const targetId = mediaContextTargetId;
      if (!action || !targetId) return;
      const item = getItemById(targetId);
      if (!item) return;

      if (action === 'open') {
        hideMediaContextMenu();
        await openItemFromContext(item);
        return;
      }
      if (action === 'reveal') {
        hideMediaContextMenu();
        const loc = getLocationForContext(item);
        if (!loc || isWebLocation(loc)) {
          alert('该资源没有可定位的本地文件位置');
          return;
        }
        const url = `/api/media/${encodeURIComponent(item.item_id)}/reveal?locationId=${encodeURIComponent(loc.location_id)}`;
        const res = await fetch(url, { method: 'POST' });
        if (!res.ok) {
          const msg = await res.json().catch(() => ({}));
          alert(msg?.error || '定位失败');
        }
        return;
      }
      if (action === 'copyPath') {
        hideMediaContextMenu();
        const loc = getLocationForContext(item);
        if (!loc) return;
        const text = loc.path || '';
        try {
          await navigator.clipboard.writeText(text);
          alert('已复制到剪贴板');
        } catch {
          alert('复制失败');
        }
        return;
      }
      if (action === 'copyLink') {
        hideMediaContextMenu();
        const loc = getLocationForContext(item);
        if (!loc) return;
        let text = '';
        if (isWebLocation(loc)) {
          text = loc.path || '';
        } else {
          const origin = await getSharableOrigin();
          text = `${origin}/api/media/${encodeURIComponent(item.item_id)}/download?locationId=${encodeURIComponent(loc.location_id)}`;
        }
        try {
          await navigator.clipboard.writeText(text);
          alert('已复制到剪贴板');
        } catch {
          alert('复制失败');
        }
        return;
      }
      if (action === 'moveTo') {
        hideMediaContextMenu();
        if (state.library === 'trash' || item.deleted_at) {
          alert('回收站中的资源无法移动');
          return;
        }

        const itemIds = Array.from(state.selectedItemIds.size ? state.selectedItemIds : [item.item_id]);
        if (itemIds.length >= 2) {
          alert('多选移动请使用上方“批量操作”栏的“移动到”');
          return;
        }

        openEditModal(item);
        setTimeout(() => {
          try {
            elements.editMediaFolderInput?.focus?.();
          } catch {}
        }, 0);
        return;
      }

      if (action === 'trash') {
        hideMediaContextMenu();
        if (state.library === 'trash' || item.deleted_at) {
          alert('该资源已在回收站');
          return;
        }

        const itemIds = Array.from(state.selectedItemIds.size ? state.selectedItemIds : [item.item_id]);
        const ok = confirm(itemIds.length >= 2
          ? `删除 ${itemIds.length} 项？（将移入回收站）`
          : `删除资源：${item.title || ''} ？（将移入回收站）`
        );
        if (!ok) return;

        if (itemIds.length >= 2) {
          await fetch('/api/media/batch/trash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemIds })
          });
        } else {
          await fetch(`/api/media/${encodeURIComponent(item.item_id)}`, { method: 'DELETE' });
        }

        clearSelection();
        await fetchBootstrap();
        await fetchMedia();
        return;
      }

      if (action === 'restore') {
        hideMediaContextMenu();
        if (!(state.library === 'trash' || item.deleted_at)) {
          alert('该资源不在回收站');
          return;
        }

        const itemIds = Array.from(state.selectedItemIds.size ? state.selectedItemIds : [item.item_id]);
        if (itemIds.length >= 2) {
          await fetch('/api/media/batch/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemIds })
          });
        } else {
          await fetch(`/api/media/${encodeURIComponent(item.item_id)}/restore`, { method: 'POST' });
        }

        clearSelection();
        await fetchBootstrap();
        await fetchMedia();
        return;
      }

      if (action === 'hardDelete') {
        hideMediaContextMenu();
        if (!(state.library === 'trash' || item.deleted_at)) {
          alert('仅回收站中的资源可永久删除');
          return;
        }

        const itemIds = Array.from(state.selectedItemIds.size ? state.selectedItemIds : [item.item_id]);
        const ok = confirm(itemIds.length >= 2
          ? `永久删除 ${itemIds.length} 项？该操作不可恢复。`
          : `永久删除资源：${item.title || ''} ？该操作不可恢复。`
        );
        if (!ok) return;

        if (itemIds.length >= 2) {
          await fetch('/api/media/batch/hardDelete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemIds })
          });
        } else {
          await fetch(`/api/media/${encodeURIComponent(item.item_id)}?force=1`, { method: 'DELETE' });
        }

        clearSelection();
        await fetchBootstrap();
        await fetchMedia();
        return;
      }
    });
  }
}

function showFolderContextMenu(x, y) {
  const menu = elements.folderContextMenu;
  menu.classList.remove('hidden');
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, innerWidth - rect.width - 8);
  const top = Math.min(y, innerHeight - rect.height - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideFolderContextMenu() {
  folderContextTarget = null;
  elements.folderContextMenu.classList.add('hidden');
}

function showMediaContextMenu(x, y) {
  const menu = elements.mediaContextMenu;
  if (!menu) return;
  updateMediaContextMenuVisibility();
  menu.classList.remove('hidden');
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, innerWidth - rect.width - 8);
  const top = Math.min(y, innerHeight - rect.height - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideMediaContextMenu() {
  mediaContextTargetId = null;
  mediaContextLocationId = null;
  if (elements.mediaContextMenu) elements.mediaContextMenu.classList.add('hidden');
}

function setContextActionVisible(action, visible) {
  const btn = elements.mediaContextMenu?.querySelector?.(`button[data-action="${action}"]`);
  if (!btn) return;
  btn.classList.toggle('hidden', !visible);
}

function updateMediaContextMenuVisibility() {
  const inTrash = state.library === 'trash';
  setContextActionVisible('trash', !inTrash);
  setContextActionVisible('restore', inTrash);
  setContextActionVisible('hardDelete', inTrash);
  setContextActionVisible('moveTo', !inTrash);
}

function getItemById(itemId) {
  return state.media.find((m) => m.item_id === itemId) || null;
}

function getLocationForContext(item) {
  if (!item) return null;
  const loc = pickPrimaryLocation(item);
  if (!loc) return null;
  if (mediaContextLocationId) {
    const found = (item.locations || []).find((l) => l.location_id === mediaContextLocationId);
    return found || loc;
  }
  return loc;
}

async function openItemFromContext(item) {
  const loc = getLocationForContext(item);
  if (!loc) return;
  await openItemWithUx(item, loc);
}

async function init() {
  await fetchBootstrap();
  await fetchMedia();
  bindEvents();
  updateToolbarControls();
}

init();
