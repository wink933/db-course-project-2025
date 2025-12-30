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
  viewMode: 'list'
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

  searchInput: document.getElementById('searchInput'),
  searchScope: document.getElementById('searchScope'),
  searchScopeDevice: document.getElementById('searchScopeDevice'),
  searchChips: document.getElementById('searchChips'),
  mediaList: document.getElementById('mediaList'),

  sortBtn: document.getElementById('sortBtn'),
  viewToggleBtn: document.getElementById('viewToggleBtn'),

  inspectorEmpty: document.getElementById('inspectorEmpty'),
  inspector: document.getElementById('inspector'),
  previewBox: document.getElementById('previewBox'),
  detailTitle: document.getElementById('detailTitle'),
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

  dropOverlay: document.getElementById('dropOverlay'),
  folderContextMenu: document.getElementById('folderContextMenu')
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

function pickPrimaryLocation(item) {
  if (!item?.locations?.length) return null;
  const web = item.locations.find((l) => isWebLocation(l));
  if (web) return web;
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
  return mode === 'grid' ? '网格' : '列表';
}

function updateToolbarControls() {
  if (elements.sortBtn) elements.sortBtn.textContent = `排序：${sortModeLabel(state.sortMode)}`;
  if (elements.viewToggleBtn) elements.viewToggleBtn.textContent = `视图：${viewModeLabel(state.viewMode)}`;
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
  const options = ['<option value="">未分类</option>'];
  state.folders.forEach((folder) => {
    options.push(`<option value="${folder.folder_id}">${folder.folder_name}</option>`);
  });
  elements.folderParentSelect.innerHTML = '<option value="">根目录</option>' + options.slice(1).join('');
  elements.mediaFolderInput.innerHTML = options.join('');
  elements.editMediaFolderInput.innerHTML = options.join('');
}

function renderDeviceOptions() {
  const options = ['<option value="">未指定</option>'];
  state.devices.forEach((device) => {
    options.push(`<option value="${device.device_id}">${device.device_name}</option>`);
  });
  elements.mediaDeviceInput.innerHTML = options.join('');
  elements.editMediaDeviceInput.innerHTML = options.join('');
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
    const statusDot = `<span class="status-dot ${isRecent ? 'online' : 'offline'}"></span>`;
    li.innerHTML = `${statusDot}<span class="device-name">${device.device_name}</span> <span class="device-type">(${device.device_type || '未知'})</span>`;
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
  return items;
}

function renderMediaList() {
  elements.mediaList.innerHTML = '';
  const items = filterByLibrary(state.media).slice();

  // view mode
  elements.mediaList.classList.toggle('grid', state.viewMode === 'grid');

  // sort
  if (state.sortMode === 'created_asc') {
    items.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  } else if (state.sortMode === 'title_asc') {
    items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN'));
  } else {
    items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }

  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'resource-item';
    empty.style.cursor = 'default';
    empty.innerHTML = `<div class="item-info"><div class="item-title">暂无资源</div><div class="item-meta">尝试切换左侧库分类或修改搜索条件</div></div>`;
    elements.mediaList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'resource-item';
    li.dataset.id = item.item_id;
    if (item.item_id === state.selectedItemId) {
      li.classList.add('selected');
    }
    const icon = typeIcon(item.media_type);
    const primaryLoc = pickPrimaryLocation(item);
    const locText = primaryLoc
      ? (isWebLocation(primaryLoc) ? 'Web' : `本地: ${primaryLoc.path}`)
      : '';
    const tagPills = (item.tags || []).slice(0, 2).map((t) => `<span class="tag-pill">${t.tag_name}</span>`).join('');
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
    elements.mediaList.appendChild(li);
  }
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
    return;
  }

  setInspectorVisible(true);

  const loc = pickPrimaryLocation(item);
  const mediaType = (item.media_type || '').toLowerCase();
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
    const filePath = loc.path || '';
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    const src = `/api/media/${encodeURIComponent(item.item_id)}/preview?locationId=${encodeURIComponent(loc.location_id)}`;
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
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
      elements.previewBox.innerHTML = `
        <div class="preview-empty">
          ${typeIcon(item.media_type)}
          <div style="margin-top:8px; font-weight:600;">无法预览该格式</div>
          <div style="margin-top:6px; color: var(--muted); font-size: 12px;">可点击“打开”查看原文件</div>
        </div>
      `;
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-option';
      const selected = existing.has(t.tag_name);
      if (selected) btn.classList.add('selected');
      btn.textContent = t.tag_name;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = new Set((item.tags || []).map((x) => x.tag_name));
        if (next.has(t.tag_name)) next.delete(t.tag_name);
        else next.add(t.tag_name);
        await setItemTags(item.item_id, Array.from(next));
      });
      elements.tagPicker.appendChild(btn);
    });
  }

  elements.detailNote.value = item.description || '';

  elements.openPrimaryBtn.disabled = !pickPrimaryLocation(item);
  elements.shareBtn.disabled = !pickPrimaryLocation(item);
  elements.deleteBtn.disabled = false;
}

