package com.example.mediarchive

import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

object SyncClient {
  data class PullResult(
    val serverTimeIso: String,
    val devices: List<RemoteDevice>,
    val items: List<RemoteItem>
  )

  data class BootstrapResult(
    val devices: List<RemoteDevice>,
    val folders: List<RemoteFolder>
  )

  data class RemoteDevice(
    val deviceId: String,
    val deviceName: String?,
    val deviceType: String?,
    val lanUrl: String?,
    val transferToken: String?
  )

  data class RemoteItem(
    val itemId: String,
    val folderId: String?,
    val title: String,
    val mediaType: String?,
    val description: String?,
    val createdAtIso: String?,
    val updatedAtIso: String?,
    val locations: List<RemoteLocation>
  )

  data class RemoteFolder(
    val folderId: String,
    val parentId: String?,
    val folderName: String,
    val sortOrder: Int?
  )

  data class RemoteLocation(
    val locationId: String,
    val deviceId: String?,
    val storageType: String,
    val path: String,
    val accessInfo: String?,
    val isAvailable: Int?,
    val createdAtIso: String?,
    val updatedAtIso: String?
  )

  private fun optNullableString(o: JSONObject, key: String): String? {
    val v = o.opt(key)
    if (v == null || v == JSONObject.NULL) return null
    val s = v.toString().trim()
    if (s.isBlank()) return null
    if (s.equals("null", ignoreCase = true)) return null
    return s
  }

  private const val PREFS = "mediarchive_sync"
  private const val KEY_DEVICE_ID = "device_id"
  private const val KEY_LAST_SYNC = "last_sync_server_time"
  private const val KEY_SERVER_URL = "server_base_url"
  private const val KEY_LAN_TRANSFER_TOKEN = "lan_transfer_token"
  private const val KEY_PENDING_DELETED_ITEM_IDS = "pending_deleted_item_ids"

  fun getOrCreateDeviceId(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val existing = prefs.getString(KEY_DEVICE_ID, null)
    if (!existing.isNullOrBlank()) return existing
    val created = UUID.randomUUID().toString()
    prefs.edit().putString(KEY_DEVICE_ID, created).apply()
    return created
  }

