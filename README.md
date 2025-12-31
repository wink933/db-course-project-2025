# 数据库课程设计大作业：个人媒体资产管理系统（可运行版本）

本仓库包含数据库课程设计的大作业交付物，并基于设计文档实现了可运行的本地应用（SQLite + Node.js Web UI），覆盖需求分析中提出的核心功能：资源录入、虚拟文件夹、标签管理、多设备登记与元数据同步。

## 功能覆盖说明

- **资源管理**：支持本地路径与网络链接两种资源类型，记录路径/URL、访问备注与可用性。
- **虚拟文件夹**：树形结构（根目录/子目录）用于整理资源。
- **标签系统**：自定义标签并关联资源，支持按标签筛选。
- **多设备管理**：登记设备类型与名称，用于关联本地资源位置。
- **检索与筛选**：按关键词、类型、设备、标签组合搜索。
- **局域网同步**：通过 `/api/sync/export` 和 `/api/sync/import` 实现元数据同步（局域网内互通）。
- **可用性检查**：支持刷新本地路径是否存在的状态，并在列表中展示。
- **基础维护**：资源支持删除。

## 目录结构

```
.
├── db/
│   ├── media-archive.db            # 运行后生成的 SQLite 数据库
│   └── schema.sql                  # 数据库建表与视图
├── public/
│   ├── index.html                  # 前端界面
│   ├── app.js                      # 前端逻辑
│   └── styles.css                  # 样式
├── scripts/
│   └── init-db.js                  # 初始化数据库脚本
├── server.js                       # Node.js 服务入口
├── package.json
├── 01_需求分析报告_个人媒体资产管理系统.md
├── 02_概念结构设计_个人媒体资产管理系统.md
├── 03_逻辑结构设计_个人媒体资产管理系统.md
├── 04_物理结构设计_个人媒体资产管理系统.md
├── 05_应用系统设计_个人媒体资产管理系统.md
├── ER_Diagram.html
├── UI_Prototype.html
├── 第四组-个人媒体资源管理.pptx
├── 讨论课准备_个人媒体资产管理系统.md
└── README.md
```

## 环境配置（Windows / Linux / macOS）

### 通用要求

- **Node.js 18+**
- **VSCode（或其他编辑器）**
- **浏览器**（用于访问本地 UI）
- **Git（可选，用于克隆仓库）**

### Windows 环境配置

