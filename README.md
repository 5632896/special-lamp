# 英语阅读词汇诊断

当前 Windows 桌面版本：**1.31.0**（Git 标签 `v1.31.0`，遵循 `MAJOR.MINOR.PATCH`）。

> 把英语阅读中的每个词变成可标记、可分析、可长期追踪的个人词汇学习记录。

英语阅读词汇诊断是一款面向英语学习者的本地词汇学习工具。导入教材或自建词库后，粘贴一篇英文文章并标记自己认识、模糊或未掌握的单词，即可查看本篇阅读的重点词、词库匹配情况和个人掌握等级。

## 主要功能

- **上传词库**：支持 CSV、TXT、XLSX、DOCX、PDF 格式；上传后先确认字段映射。标准字段有 11 个，预览时还可按实际源列新增任意命名映射字段；未映射列会保留为自定义字段，同一源列也可同时映射为标准字段和原始自定义字段（例如“频率等级”与“词频次数”）。单个文件最大 5 MB，不再有 300 行限制。
- **粘贴文章并分析**：输入英文阅读内容，自动切分单词并与所选主词库、补充词库匹配。
- **标色生词**：单击词块即可标记为当前状态；按住 `Alt` 拖过多个词块可连续标色，普通鼠标拖拽用于选择和复制文本。
- **动态字段显示**：在「分析设置」中按词库分别配置词块标记区、词块悬浮提示、重点词清单外部字段、单词库词块表面字段和词块点击详情字段；可启用、停用、改名或添加标准字段与自定义字段。重点词清单还可单独设置卡片表面最多显示 1～12 个已启用字段，添加的字段不会因此丢失。
- **点击查释义**：文章词块和重点词提供详情抽屉；词库单词可在下方展开或在悬浮抽屉显示详情；诊断规则提示、词卡文字和详情面板均支持直接拖选复制，复制按钮仅保留在详情面板。配置 AI 后还可生成中文释义、词性、派生词、例句和词频参考，并可加入补充词库。
- **掌握等级管理**：系统根据每次阅读标记维护单词的 0～12 级掌握度、出现次数和连续认识次数，并可按等级筛选词库。
- **重点词与统计**：展示本篇词数、去重词数、认识/模糊/未掌握数量、主词库命中、补充词库命中、词库外词和重点词。
- **词库外词收集**：可将重点的词库外单词加入补充词库，供后续阅读继续追踪。
- **词库管理与复习**：可导出单个词库或基础词白名单为 CSV；白名单支持增删、清空和字段映射导入；复习记录会生成下次复习时间。单词库支持逐行列表或类似白名单的词块显示，按词库保存回想/浏览模式与详情位置；词块表面字段可在「分析设置」中逐库选择。
- **AI 学习辅助**：支持全文翻译、带文件的多轮 AI 对话，以及 SQLite 缓存和聊天记录。

## 配置 AI API Key

AI 功能是可选的；未配置时，词库上传、文章标色、词汇诊断和掌握度追踪仍可正常使用。

1. 打开左侧的 **AI 对话** 页面。
2. 点击 **展开 AI 设置**。
3. 选择服务商，或选择 **OpenAI Compatible**。
4. 填写以下内容：
   - **Base URL**：服务商 API 地址，例如 `https://api.openai.com/v1`。
   - **Model**：要使用的模型名称。
   - **API Key**：由你自己的服务商账号创建；页面输入仅用于当前浏览器会话。
5. 需要时调整 `temperature` 与请求超时时间，然后点击 **保存 AI 设置**。

### 安全提示

- 请只填写自己的 API Key，不要将密钥发送给他人或截图分享。
- 推荐在启动后端前设置 `AI_API_KEY` 环境变量；也兼容 `OPENAI_API_KEY`。此方式可在刷新页面后继续使用 AI 功能。
- 页面中临时输入的 API Key 不会保存到项目 JSON、浏览器本地存储或 Git。
- 默认建议开启 SSL 证书校验；只有在确认接口可信且遇到证书问题时，才临时关闭。

Windows PowerShell 示例：`$env:AI_API_KEY="你的新密钥"`。macOS/Linux 示例：`export AI_API_KEY="你的新密钥"`。请在同一个终端中再启动后端。

## 简单使用步骤

1. **上传词库**
   - 在首页的「上传词库」区域选择词库文件。
   - 推荐使用 CSV 或 XLSX；常用字段包括 `lemma`、`unit`、`page`、`frequency`、`in_syllabus`、`meaning`。
   - 上传后在预览中确认“单词列”；未映射列会保留为自定义字段。原本显示「不映射」的源列可以切换到「映射」，系统会为其创建可编辑的自定义映射目标。
   - 点击“添加映射字段”可为实际源列表头设置显示名称和保存字段名；可与标准字段重复选择同一源列。
   - 文件最大为 5 MB，导入行数不限。大型文件预览每页显示 50 行，但确认时会导入全部预览数据；词库预览和确认各有 120 秒的请求超时（其他普通请求为 20 秒）。

