package com.example.mediarchive

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : ComponentActivity() {
  private val vm: MainViewModel by viewModels()

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    super.onCreate(savedInstanceState)
    setContent {
      MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
          val pendingRemote = remember { mutableStateOf<IndexedFile?>(null) }

          MainScreen(
            vm = vm,
            onOpen = { item ->
              val uri = item.uri.trim()
              when {
                uri.startsWith("content://") -> openUri(uri, item.mimeType)
                uri.startsWith("http://") || uri.startsWith("https://") -> openUri(uri, item.mimeType)
                else -> pendingRemote.value = item
              }
            }
          )

          val pending = pendingRemote.value
          if (pending != null) {
            val base = vm.serverBaseUrl.trim().removeSuffix("/")
            val canUseServer = base.startsWith("http://") || base.startsWith("https://")

            AlertDialog(
              onDismissRequest = { pendingRemote.value = null },
              title = { Text("打开方式") },
              text = {
                Text(
                  if (canUseServer) {
                    "该文件位于电脑端，选择：下载到手机 或 流式传输。"
                  } else {
                    "该文件位于电脑端。请先在上方填写电脑端服务器地址。"
                  }
                )
              },
              confirmButton = {
                Button(
                  enabled = canUseServer,
                  onClick = {
                    val url = "$base/api/media/${pending.itemId}/preview?locationId=${pending.locationId}"
                    pendingRemote.value = null
                    openUri(url, pending.mimeType)
                  }
                ) {
                  Text("流式")
                }
              },
              dismissButton = {
                Button(
                  enabled = canUseServer,
                  onClick = {
                    val url = "$base/api/media/${pending.itemId}/download?locationId=${pending.locationId}"
                    pendingRemote.value = null
                    openUri(url, pending.mimeType)
                  }
                ) {
                  Text("下载")
                }
              }
            )
          }
        }
      }
    }
  }

  private fun openUri(uriString: String, mimeType: String?) {
    val uri = Uri.parse(uriString)
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, mimeType ?: "*/*")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
      startActivity(intent)
    } catch (_: Exception) {
      // No handler installed or uri invalid.
    }
  }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun MainScreen(vm: MainViewModel, onOpen: (IndexedFile) -> Unit) {
  val items by vm.items.collectAsState()
  val query = remember { mutableStateOf("") }
  val pendingDelete = remember { mutableStateOf<IndexedFile?>(null) }
  val tab = remember { mutableStateOf(0) }
  val currentFolderId = remember { mutableStateOf<String?>(null) }
  val folderStack = remember { mutableStateOf<List<String?>>(emptyList()) }
  val currentDeviceId = remember { mutableStateOf<String?>(null) }

  val picker = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.OpenDocument(),
    onResult = { uri ->
      if (uri != null) vm.addFromPickedUri(uri)
    }
  )

  Scaffold(
    topBar = {
      TopAppBar(
        title = { Text("已索引文件") },
        colors = TopAppBarDefaults.topAppBarColors(
          containerColor = MaterialTheme.colorScheme.surface,
          titleContentColor = MaterialTheme.colorScheme.onSurface
        )
      )
    },
    floatingActionButton = {
      FloatingActionButton(onClick = { picker.launch(arrayOf("*/*")) }) {
        Text("添加")
      }
    }
  ) { padding ->
    val q = query.value.trim().lowercase()
    val filteredByQuery = if (q.isBlank()) items else items.filter {
      it.displayName.lowercase().contains(q) || it.uri.lowercase().contains(q)
    }

    val folders = vm.remoteFolders
    val devices = vm.remoteDevices

    val filtered = when (tab.value) {
      0 -> filteredByQuery.filter { it.folderId == currentFolderId.value }
      1 -> filteredByQuery.filter { it.deviceId == currentDeviceId.value }
      else -> filteredByQuery
    }

    LazyColumn(
      modifier = Modifier
        .fillMaxSize()
        .padding(padding)
    ) {
      item(key = "sync") {
        SyncBlock(vm)
      }

      item(key = "tabs") {
        TabRow(selectedTabIndex = tab.value) {
          Tab(selected = tab.value == 0, onClick = { tab.value = 0 }) { Text("文件夹") }
          Tab(selected = tab.value == 1, onClick = { tab.value = 1 }) { Text("设备") }
          Tab(selected = tab.value == 2, onClick = { tab.value = 2 }) { Text("全部") }
        }
      }

      item(key = "search") {
        OutlinedTextField(
          value = query.value,
          onValueChange = { query.value = it },
          label = { Text("搜索") },
          placeholder = { Text("按文件名/URI") },
          singleLine = true,
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
        )
        Spacer(modifier = Modifier.height(8.dp))
      }

      if (tab.value == 0) {
        item(key = "folderHeader") {
          FolderTreeBlock(
            folders = folders,
            currentFolderId = currentFolderId.value,
            folderStack = folderStack.value,
            onBack = {
              val stack = folderStack.value
              if (stack.isNotEmpty()) {
                val prev = stack.last()
                folderStack.value = stack.dropLast(1)
                currentFolderId.value = prev
              }
            },
            onInitIfNeeded = { }
          )
        }

        val subFolders = folders
          .filter { it.parentId == currentFolderId.value }
          .sortedWith(compareBy<SyncClient.RemoteFolder>({ it.sortOrder ?: 0 }, { it.folderName }))

        if (subFolders.isNotEmpty()) {
          items(subFolders, key = { "folder:${it.folderId}" }) { f ->
            ListItem(
              modifier = Modifier
                .fillMaxWidth()
                .clickable {
                  folderStack.value = folderStack.value + listOf(currentFolderId.value)
                  currentFolderId.value = f.folderId
                },
              headlineContent = {
                Text(
                  text = f.folderName,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis
                )
              },
              supportingContent = {
                Text(
                  text = "文件夹",
                  color = MaterialTheme.colorScheme.onSurfaceVariant
                )
              }
            )
          }
        } else {
          item(key = "noSubfolders") {
            Text(
              text = if (currentFolderId.value == null) "根目录下暂无文件夹" else "该文件夹暂无子文件夹",
              modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        }
      }

      if (tab.value == 1) {
        item(key = "deviceHeader") {
          DevicePickerRow(
            devices = devices,
            currentDeviceId = currentDeviceId.value,
            onChangeDevice = { currentDeviceId.value = it }
          )
        }
      }

      if (filtered.isEmpty()) {
        item(key = "empty") {
          Box(
            modifier = Modifier
              .fillMaxWidth()
              .padding(24.dp),
            contentAlignment = Alignment.TopStart
          ) {
            Column(modifier = Modifier.fillMaxWidth()) {
              Text(
                text = if (items.isEmpty()) "暂无文件索引" else "没有匹配结果",
                style = MaterialTheme.typography.titleMedium
              )
              Text(
                text = if (items.isEmpty()) "点击右下角“添加”选择文件建立索引。" else "换个关键词试试。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
              )
            }
          }
        }
      } else {
        items(filtered, key = { it.id }) { item ->
          IndexedFileRow(
            item = item,
            onOpen = onOpen,
            onDelete = { pendingDelete.value = item }
          )
        }
      }
    }

    val del = pendingDelete.value
    if (del != null) {
      AlertDialog(
        onDismissRequest = { pendingDelete.value = null },
        title = { Text("删除索引") },
        text = { Text("只会从 App 的索引列表移除，不会删除手机本地文件。\n\n确认删除：${del.displayName}？") },
        confirmButton = {
          Button(
            onClick = {
              pendingDelete.value = null
              vm.deleteItem(del)
            }
          ) { Text("删除") }
        },
        dismissButton = {
          OutlinedButton(onClick = { pendingDelete.value = null }) { Text("取消") }
        }
      )
    }
  }
}

@Composable
private fun FolderTreeBlock(
  folders: List<SyncClient.RemoteFolder>,
  currentFolderId: String?,
  folderStack: List<String?>,
  onBack: () -> Unit,
  onInitIfNeeded: () -> Unit
) {
  onInitIfNeeded()

  val current = folders.firstOrNull { it.folderId == currentFolderId }
  val currentName = current?.folderName ?: "(根)"

  Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
    Text(
      text = "文件夹视图",
      style = MaterialTheme.typography.labelLarge,
      color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    Spacer(modifier = Modifier.height(8.dp))

    Box(modifier = Modifier.fillMaxWidth()) {
      Column(modifier = Modifier.fillMaxWidth()) {
        Text(
          text = "当前位置：$currentName",
          style = MaterialTheme.typography.bodyMedium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        Text(
          text = "子文件夹在上方列表，文件条目在其后",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }

      if (folderStack.isNotEmpty()) {
        OutlinedButton(
          onClick = { onBack() },
          modifier = Modifier.align(Alignment.CenterEnd)
        ) {
          Text("返回上级")
        }
      }
    }
  }
}

@Composable
private fun DevicePickerRow(
  devices: List<SyncClient.RemoteDevice>,
  currentDeviceId: String?,
  onChangeDevice: (String?) -> Unit
) {
  Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
    Text(
      text = "设备视图",
      style = MaterialTheme.typography.labelLarge,
      color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    Spacer(modifier = Modifier.height(8.dp))
    OutlinedButton(
      onClick = { onChangeDevice(null) },
      modifier = Modifier.fillMaxWidth()
    ) {
      Text(if (currentDeviceId == null) "全部" else "全部设备")
    }

    Spacer(modifier = Modifier.height(8.dp))

    devices.forEach { d ->
      OutlinedButton(
        onClick = { onChangeDevice(d.deviceId) },
        modifier = Modifier.fillMaxWidth()
      ) {
        Text((d.deviceName ?: d.deviceType ?: d.deviceId), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Spacer(modifier = Modifier.height(8.dp))
    }
  }
}

@Composable
private fun SyncBlock(vm: MainViewModel) {
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .padding(16.dp)
  ) {
    OutlinedTextField(
      value = vm.serverBaseUrl,
      onValueChange = { vm.updateServerBaseUrl(it) },
      label = { Text("电脑端服务器地址") },
      placeholder = { Text("例如：http://192.168.1.10:4000") },
      singleLine = true,
      modifier = Modifier.fillMaxWidth()
    )
    Spacer(modifier = Modifier.height(12.dp))
    Button(
      onClick = { vm.syncNow() },
      enabled = !vm.isSyncing,
      modifier = Modifier.fillMaxWidth()
    ) {
      Text(if (vm.isSyncing) "同步中…" else "同步")
    }
    if (vm.isSyncing) {
      Spacer(modifier = Modifier.height(8.dp))
      LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    }
    val msg = vm.lastSyncMessage
    if (msg.isNotBlank()) {
      Spacer(modifier = Modifier.height(8.dp))
      Text(text = msg, style = MaterialTheme.typography.bodyMedium)
    }
  }
}

@Composable
private fun IndexedFileRow(item: IndexedFile, onOpen: (IndexedFile) -> Unit, onDelete: (IndexedFile) -> Unit) {
  ListItem(
    modifier = Modifier
      .fillMaxWidth()
      .clickable { onOpen(item) },
    headlineContent = {
      Text(
        text = item.displayName,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
      )
    },
    trailingContent = {
      OutlinedButton(onClick = { onDelete(item) }) {
        Text("删除")
      }
    },
    supportingContent = {
      Text(
        text = item.uri,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis
      )
    },
    overlineContent = {
      val mt = item.mimeType
      if (!mt.isNullOrBlank()) {
        Text(
          text = mt,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }
    }
  )
}
