package com.example.mediarchive

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.util.UUID

@Database(
  entities = [IndexedFile::class],
  version = 3,
  exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
  abstract fun indexedFileDao(): IndexedFileDao

  companion object {
    @Volatile private var instance: AppDatabase? = null

    private val MIGRATION_1_2 = object : Migration(1, 2) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE indexed_files ADD COLUMN itemId TEXT")
        db.execSQL("ALTER TABLE indexed_files ADD COLUMN locationId TEXT")
        db.execSQL("ALTER TABLE indexed_files ADD COLUMN updatedAtEpochMs INTEGER NOT NULL DEFAULT 0")
        db.execSQL("UPDATE indexed_files SET updatedAtEpochMs = addedAtEpochMs WHERE updatedAtEpochMs = 0")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_indexed_files_itemId ON indexed_files(itemId)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_indexed_files_locationId ON indexed_files(locationId)")
      }
    }

    private val MIGRATION_2_3 = object : Migration(2, 3) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE indexed_files ADD COLUMN folderId TEXT")
        db.execSQL("ALTER TABLE indexed_files ADD COLUMN deviceId TEXT")
        db.execSQL("ALTER TABLE indexed_files ADD COLUMN mediaType TEXT")
      }
    }

    fun get(context: Context): AppDatabase {
      return instance ?: synchronized(this) {
        instance ?: Room.databaseBuilder(
          context.applicationContext,
          AppDatabase::class.java,
          "mediarchive.db"
        )
          .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
          .addCallback(
            object : RoomDatabase.Callback() {
              override fun onOpen(db: SupportSQLiteDatabase) {
                super.onOpen(db)
                // Backfill stable IDs for existing rows.
                val cursor = db.query(
                  "SELECT id, itemId, locationId FROM indexed_files WHERE itemId IS NULL OR itemId = '' OR locationId IS NULL OR locationId = ''"
                )
                cursor.use {
                  val idIdx = it.getColumnIndex("id")
                  while (it.moveToNext()) {
                    val rowId = it.getLong(idIdx)
                    val itemId = UUID.randomUUID().toString()
                    val locationId = UUID.randomUUID().toString()
                    db.execSQL(
                      "UPDATE indexed_files SET itemId = ?, locationId = ? WHERE id = ?",
                      arrayOf(itemId, locationId, rowId)
                    )
                  }
                }
              }
            }
          )
          .build()
          .also { instance = it }
      }
    }
  }
}
