# 个人媒体资产管理系统（可运行版本）

这是数据库课程设计的可运行实现：桌面端（Node.js + Express + SQLite + Web UI / Electron），以及移动端（Android 原生 App）。核心目标是“管理个人媒体资产的元数据”，并在局域网内实现多设备之间的元数据同步与按需传输。

## 技术栈与选型说明（为什么用这些）

- SQLite（服务端数据库）
  - 课程设计/个人应用场景：零运维、单文件、跨平台、便于交付与演示。
  - 配合外键/索引/视图，足以覆盖“文件夹树、标签、多对多关系、按条件检索、同步增量”等需求。
- Node.js + Express（桌面端本地服务）
  - 开发效率高、HTTP API 统一：Web UI / Electron / Android 都通过同一套接口交互。
  - 作为“本地服务”启动简单，适合课程作业交付。
- better-sqlite3（SQLite 驱动）
  - 同步/批量写入场景需要更高性能与事务控制；同步写入大量 rows 时更稳定。
  - 代价是：它是原生模块，需要 C/C++ 编译链（README 已给出三端配置）。
- Web UI（public/ 原生 JS + fetch）
  - 课程作业展示更直观：不引入复杂前端框架，代码与接口调用链清晰。
- Electron（可选桌面壳）
  - 把“本地服务 + Web UI”封装成安装包，演示/交付更像真实产品。
  - 统一数据目录（DB + uploads），并做端口占用兜底。
- Android：Kotlin + Jetpack Compose + Room + SAF
  - SAF（content://）是 Android 10+ 访问本地文件的正确方式；避免传统路径权限问题。
  - Room 作为本地索引库：把“手机上选择过的文件”落地，离线可用。
  - Compose 提升 UI 开发效率，便于实现“文件夹/设备/全部 + 搜索”的多视图。

---

## 功能一览

- 资源：本地路径 / Web 链接 / 手机 content:// URI（只记录索引与元数据，不默认复制文件本体）
- 虚拟文件夹：树形结构 + 拖拽/移动 + 同级排序
- 标签：创建/关联/批量打标与取消
- 设备：多设备登记（PC / Android），位置记录关联设备
- 搜索筛选：关键字 + 文件夹 + 设备 + 类型 + 标签 + 回收站
- 回收站：软删除、恢复、清空、硬删除（安全限制）
- 同步：
  - Android ↔ 桌面端：`/api/sync/push` + `/api/sync/pull`（元数据同步）
  - 桌面端 ↔ 桌面端：`/api/sync/export` + `/api/sync/import`（导出/导入）
- 局域网传输（按需）：当资源在“另一台设备”（如手机）时，桌面端可选择“下载到本机 uploads / 流式传输”

## 从零开始：环境配置（Windows / Linux / macOS）

本项目有三端：
- 桌面端（Node/Express/SQLite + Web UI）
- 桌面端壳（Electron，可选）
- 移动端（Android 原生 App）

### 共同要求（建议）

- Node.js：建议 18 LTS 或 20 LTS
  - 不建议用过新的实验版本（例如 v25），会导致 `better-sqlite3` 报 `NODE_MODULE_VERSION mismatch`。
- npm（随 Node 安装）
- Git（可选，但推荐）

#### macOS

1) 安装 Xcode Command Line Tools（用于编译 better-sqlite3）：

```bash
xcode-select --install
```

2) 安装 Node（推荐 Homebrew）：

```bash
brew install node@20
```

3) 验证：

```bash
node -v
npm -v
```

#### Linux（Ubuntu/Debian 示例）

1) 安装编译工具链 + Python（node-gyp 常用）：

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 make g++
```

2) 安装 Node 18/20（推荐 nvm；也可以用发行版/官方源）：

```bash
# 安装 nvm（如未安装）后：
nvm install 20
nvm use 20
```

3) 验证：

```bash
node -v
npm -v
```

#### Windows

1) 安装 Node 18/20（建议从 Node.js 官网下载安装 LTS）。

2) 安装 C/C++ 编译工具（better-sqlite3 需要）：

- 推荐方式：安装 “Visual Studio Build Tools”，并勾选：
  - **Desktop development with C++**（或至少包含 MSVC v143、Windows SDK、CMake 工具）

3) （可选但推荐）安装 Python 3（部分环境下 node-gyp 需要）：
- 安装后确保 `python` 或 `py -3` 可用。

4) 验证：打开 PowerShell：

```powershell
node -v
npm -v
```

---

## 快速开始：运行桌面端 Web UI（Node/Express）

在仓库根目录执行：

1) 安装依赖

```bash
npm install
```

2) 初始化数据库

```bash
npm run init-db
```

3) 启动服务

```bash
npm start
```

4) 打开页面

- http://localhost:4000

5) 局域网访问（手机/同网段设备）

```bash
HOST=0.0.0.0 PORT=4000 npm start
```

Windows（PowerShell）等价写法：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "4000"
npm start
```

