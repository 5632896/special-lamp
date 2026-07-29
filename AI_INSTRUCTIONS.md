# AI 项目速览

## 1. 项目概述

**英语阅读词汇诊断 MVP**：面向英语学习者，基于教材/自建词库分析英文阅读内容。用户给文章单词标记「认识、模糊、未掌握」，系统输出词库命中、重点词与统计，并持续更新个人掌握等级（0～12）。核心用户是需要结合教材词库做阅读词汇诊断的学生与教师。

## 2. 技术栈与事实

- 前端：React 18 + Vite 5，单页应用。
- 后端：Python + FastAPI + Uvicorn。
- 解析：`simplemma`、`openpyxl`、`python-docx`、`pypdf`。
- 数据：**SQLite 主存储**，文件为 `backend/data/reading_vocab.sqlite3`。首次启动从旧 JSON 迁移，并将 JSON 复制到 `backend/data/json-backups/时间戳/`；JSON 不再是运行期主存储。
- AI：标准库 `urllib` 调用 OpenAI 兼容 `POST {baseUrl}/chat/completions`。

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
| 前端依赖 | `frontend/package.json` | npm 脚本与依赖 |

### 关键功能映射

- **词库上传**：`parse_uploaded_vocab()`、`parse_upload_table()`、`entries_from_mapping()`；预览/确认入口为 `/api/vocab/import-preview` 与 `/api/vocab/import-confirm`。确认前必须有单词列映射；未映射列写入 `customFields`。
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
- **超时与熔断**：前端普通请求 20 秒、上传 60 秒；后端 AI 超时限定为 5～120 秒，并将 HTTP/网络/超时转换为 502/504。无重试、无并发限流。
- **安全注意**：`ai_settings.json` 不保存 API Key；不要把真实密钥、缓存或个人词库提交到 Git。

## 5. 已实现

- SQLite 词库/状态/设置/缓存存储及旧 JSON 一次性迁移备份。
- 词库字段映射预览、保留自定义列与多教材位置、单词库 CSV 导出、二次确认删除主词库、白名单增删清空导入导出、基础间隔复习队列。
- 词库上传、主/补充/基础词库管理。
- 英文分词、词库匹配、普通/严格模式、重点词排序、文章统计。
- 词块拖拽标色、词义参考、单词详情、掌握等级分布与筛选。
- AI 单词解析（携带教材位置/自定义字段）、全文翻译、带文件的多轮 AI 对话、缓存与 SQLite 聊天记录。

## 6. 待办（高→低）

1. 对已暴露 Key 执行轮换，并清理远端 Git 历史；启用 secret scanning。
2. 拆分 `backend/main.py` 与 `frontend/src/App.jsx`，为上传、分析、AI、存储建立测试。
3. 为 SQLite 存储添加自动化 API/迁移回归测试，并逐步拆分 `main.py` 与 `App.jsx`。
4. 增加自动化 API/迁移回归测试，并评估补充词库条目编辑和更细致的复习算法。
5. 补充 CI、错误监控和生产部署流程；**不要实现桌面/移动打包、安装包、Tauri 或 Capacitor（阶段 9 不在范围内）**。

## 7. 目录结构

```text
backend/
  main.py                  # FastAPI 全部后端逻辑
  storage.py               # SQLite 持久化与 JSON 迁移
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
```

## 8. 常用开发命令

在项目根目录：

- 后端依赖：`pip install -r backend/requirements.txt`
- 后端启动：`uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
- 前端安装：进入 `frontend` 后执行 `npm install`
- 前端开发：进入 `frontend` 后执行 `npm run dev`
- 前端构建：进入 `frontend` 后执行 `npm run build`
- 前端预览：进入 `frontend` 后执行 `npm run preview`
- Git 状态：`git status`
- Git 提交：`git add .`，再执行 `git commit -m "说明"`
- Git 推送：`git push gitee main`

## 9. 代码规范

- 保持现有风格：Python 4 空格、类型注解、`snake_case`；React 函数组件、`camelCase`。
- 不要无关重构；后端 API 的中文错误文案应保持清晰。
- 新增数据字段必须同时检查：默认值、读取兼容、写入、前端展示与缓存兼容。
- 修改 AI 行为时保留 `forceRefresh`、缓存隔离、超时限制与 JSON 解析容错。
