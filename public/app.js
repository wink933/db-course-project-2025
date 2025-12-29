const state = {
  user: null,
  devices: [],
  folders: [],
  tags: [],
  media: []
};

const elements = {
  folderList: document.getElementById('folderList'),
  deviceList: document.getElementById('deviceList'),
  tagList: document.getElementById('tagList'),
  folderNameInput: document.getElementById('folderNameInput'),
  folderParentSelect: document.getElementById('folderParentSelect'),
  addFolderBtn: document.getElementById('addFolderBtn'),
  deviceNameInput: document.getElementById('deviceNameInput'),
  deviceTypeInput: document.getElementById('deviceTypeInput'),
  addDeviceBtn: document.getElementById('addDeviceBtn'),
  tagNameInput: document.getElementById('tagNameInput'),
  addTagBtn: document.getElementById('addTagBtn'),
  syncEndpointInput: document.getElementById('syncEndpointInput'),
  syncBtn: document.getElementById('syncBtn'),
  refreshAvailabilityBtn: document.getElementById('refreshAvailabilityBtn'),
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
  mediaTableBody: document.getElementById('mediaTableBody'),
  searchInput: document.getElementById('searchInput'),
  mediaTypeFilter: document.getElementById('mediaTypeFilter'),
  tagFilter: document.getElementById('tagFilter'),
  deviceFilter: document.getElementById('deviceFilter'),
  searchBtn: document.getElementById('searchBtn'),
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
  elements.deviceFilter.innerHTML = '<option value="">全部设备</option>' + state.devices.map((device) => `<option value="${device.device_id}">${device.device_name}</option>`).join('');
  elements.editMediaDeviceInput.innerHTML = options.join('');
}

function renderTagOptions() {
  elements.tagFilter.innerHTML = '<option value="">全部标签</option>' + state.tags.map((tag) => `<option value="${tag.tag_id}">${tag.tag_name}</option>`).join('');
}

function renderFolders() {
  elements.folderList.innerHTML = '';
  state.folders.forEach((folder) => {
    const li = document.createElement('li');
    li.textContent = folder.folder_name;
    li.dataset.id = folder.folder_id;
    elements.folderList.appendChild(li);
  });
}

