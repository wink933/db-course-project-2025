package com.example.mediarchive

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
  tableName = "indexed_files",
  indices = [
    Index(value = ["uri"], unique = true),
    Index(value = ["itemId"], unique = true),
    Index(value = ["locationId"], unique = true)
  ]
)
data class IndexedFile(
  @PrimaryKey(autoGenerate = true)
  val id: Long = 0,
  /** UUID: maps to desktop media_items.item_id */
  val itemId: String,
  /** UUID: maps to desktop storage_locations.location_id */
  val locationId: String,
  /** Nullable: maps to desktop media_items.folder_id */
  val folderId: String?,
  /** Nullable: maps to desktop storage_locations.device_id */
  val deviceId: String?,
  /** Nullable: maps to desktop media_items.media_type */
  val mediaType: String?,
  val displayName: String,
  val uri: String,
  val mimeType: String?,
  val addedAtEpochMs: Long,
  /** Used for sync conflict resolution. */
  val updatedAtEpochMs: Long
)
