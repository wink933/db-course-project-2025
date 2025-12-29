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
  searchBtn: document.getElementById('searchBtn')
};

function renderFolderOptions() {
  const options = ['<option value="">未分类</option>'];
  state.folders.forEach((folder) => {
    options.push(`<option value="${folder.folder_id}">${folder.folder_name}</option>`);
  });
  elements.folderParentSelect.innerHTML = '<option value="">根目录</option>' + options.slice(1).join('');
  elements.mediaFolderInput.innerHTML = options.join('');
}

function renderDeviceOptions() {
  const options = ['<option value="">未指定</option>'];
  state.devices.forEach((device) => {
    options.push(`<option value="${device.device_id}">${device.device_name}</option>`);
  });
  elements.mediaDeviceInput.innerHTML = options.join('');
  elements.deviceFilter.innerHTML = '<option value="">全部设备</option>' + state.devices.map((device) => `<option value="${device.device_id}">${device.device_name}</option>`).join('');
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

function renderDevices() {
  elements.deviceList.innerHTML = '';
  state.devices.forEach((device) => {
    const li = document.createElement('li');
    li.textContent = `${device.device_name} (${device.device_type || '未知'})`;
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
      <td><button class="danger" data-id="${item.item_id}">删除</button></td>
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
}

async function init() {
  await fetchBootstrap();
  await fetchMedia();
  bindEvents();
}

init();
