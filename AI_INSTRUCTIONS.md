# AI 项目速览

## 1. 项目概述

**英语阅读词汇诊断 MVP**：面向英语学习者，基于教材/自建词库分析英文阅读内容。用户给文章单词标记「认识、模糊、未掌握」，系统输出词库命中、重点词与统计，并持续更新个人掌握等级（0～12）。核心用户是需要结合教材词库做阅读词汇诊断的学生与教师。

## 2. 技术栈与事实

- 前端：React 18 + Vite 5，单页应用。
- 后端：Python + FastAPI + Uvicorn。
- 解析：`simplemma`、`openpyxl`、`python-docx`、`pypdf`。
- 数据：**SQLite 主存储**，源码模式文件为 `backend/data/reading_vocab.sqlite3`。首次启动从旧 JSON 迁移，并将 JSON 复制到 `backend/data/json-backups/时间戳/`；JSON 不再是运行期主存储。Windows 安装版改用 `%LOCALAPPDATA%\英语阅读工具\data`。
- AI：标准库 `urllib` 调用 OpenAI 兼容 `POST {baseUrl}/chat/completions`。
- 桌面端：**Tauri 2 + FastAPI sidecar**。Tauri 加载 React 静态页面，并自动启动/关闭经 PyInstaller 打包的 FastAPI sidecar；API 固定监听 `127.0.0.1:18432`。Windows 发布只使用已验证的 NSIS Setup `.exe`，不维护 MSI。用户数据绝不能写入安装目录、Tauri 资源目录或 PyInstaller 临时目录。

## 3. 核心模块

| 模块 | 主要路径 | 职责 |
| --- | --- | --- |
| 后端总入口 | `backend/main.py` | 全部 API、数据读写、词形还原、上传解析、诊断、AI 调用与缓存 |
| SQLite 适配层 | `backend/storage.py` | 建表、旧 JSON 一次性迁移、词库/状态/设置/缓存读写 |
| 前端总入口 | `frontend/src/App.jsx` | 页面组件、状态、交互、API 请求 |
| 样式 | `frontend/src/styles.css` | 响应式 UI 与词汇/等级颜色 |
| React 挂载 | `frontend/src/main.jsx` | 渲染 `App` |
| Vite 配置 | `frontend/vite.config.js` | 开发端口 5173；`/api` 代理至 8000 |
| 后端依赖 | `backend/requirements.txt` | Python 依赖 |
| FastAPI sidecar | `backend/sidecar.py` | sidecar 进程入口，监听本机回环地址 |
| Tauri 壳 | `src-tauri/src/main.rs` | 原生窗口、sidecar 自动启动和退出清理 |
| Tauri 配置 | `src-tauri/tauri.conf.json` | 前端构建、sidecar 资源与 NSIS 打包配置 |
| Windows 图标 | `design/icon-proposals/C-search.svg` → `src-tauri/icons/icon.ico` | 已选 C「词卡搜索」；通过 Tauri CLI 生成 `.ico`，用于 EXE/安装包/快捷方式，NSIS 的 `installerIcon`/`uninstallerIcon` 也指向该文件 |
| Sidecar 构建 | `scripts/build_tauri_sidecar.py` | 通过 PyInstaller 生成 Tauri 资源文件 |
| 前端依赖 | `frontend/package.json` | npm 脚本与依赖 |

### 关键功能映射

