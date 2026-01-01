package com.example.mediarchive

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainViewModel(app: Application) : AndroidViewModel(app) {
  private val db = AppDatabase.get(app)
  private val repo = FileRepository(db.indexedFileDao())

  private var lanServer: LanFileServer? = null

  private var lanOrigin: String? = null
  private var lanToken: String? = null

  var serverBaseUrl: String by mutableStateOf("")
    private set

  var lastSyncMessage: String by mutableStateOf("")
    private set

  var isSyncing: Boolean by mutableStateOf(false)
    private set

  var remoteDevices: List<SyncClient.RemoteDevice> by mutableStateOf(emptyList())
    private set

  var remoteFolders: List<SyncClient.RemoteFolder> by mutableStateOf(emptyList())
    private set

  init {
    serverBaseUrl = SyncClient.getServerBaseUrl(app)
    ensureLanServerRunning()
  }

  fun getLanOriginForSync(): String? = lanOrigin
  fun getLanTokenForSync(): String? = lanToken

  private fun ensureLanServerRunning() {
    val context = getApplication<Application>()
    if (lanServer != null) return

    val token = SyncClient.getOrCreateLanTransferToken(context)
    val dao = db.indexedFileDao()

    // Try a small port range to avoid conflicts.
    val ports = (9100..9109).toList()
    var started: LanFileServer? = null
    var lastError: Exception? = null
    for (p in ports) {
      try {
        val s = LanFileServer(context, dao, token, p)
        s.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
        started = s
        break
      } catch (e: Exception) {
        lastError = e
      }
    }

    if (started == null) {
      lanOrigin = null
      lanToken = null
      lastSyncMessage = "局域网文件服务启动失败：${lastError?.message ?: "端口占用"}"
      return
    }

    lanServer = started
    val origins = LanFileServer.listLanOrigins(started.listeningPort)
    lanOrigin = origins.firstOrNull()
    lanToken = token
  }

  fun updateServerBaseUrl(value: String) {
    serverBaseUrl = value
    SyncClient.setServerBaseUrl(getApplication(), value)
  }

  val items: StateFlow<List<IndexedFile>> = repo.observeAll()
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

  fun deleteItem(item: IndexedFile) {
    val context = getApplication<Application>()
    viewModelScope.launch {
      SyncClient.addPendingDeletedItemId(context, item.itemId)
      repo.deleteById(item.id)
    }
  }

  fun addFromPickedUri(uri: Uri) {
    val context = getApplication<Application>()

    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
    try {
      context.contentResolver.takePersistableUriPermission(uri, flags)
    } catch (_: Exception) {
      // Some providers may not support persistable permissions.
    }

    val mimeType = context.contentResolver.getType(uri)
    val displayName = queryDisplayName(context, uri) ?: (uri.lastPathSegment ?: uri.toString())

    viewModelScope.launch {
      val deviceId = SyncClient.getOrCreateDeviceId(context)
      repo.addIndexedFile(
        displayName = displayName,
        uri = uri.toString(),
        mimeType = mimeType,
        nowMs = System.currentTimeMillis(),
        deviceId = deviceId
      )
    }
  }

  fun syncNow() {
    val context = getApplication<Application>()
    val baseUrl = serverBaseUrl.trim()
    if (baseUrl.isBlank()) {
      lastSyncMessage = "请先填写服务器地址"
      return
    }

    viewModelScope.launch {
      isSyncing = true
      try {
        // Only push phone-local items (content://). Pulled desktop paths should not be pushed back as phone locations.
        val allLocal = repo.getAllOnce().filter { it.uri.startsWith("content://") }
        val pendingDeletes = SyncClient.getPendingDeletedItemIds(context)
        withContext(Dispatchers.IO) {
          ensureLanServerRunning()
          val resp = SyncClient.push(
            context,
            baseUrl,
            allLocal,
            lanOrigin = getLanOriginForSync(),
            lanToken = getLanTokenForSync(),
            deletedItemIds = pendingDeletes
          )

          // If server merged our device into a canonical device_id, normalize local content:// rows
          // so device-view filtering matches server-side device ids.
          val canonicalDeviceId = resp.optJSONObject("device")?.optString("device_id")?.trim()
          if (!canonicalDeviceId.isNullOrBlank()) {
            repo.setDeviceIdForAllContentUris(canonicalDeviceId)
          }
        }
        if (pendingDeletes.isNotEmpty()) {
          SyncClient.clearPendingDeletedItemIds(context)
        }

        val since = SyncClient.getLastSyncServerTime(context)
        val pull = withContext(Dispatchers.IO) {
          SyncClient.pull(baseUrl, since)
        }

        remoteDevices = pull.devices

        val bootstrap = withContext(Dispatchers.IO) {
          SyncClient.bootstrap(baseUrl)
        }
        remoteFolders = bootstrap.folders
        if (bootstrap.devices.isNotEmpty()) {
          remoteDevices = bootstrap.devices
        }

        // Merge: keep items from all devices. Prefer Android content:// when present.
        val merged = pull.items.mapNotNull { remote ->
          val loc = remote.locations.firstOrNull { l ->
            (l.accessInfo == "android_uri") || l.path.startsWith("content://")
          } ?: remote.locations.firstOrNull() ?: return@mapNotNull null

          val updatedMs = parseIsoToEpochMs(remote.updatedAtIso) ?: System.currentTimeMillis()
          val createdMs = parseIsoToEpochMs(remote.createdAtIso) ?: updatedMs

          IndexedFile(
            itemId = remote.itemId,
            locationId = loc.locationId,
            folderId = remote.folderId,
            deviceId = loc.deviceId,
            mediaType = remote.mediaType,
            displayName = remote.title,
            uri = loc.path,
            mimeType = null,
            addedAtEpochMs = createdMs,
            updatedAtEpochMs = updatedMs
          )
        }

        repo.upsertAll(merged)
        if (pull.serverTimeIso.isNotBlank()) {
          SyncClient.setLastSyncServerTime(context, pull.serverTimeIso)
        }
        lastSyncMessage = "同步完成：下发 ${merged.size} 条，文件夹 ${remoteFolders.size}，设备 ${remoteDevices.size}"
      } catch (e: Exception) {
        lastSyncMessage = "同步失败：${e.message ?: e.javaClass.simpleName}"
      } finally {
        isSyncing = false
      }
    }
  }

  private fun parseIsoToEpochMs(iso: String?): Long? {
    val s = iso?.trim().orEmpty()
    if (s.isBlank()) return null
    return try {
      java.time.Instant.parse(s).toEpochMilli()
    } catch (_: Exception) {
      null
    }
  }

  private fun queryDisplayName(context: Application, uri: Uri): String? {
    return try {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c ->
          if (!c.moveToFirst()) return@use null
          val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (idx < 0) return@use null
          c.getString(idx)
        }
    } catch (_: Exception) {
      null
    }
  }
}