1. **安装 Node.js**
   - 推荐从 [https://nodejs.org](https://nodejs.org) 下载 LTS 版本并安装。
2. **安装编译工具（better-sqlite3 需要）**
   - 以管理员身份打开 PowerShell，执行：
     ```powershell
     npm install --global windows-build-tools
     ```
   - 或在安装 Visual Studio 时勾选 “使用 C++ 的桌面开发”。
3. **验证**
   ```powershell
   node -v
   npm -v
   ```

### Linux 环境配置

1. **安装 Node.js（推荐使用官方仓库）**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs build-essential
   ```
2. **验证**
   ```bash
   node -v
   npm -v
   ```

### macOS 环境配置

1. **安装 Xcode Command Line Tools**
   ```bash
   xcode-select --install
   ```
2. **安装 Node.js（推荐使用 Homebrew）**
   ```bash
   brew install node
   ```
3. **验证**
   ```bash
   node -v
   npm -v
   ```

### 安装依赖（通用）

在仓库根目录执行：

```bash
npm install
```

### 初始化数据库（通用）

```bash
npm run init-db
```

### 启动项目（通用）

```bash
npm start
```

启动后访问：

```
http://localhost:4000
```

如果希望手机/其他设备在同一 Wi‑Fi 下访问（局域网访问），可让服务监听所有网卡：

```bash
HOST=0.0.0.0 PORT=4000 npm start
```

然后在电脑终端输出的 `LAN URLs` 里选一个（例如 `http://192.168.x.x:4000`），用手机浏览器打开即可。

> 提示：确保手机与电脑在同一局域网，且防火墙允许该端口访问。

## VSCode 验收流程（可运行项目）

1. **打开工程**
   - VSCode → “文件 → 打开文件夹…”，选择本仓库根目录。

2. **启动服务**
   - 打开终端，执行 `npm install`、`npm run init-db`、`npm start`。
   - 访问 `http://localhost:4000` 查看界面。

3. **功能验收要点**
   - 新增设备与标签。
   - 新增文件夹，并在新增资源时选择文件夹。
   - 新增本地文件/网络链接资源，并填写路径/URL、备注、标签。
   - 使用顶部搜索栏按标题、类型、标签、设备筛选。
   - 使用同步模块输入对端地址进行元数据同步。

4. **查看设计文档**
   - 使用 VSCode Markdown 预览（`Ctrl+Shift+V` / `Cmd+Shift+V`）。

## 局域网同步说明

- 在两台设备上分别启动项目。
- 确保在同一局域网内。
- 在任一设备的“同步”区域输入对端地址（例如 `http://192.168.0.5:4000`）并点击同步。

## 手机新增资源（拍照/选择文件上传）

在手机浏览器打开上述局域网地址后：

- 点击 `+ 添加资源`
- 将“资源类型”选择为 **本地文件**
- 在“选择文件 / 拍照导入”里直接拍照或选择相册/文件
- 点击“保存”即可上传并入库（会出现在列表里，右侧可预览/打开）

## Electron 打包与桌面应用运行

> 适用于：无需对方安装 Node.js，直接给安装包使用的场景。

### 运行桌面版（开发模式）

```bash
npm install
npm run init-db
npm run rebuild:electron
npm run electron:dev
```

说明：桌面版（开发模式）与打包后的桌面 App 会使用同一份数据目录（同一份数据库 + 同一份 uploads），确保两边内容一致。

- macOS 数据目录：`~/Library/Application Support/MediArchive Pro/`
- 如果你之前在开发模式下已产生数据但打包版看不到，通常是旧版开发模式写到了 `~/Library/Application Support/Electron/`；启动开发模式时会做一次安全迁移（仅当新目录还没有数据库时才会复制）。

### 打包桌面安装包

```bash
npm install
npm run electron:dist
```

如果打包时出现类似：`cannot unpack electron zip file` / `zip: not a valid zip file`（通常是 Electron 下载缓存里有不完整的 zip），可按下面步骤处理：

```bash
# 1) 关闭正在运行的 electron-builder（若有）

# 2) 清理 Electron 下载缓存（macOS）
rm -rf ~/Library/Caches/electron

# 3) 使用镜像重新打包（同一条命令即可）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run electron:dist
```

打包输出在 `dist/` 目录下（Windows/macOS/Linux 会生成对应安装包）。

### 注意事项

- Electron 会在后台启动本地服务并加载 `http://localhost:4000`。
- 打包后的桌面 App（安装包运行）默认会开启局域网监听，并在启动时弹出“手机访问地址”（同一 Wi‑Fi 下用手机浏览器打开即可新增资源/拍照上传）。
- 桌面版数据库文件会存放在系统用户数据目录（如 macOS 的 `~/Library/Application Support/MediArchive Pro/`）。
- 如需更换端口，可在运行时设置：
  ```bash
  ELECTRON_PORT=4000 npm run electron:dev
  ```

如果你希望手动控制是否开启局域网监听，可设置（开发模式/命令行启动时生效）：

```bash
# 仅本机访问
ELECTRON_HOST=127.0.0.1

# 局域网访问
ELECTRON_HOST=0.0.0.0
```

## 说明

本项目为课程设计的可运行版本，以 SQLite 本地数据库为核心实现，满足设计文档中描述的功能模块。若需扩展为 Electron 桌面应用，可将 `public/` 作为前端渲染层，并将 `server.js` 作为本地服务入口。

## 运行常见问题（FAQ）

1. **`npm install` 报错 `better-sqlite3` 编译失败**
   - Windows：确认已安装 Visual Studio Build Tools 或 `windows-build-tools`。
   - Linux：确认安装了 `build-essential`。
   - macOS：确认已安装 Xcode Command Line Tools。

2. **端口被占用**
   - 修改启动端口：
     ```bash
     PORT=4000 npm start
     ```
   - 访问 `http://localhost:4000`。

3. **运行时报错 `NODE_MODULE_VERSION` 不匹配（better-sqlite3 原生模块）**
    - 典型现象：提示类似 `was compiled against a different Node.js version`。
    - 原因：你切换了 Node 版本，或在 Electron（自带 Node ABI）与普通 Node 环境之间来回运行，导致 `better-sqlite3` 的二进制产物不兼容。
    - 解决：
       ```bash
       # 在普通 Node 环境下运行 server.js 时
       npm run rebuild:node

       # 在 Electron 环境下运行桌面版时
       npm run rebuild:electron
       ```