- **词库上传**：`parse_uploaded_vocab()`、`parse_upload_table()`、`entries_from_mapping()`；预览/确认入口为 `/api/vocab/import-preview` 与 `/api/vocab/import-confirm`。确认前必须有单词列映射；标准映射字段有 11 个，且可在预览中基于实际源列表头新增 `key`、`label`、`sourceHeader`、`displaySource` 字段定义。标准字段和自定义字段可共享同一源列，未映射列继续写入 `customFields`。预览中「不映射 → 映射」必须为无目标的源列创建可编辑的自定义字段定义（见 `frontend/src/importMapping.js`），不能只改变下拉框文字。仅保留 5 MB 文件大小限制，不应恢复 300 行限制。
- **字段显示配置**：每个词库的 `displayConfig` 写入 SQLite `libraries.display_config_json`。配置包含 `tokenFields`（词块标记区）、`tooltipFields`（词块悬浮提示）、`focusFields`（重点词清单外部字段）、`detailFields`（词块点击详情字段）及 `focusFieldLimit`（重点词卡片表面显示数量，范围 1～12）、`wordListFields`（单词库词块表面字段）和 `listLayout`（`list`/`tiles`）。字段数组与 `listMode`、`rushMode`、`detailPlacement` 等标量设置务必分开校验，不可遍历标量并当成数组，否则保存设置返回 400。`/api/libraries/{library_id}/display-config` 负责读取/保存；旧词库由 `normalized_display_config()` 生成默认配置。前端可使用 `availableFields` 选择标准或自定义字段。保存后必须以接口返回的配置更新草稿，不能被词库刷新前的旧数据覆盖。
- **文章标色与诊断**：前端 `tokenizeText()`、`HomePage`；后端 `analyze()`，入口 `/api/analyze`。
- **AI 解释/翻译/对话**：`call_ai_chat()`、`ai_word_query()`、`ai_article_translate()`、`ai_chat()`；前端 `WordDetailPanel`、`AIChatPage`。
- **掌握度追踪**：`update_level_by_mark()`、`build_mastery_overview()`；状态存入 SQLite 的 `user_vocab_status`，间隔复习排程存入 `review_schedule`，接口为 `/api/review/due` 与 `/api/review/mark`。
- **聊天持久化**：`chat_sessions`、`chat_messages` 与 `/api/chat/sessions`；`/api/ai/chat` 使用最近历史构建多轮上下文。

## 4. 关键设计决策

- **词元匹配**：`simplemma` 加简单后缀候选，将时态/复数尽量归并到 lemma 后查词库。
- **词库层级**：主词库可多选；补充词库可选；基础词白名单可在分析时忽略。
- **掌握等级**：范围 0～12，分析时按同 lemma 的最差标记更新，避免同篇多次出现时被“认识”覆盖。
- **缓存策略**：AI 单词、全文翻译、对话结果分别写入 SQLite 的 `ai_cache`；单词缓存按教材上下文隔离，对话缓存按近期历史隔离；缓存键不含 API Key。
- **用户 Key 透传**：前端请求可携带当前会话的临时 Key；后端 `merge_ai_settings()` 按“请求 Key → `AI_API_KEY` → `OPENAI_API_KEY`”取 Key，持久化设置中不保留 Key。
- **超时与熔断**：前端普通请求 20 秒、一般上传 60 秒；词库预览与确认导入均为 120 秒（`IMPORT_TIMEOUT_MS`），文章分析为 60 秒；后端 AI 超时限定为 5～120 秒，并将 HTTP/网络/超时转换为 502/504。无重试、无并发限流。
- **安全注意**：`ai_settings.json` 不保存 API Key；不要把真实密钥、缓存或个人词库提交到 Git。

## 5. 已实现

- SQLite 词库/状态/设置/缓存存储及旧 JSON 一次性迁移备份。
- 词库字段映射预览、保留自定义列与多教材位置、单词库 CSV 导出、二次确认删除主词库、白名单增删清空导入导出、基础间隔复习队列。
- 词库上传、主/补充/基础词库管理。
- 英文分词、词库匹配、普通/严格模式、重点词排序、文章统计。
- 单击词块打开详情且保留已分析的词汇字段；标色仅由显式标记/拖拽操作触发。支持按 `Alt` 拖拽连续标色、普通拖拽文本选择、词义参考、可选择的重点词文本与可复制的单词详情、掌握等级分布与筛选；重点词清单不提供单独复制按钮。
- AI 单词解析（携带教材位置/自定义字段）、全文翻译、带文件的多轮 AI 对话、缓存与 SQLite 聊天记录。

## 6. 待办（高→低）