function selectItem(itemId) {
  state.selectedItemId = itemId || '';
  renderMediaList();
  renderInspector();
}

async function setItemTags(itemId, tags) {
  await fetch(`/api/media/${itemId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags })
  });
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

  const pathVal = elements.editMediaPathInput.value.trim();
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
  if (state.selectedItemId && !visibleItems.some((m) => m.item_id === state.selectedItemId)) {
    state.selectedItemId = '';
  }
  if (!state.selectedItemId && visibleItems.length) {
    state.selectedItemId = visibleItems[0].item_id;
  }
  renderMediaList();
  renderInspector();
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
  const title = elements.mediaTitleInput.value.trim();
  if (!title) return;

  const tagNames = elements.mediaTagsInput.value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  await fetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      mediaType: elements.mediaTypeInput.value,
      description: elements.mediaDescriptionInput.value.trim(),
      folderId: elements.mediaFolderInput.value,
      tags: tagNames,
      storageType: elements.storageTypeInput.value,
      path: elements.mediaPathInput.value.trim(),
      accessInfo: elements.mediaAccessInput.value.trim(),
      deviceId: elements.mediaDeviceInput.value
    })
  });

  elements.mediaTitleInput.value = '';
  elements.mediaTagsInput.value = '';
  elements.mediaPathInput.value = '';
  elements.mediaAccessInput.value = '';
  elements.mediaDescriptionInput.value = '';

  await fetchBootstrap();
  await fetchMedia();
}

function openAddModal() {
  elements.addModal.classList.remove('hidden');
  elements.mediaTitleInput.focus();
}

function closeAddModal() {
  elements.addModal.classList.add('hidden');
}

async function syncWithRemote() {
  const endpoint = elements.syncEndpointInput.value.trim();
  if (!endpoint) return;
  const exportRes = await fetch(`${endpoint}/api/sync/export`);
  const exportData = await exportRes.json();

  await fetch('/api/sync/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: exportData.payload })
  });

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
        state.viewMode = state.viewMode === 'list' ? 'grid' : 'list';
        updateToolbarControls();
        renderMediaList();
      });
    }
  elements.addFolderBtn.addEventListener('click', addFolder);
  elements.addDeviceBtn.addEventListener('click', addDevice);
  elements.openAddModalBtn.addEventListener('click', openAddModal);
  elements.closeAddModal.addEventListener('click', closeAddModal);
  elements.addModal.addEventListener('click', (e) => {
    if (e.target === elements.addModal.querySelector('.modal-backdrop')) {
      closeAddModal();
    }
  });
  elements.addMediaBtn.addEventListener('click', async () => {
    await addMedia();
    closeAddModal();
  });
  elements.syncBtn.addEventListener('click', syncWithRemote);
  elements.refreshAvailabilityBtn.addEventListener('click', refreshAvailability);
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
    if (!draggingFolderId) return;
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const targetId = li.dataset.id;
    if (!targetId || targetId === draggingFolderId) return;

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
    if (!draggingFolderId) return;
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const targetId = li.dataset.id;
    if (!targetId || targetId === draggingFolderId) return;

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
    clearDragOver();
  });

  elements.deviceList.addEventListener('click', async (e) => {
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
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    selectItem(li.dataset.id);
  });

  elements.openPrimaryBtn.addEventListener('click', async () => {
    const item = getSelectedItem();
    if (!item) return;
    const loc = pickPrimaryLocation(item);
    if (!loc) return;
    if (isWebLocation(loc)) {
      window.open(loc.path, '_blank', 'noopener,noreferrer');
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
  });

  elements.shareBtn.addEventListener('click', async () => {
    const item = getSelectedItem();
    if (!item) return;
    const loc = pickPrimaryLocation(item);
    if (!loc) return;
    const text = isWebLocation(loc) ? loc.path : loc.path;
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
    const ok = confirm(`删除资源：${item.title || ''} ？`);
    if (!ok) return;
    await fetch(`/api/media/${item.item_id}`, { method: 'DELETE' });
    state.selectedItemId = '';
    await fetchBootstrap();
    await fetchMedia();
  });

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
      const filePath = file.path;
      if (!filePath) continue;
      const title = file.name || filePath.split(/[/\\]/).pop();
      await fetch('/api/media', {
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
    closeAddModal();
    closeEditModal();
    cancelInlineRename();
  });
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

async function init() {
  await fetchBootstrap();
  await fetchMedia();
  bindEvents();
  updateToolbarControls();
}

init();
