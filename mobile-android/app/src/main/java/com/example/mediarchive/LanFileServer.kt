package com.example.mediarchive

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.runBlocking
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Locale

class LanFileServer(
  private val context: Context,
  private val dao: IndexedFileDao,
  private val token: String,
  port: Int
) : NanoHTTPD("0.0.0.0", port) {

  override fun serve(session: IHTTPSession): Response {
    val uriPath = (session.uri ?: "/").trim()
    val providedToken = session.parms["token"]?.trim().orEmpty()
    if (token.isNotEmpty() && token != providedToken) {
      return newFixedLengthResponse(Response.Status.UNAUTHORIZED, "application/json", "{\"error\":\"unauthorized\"}")
        .also { it.addHeader("Cache-Control", "no-store") }
    }

    return when {
      uriPath == "/api/ma/health" -> {
        newFixedLengthResponse(Response.Status.OK, "application/json", "{\"ok\":true}")
          .also { it.addHeader("Cache-Control", "no-store") }
      }

      uriPath == "/api/ma/location" -> {
        val locationId = session.parms["locationId"]?.trim().orEmpty()
        if (locationId.isBlank()) {
          return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", "{\"error\":\"missing locationId\"}")
        }

        val item = runBlocking { dao.getByLocationId(locationId) }
          ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"not found\"}")

        val contentUri = try {
          Uri.parse(item.uri)
        } catch (_: Exception) {
          return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", "{\"error\":\"invalid uri\"}")
        }

        serveContentUri(
          resolver = context.contentResolver,
          uri = contentUri,
          fallbackName = item.displayName,
          mimeTypeOverride = item.mimeType,
          rangeHeader = session.headers["range"]
        )
      }

      else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"not found\"}")
    }
  }

  private fun serveContentUri(
    resolver: ContentResolver,
    uri: Uri,
    fallbackName: String,
    mimeTypeOverride: String?,
    rangeHeader: String?
  ): Response {
    val (displayName, size) = queryNameAndSize(resolver, uri, fallbackName)
    val mimeType = mimeTypeOverride?.takeIf { it.isNotBlank() }
      ?: resolver.getType(uri)
      ?: "application/octet-stream"

    val sizeKnown = (size != null && size >= 0)
    val range = parseRange(rangeHeader)

    // If size is unknown, we ignore Range and serve full stream.
    if (!sizeKnown || range == null) {
      val input = try {
        resolver.openInputStream(uri)
      } catch (_: Exception) {
        null
      } ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"cannot open\"}")

      val resp = newChunkedResponse(Response.Status.OK, mimeType, input)
      resp.addHeader("Cache-Control", "no-store")
      resp.addHeader("Access-Control-Allow-Origin", "*")
      resp.addHeader("Accept-Ranges", "bytes")
      resp.addHeader("X-MA-Filename", displayName)
      resp.addHeader("Content-Disposition", "attachment; filename=\"${escapeHeader(displayName)}\"")
      return resp
    }

    val total = size!!
    val (start, endInclusive) = normalizeRange(range, total)
      ?: return newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "application/json", "{\"error\":\"range not satisfiable\"}")
        .also { it.addHeader("Content-Range", "bytes */$total") }

    val length = (endInclusive - start + 1)

    val input = try {
      resolver.openInputStream(uri)
    } catch (_: Exception) {
      null
    } ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"cannot open\"}")

    try {
      var skipped = 0L
      while (skipped < start) {
        val s = input.skip(start - skipped)
        if (s <= 0) break
        skipped += s
      }
      if (skipped < start) {
        input.close()
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"cannot seek\"}")
      }
    } catch (_: Exception) {
      try { input.close() } catch (_: Exception) {}
      return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{\"error\":\"cannot seek\"}")
    }

    val resp = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mimeType, input, length)
    resp.addHeader("Cache-Control", "no-store")
    resp.addHeader("Access-Control-Allow-Origin", "*")
    resp.addHeader("Accept-Ranges", "bytes")
    resp.addHeader("Content-Range", "bytes $start-$endInclusive/$total")
    resp.addHeader("X-MA-Filename", displayName)
    resp.addHeader("Content-Disposition", "attachment; filename=\"${escapeHeader(displayName)}\"")
    return resp
  }

  private data class ByteRange(val start: Long, val end: Long?)

  private fun parseRange(rangeHeader: String?): ByteRange? {
    val raw = rangeHeader?.trim().orEmpty()
    if (raw.isBlank()) return null
    // Only support: bytes=start-end
    val m = Regex("^bytes=(\\d*)-(\\d*)$", RegexOption.IGNORE_CASE).find(raw) ?: return null
    val startStr = m.groupValues[1]
    val endStr = m.groupValues[2]
    if (startStr.isBlank() && endStr.isBlank()) return null
    val start = startStr.toLongOrNull()
    val end = endStr.toLongOrNull()
    return ByteRange(start ?: -1L, end)
  }

  private fun normalizeRange(range: ByteRange, total: Long): Pair<Long, Long>? {
    if (total <= 0) return null

    // Suffix range: bytes=-N (last N bytes)
    if (range.start < 0) {
      val suffix = range.end ?: return null
      if (suffix <= 0) return null
      val start = (total - suffix).coerceAtLeast(0)
      return start to (total - 1)
    }

    val start = range.start
    if (start >= total) return null
    val end = (range.end ?: (total - 1)).coerceAtMost(total - 1)
    if (end < start) return null
    return start to end
  }

  private fun queryNameAndSize(resolver: ContentResolver, uri: Uri, fallback: String): Pair<String, Long?> {
    var name: String? = null
    var size: Long? = null
    var cursor: Cursor? = null
    try {
      cursor = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
      if (cursor != null && cursor.moveToFirst()) {
        val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIdx >= 0) name = cursor.getString(nameIdx)
        val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (sizeIdx >= 0) {
          val v = cursor.getLong(sizeIdx)
          if (v >= 0) size = v
        }
      }
    } catch (_: Exception) {
      // ignore
    } finally {
      try { cursor?.close() } catch (_: Exception) {}
    }
    val finalName = (name?.takeIf { it.isNotBlank() } ?: fallback.takeIf { it.isNotBlank() } ?: "file")
    return finalName to size
  }

  private fun escapeHeader(value: String): String {
    // Minimal header escaping for quoted-string.
    return value.replace("\\", "_").replace("\"", "_").replace("\r", " ").replace("\n", " ")
  }

  companion object {
    fun listLanOrigins(port: Int): List<String> {
      val urls = mutableListOf<String>()
      try {
        val ifaces = NetworkInterface.getNetworkInterfaces()
        for (iface in ifaces) {
          if (!iface.isUp || iface.isLoopback) continue
          val addrs = iface.inetAddresses
          for (addr in addrs) {
            if (addr !is Inet4Address) continue
            if (addr.isLoopbackAddress) continue
            val host = addr.hostAddress ?: continue
            if (!addr.isSiteLocalAddress) continue
            urls.add("http://$host:$port")
          }
        }
      } catch (_: Exception) {
        // ignore
      }
      return urls.distinct().sorted()
    }

    fun listLanUrls(port: Int, token: String): List<String> {
      val urls = mutableListOf<String>()
      val tokenPart = if (token.isNotBlank()) "?token=$token" else ""
      try {
        val ifaces = NetworkInterface.getNetworkInterfaces()
        for (iface in ifaces) {
          if (!iface.isUp || iface.isLoopback) continue
          val addrs = iface.inetAddresses
          for (addr in addrs) {
            if (addr !is Inet4Address) continue
            if (addr.isLoopbackAddress) continue
            val host = addr.hostAddress ?: continue
            // Prefer RFC1918 site-local addresses.
            if (!addr.isSiteLocalAddress) continue
            urls.add("http://$host:$port$tokenPart")
          }
        }
      } catch (_: Exception) {
        // ignore
      }
      return urls.distinct().sorted()
    }

    fun randomToken(): String {
      val alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
      val sb = StringBuilder()
      repeat(12) {
        val idx = (Math.random() * alphabet.length).toInt().coerceIn(0, alphabet.length - 1)
        sb.append(alphabet[idx])
      }
      return sb.toString().lowercase(Locale.US)
    }
  }
}