2. **选择词库**
   - 勾选本次阅读要参与分析的一个或多个主词库。
   - 可按需要启用「包含补充词库」和「忽略基础功能词」。

3. **粘贴英文文章**
   - 在「输入阅读并涂色」区域粘贴英文内容。
   - 系统会将文章拆成可操作的词块。

4. **标记掌握情况**
   - 选择「认识模式」「模糊模式」或「未掌握模式」。
   - 单击词块标记当前状态；按住 `Alt` 拖过多个词块可连续标色。
   - 要复制文章或词块文字时，直接使用普通鼠标拖拽选择即可。

5. **开始分析**
   - 点击「开始分析」。
   - 查看统计卡片、重点词清单、词库来源和文章词义参考。

6. **查看词义与长期进度**
   - 点击任意词块或重点词卡片打开详情。
   - 配置 AI 后可点击「AI解析」获得更完整的词汇说明。
   - 打开「单词库」页面，按掌握等级查看和筛选词汇；可以导出或删除当前主词库，也可进入带下次复习时间的待复习队列。

7. **配置字段显示**
   - 打开「分析设置」，在「词库字段显示」中选择要配置的主词库或补充词库。
   - 可在词块标记区、词块悬浮提示、重点词清单外部字段、单词库词块表面字段和词块点击详情字段中启用、停用、改名或添加标准字段与导入的自定义字段；补充词库也可单独配置词块表面字段。
   - 「外部最多显示字段数」仅限制重点词卡片表面的显示数量，可设置为 1～12；不会限制添加或保存的字段数量。
   - 在「词库管理 → 单词列表设置」选择「列表：逐行显示」或「词块」，并选择回想/浏览模式及详情位置，然后点击「保存显示设置」。词块表面默认显示释义、音标、单元；单词和掌握等级始终显示。
   - 配置保存在对应词库的 SQLite 记录中；旧词库会自动使用兼容默认配置。现存旧安装包未包含本轮修复。

## 截图与动图

### 首页与阅读标色

<!-- 在此放置首页/文章标色截图或动图 -->

### 词库与掌握等级

<!-- 在此放置词库管理截图或动图 -->

### AI 解析与对话

<!-- 在此放置 AI 设置、单词解析或对话截图/动图 -->

## 数据说明

本项目以 SQLite 保存学习数据，文件位于 `backend/data/reading_vocab.sqlite3`。首次启动会自动从旧 JSON 迁移，并将迁移来源备份到 `backend/data/json-backups/时间戳/`。

- SQLite 中保存主/补充/基础词库、教材位置、自定义列、每个词库的字段显示配置、掌握度、复习排程、AI 非敏感设置、AI 缓存及聊天会话/消息。
- 旧的 `vocab_libraries.json`、`user_vocab_status.json`、`ai_settings.json`、`ai_cache.json` 仅用于兼容迁移与备份来源，不再是运行期主存储。
- API Key 不会写入 SQLite、JSON、浏览器本地存储或 Git。

建议定期备份该目录，以保留个人词库和学习进度。

### Windows 安装版数据位置

安装版「英语阅读工具」会将 SQLite、迁移备份、个人词库和本地设置保存在 `%LOCALAPPDATA%\英语阅读工具\data`，而不是安装目录。因此升级或卸载应用不会默认清除学习数据；如需迁移或备份，请复制整个该目录。

## 构建 Windows 安装程序

构建机器需要 Node.js、Python 3.10+、Rust stable、Visual Studio C++ 生成工具与 Windows 10/11 SDK。以下步骤在项目根目录执行：

1. 在后端虚拟环境安装 PyInstaller：`pip install pyinstaller`。
2. 执行 `python scripts/build_tauri_sidecar.py`，生成 Tauri 随应用分发的 FastAPI sidecar。
3. 进入 `frontend`，执行 `npm install` 安装 Tauri CLI 与前端依赖。
4. 已选定的 Windows 图标源文件是 `design/icon-proposals/C-search.svg`（「词卡搜索」）。如需重新生成图标，在项目根目录执行 `frontend\node_modules\.bin\tauri.cmd icon design\icon-proposals\C-search.svg --output build\icon-work\v1.31.0`，再将生成的 `icon.ico` 复制到 `src-tauri\icons\icon.ico`；当前 `src-tauri/tauri.conf.json` 将该图标显式用于程序、NSIS 安装及卸载图标；仅替换已安装程序的图标不会自动更新安装包。
5. 确保 `NSIS` 已安装并可在 `PATH` 中找到，用于生成 Setup `.exe`。本机可将 `D:\NSIS\NSIS` 临时加入 `PATH`。
6. 建议将 `CARGO_TARGET_DIR` 设为本工作区下的 `build\tauri-target-v1.31.0`、`CARGO_BUILD_JOBS` 设为 `1`，再进入 `src-tauri` 执行 `..\frontend\node_modules\.bin\tauri.cmd build --bundles nsis`。
7. 构建产物在设置的 `CARGO_TARGET_DIR/release/bundle/nsis/`（未设置时为 `src-tauri/target/release/bundle/nsis/`）。核对新图标和安装包后复制 Setup `.exe` 到 `release/desktop/`，更新 `SHA256SUMS.txt`，再作为 GitHub Release 附件上传。

