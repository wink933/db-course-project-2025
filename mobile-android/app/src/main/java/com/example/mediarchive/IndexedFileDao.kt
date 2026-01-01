package com.example.mediarchive

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface IndexedFileDao {
  @Query("SELECT * FROM indexed_files ORDER BY addedAtEpochMs DESC")
  fun observeAll(): Flow<List<IndexedFile>>

  @Query("SELECT * FROM indexed_files ORDER BY addedAtEpochMs DESC")
  suspend fun getAll(): List<IndexedFile>

  @Query("SELECT * FROM indexed_files WHERE itemId = :itemId LIMIT 1")
  suspend fun getByItemId(itemId: String): IndexedFile?

  @Query("SELECT * FROM indexed_files WHERE locationId = :locationId LIMIT 1")
  suspend fun getByLocationId(locationId: String): IndexedFile?

  @Query(
    """
    UPDATE indexed_files
    SET
      locationId = :locationId,
      folderId = :folderId,
      deviceId = :deviceId,
      mediaType = :mediaType,
      displayName = :displayName,
      uri = :uri,
      mimeType = :mimeType,
      addedAtEpochMs = :addedAtEpochMs,
      updatedAtEpochMs = :updatedAtEpochMs
    WHERE itemId = :itemId
    """
  )
  suspend fun updateByItemId(
    itemId: String,
    locationId: String,
    folderId: String?,
    deviceId: String?,
    mediaType: String?,
    displayName: String,
    uri: String,
    mimeType: String?,
    addedAtEpochMs: Long,
    updatedAtEpochMs: Long
  ): Int

  @Query("UPDATE indexed_files SET deviceId = :deviceId WHERE uri LIKE 'content://%'")
  suspend fun setDeviceIdForAllContentUris(deviceId: String?)

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertIgnore(item: IndexedFile): Long

  @Upsert
  suspend fun upsert(item: IndexedFile)

  @Query("DELETE FROM indexed_files WHERE id = :id")
  suspend fun deleteById(id: Long)
}
