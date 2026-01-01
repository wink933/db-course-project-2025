package com.example.mediarchive

import kotlinx.coroutines.flow.Flow
import java.util.UUID

class FileRepository(private val dao: IndexedFileDao) {
  fun observeAll(): Flow<List<IndexedFile>> = dao.observeAll()

  suspend fun getAllOnce(): List<IndexedFile> = dao.getAll()

  suspend fun upsertAll(items: List<IndexedFile>) {
    items.forEach { item ->
      val updated = dao.updateByItemId(
        itemId = item.itemId,
        locationId = item.locationId,
        folderId = item.folderId,
        deviceId = item.deviceId,
        mediaType = item.mediaType,
        displayName = item.displayName,
        uri = item.uri,
        mimeType = item.mimeType,
        addedAtEpochMs = item.addedAtEpochMs,
        updatedAtEpochMs = item.updatedAtEpochMs
      )
      if (updated == 0) {
        val inserted = dao.insertIgnore(item.copy(id = 0))
        if (inserted == -1L) {
          // A unique constraint (itemId/locationId/uri) might have been hit; retry update.
          dao.updateByItemId(
            itemId = item.itemId,
            locationId = item.locationId,
            folderId = item.folderId,
            deviceId = item.deviceId,
            mediaType = item.mediaType,
            displayName = item.displayName,
            uri = item.uri,
            mimeType = item.mimeType,
            addedAtEpochMs = item.addedAtEpochMs,
            updatedAtEpochMs = item.updatedAtEpochMs
          )
        }
      }
    }
  }

  suspend fun setDeviceIdForAllContentUris(deviceId: String?) {
    dao.setDeviceIdForAllContentUris(deviceId)
  }

  suspend fun addIndexedFile(
    displayName: String,
    uri: String,
    mimeType: String?,
    nowMs: Long,
    deviceId: String?
  ): Boolean {
    val id = dao.insertIgnore(
      IndexedFile(
        itemId = UUID.randomUUID().toString(),
        locationId = UUID.randomUUID().toString(),
        folderId = null,
        deviceId = deviceId,
        mediaType = null,
        displayName = displayName,
        uri = uri,
        mimeType = mimeType,
        addedAtEpochMs = nowMs,
        updatedAtEpochMs = nowMs
      )
    )
    return id != -1L
  }

  suspend fun deleteById(id: Long) {
    dao.deleteById(id)
  }
}