async function promptRenameFolder(targetId) {
  if (!targetId) return;
  const newName = window.prompt('输入新的文件夹名称');
  if (!newName || !newName.trim()) return;
  const res = await fetch(`/api/folders/${targetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName: newName.trim() })
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    alert(msg.error || '重命名失败');
    return;
  }
  await fetchBootstrap();
  await fetchMedia();
}

function renderDevices() {
  elements.deviceList.innerHTML = '';
  state.devices.forEach((device) => {
    const li = document.createElement('li');
    const lastSync = device.last_sync_time ? new Date(device.last_sync_time) : null;
    const isRecent = lastSync && (Date.now() - lastSync.getTime() < 5 * 60 * 1000);
    const statusDot = `<span class="status-dot ${isRecent ? 'online' : 'offline'}"></span>`;
    const syncText = lastSync ? lastSync.toLocaleString() : '未同步';
    li.innerHTML = `${statusDot}<span class="device-name">${device.device_name}</span> <span class="device-type">(${device.device_type || '未知'})</span><br /><span class="device-sync">上次同步：${syncText}</span>`;
    elements.deviceList.appendChild(li);
  });
}

function renderTags() {
  elements.tagList.innerHTML = '';
  state.tags.forEach((tag) => {
    const li = document.createElement('li');
    li.textContent = tag.tag_name;
    elements.tagList.appendChild(li);
  });
}

function renderMediaTable() {
  elements.mediaTableBody.innerHTML = '';
  const folderMap = Object.fromEntries(state.folders.map((folder) => [folder.folder_id, folder.folder_name]));

  const formatLocation = (loc) => {
    if (!loc || !loc.path) return '';
    const isWeb = loc.storage_type === 'Web' || /^https?:\/\//i.test(loc.path);
    const status = loc.storage_type === 'Local'
      ? (loc.is_available ? '可用' : '不可用')
      : '在线';

    if (isWeb) {
      const safeUrl = loc.path;
      return `<a class="link-web" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a> (${status})`;
    }

    const downloadUrl = `/api/file?path=${encodeURIComponent(loc.path)}`;
    const display = loc.path;
    return `<a class="link-local" href="${downloadUrl}" download>${display}</a> (${status})`;
  };

  state.media.forEach((item) => {
    const tr = document.createElement('tr');
    const tagNames = item.tags.map((tag) => tag.tag_name).join(', ');
    const locations = item.locations.map((loc) => formatLocation(loc)).join('<br />');

    tr.innerHTML = `
      <td>${item.title}</td>
      <td>${item.media_type || ''}</td>
      <td>${folderMap[item.folder_id] || '未分类'}</td>
      <td>${tagNames}</td>
      <td>${locations}</td>
      <td>
        <button class="secondary" data-edit-id="${item.item_id}">编辑</button>
        <button class="danger" data-id="${item.item_id}">删除</button>
      </td>
    `;
    elements.mediaTableBody.appendChild(tr);
  });

  elements.mediaTableBody.querySelectorAll('button[data-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const itemId = button.getAttribute('data-id');
      if (!itemId) return;
      await fetch(`/api/media/${itemId}`, { method: 'DELETE' });
      await fetchMedia();
    });
  });

  elements.mediaTableBody.querySelectorAll('button[data-edit-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemId = button.getAttribute('data-edit-id');
      if (!itemId) return;
      const target = state.media.find((m) => m.item_id === itemId);
      if (!target) return;
      openEditModal(target);
    });
  });
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
  renderFolderOptions();
  renderDeviceOptions();
  renderTagOptions();
  renderFolders();
  renderDevices();
  renderTags();
}

async function fetchMedia() {
  const params = new URLSearchParams();
  if (elements.searchInput.value.trim()) {
    params.set('search', elements.searchInput.value.trim());
  }
  if (elements.mediaTypeFilter.value) {
    params.set('mediaType', elements.mediaTypeFilter.value);
  }
  if (elements.tagFilter.value) {
    params.set('tagId', elements.tagFilter.value);
  }
  if (elements.deviceFilter.value) {
    params.set('deviceId', elements.deviceFilter.value);
  }
  const res = await fetch(`/api/media?${params.toString()}`);
  state.media = await res.json();
  renderMediaTable();
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

async function addTag() {
  const name = elements.tagNameInput.value.trim();
  if (!name) return;
  await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagName: name })
  });
  elements.tagNameInput.value = '';
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
  elements.addFolderBtn.addEventListener('click', addFolder);
  elements.addDeviceBtn.addEventListener('click', addDevice);
  elements.addTagBtn.addEventListener('click', addTag);
  elements.addMediaBtn.addEventListener('click', addMedia);
  elements.searchBtn.addEventListener('click', fetchMedia);
  elements.syncBtn.addEventListener('click', syncWithRemote);
  elements.refreshAvailabilityBtn.addEventListener('click', refreshAvailability);
  elements.closeEditModal.addEventListener('click', closeEditModal);
  elements.saveEditBtn.addEventListener('click', saveEdit);
  elements.editModal.addEventListener('click', (e) => {
    if (e.target === elements.editModal.querySelector('.modal-backdrop')) {
      closeEditModal();
    }
  });

  document.addEventListener('dragover', (e) => {
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
    e.preventDefault();
    folderContextTarget = target.dataset.id;
    showFolderContextMenu(e.clientX, e.clientY);
  });

  elements.folderList.addEventListener('dblclick', (e) => {
    const target = e.target.closest('li[data-id]');
    if (!target) return;
    promptRenameFolder(target.dataset.id);
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

  elements.folderContextMenu.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    const targetId = folderContextTarget;
    if (!action || !targetId) return;
    if (action === 'rename') {
      await promptRenameFolder(targetId);
    }
    if (action === 'delete') {
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
}

init();