Windows（cmd）等价写法：

```bat
set HOST=0.0.0.0
set PORT=4000
npm start
```

启动日志会输出 `LAN URLs`，手机可直接访问其中一个。

## 运行桌面版 Electron（推荐交付演示）

Electron 会内置启动本地服务并打开窗口。打包版默认开启局域网监听，启动时弹出“手机访问地址”。

### 开发模式运行

```bash
npm install
npm run init-db
npm run rebuild:electron
npm run electron:dev
```

Windows 说明：`npm run electron:dev` 的脚本包含类 Unix 的环境变量写法（`ELECTRON_PORT=...`）。
推荐两种方式：

- 用 Git Bash / WSL 跑上述命令
- 或用 PowerShell 手动设置环境变量再启动 Electron：

```powershell
npm install
npm run init-db
npm run rebuild:electron

$env:ELECTRON_PORT = "4000"
npx electron electron/main.js
```

### 打包安装包

```bash
npm install
npm run electron:dist
```

输出在 `dist/`。

### 常见问题：better-sqlite3 ABI 不匹配

如果 Electron 启动报错提示原生模块 ABI 不匹配，先跑：

```bash
npm run rebuild:electron
```

如果你在 Node 模式下重建过：

```bash
npm run rebuild:node
npm run rebuild:electron
```

如果你看到类似（示例）：

- `was compiled against a different Node.js version using NODE_MODULE_VERSION ...`

优先建议：切到 Node 18/20 再 `npm install`：

```bash
# macOS/Linux 可用 nvm
# 1) 安装 nvm（若未安装）后：
nvm install 20
nvm use 20

# 2) 重新安装依赖
rm -rf node_modules package-lock.json
npm install
```

Windows 上也可以使用 nvm-windows（可选）：

```powershell
# 安装 nvm-windows 后：
nvm install 20.11.1
nvm use 20.11.1
node -v
```

### 端口占用

- CLI 模式：`server.js` 端口被占用会报错退出。
- Electron 模式：会自动尝试 `4000~4009`，并弹窗提示实际使用端口。

## Android App（移动端独立索引 + 同步 + 局域网传输）

### 0. 环境配置（Windows / Linux / macOS）

共同要求：
- Android Studio（建议使用自带 JDK 17）
- Android SDK（Android Studio 会引导安装）
- 真机或模拟器

#### macOS

1) 安装 Android Studio

2) Android Studio → Settings/Preferences → Android SDK
- 安装一个 SDK Platform（例如 Android 14 / API 34）
- 安装 Platform-Tools（包含 `adb`）

3) 真机调试（可选但推荐）：
- 手机开启“开发者选项/USB 调试”
- 用数据线连接，信任电脑

#### Linux

1) 安装 Android Studio

2) 确保能访问 USB 设备（不同发行版可能需要 udev 规则；如果真机不识别，可先用模拟器验证）

3) 在 Android Studio 安装 SDK Platform + Platform-Tools

#### Windows

1) 安装 Android Studio

2) 在 Android Studio 安装 SDK Platform + Platform-Tools

3) 真机调试常见拦截（部分国产 ROM）：
- 开发者选项中开启 **USB 安装 / 通过 USB 安装应用**
-（可选）开启 **USB 调试（安全设置）**

### 1. 运行方式

1) Android Studio 打开目录 `mobile-android/`

2) Sync Gradle 后直接 Run `app`

（可选）命令行构建 Debug APK：

```bash
cd mobile-android
./gradlew :app:assembleDebug
```

Windows（cmd/PowerShell）可用：

```bat
cd mobile-android
gradlew.bat :app:assembleDebug
```

### 2. 使用与同步