本项目当前只发布经过验证的 **NSIS Setup `.exe`**，不发布 MSI。不要将 `src-tauri/target/`、`target-msi/`、构建日志或解压版目录作为 Release 附件。

### 分发给其他用户

当前版本的 Windows x64 安装包是 `release/desktop/英语阅读工具_1.31.0_x64-setup.exe`；`1.30.0` 是历史版本，不含本轮修复与 C「词卡搜索」图标。下载者无需额外安装 Node.js、React、Python、FastAPI、Rust、SQLite 或数据库服务。

- 将该文件和 `SHA256SUMS.txt` 上传到 GitHub 的 `v1.31.0` Release 附件，不要把安装包提交进 Git 历史；发布说明注明“Windows x64、NSIS 安装程序”。
- 安装版会包含前端、Tauri 壳和 FastAPI sidecar；后端只监听本机 `127.0.0.1:18432`。
- 用户词库和 SQLite 数据会写入 `%LOCALAPPDATA%\\英语阅读工具\\data`，升级或卸载程序不会默认删除这些数据。
- AI 功能需由用户自行配置自己的 API Key；密钥不会包含在发布包中。

### 版本与 GitHub 发布流程

桌面端按语义化版本管理：不兼容变更升级主版本，新功能升级次版本，兼容性修复升级修订号。每次发布保持 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`frontend/package.json`、`frontend/package-lock.json` 同号；Git 标签统一使用 `vMAJOR.MINOR.PATCH`，不改写旧标签。

1. 完成测试及 NSIS 打包，核对安装包、图标、版本和 `SHA256SUMS.txt`。
2. 只暂存源码、测试、文档、版本和图标源文件；运行 `git diff --cached --check` 与 `git diff --cached --stat`，确认没有个人词库、密钥、备份、安装包或构建缓存。
3. 创建提交，例如 `git commit -m "release: v1.31.0 Windows desktop"`；推送源码：`git -c http.sslBackend=openssl -c http.version=HTTP/1.1 push -u special-lamp main`。此 OpenSSL 设置仅对单次命令生效，不关闭 TLS 校验。
4. 确认远端提交后，创建并推送 `v1.31.0` 标签：`git tag -a v1.31.0 -m "Release v1.31.0"`，再运行 `git -c http.sslBackend=openssl -c http.version=HTTP/1.1 push special-lamp v1.31.0`。
5. 在 GitHub 仓库的 Releases 页面以该标签创建 Release，上传 `release/desktop/` 的 Setup `.exe` 和 `SHA256SUMS.txt`，并核对附件校验和；安装包保持在 Git 历史之外。

若本地加速器将单次附件上传限制在约 5 MiB，可把安装包按 4 MiB 切为 `setup-v1.31.0.part-000` 起的连续 Release 附件，并从 GitHub Actions 手动运行 `Publish split Windows installer`。该流程先按 `SHA256SUMS.txt` 合并验证，再从 GitHub 运行器上传完整 Setup；确认远端 SHA-256 后才删除临时分片。无需把安装包或分片提交到 Git。

安装版使用 Tauri 提供原生窗口，并自动启动 FastAPI sidecar。sidecar 仅监听本机回环地址 `127.0.0.1:18432`，不会开放局域网服务端口，也不会自动打开浏览器；关闭应用时 Tauri 会终止 sidecar 进程。

## 开发者运行源码

源码模式需要分别启动后端和前端，因此需要已安装 Python 与 Node.js。

1. 在项目根目录安装后端依赖：
   - `pip install -r backend/requirements.txt`
2. 启动后端：
   - `uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
3. 进入 `frontend` 目录，安装前端依赖：
   - `npm install`
4. 启动前端：
   - `npm run dev`
5. 在浏览器打开 Vite 提示的本地地址，默认通常为 `http://127.0.0.1:5173`。

前端会将 `/api` 请求代理到本地后端 `http://127.0.0.1:8000`。

---

这是一个持续迭代中的 MVP。欢迎用真实阅读材料建立自己的词库与词汇掌握记录。