  fun setDeviceId(context: Context, deviceId: String) {
    val id = deviceId.trim()
    if (id.isBlank()) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_DEVICE_ID, id).apply()
  }

  fun getLastSyncServerTime(context: Context): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs.getString(KEY_LAST_SYNC, null)
  }

  fun setLastSyncServerTime(context: Context, serverTimeIso: String) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_LAST_SYNC, serverTimeIso).apply()
  }

  fun getServerBaseUrl(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs.getString(KEY_SERVER_URL, "") ?: ""
  }

  fun setServerBaseUrl(context: Context, baseUrl: String) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_SERVER_URL, baseUrl).apply()
  }

  fun getOrCreateLanTransferToken(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val existing = prefs.getString(KEY_LAN_TRANSFER_TOKEN, null)
    if (!existing.isNullOrBlank()) return existing
    val created = UUID.randomUUID().toString().replace("-", "")
    prefs.edit().putString(KEY_LAN_TRANSFER_TOKEN, created).apply()
    return created
  }

  fun addPendingDeletedItemId(context: Context, itemId: String) {
    val id = itemId.trim()
    if (id.isBlank()) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = prefs.getStringSet(KEY_PENDING_DELETED_ITEM_IDS, emptySet())?.toMutableSet() ?: mutableSetOf()
    current.add(id)
    prefs.edit().putStringSet(KEY_PENDING_DELETED_ITEM_IDS, current).apply()
  }

  fun getPendingDeletedItemIds(context: Context): List<String> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return (prefs.getStringSet(KEY_PENDING_DELETED_ITEM_IDS, emptySet()) ?: emptySet())
      .map { it.trim() }
      .filter { it.isNotBlank() }
      .distinct()
  }

  fun clearPendingDeletedItemIds(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.edit().remove(KEY_PENDING_DELETED_ITEM_IDS).apply()
  }

  fun normalizeBaseUrl(raw: String): String {
    val trimmed = raw.trim().removeSuffix("/")
    require(trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      "服务器地址需以 http:// 或 https:// 开头"
    }
    return trimmed
  }

  fun push(
    context: Context,
    baseUrlRaw: String,
    items: List<IndexedFile>,
    lanOrigin: String?,
    lanToken: String?,
    deletedItemIds: List<String>
  ): JSONObject {
    val baseUrl = normalizeBaseUrl(baseUrlRaw)
    val deviceId = getOrCreateDeviceId(context)

    val payload = JSONObject().apply {
      put(
        "device",
        JSONObject().apply {
          put("device_id", deviceId)
          put("device_name", Build.MODEL ?: "Android")
          put("device_type", "Android")

          val androidId = try {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
          } catch (_: Exception) {
            null
          }
          if (!androidId.isNullOrBlank()) {
            put("device_key", "android:$androidId")
          }

          if (!lanOrigin.isNullOrBlank()) {
            put("lan_url", lanOrigin)
          }
          if (!lanToken.isNullOrBlank()) {
            put("transfer_token", lanToken)
          }
        }
      )

      put("items", JSONArray().apply {
        items.forEach { item ->
          put(indexedFileToRemoteJson(deviceId, item))
        }
      })

      put("deleted_item_ids", JSONArray().apply {
        deletedItemIds.forEach { id ->
          val s = id.trim()
          if (s.isNotBlank()) put(s)
        }
      })
    }

    val url = URL("$baseUrl/api/sync/push")
    val conn = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 10_000
      readTimeout = 20_000
      doOutput = true
      setRequestProperty("Content-Type", "application/json; charset=utf-8")
    }

    conn.outputStream.use { os ->
      os.write(payload.toString().toByteArray(Charsets.UTF_8))
    }

    val code = conn.responseCode
    val body = readBody(conn)
    if (code !in 200..299) {
      throw IllegalStateException("push 失败($code): $body")
    }

    val resp = JSONObject(body)
    val canonical = resp.optJSONObject("device")?.optString("device_id")?.trim().orEmpty()
    if (canonical.isNotBlank()) {
      setDeviceId(context, canonical)
    }
    return resp
  }

  fun pull(baseUrlRaw: String, sinceIsoOrNull: String?): PullResult {
    val baseUrl = normalizeBaseUrl(baseUrlRaw)

    val urlStr = if (!sinceIsoOrNull.isNullOrBlank()) {
      val encoded = URLEncoder.encode(sinceIsoOrNull, "UTF-8")
      "$baseUrl/api/sync/pull?since=$encoded"
    } else {
      "$baseUrl/api/sync/pull"
    }

    val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 10_000
      readTimeout = 20_000
    }

    val code = conn.responseCode
    val body = readBody(conn)
    if (code !in 200..299) {
      throw IllegalStateException("pull 失败($code): $body")
    }

    val json = JSONObject(body)
    val serverTime = json.optString("server_time")

    val devicesArr = json.optJSONArray("devices") ?: JSONArray()
    val devices = buildList {
      for (i in 0 until devicesArr.length()) {
        val d = devicesArr.optJSONObject(i) ?: continue
        val id = d.optString("device_id")
        if (id.isBlank()) continue
        add(
          RemoteDevice(
            deviceId = id,
            deviceName = d.optString("device_name").takeIf { it.isNotBlank() },
            deviceType = d.optString("device_type").takeIf { it.isNotBlank() },
            lanUrl = d.optString("lan_url").takeIf { it.isNotBlank() },
            transferToken = d.optString("transfer_token").takeIf { it.isNotBlank() }
          )
        )
      }
    }

    val itemsArr = json.optJSONArray("items") ?: JSONArray()

    val items = buildList {
      for (i in 0 until itemsArr.length()) {
        val o = itemsArr.optJSONObject(i) ?: continue
        val itemId = o.optString("item_id")
        if (itemId.isBlank()) continue

        val folderId = optNullableString(o, "folder_id")

        val locationsArr = o.optJSONArray("locations") ?: JSONArray()
        val locations = buildList {
          for (j in 0 until locationsArr.length()) {
            val lo = locationsArr.optJSONObject(j) ?: continue
            val locId = lo.optString("location_id")
            val storageType = lo.optString("storage_type")
            val path = lo.optString("path")
            if (locId.isBlank() || storageType.isBlank() || path.isBlank()) continue
            add(
              RemoteLocation(
                locationId = locId,
                deviceId = optNullableString(lo, "device_id"),
                storageType = storageType,
                path = path,
                accessInfo = optNullableString(lo, "access_info"),
                isAvailable = if (lo.has("is_available")) lo.optInt("is_available") else null,
                createdAtIso = optNullableString(lo, "created_at"),
                updatedAtIso = optNullableString(lo, "updated_at")
              )
            )
          }
        }

        add(
          RemoteItem(
            itemId = itemId,
            folderId = folderId,
            title = o.optString("title").ifBlank { "未命名" },
            mediaType = optNullableString(o, "media_type"),
            description = optNullableString(o, "description"),
            createdAtIso = optNullableString(o, "created_at"),
            updatedAtIso = optNullableString(o, "updated_at"),
            locations = locations
          )
        )
      }
    }

    return PullResult(serverTimeIso = serverTime, devices = devices, items = items)
  }

  fun bootstrap(baseUrlRaw: String): BootstrapResult {
    val baseUrl = normalizeBaseUrl(baseUrlRaw)
    val conn = (URL("$baseUrl/api/bootstrap").openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 10_000
      readTimeout = 20_000
    }

    val code = conn.responseCode
    val body = readBody(conn)
    if (code !in 200..299) {
      throw IllegalStateException("bootstrap 失败($code): $body")
    }

    val json = JSONObject(body)

    val devicesArr = json.optJSONArray("devices") ?: JSONArray()
    val devices = buildList {
      for (i in 0 until devicesArr.length()) {
        val d = devicesArr.optJSONObject(i) ?: continue
        val id = d.optString("device_id")
        if (id.isBlank()) continue
        add(
          RemoteDevice(
            deviceId = id,
            deviceName = d.optString("device_name").takeIf { it.isNotBlank() },
            deviceType = d.optString("device_type").takeIf { it.isNotBlank() },
            lanUrl = d.optString("lan_url").takeIf { it.isNotBlank() },
            transferToken = d.optString("transfer_token").takeIf { it.isNotBlank() }
          )
        )
      }
    }

    val foldersArr = json.optJSONArray("folders") ?: JSONArray()
    val folders = buildList {
      for (i in 0 until foldersArr.length()) {
        val f = foldersArr.optJSONObject(i) ?: continue
        val id = f.optString("folder_id")
        val name = f.optString("folder_name")
        if (id.isBlank() || name.isBlank()) continue
        add(
          RemoteFolder(
            folderId = id,
            parentId = optNullableString(f, "parent_id"),
            folderName = name,
            sortOrder = if (f.has("sort_order")) f.optInt("sort_order") else null
          )
        )
      }
    }

    return BootstrapResult(devices = devices, folders = folders)
  }

  private fun indexedFileToRemoteJson(deviceId: String, item: IndexedFile): JSONObject {
    val updatedIso = isoFromEpoch(item.updatedAtEpochMs)
    val createdIso = isoFromEpoch(item.addedAtEpochMs)

    val mediaType = inferMediaType(item.mimeType)

    return JSONObject().apply {
      put("item_id", item.itemId)
      put("title", item.displayName)
      put("media_type", mediaType)
      put("description", JSONObject.NULL)
      put("created_at", createdIso)
      put("updated_at", updatedIso)

      put("locations", JSONArray().apply {
        put(
          JSONObject().apply {
            put("location_id", item.locationId)
            put("item_id", item.itemId)
            put("device_id", deviceId)
            put("storage_type", "Local")
            put("path", item.uri)
            put("access_info", "android_uri")
            put("is_available", 1)
            put("created_at", createdIso)
            put("updated_at", updatedIso)
          }
        )
      })
    }
  }

  private fun inferMediaType(mimeType: String?): String {
    val mt = (mimeType ?: "").lowercase()
    return when {
      mt.startsWith("image/") -> "Image"
      mt.startsWith("video/") -> "Video"
      else -> "Doc"
    }
  }

  private fun isoFromEpoch(epochMs: Long): String {
    return java.util.Date(epochMs).toInstant().toString()
  }

  private fun readBody(conn: HttpURLConnection): String {
    val stream = try {
      conn.inputStream
    } catch (_: Exception) {
      conn.errorStream
    } ?: return ""

    return BufferedReader(InputStreamReader(stream)).use { it.readText() }
  }
}