- App 内点“添加”选择文件后，会保存 `content://` URI（索引）与元数据到 Room。
- 同步：在 App 首页填写“电脑端服务器地址”，例如：
  - `http://192.168.x.x:4000`
- 点击“同步”会执行：push → pull → bootstrap。

### 3. 关于“文件在哪儿 / 为什么打不开”

- 同步默认同步的是元数据，不会自动把电脑硬盘文件复制到手机。
- 当桌面端看到某条记录的 location 是 `content://...`（文件在手机上），桌面端会弹窗让你选择：
  - 下载到本机：拉取并保存到桌面端 `uploads/`
  - 流式传输：不落盘，直接从手机读取

## 同步与接口速查

### 基础数据

- `GET /api/bootstrap`：下发 user/devices/folders/tags（用于 UI 初始化）

### 元数据同步

- `POST /api/sync/push`：客户端推送 device + items + locations + deleted_item_ids
- `GET /api/sync/pull?since=<ISO>`：按 updated_at 拉取增量（默认只返回未删除的 media_items）

### 桌面端导出/导入（桌面↔桌面）

- `GET /api/sync/export?since=<ISO>`
- `POST /api/sync/import`（body: `{ payload }`）

### 按需传输（桌面端发起）

- `GET /api/transfer/stream-from-device?locationId=...`
- `POST /api/transfer/pull-from-phone`（body: `{ locationId }`）

## 目录结构（开发视角）

```
.
├── server.js            # Express + SQLite API（核心）
├── db/schema.sql        # 数据库表/约束/视图
├── public/              # Web UI（原生 JS，fetch 调 API）
├── electron/main.js     # Electron 壳：启动 server + 打开窗口 + 端口兜底
├── scripts/             # init-db / smoke-check 等
└── mobile-android/      # Android App（Compose + Room + SAF + LAN Server）
```

## 进一步阅读

- 设计文档：`01~05_*.md`、ER_Diagram.html、UI_Prototype.html
- 代码结构与实现原理说明：`06_代码结构与实现原理_个人媒体资产管理系统.md`

本项目为课程设计的可运行版本，以 SQLite 本地数据库为核心实现，满足设计文档中描述的功能模块。若需扩展为 Electron 桌面应用，可将 `public/` 作为前端渲染层，并将 `server.js` 作为本地服务入口。

## 运行常见问题（FAQ）

1. **`npm install` 报错 `better-sqlite3` 编译失败**
  - Windows：确认已安装 Visual Studio Build Tools（勾选 C++ 相关组件）。
  - Linux：确认安装了 `build-essential`、`python3`、`make`、`g++`。
  - macOS：确认已安装 Xcode Command Line Tools（`xcode-select --install`）。

2. **端口被占用**
  - 修改启动端口（macOS/Linux）：
    ```bash
    PORT=4001 npm start
    ```
  - 修改启动端口（Windows PowerShell）：
    ```powershell
    $env:PORT = "4001"
    npm start
    ```
  - Electron 模式会自动尝试 `4000~4009`。

3. **手机访问不了电脑的地址（同一 Wi‑Fi）**
  - 确认电脑端用 `HOST=0.0.0.0` 启动，并使用启动日志中的 `LAN URLs`。
  - 确认手机和电脑在同一网段（同一 Wi‑Fi）。
  - 关闭/放行防火墙对 `PORT` 的入站访问。

4. **运行时报错 `NODE_MODULE_VERSION` 不匹配（better-sqlite3 原生模块）**
    - 典型现象：提示类似 `was compiled against a different Node.js version`。
    - 原因：你切换了 Node 版本，或在 Electron（自带 Node ABI）与普通 Node 环境之间来回运行，导致 `better-sqlite3` 的二进制产物不兼容。
    - 解决：
       ```bash
       # 在普通 Node 环境下运行 server.js 时
       npm run rebuild:node

       # 在 Electron 环境下运行桌面版时
       npm run rebuild:electron
       ```

    5. **手机 App 能不能“同步电脑上的文件”？为什么手机打不开电脑文件？**
       - 当前实现：手机 App 与电脑端同步的是**元数据/索引**，不做文件内容分发。
       - 电脑的本地路径（如 `/Users/...`、`D:\...`）对手机不可直接访问。
       - 如需在手机打开文件：建议用“浏览器上传到电脑端 uploads”或把文件放到“网盘/共享/可访问 URL”。