1. 对已暴露 Key 执行轮换，并清理远端 Git 历史；启用 secret scanning。
2. 拆分 `backend/main.py` 与 `frontend/src/App.jsx`，为上传、分析、AI、存储建立测试。
3. 为 SQLite 存储添加自动化 API/迁移回归测试，并逐步拆分 `main.py` 与 `App.jsx`。
4. 增加自动化 API/迁移回归测试，并评估补充词库条目编辑和更细致的复习算法。
5. 补充 CI、错误监控和发布流程；每次桌面端发布均将已验证的 NSIS Setup `.exe` 和 SHA256SUMS 上传 GitHub Release 附件。Tauri Windows 桌面端已纳入本阶段，移动端与 Capacitor 仍不在当前范围内。

## 7. 目录结构

```text
backend/
  main.py                  # FastAPI 全部后端逻辑
  storage.py               # SQLite 持久化与 JSON 迁移
  runtime_paths.py         # 源码/安装版资源与用户数据目录
  requirements.txt
  data/                    # SQLite 主数据、JSON 迁移来源与备份
frontend/
  index.html
  package.json
  vite.config.js
  src/
    App.jsx                # 全部前端页面/组件
    main.jsx
    styles.css
scripts/
  build_tauri_sidecar.py   # 生成 FastAPI sidecar
src-tauri/
  src/main.rs              # Tauri 窗口与 sidecar 生命周期
  resources/               # 打包后的 FastAPI sidecar 资源
  tauri.conf.json          # Tauri Windows 安装包配置
```

## 8. 常用开发命令

在项目根目录：

- 后端依赖：`pip install -r backend/requirements.txt`
- 后端启动：`uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
- 前端安装：进入 `frontend` 后执行 `npm install`
- 前端开发：进入 `frontend` 后执行 `npm run dev`
- 前端构建：进入 `frontend` 后执行 `npm run build`
- 前端预览：进入 `frontend` 后执行 `npm run preview`
- FastAPI sidecar 构建：`python scripts/build_tauri_sidecar.py`
- Windows 图标更新：在根目录执行 `frontend\node_modules\.bin\tauri.cmd icon design\icon-proposals\C-search.svg --output build\icon-work\v1.31.0`，再将生成的 `icon.ico` 复制到 `src-tauri\icons\icon.ico`。
- Tauri Windows 安装程序构建：打包前先在已安装 PyInstaller 的 Python 环境运行 `python scripts\build_tauri_sidecar.py` 刷新后端；将 `D:\NSIS\NSIS` 加入 `PATH`，设 `CARGO_BUILD_JOBS=1` 和工作区内的 `CARGO_TARGET_DIR`，然后在 `src-tauri` 执行 `..\frontend\node_modules\.bin\tauri.cmd build --bundles nsis`。构建完成后核对安装包图标与 `release/desktop/SHA256SUMS.txt`。
- 发布附件：当前版本 `1.31.0`（Git 标签 `v1.31.0`），NSIS Setup 为 `release/desktop/英语阅读工具_1.31.0_x64-setup.exe`。将经过验证的 Setup 与 `SHA256SUMS.txt` 上传 GitHub Release，不把二进制、MSI、`target` 缓存或解压目录提交到 Git。
- Git 状态：`git status`
- Git 提交：只暂存本次源码、测试、图标及版本文档；运行 `git diff --cached --check`、检查暂存文件后再执行 `git commit -m "release: v1.31.0 Windows desktop"`。不要提交个人词库、密钥、备份或构建缓存。
- GitHub 推送：先用 `git -c http.sslBackend=openssl -c http.version=HTTP/1.1 ls-remote special-lamp HEAD` 核对远端，再以相同临时参数推送 `main` 与 `v1.31.0` 标签；最后在 GitHub Releases 页面上传安装包和校验和。`ls-remote` 成功不等于有推送权限；不要全局关闭 TLS 校验或强推。

## 9. 代码规范

- 保持现有风格：Python 4 空格、类型注解、`snake_case`；React 函数组件、`camelCase`。
- 不要无关重构；后端 API 的中文错误文案应保持清晰。
- 新增数据字段必须同时检查：默认值、读取兼容、写入、前端展示与缓存兼容。词库字段显示变更还必须保留 `lemma`、标记和数量等身份信息，不能把 API Key 写入显示配置。
- 修改 AI 行为时保留 `forceRefresh`、缓存隔离、超时限制与 JSON 解析容错。
