# MediArchiveMobile（Android）

这是一个“移动端独立设备”的最小实现：
- 本地索引：只保存元数据（displayName + `content://` URI + mimeType），不复制文件副本。
- 本地存储：Room(SQLite)。
- 选择文件：系统文件选择器（SAF / ACTION_OPEN_DOCUMENT），并尝试申请持久读取权限。

## 打开与运行

1. 使用 Android Studio 打开本目录 `mobile-android/`。
2. 首次同步需要下载 Gradle/依赖（需联网）。
3. 运行 `app` 到真机或模拟器。

> 说明：由于当前环境无法下载二进制 wrapper，我们没有提交 `gradle/wrapper/gradle-wrapper.jar`。
> Android Studio 通常会在同步时自动拉取所需组件；如果提示缺失 wrapper，请在 Android Studio 里执行一次 `gradle wrapper` 生成 wrapper 文件。

## 使用方式

- 点击右下角“添加” -> 选择任意文件。
- App 会保存该文件的 `content://` URI（索引），并在列表中展示。
- 点击列表项会尝试用系统默认应用打开。

## 与电脑端同步（元数据）

前提：手机和电脑在同一局域网（或手机能访问到电脑端服务地址）。

1) 电脑端启动服务（仓库根目录）：

```bash
npm run dev
```

2) 手机端 App 首页填写“电脑端服务器地址”，例如：

- `http://192.168.1.10:4000`

3) 点击“同步”

- push：把手机端已索引记录推送到电脑端（写入 `media_items` + `storage_locations`）
- pull：从电脑端拉取变更，并仅导入 Android 可访问的 location（`content://...` 或 `access_info=android_uri`）

## 常见问题排查（真机跑不起来 / 一直 Launching）

### 1）Run 窗口没有任何输出

Android Studio 有时不会在左侧“Run ▶︎”面板里显示安装日志（可能显示 `Nothing to show`）。请改用以下入口看日志：

- **Event Log**：右下角通知区域/铃铛图标（会提示安装失败原因）。
- **Logcat**：`View` → `Tool Windows` → `Logcat`，在顶部下拉选择你的设备与应用进程。
- **Build 输出**：如果是安装阶段失败，Build 窗口里也常会出现 `INSTALL_FAILED_*`。

### 2）确认设备是否已授权（最常见）

在 macOS 终端或 Android Studio Terminal 运行：

```bash
~/Library/Android/sdk/platform-tools/adb devices
```

- 看到 `device`：设备已连接
- 看到 `unauthorized`：手机上会弹“允许 USB 调试”，点**允许**；必要时在开发者选项里“撤销 USB 调试授权”后重连
- 看不到设备：检查数据线/USB 模式（建议“文件传输/MTP”）

### 3）一加/ColorOS 常见拦截：USB 安装

在开发者选项里打开（名称可能略不同）：
- **USB 安装** / **通过 USB 安装应用**
- （可选）**USB 调试（安全设置）**

否则可能会出现 `INSTALL_FAILED_USER_RESTRICTED` 导致一直无法安装。

### 4）手动确认是否已安装

```bash
~/Library/Android/sdk/platform-tools/adb shell pm list packages | grep mediarchive
```

如果能看到 `com.example.mediarchive`，说明已经装上了；可以手动启动：

```bash
~/Library/Android/sdk/platform-tools/adb shell monkey -p com.example.mediarchive 1
```

## 已知限制

- 如果文件被删除/提供方撤销访问，索引会失效。
- 不同文件提供方对“持久权限”支持不同，无法保证 100% 可持久。
