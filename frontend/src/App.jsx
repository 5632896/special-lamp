import { useEffect, useMemo, useRef, useState } from "react";

const WORD_REGEX = /[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z\s]+|\s+/g;
const REQUEST_TIMEOUT_MS = 20000;
const PAGE_SIZE = 50;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const CHAT_FILE_ACCEPT =
  ".txt,.md,.csv,.json,.docx,.pdf,.xlsx,.py,.js,.ts,.jsx,.tsx,.html,.css,.xml,.yaml,.yml,.log";

const CHAT_SESSIONS_STORAGE_KEY = "reading_vocab_chat_sessions_v1";
const CHAT_SELECTED_STORAGE_KEY = "reading_vocab_selected_chat_v1";
const WORD_AI_CACHE_STORAGE_KEY = "reading_vocab_word_ai_cache_v1";

const MARK_LABEL = {
  known: "认识",
  fuzzy: "模糊",
  unknown: "未掌握"
};

const MODE_THEME = {
  known: {
    backgroundColor: "#16a34a",
    color: "#ffffff"
  },
  fuzzy: {
    backgroundColor: "#f59e0b",
    color: "#ffffff"
  },
  unknown: {
    backgroundColor: "#dc2626",
    color: "#ffffff"
  }
};

const LEVEL_LABEL = {
  0: "未追踪",
  1: "不认识",
  2: "模糊",
  3: "认识",
  4: "认识",
  5: "认识",
  6: "较稳定",
  7: "较稳定",
  8: "较稳定",
  9: "较稳定",
  10: "较稳定",
  11: "较稳定",
  12: "稳定"
};

const SAMPLE_TEXT =
  "Students are discussing how climate change affects the ecosystem of a coastal city. Scientists hope the government will protect the environment, reduce pollution, and explore renewable energy solutions so more species can survive.";

function tokenizeText(text) {
  const parts = text.match(WORD_REGEX) ?? [];
  return parts.map((part, index) => ({
    id: index,
    text: part,
    isWord: /[A-Za-z]/.test(part),
    mark: "unknown",
    analysis: null
  }));
}

async function request(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        typeof body === "string"
          ? body
          : body.detail || body.message || "请求失败";
      throw new Error(message);
    }

    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("请求超时，请检查后端是否启动，或缩短内容后再试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getJson(url) {
  return request(url);
}

function postJson(url, body) {
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function postForm(url, formData) {
  return request(
    url,
    {
      method: "POST",
      body: formData
    },
    60000
  );
}

function levelClass(level) {
  const n = Math.min(Math.max(Number(level) || 0, 0), 12);
  return `level-bg-${n}`;
}

function buildTokenTitle(token) {
  if (!token.analysis) return "";
  const item = token.analysis;

  const parts = [
    item.lemma ? `lemma: ${item.lemma}` : "",
    item.sourceText ? `来源: ${item.sourceText}` : "",
    item.unit ? `Unit: ${item.unit}` : "",
    item.page ? `页码: ${item.page}` : "",
    item.frequencyText ? `频率: ${item.frequencyText}` : "",
    item.basicIgnored ? "基础词" : "",
    item.outside ? item.outsideText : "",
    typeof item.level !== "undefined" ? `等级: L${item.level} ${item.levelLabel}` : "",
    item.meaning ? `词义: ${item.meaning}` : ""
  ].filter(Boolean);

  return parts.join("\n");
}

function buildTokenMiniInfo(token) {
  if (!token.analysis) return "";
  const item = token.analysis;

  if (item.basicIgnored) {
    return "基础词";
  }

  if (item.outside) {
    return item.outsideText;
  }

  const parts = [];

  if (item.unit && item.page) {
    parts.push(`${item.unit}/p.${item.page}`);
  } else if (item.unit) {
    parts.push(item.unit);
  }

  if (item.libraryType === "extra") {
    parts.push(item.sourceText || "补充词库");
    return parts.join(" · ");
  }

  if (item.frequencyText) {
    parts.push(item.frequencyText);
  }

  return parts.join(" · ");
}

function buildTokenMeaning(token) {
  if (!token.analysis?.meaning) return "";
  return token.analysis.meaning;
}

function buildFocusMeta(word) {
  const parts = [];

  if (word.libraryName) {
    parts.push(word.libraryName);
  }

  if (word.libraryType !== "extra" && word.unit && word.page) {
    parts.push(`${word.unit} / p.${word.page}`);
  } else if (word.libraryType !== "extra" && word.unit) {
    parts.push(word.unit);
  }

  if (word.outside) {
    parts.push(word.outsideText);
  } else if (word.libraryType === "extra") {
    parts.push("补充词库");
  } else {
    parts.push("主词库");
  }

  if (word.libraryType !== "extra" && word.frequencyText) {
    parts.push(word.frequencyText);
  }

  return parts.join(" · ");
}

function buildAISettingsPayload(aiSettings) {
  return {
    provider: aiSettings.provider || "openai-compatible",
    baseUrl: aiSettings.baseUrl || "",
    model: aiSettings.model || "",
    apiKey: aiSettings.apiKey || "",
    temperature: Number(aiSettings.temperature || 0.2),
    timeoutSeconds: Number(aiSettings.timeoutSeconds || 30),
    verifySSL: !!aiSettings.verifySSL
  };
}

function readLocalStorageJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function createChatSession(index = 1) {
  const now = new Date().toISOString();
  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `新对话 ${index}`,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function buildChatTitleFromMessage(message, fallback) {
  const clean = String(message || "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getWordAiKey(wordLike) {
  return String(
    wordLike?.lemma || wordLike?.word || wordLike?.displayText || wordLike?.text || ""
  )
    .trim()
    .toLowerCase();
}

function getAiFrequencyLabel(result) {
  if (result?.aiFrequencyText) return result.aiFrequencyText;
  if (result?.aiFrequency === "high") return "高考高频";
  if (result?.aiFrequency === "low") return "高考低频";
  return "暂无";
}

function normalizePosDetails(result) {
  const raw = Array.isArray(result?.posDetails)
    ? result.posDetails
    : Array.isArray(result?.pos)
    ? result.pos.map((item) =>
        typeof item === "string" ? { en: item, zh: "" } : item
      )
    : [];

  return raw
    .map((item) => {
      if (typeof item === "string") {
        return { en: item, zh: "" };
      }
      return {
        en: item?.en || item?.english || item?.pos || "",
        zh: item?.zh || item?.chinese || item?.meaning || ""
      };
    })
    .filter((item) => item.en || item.zh);
}

function normalizeDerivativeDetails(result) {
  const raw = [
    ...(Array.isArray(result?.derivatives) ? result.derivatives : []),
    ...(Array.isArray(result?.wordForms) ? result.wordForms : [])
  ];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const [wordPart, meaningPart = ""] = item.split(/[:：]\s*/);
        return {
          word: (wordPart || "").trim(),
          meaning: (meaningPart || "").trim(),
          relation: "",
          source: "ai"
        };
      }
      return {
        word: item?.word || item?.lemma || item?.name || "",
        meaning: item?.meaning || item?.translation || "",
        relation: item?.relation || item?.form || item?.type || "",
        source: item?.source || "ai"
      };
    })
    .filter((item) => item.word || item.meaning);
}

function getCustomField(customFields, names) {
  const fields = customFields || {};
  const matchedKey = Object.keys(fields).find((key) => names.includes(String(key).trim().toLowerCase()));
  return matchedKey ? fields[matchedKey] : "";
}

function buildWordDetailFromToken(token) {
  const analysis = token?.analysis || {};
  return {
    word: token?.text || analysis?.displayText || analysis?.lemma || "",
    displayText: token?.text || analysis?.displayText || analysis?.lemma || "",
    lemma: analysis?.lemma || token?.text || "",
    meaning: analysis?.meaning || "",
    sourceText: analysis?.sourceText || analysis?.libraryName || "",
    libraryName: analysis?.libraryName || "",
    libraryType: analysis?.libraryType || "",
    unit: analysis?.unit || "",
    page: analysis?.page || "",
    frequencyText: analysis?.frequencyText || "",
    locations: analysis?.locations || [],
    customFields: analysis?.customFields || {},
    ipa: analysis?.ipa || getCustomField(analysis?.customFields, ["音标", "ipa", "phonetic", "pronunciation"]),
    audioUrl: analysis?.audioUrl || getCustomField(analysis?.customFields, ["音频链接", "audio_url", "audio", "sound_url"]),
    pos: analysis?.pos || getCustomField(analysis?.customFields, ["词性", "pos", "part_of_speech"]),
    level: analysis?.level,
    levelLabel: analysis?.levelLabel || "",
    outside: !!analysis?.outside,
    outsideText: analysis?.outsideText || "",
    basicIgnored: !!analysis?.basicIgnored,
    selectionMark: token?.mark || analysis?.selectionMark || "unknown"
  };
}

function buildWordDetailFromFocusWord(word) {
  return {
    word: word?.displayText || word?.lemma || "",
    displayText: word?.displayText || word?.lemma || "",
    lemma: word?.lemma || "",
    meaning: word?.meaning || "",
    sourceText: word?.libraryType === "extra" ? "补充词库" : word?.libraryName || "",
    libraryName: word?.libraryName || "",
    libraryType: word?.libraryType || "",
    unit: word?.unit || "",
    page: word?.page || "",
    frequencyText: word?.frequencyText || "",
    locations: word?.locations || [],
    customFields: word?.customFields || {},
    ipa: word?.ipa || getCustomField(word?.customFields, ["音标", "ipa", "phonetic", "pronunciation"]),
    audioUrl: word?.audioUrl || getCustomField(word?.customFields, ["音频链接", "audio_url", "audio", "sound_url"]),
    pos: word?.pos || getCustomField(word?.customFields, ["词性", "pos", "part_of_speech"]),
    outside: !!word?.outside,
    outsideText: word?.outsideText || "",
    basicIgnored: !!word?.basicIgnored,
    selectionMark: word?.focusMark || "unknown"
  };
}

function Sidebar({ activePage, setActivePage }) {
  const homeActive = activePage === "home" || activePage.startsWith("home-");
  const libraryActive = activePage === "library" || activePage.startsWith("library-");
  return (
    <aside className="sidebar">
      <div className="sidebar-title">词汇诊断</div>
      <button
        type="button"
        className={`sidebar-item ${homeActive ? "active" : ""}`}
        onClick={() => setActivePage("home")}
      >
        首页
      </button>
      <button type="button" className={`sidebar-item sidebar-subitem ${activePage === "home-libraries" ? "active" : ""}`} onClick={() => setActivePage("home-libraries")}>参与分析词库</button>
      <button type="button" className={`sidebar-item sidebar-subitem ${activePage === "home-analysis" ? "active" : ""}`} onClick={() => setActivePage("home-analysis")}>分析设置</button>
      <button
        type="button"
        className={`sidebar-item ${libraryActive ? "active" : ""}`}
        onClick={() => setActivePage("library")}
      >
        单词库
      </button>
      <button type="button" className={`sidebar-item sidebar-subitem ${activePage === "library-import" ? "active" : ""}`} onClick={() => setActivePage("library-import")}>导入词库</button>
      <button type="button" className={`sidebar-item sidebar-subitem ${activePage === "library-basic" ? "active" : ""}`} onClick={() => setActivePage("library-basic")}>基础词白名单</button>
      <button type="button" className={`sidebar-item sidebar-subitem ${activePage === "library-manage" ? "active" : ""}`} onClick={() => setActivePage("library-manage")}>词库管理</button>
      <button
        type="button"
        className={`sidebar-item ${activePage === "chat" ? "active" : ""}`}
        onClick={() => setActivePage("chat")}
      >
        AI 对话
      </button>
      <button
        type="button"
        className={`sidebar-item sidebar-subitem ${activePage === "ai-settings" ? "active" : ""}`}
        onClick={() => setActivePage("ai-settings")}
      >
        AI 设置
      </button>
    </aside>
  );
}

function AISettingsPanel({
  aiSettings,
  setAiSettings,
  providerOptions,
  fieldHelp,
  embedded = false,
  title = "AI 设置",
  subtitle = "非敏感设置会保存到本机"
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const selectedProvider =
    providerOptions.find((item) => item.id === aiSettings.provider) || null;

  const applyProviderPreset = () => {
    if (!selectedProvider) return;
    setAiSettings((prev) => ({
      ...prev,
      baseUrl: prev.baseUrl || selectedProvider.baseUrlExample || "",
      model: prev.model || selectedProvider.modelExample || ""
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const payload = buildAISettingsPayload(aiSettings);
      const result = await postJson("/api/ai/settings", payload);

      setAiSettings((prev) => ({
        ...prev,
        provider: result.provider,
        baseUrl: result.baseUrl,
        model: result.model,
        apiKey: prev.apiKey,
        apiKeyMasked: result.apiKeyMasked,
        hasApiKey: result.hasApiKey,
        temperature: result.temperature,
        timeoutSeconds: result.timeoutSeconds,
        verifySSL: result.verifySSL
      }));

      setMessage(
        aiSettings.apiKey
          ? "非敏感设置已保存；当前输入的 API Key 仅在本次会话中使用。"
          : "非敏感 AI 设置已保存。"
      );
    } catch (error) {
      setError(`保存 AI 设置失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      <div className="panel-title">
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>

      <div className="ai-settings-grid">
        <select
          className="select-input"
          value={aiSettings.provider}
          onChange={(event) =>
            setAiSettings((prev) => ({ ...prev, provider: event.target.value }))
          }
        >
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="ghost-btn"
          onClick={applyProviderPreset}
        >
          套用平台示例
        </button>

        <input
          className="text-mini-input"
          placeholder={selectedProvider?.baseUrlExample || "Base URL"}
          value={aiSettings.baseUrl}
          onChange={(event) =>
            setAiSettings((prev) => ({ ...prev, baseUrl: event.target.value }))
          }
        />

        <input
          className="text-mini-input"
          placeholder={selectedProvider?.modelExample || "Model"}
          value={aiSettings.model}
          onChange={(event) =>
            setAiSettings((prev) => ({ ...prev, model: event.target.value }))
          }
        />

        <input
          className="text-mini-input"
          type="password"
          placeholder={
            aiSettings.hasApiKey
              ? `已配置：${aiSettings.apiKeyMasked || "已存在"}；输入仅当前会话有效`
              : "API Key（仅当前会话有效）"
          }
          value={aiSettings.apiKey}
          onChange={(event) =>
            setAiSettings((prev) => ({ ...prev, apiKey: event.target.value }))
          }
        />

        <div className="setting-help-card">
          <div className="setting-help-title">平台说明</div>
          <div className="setting-help-text">
            {selectedProvider?.note || "可填写任意 OpenAI 兼容接口。"}
          </div>
        </div>

        <div className="setting-help-card">
          <div className="setting-help-title">API Key 安全</div>
          <div className="setting-help-text">
            推荐设置 AI_API_KEY 环境变量。此处输入的 Key 仅用于当前浏览器会话，不会写入项目文件。
          </div>
        </div>

        <input
          className="text-mini-input"
          type="number"
          step="0.1"
          placeholder="temperature"
          value={aiSettings.temperature}
          onChange={(event) =>
            setAiSettings((prev) => ({ ...prev, temperature: event.target.value }))
          }
        />

        <input
          className="text-mini-input"
          type="number"
          placeholder="timeoutSeconds"
          value={aiSettings.timeoutSeconds}
          onChange={(event) =>
            setAiSettings((prev) => ({ ...prev, timeoutSeconds: event.target.value }))
          }
        />
      </div>

      <div className="ai-help-grid">
        <div className="setting-help-card">
          <div className="setting-help-title">temperature</div>
          <div className="setting-help-text">
            {fieldHelp.temperature ||
              "控制回答随机性。越低越稳定，推荐 0.1~0.3；越高越发散。"}
          </div>
        </div>

        <div className="setting-help-card">
          <div className="setting-help-title">timeoutSeconds</div>
          <div className="setting-help-text">
            {fieldHelp.timeoutSeconds ||
              "单次 AI 请求最长等待秒数。超过后会报超时。"}
          </div>
        </div>

        <label className="check-row include-extra">
          <input
            type="checkbox"
            checked={!!aiSettings.verifySSL}
            onChange={(event) =>
              setAiSettings((prev) => ({ ...prev, verifySSL: event.target.checked }))
            }
          />
          <span>校验 SSL 证书（verifySSL）</span>
          <em>证书报错时可临时关闭</em>
        </label>

        <div className="setting-help-card">
          <div className="setting-help-title">verifySSL</div>
          <div className="setting-help-text">
            {fieldHelp.verifySSL ||
              "是否校验 HTTPS 证书。证书报错时可临时关闭，但仅建议本地测试使用。"}
          </div>
        </div>
      </div>

      <div className="upload-row">
        <button
          type="button"
          className="primary-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "保存中..." : "保存 AI 设置"}
        </button>
      </div>

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
    </>
  );

  if (embedded) {
    return <div className="embedded-settings-panel">{content}</div>;
  }

  return <section className="panel small-panel">{content}</section>;
}

function UploadPanel({
  libraries,
  refreshLibraries,
  selectedLibraryIds,
  setSelectedLibraryIds,
  aiSettings
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [libraryName, setLibraryName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [editableRows, setEditableRows] = useState([]);
  const [customHeader, setCustomHeader] = useState("");
  const [customDefaultValue, setCustomDefaultValue] = useState("");

  const applyDraft = (result, message) => {
    setPreview(result);
    setMapping(result.mapping || {});
    setEditableRows((result.rows || []).map((row) => [...row]));
    setMessage(message || result.message || "请确认字段映射和词条内容。");
  };

  const handlePreview = async () => {
    if (!selectedFile) {
      setError("请先选择词库文件。");
      return;
    }

    setUploading(true);
    setError("");
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("libraryName", libraryName);

      const result = await postForm("/api/vocab/import-preview", formData);
      applyDraft(result, `已读取 ${result.rowCount} 行，识别到 ${result.recognizedCount} 个可导入词条。请确认映射。`);
    } catch (error) {
      setError(`上传失败：${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleAiDraft = async () => {
    if (!selectedFile) {
      setError("请先选择需要 AI 整理的文件。");
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("settingsJson", JSON.stringify(buildAISettingsPayload(aiSettings)));
      const result = await postForm("/api/vocab/ai-import-file-draft", formData);
      applyDraft(result, result.message);
    } catch (error) {
      setError(`AI 整理失败：${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setUploading(true);
    setError("");
    try {
      const result = await postJson("/api/vocab/import-confirm", {
        libraryName: libraryName || selectedFile?.name?.replace(/\.[^.]+$/, "") || "未命名词库",
        headers: preview.headers,
        rows: editableRows,
        mapping
      });
      await refreshLibraries();
      if (result.library?.id) {
        setSelectedLibraryIds((prev) => prev.includes(result.library.id) ? prev : [...prev, result.library.id]);
      }
      setMessage(`导入成功：${result.library.name}，共 ${result.importedCount} 个词条。`);
      setPreview(null);
      setMapping({});
      setEditableRows([]);
      setLibraryName("");
      setSelectedFile(null);
    } catch (error) {
      setError(`导入失败：${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const mainCount = libraries.filter((lib) => lib.type === "main").length;

  const updateEditableCell = (rowIndex, columnIndex, value) => {
    setEditableRows((prev) => prev.map((row, currentRowIndex) => {
      if (currentRowIndex !== rowIndex) return row;
      return row.map((cell, currentColumnIndex) => currentColumnIndex === columnIndex ? value : cell);
    }));
  };

  const removeEditableRow = (rowIndex) => {
    setEditableRows((prev) => prev.filter((_, index) => index !== rowIndex));
  };

  const addCustomColumn = () => {
    const header = customHeader.trim();
    if (!header) {
      setError("请先输入自定义表头名称。");
      return;
    }
    if (preview.headers.some((item) => item.trim().toLowerCase() === header.toLowerCase())) {
      setError("该表头已存在，请换一个名称。");
      return;
    }
    setPreview((prev) => ({ ...prev, headers: [...prev.headers, header] }));
    setEditableRows((prev) => prev.map((row) => [...row, customDefaultValue]));
    setCustomHeader("");
    setCustomDefaultValue("");
    setError("");
  };

  return (
    <section className="panel upload-panel">
      <div className="panel-title">
        <h2>0. 导入词库</h2>
        <span>主词库 {mainCount} 个</span>
      </div>

      <div className="upload-row">
        <input
          className="file-input"
          type="file"
          accept=".csv,.txt,.xlsx,.docx,.pdf"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
        />
        <input
          className="text-mini-input"
          placeholder="词库名称，可不填"
          value={libraryName}
          onChange={(event) => setLibraryName(event.target.value)}
        />
        <button type="button" className="primary-btn" onClick={handlePreview} disabled={uploading}>
          {uploading ? "处理中..." : "读取文件"}
        </button>
        <button type="button" className="secondary-btn" onClick={handleAiDraft} disabled={uploading || !selectedFile}>
          {uploading ? "AI 整理中..." : "AI 整理此文件"}
        </button>
      </div>

      <div className="upload-tips">
        先“读取文件”保留原表格，或选择“AI 整理此文件”把 TXT、DOCX、PDF 等半结构化资料转成草稿。AI 仅生成预览，确认导入前不会写入词库。
      </div>

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
      {preview ? (
        <div className="import-preview">
          <div className="panel-title compact">
            <h2>预处理与字段映射</h2>
            <span>仅单词必填；单次最多 300 行</span>
          </div>
          <div className="import-map-grid">
            {(preview.mappingFields || [
              { key: "lemma", label: "单词（必填）" }, { key: "meaning", label: "释义" },
              { key: "unit", label: "单元" }, { key: "lesson", label: "课程/章节" },
              { key: "page", label: "页码" }, { key: "frequency", label: "频率" },
              { key: "pos", label: "词性" }, { key: "ipa", label: "音标" },
              { key: "audio_url", label: "音频链接" },
              { key: "serial", label: "序号" }, { key: "in_syllabus", label: "是否书内" }
            ]).map(({ key: field, label }) => (
              <label key={field} className="import-map-row">
                <span>{label}</span>
                <select
                  className="select-input"
                  value={mapping[field] || ""}
                  onChange={(event) => setMapping((prev) => ({ ...prev, [field]: event.target.value }))}
                >
                  <option value="">不映射</option>
                  {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="custom-column-editor">
            <div>
              <strong>补充缺失字段</strong>
              <span>创建自定义表头后，会为全部现有词条增加此列；可先批量填固定值，再在下方逐格修改。</span>
            </div>
            <input className="text-mini-input" placeholder="例如：难度 / 记忆备注" value={customHeader} onChange={(event) => setCustomHeader(event.target.value)} />
            <input className="text-mini-input" placeholder="整列默认值（可留空）" value={customDefaultValue} onChange={(event) => setCustomDefaultValue(event.target.value)} />
            <button type="button" className="secondary-btn" onClick={addCustomColumn}>添加自定义列</button>
          </div>
          <div className="editable-import-header">
            <div>
              <strong>待导入词条</strong>
              <span>可直接修改或删除不需要的行；确认时以这里的内容为准，未映射列将保留为自定义信息。</span>
            </div>
          </div>
          <div className="editable-import-table-wrap">
            <table className="editable-import-table">
              <thead>
                <tr>
                  {preview.headers.map((header) => <th key={header}>{header}</th>)}
                  <th aria-label="操作">操作</th>
                </tr>
              </thead>
              <tbody>
                {editableRows.map((row, rowIndex) => (
                  <tr key={`editable-row-${rowIndex}`}>
                    {preview.headers.map((header, columnIndex) => (
                      <td key={`${header}-${columnIndex}`}>
                        <input
                          className="editable-import-cell"
                          value={row[columnIndex] ?? ""}
                          onChange={(event) => updateEditableCell(rowIndex, columnIndex, event.target.value)}
                          aria-label={`${header} 第 ${rowIndex + 1} 行`}
                        />
                      </td>
                    ))}
                    <td><button type="button" className="ghost-btn mini-ghost-btn" onClick={() => removeEditableRow(rowIndex)}>删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="upload-row">
            <button type="button" className="primary-btn" onClick={handleConfirm} disabled={uploading || !mapping.lemma}>
              {uploading ? "导入中..." : "确认创建主词库"}
            </button>
            <button type="button" className="ghost-btn" onClick={() => { setPreview(null); setEditableRows([]); }}>取消</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LibrarySelector({
  libraries,
  selectedLibraryIds,
  setSelectedLibraryIds,
  includeExtra,
  setIncludeExtra
}) {
  const mainLibraries = libraries.filter((lib) => lib.type === "main");
  const extras = libraries.filter((lib) => lib.type === "extra");
  const extraCount = extras.reduce((total, library) => total + (library.count || 0), 0);

  const toggleLibrary = (id) => {
    if (selectedLibraryIds.includes(id)) {
      setSelectedLibraryIds(selectedLibraryIds.filter((item) => item !== id));
    } else {
      setSelectedLibraryIds([...selectedLibraryIds, id]);
    }
  };

  return (
    <section className="panel small-panel">
      <div className="panel-title">
        <h2>选择参与分析的词库</h2>
        <span>可多选</span>
      </div>

      {mainLibraries.length === 0 ? (
        <div className="warning-box">还没有主词库，请先上传。</div>
      ) : (
        <div className="library-check-list">
          {mainLibraries.map((lib) => (
            <label key={lib.id} className="check-row">
              <input
                type="checkbox"
                checked={selectedLibraryIds.includes(lib.id)}
                onChange={() => toggleLibrary(lib.id)}
              />
              <span>{lib.name}</span>
              <em>{lib.count} 词</em>
            </label>
          ))}
        </div>
      )}

      <label className="check-row include-extra">
        <input
          type="checkbox"
          checked={includeExtra}
          onChange={(event) => setIncludeExtra(event.target.checked)}
        />
        <span>包含补充词库</span>
        <em>{extraCount} 词 / {extras.length} 库</em>
      </label>
    </section>
  );
}

function AnalysisSettings({
  analysisMode,
  setAnalysisMode,
  ignoreBasicWords,
  setIgnoreBasicWords
}) {
  return (
    <section className="panel small-panel">
      <div className="panel-title">
        <h2>分析设置</h2>
        <span>更准确 / 更友好</span>
      </div>

      <div className="analysis-setting-block">
        <div className="setting-title">分析模式</div>
        <div className="analysis-mode-group">
          <label className="radio-row">
            <input
              type="radio"
              name="analysisMode"
              checked={analysisMode === "friendly"}
              onChange={() => setAnalysisMode("friendly")}
            />
            <span>普通学习模式</span>
            <em>词库外 / 未收录，结果更友好</em>
          </label>

          <label className="radio-row">
            <input
              type="radio"
              name="analysisMode"
              checked={analysisMode === "strict"}
              onChange={() => setAnalysisMode("strict")}
            />
            <span>严格词库模式</span>
            <em>未在所选词库中的词显示为“超纲”</em>
          </label>
        </div>
      </div>

      <label className="check-row include-extra">
        <input
          type="checkbox"
          checked={ignoreBasicWords}
          onChange={(event) => setIgnoreBasicWords(event.target.checked)}
        />
        <span>忽略基础功能词</span>
        <em>默认开启</em>
      </label>
    </section>
  );
}

function HomeConfigurationPage({
  section,
  libraries,
  selectedLibraryIds,
  setSelectedLibraryIds,
  includeExtra,
  setIncludeExtra,
  analysisMode,
  setAnalysisMode,
  ignoreBasicWords,
  setIgnoreBasicWords
}) {
  const isLibraries = section === "libraries";

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>{isLibraries ? "参与分析词库" : "分析设置"}</h1>
          <p>{isLibraries ? "选择本次阅读诊断所使用的词库。" : "调整阅读诊断的识别规则。"}</p>
        </div>
      </div>
      {isLibraries ? (
        <LibrarySelector libraries={libraries} selectedLibraryIds={selectedLibraryIds} setSelectedLibraryIds={setSelectedLibraryIds} includeExtra={includeExtra} setIncludeExtra={setIncludeExtra} />
      ) : (
        <AnalysisSettings analysisMode={analysisMode} setAnalysisMode={setAnalysisMode} ignoreBasicWords={ignoreBasicWords} setIgnoreBasicWords={setIgnoreBasicWords} />
      )}
    </div>
  );
}

function StatsPanel({ stats, analysisMode }) {
  const outsideTitle = analysisMode === "strict" ? "超纲" : "词库外/未收录";

  const cards = [
    { label: "总词数", value: stats.totalTokens, className: "blue" },
    { label: "不重复词数", value: stats.uniqueWords, className: "blue" },
    { label: "本篇认识", value: stats.recognized, className: "known" },
    { label: "本篇模糊", value: stats.fuzzy, className: "fuzzy" },
    { label: "本篇未掌握", value: stats.unmastered, className: "unknown" },
    { label: "主词库命中", value: stats.mainHits, className: "blue" },
    { label: "补充词库命中", value: stats.extraHits, className: "purple" },
    { label: outsideTitle, value: stats.outsideVocab, className: "purple" },
    { label: "基础忽略词", value: stats.ignoredBasics, className: "gray" },
    { label: "主词库重点词", value: stats.mainFocus, className: "blue" }
  ];

  return (
    <div className="stats-grid stats-grid-extended">
      {cards.map((card) => (
        <div key={card.label} className={`stat-card ${card.className}`}>
          <div className="stat-value">{card.value ?? 0}</div>
          <div className="stat-label">{card.label}</div>
        </div>
      ))}
    </div>
  );
}

function DetailSection({ title, fullWidth = false, children }) {
  return (
    <section className={`detail-section ${fullWidth ? "full-width" : ""}`}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function PronunciationSection({ ipa, audioUrl, word }) {
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && word;
  const speak = () => {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  };
  return (
    <DetailSection title="发音">
      <div className="detail-item"><span className="detail-item-label">音标</span><span className="ipa-text">{ipa || "暂无音标"}</span></div>
      <div className="pronunciation-actions">
        {audioUrl ? <audio controls preload="none" src={audioUrl}>当前浏览器不支持音频播放。</audio> : null}
        <button type="button" className="ghost-btn mini-ghost-btn" onClick={speak} disabled={!canSpeak}>{canSpeak ? "浏览器朗读" : "暂无可用音频"}</button>
      </div>
      {!audioUrl ? <div className="detail-tip">未提供可靠音频链接，已保留音频字段并可使用浏览器朗读。</div> : null}
    </DetailSection>
  );
}

function AIWordResult({ result, wordMeta }) {
  if (!result) return null;

  const posDetails = normalizePosDetails(result);
  const derivatives = normalizeDerivativeDetails(result);
  const libraryPos = wordMeta?.pos;
  const libraryIpa = wordMeta?.ipa;
  const audioUrl = result.audioUrl || wordMeta?.audioUrl;

  return (
    <div className="detail-grid">
      <DetailSection title="基本信息">
        <div className="detail-item">
          <span className="detail-item-label">原词</span>
          <span>{result.word || wordMeta?.word || wordMeta?.displayText || "暂无"}</span>
        </div>
        <div className="detail-item">
          <span className="detail-item-label">lemma</span>
          <span>{result.lemma || wordMeta?.lemma || "暂无"}</span>
        </div>
        <div className="detail-item">
          <span className="detail-item-label">中文翻译</span>
          <span>{result.meaning || wordMeta?.meaning || "暂无"}</span>
        </div>
        </DetailSection>
        <PronunciationSection ipa={result.ipa || libraryIpa} audioUrl={audioUrl} word={result.word || wordMeta?.word} />

      <DetailSection title="词库信息">
        <div className="detail-item">
          <span className="detail-item-label">来源</span>
          <span>
            {wordMeta?.outside
              ? wordMeta.outsideText
              : wordMeta?.sourceText || wordMeta?.libraryName || "暂无"}
          </span>
        </div>
        {wordMeta?.libraryType !== "extra" ? <div className="detail-item">
          <span className="detail-item-label">位置</span>
          <span>
            {wordMeta?.unit
              ? `${wordMeta.unit}${wordMeta.page ? ` / p.${wordMeta.page}` : ""}`
              : "暂无"}
          </span>
        </div> : null}
        <div className="detail-item">
          <span className="detail-item-label">等级</span>
          <span>
            {typeof wordMeta?.level === "number"
              ? `${wordMeta.level} · ${wordMeta.levelLabel || ""}`
              : "暂无"}
          </span>
        </div>
        {wordMeta?.libraryType !== "extra" ? <div className="detail-item">
          <span className="detail-item-label">书内频率</span>
          <span>{wordMeta?.frequencyText || "暂无"}</span>
        </div> : null}
      </DetailSection>

      <DetailSection title="词性">
        {posDetails.length === 0 ? (
          <div className="detail-empty">暂无词性信息</div>
        ) : (
          <div className="detail-list">
            {posDetails.map((item, index) => (
              <div key={`${item.en}-${item.zh}-${index}`} className="pos-row">
                <span className="pos-chip">{item.en || "未标注"}</span>
                <span>{item.zh || "暂无中文说明"}</span>
              </div>
            ))}
          </div>
        )}
        {libraryPos ? <div className="detail-tip">词库导入词性：{libraryPos}</div> : null}
      </DetailSection>

      <DetailSection title="词频">
        <div className="detail-item">
          <span className="detail-item-label">AI 词频</span>
          <span>{getAiFrequencyLabel(result)}</span>
        </div>
        <div className="detail-tip">
          这里显示的是 AI 判断的高考英语词频，不等于词库中的“书高频 / 书低频”。
        </div>
      </DetailSection>

      <DetailSection title="派生词">
        {derivatives.length === 0 ? (
          <div className="detail-empty">暂无派生词信息</div>
        ) : (
          <div className="detail-list">
            {derivatives.map((item, index) => (
              <div key={`${item.word}-${index}`} className="derivative-row">
                <div className="derivative-title"><strong>{item.word || "未命名"}</strong>{item.source === "ai" ? <span className="ai-source-badge">AI 补充</span> : null}</div>
                {item.relation ? <span className="derivative-relation">{item.relation}</span> : null}
                <span>{item.meaning || "暂无中文翻译"}</span>
              </div>
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection title="例句" fullWidth>
        <div className="detail-item">
          <span className="detail-item-label">英文例句</span>
          <span>{result.example || "暂无"}</span>
        </div>
        <div className="detail-item">
          <span className="detail-item-label">例句翻译</span>
          <span>{result.exampleTranslation || "暂无"}</span>
        </div>
      </DetailSection>
    </div>
  );
}

function WordDetailPanel({
  word,
  aiEntry,
  loading,
  error,
  onQuery,
  onRefresh,
  onClose,
  onAddToExtra
}) {
  if (!word) return null;

  return (
    <div className="word-detail-panel">
      <div className="word-detail-header">
        <div className="word-detail-title">
          <h3>{word.displayText || word.word || word.lemma || "词详情"}</h3>
          <div className="word-detail-subtitle">
            {word.basicIgnored
              ? "基础词"
              : word.selectionMark
              ? `当前标记：${MARK_LABEL[word.selectionMark] || word.selectionMark}`
              : "点击单词后查看详情"}
          </div>
        </div>

        <div className="word-detail-actions">
          <button
            type="button"
            className="mini-btn"
            onClick={onQuery}
            disabled={loading}
          >
            {loading ? "正在生成解析..." : "AI解析"}
          </button>
          <button
            type="button"
            className="ghost-btn mini-ghost-btn"
            onClick={onRefresh}
            disabled={loading}
          >
            刷新
          </button>
          {onAddToExtra ? <button type="button" className="secondary-btn mini-ghost-btn" onClick={onAddToExtra}>加入补充</button> : null}
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="收起"
          >
            ⌃
          </button>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="loading-inline">正在生成解析...</div> : null}

      {!aiEntry?.data ? (
        <div className="detail-grid">
          <PronunciationSection ipa={word.ipa} audioUrl={word.audioUrl} word={word.word || word.lemma} />
          {word.pos ? <DetailSection title="词性"><div className="detail-item"><span>{word.pos}</span></div></DetailSection> : null}
        </div>
      ) : null}
      {word.locations?.length ? <DetailSection title="教材位置"><div className="tag-row">{word.locations.map((location, index) => <span key={`${location.unit}-${location.page}-${index}`} className="tag">{location.unit || "未标注单元"}{location.page ? ` · p.${location.page}` : ""}</span>)}</div></DetailSection> : null}
      {word.customFields && Object.keys(word.customFields).length ? <DetailSection title="自定义字段"><div className="meta-list">{Object.entries(word.customFields).map(([key, value]) => <div key={key}><strong>{key}</strong><span>{String(value)}</span></div>)}</div></DetailSection> : null}

      {aiEntry?.data ? (
        <AIWordResult result={aiEntry.data} wordMeta={word} />
      ) : (
        <div className="empty-state compact-empty">
          已打开词详情。点击“AI解析”生成这个词的词性、派生词、例句和高考词频信息。
        </div>
      )}
    </div>
  );
}

function ChatSidebar({ sessions, selectedChatId, onSelect, onCreate, onDelete }) {
  const orderedSessions = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <aside className="panel chat-sidebar-panel">
      <div className="panel-title">
        <h2>对话列表</h2>
        <span>{sessions.length} 个</span>
      </div>

      <div className="chat-sidebar-actions">
        <button type="button" className="primary-btn" onClick={onCreate}>
          新开对话
        </button>
      </div>

      <div className="chat-session-list">
        {orderedSessions.map((session) => (
          <div
            key={session.id}
            className={`chat-session-item ${
              selectedChatId === session.id ? "active" : ""
            }`}
          >
            <button
              type="button"
              className="chat-session-main"
              onClick={() => onSelect(session.id)}
            >
              <div className="chat-session-title">{session.title || "未命名对话"}</div>
              <div className="chat-session-meta">
                {formatDateTime(session.updatedAt) || "刚刚更新"}
              </div>
            </button>

            <button
              type="button"
              className="chat-session-delete"
              onClick={() => onDelete(session.id)}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ChatMessage({ role, content, files, cached, updatedAt }) {
  return (
    <div className={`chat-message ${role === "user" ? "user" : "assistant"}`}>
      <div className="chat-role">{role === "user" ? "你" : "AI"}</div>
      <div className="chat-bubble">
        {files?.length ? (
          <div className="chat-files">
            {files.map((file) => (
              <span key={file.name} className="tag">
                {file.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="chat-content">{content}</div>
        {updatedAt ? (
          <div className="chat-meta">
            {cached ? "缓存结果" : "新生成"} · {updatedAt}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChatWindow({ session, loading }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [session?.messages, loading]);

  return (
    <div ref={containerRef} className="chat-window-scroll">
      {!session?.messages?.length ? (
        <div className="chat-empty-window">
          <div>
            <div>还没有聊天记录。</div>
            <div>你可以先输入问题，或上传文件后开始新对话。</div>
          </div>
        </div>
      ) : (
        <div className="chat-history">
          {session.messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              files={message.files}
              cached={message.cached}
              updatedAt={message.updatedAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatComposer({
  inputMessage,
  setInputMessage,
  selectedFiles,
  setSelectedFiles,
  loading,
  onSend,
  onSendFresh
}) {
  return (
    <div className="chat-composer">
      <textarea
        className="text-input"
        placeholder="请输入你的问题，例如：请帮我总结文章、提取重点词、解释文件内容。"
        value={inputMessage}
        onChange={(event) => setInputMessage(event.target.value)}
      />

      <div className="chat-composer-actions">
        <input
          className="file-input"
          type="file"
          accept={CHAT_FILE_ACCEPT}
          multiple
          onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
        />

        <button
          type="button"
          className="primary-btn"
          onClick={onSend}
          disabled={loading}
        >
          {loading ? "发送中..." : "发送"}
        </button>

        <button
          type="button"
          className="ghost-btn"
          onClick={onSendFresh}
          disabled={loading}
        >
          发送并跳过缓存
        </button>
      </div>

      {selectedFiles.length > 0 ? (
        <div className="chat-files-picker">
          {selectedFiles.map((file) => (
            <span key={file.name} className="tag">
              {file.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="upload-tips">
        支持上传：txt、md、csv、json、docx、pdf、xlsx、py、js、ts、jsx、tsx、html、css、xml、yaml、yml、log
      </div>
    </div>
  );
}

function HomePage({
  libraries,
  refreshLibraries,
  selectedLibraryIds,
  setSelectedLibraryIds,
  includeExtra,
  setIncludeExtra,
  setNeedLibraryRefresh,
  wordAiCache,
  fetchWordAi,
  clearWordAiCache,
  aiSettings,
  analysisMode,
  ignoreBasicWords
}) {
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState([]);
  const [selectionMode, setSelectionMode] = useState("known");
  const [isDragging, setIsDragging] = useState(false);
  const [dragMark, setDragMark] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyLemma, setBusyLemma] = useState("");
  const [articleTranslation, setArticleTranslation] = useState("");
  const [articleTranslationLoading, setArticleTranslationLoading] = useState(false);
  const [articleTranslationMeta, setArticleTranslationMeta] = useState({
    cached: false,
    updatedAt: ""
  });

  const [selectedTokenId, setSelectedTokenId] = useState(null);
  const [wordDetailLoadingKey, setWordDetailLoadingKey] = useState("");
  const [wordDetailError, setWordDetailError] = useState("");

  const [selectedFocusKey, setSelectedFocusKey] = useState("");
  const [focusDetailLoadingKey, setFocusDetailLoadingKey] = useState("");
  const [focusDetailError, setFocusDetailError] = useState("");

  useEffect(() => {
    const stopDragging = () => {
      setIsDragging(false);
      setDragMark(null);
    };

    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, []);

  useEffect(() => {
    if (selectedTokenId == null) return;
    if (!tokens.some((token) => token.id === selectedTokenId)) {
      setSelectedTokenId(null);
    }
  }, [tokens, selectedTokenId]);

  useEffect(() => {
    if (!analysis?.focusWords?.length) {
      setSelectedFocusKey("");
      return;
    }
    if (!analysis.focusWords.some((word) => word.lemma === selectedFocusKey)) {
      setSelectedFocusKey("");
    }
  }, [analysis, selectedFocusKey]);

  const wordCount = useMemo(
    () => tokens.filter((token) => token.isWord).length,
    [tokens]
  );

  const selectedToken = useMemo(
    () => tokens.find((token) => token.id === selectedTokenId) || null,
    [tokens, selectedTokenId]
  );

  const selectedWordDetail = useMemo(
    () => (selectedToken ? buildWordDetailFromToken(selectedToken) : null),
    [selectedToken]
  );

  const selectedWordAiKey = getWordAiKey(selectedWordDetail);
  const selectedWordAiEntry = selectedWordAiKey
    ? wordAiCache[selectedWordAiKey]
    : null;

  const selectedFocusWord = useMemo(
    () => analysis?.focusWords?.find((word) => word.lemma === selectedFocusKey) || null,
    [analysis, selectedFocusKey]
  );

  const selectedFocusDetail = useMemo(
    () => (selectedFocusWord ? buildWordDetailFromFocusWord(selectedFocusWord) : null),
    [selectedFocusWord]
  );

  const selectedFocusAiKey = getWordAiKey(selectedFocusDetail);
  const selectedFocusAiEntry = selectedFocusAiKey
    ? wordAiCache[selectedFocusAiKey]
    : null;
  const activeHomeDetail = selectedFocusDetail || selectedWordDetail;
  const activeHomeAiKey = selectedFocusDetail ? selectedFocusAiKey : selectedWordAiKey;
  const activeHomeAiEntry = selectedFocusDetail ? selectedFocusAiEntry : selectedWordAiEntry;

  const applyMark = (tokenId, mark) => {
    setTokens((prev) =>
      prev.map((token) =>
        token.id === tokenId ? { ...token, mark, analysis: null } : token
      )
    );
    setAnalysis(null);
    setSelectedFocusKey("");
  };

  const handlePaintStart = (token) => {
    if (!token.isWord) return;
    setError("");
    setIsDragging(true);
    setDragMark(selectionMode);
    applyMark(token.id, selectionMode);
  };

  const handlePaintEnter = (token) => {
    if (!isDragging || !dragMark || !token.isWord) return;
    applyMark(token.id, dragMark);
  };

  const handleOpenWordDetail = (token) => {
    if (!token.isWord) return;
    setSelectedTokenId((prev) => (prev === token.id ? null : token.id));
    setWordDetailError("");
  };

  const handleWordDetailQuery = async (forceRefresh = false) => {
    if (!selectedWordDetail) return;
    const key = getWordAiKey(selectedWordDetail);
    if (!key) return;

    setWordDetailLoadingKey(key);
    setWordDetailError("");

    try {
      if (forceRefresh) {
        clearWordAiCache(key);
      }

      await fetchWordAi({
        key,
        word: selectedWordDetail.lemma || selectedWordDetail.word,
        context: text || null,
        libraryContext: {
          libraryName: selectedWordDetail.libraryName,
          unit: selectedWordDetail.unit,
          page: selectedWordDetail.page,
          locations: selectedWordDetail.locations,
          meaning: selectedWordDetail.meaning,
          customFields: selectedWordDetail.customFields
        },
        forceRefresh
      });
    } catch (error) {
      setWordDetailError(`AI 解析失败：${error.message}`);
    } finally {
      setWordDetailLoadingKey("");
    }
  };

  const handleFocusCardSelect = (word) => {
    setSelectedFocusKey((prev) => (prev === word.lemma ? "" : word.lemma));
    setFocusDetailError("");
  };

  const handleFocusDetailQuery = async (forceRefresh = false) => {
    if (!selectedFocusDetail) return;
    const key = getWordAiKey(selectedFocusDetail);
    if (!key) return;

    setFocusDetailLoadingKey(key);
    setFocusDetailError("");

    try {
      if (forceRefresh) {
        clearWordAiCache(key);
      }

      await fetchWordAi({
        key,
        word: selectedFocusDetail.lemma || selectedFocusDetail.word,
        context: text || null,
        libraryContext: {
          libraryName: selectedFocusDetail.libraryName,
          unit: selectedFocusDetail.unit,
          page: selectedFocusDetail.page,
          locations: selectedFocusDetail.locations,
          meaning: selectedFocusDetail.meaning,
          customFields: selectedFocusDetail.customFields
        },
        forceRefresh
      });
    } catch (error) {
      setFocusDetailError(`AI 解析失败：${error.message}`);
    } finally {
      setFocusDetailLoadingKey("");
    }
  };

  const handleTextChange = (event) => {
    const nextText = event.target.value;
    setText(nextText);
    setTokens(tokenizeText(nextText));
    setAnalysis(null);
    setError("");
    setArticleTranslation("");
    setSelectedTokenId(null);
    setWordDetailError("");
    setSelectedFocusKey("");
    setFocusDetailError("");
  };

  const handleLoadSample = () => {
    setText(SAMPLE_TEXT);
    setTokens(tokenizeText(SAMPLE_TEXT));
    setAnalysis(null);
    setError("");
    setArticleTranslation("");
    setSelectedTokenId(null);
    setWordDetailError("");
    setSelectedFocusKey("");
    setFocusDetailError("");
  };

  const handleClear = () => {
    setText("");
    setTokens([]);
    setAnalysis(null);
    setError("");
    setArticleTranslation("");
    setSelectedTokenId(null);
    setWordDetailError("");
    setSelectedFocusKey("");
    setFocusDetailError("");
  };

  const runAnalyze = async () => {
    const payloadTokens = tokens.map(({ id, text, isWord }) => ({
      id,
      text,
      isWord
    }));

    const tokenMarks = Object.fromEntries(
      tokens
        .filter((token) => token.isWord)
        .map((token) => [String(token.id), token.mark])
    );

    const result = await postJson("/api/analyze", {
      tokens: payloadTokens,
      tokenMarks,
      selectedLibraryIds,
      includeExtra,
      analysisMode,
      ignoreBasicWords
    });

    const analyzedMap = new Map(result.tokens.map((item) => [item.id, item]));

    setTokens((prev) =>
      prev.map((token) => ({
        ...token,
        analysis: analyzedMap.get(token.id) ?? null
      }))
    );

    setAnalysis(result);
    setNeedLibraryRefresh((value) => value + 1);
    setSelectedFocusKey("");
    setFocusDetailError("");
  };

  const handleAnalyze = async () => {
    if (!tokens.length) {
      setError("请先输入一段英文阅读。");
      return;
    }

    if (selectedLibraryIds.length === 0 && !includeExtra) {
      setError("请先选择至少一个词库。");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await runAnalyze();
    } catch (error) {
      setError(`分析失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddExtraWord = async (word) => {
    setBusyLemma(word.lemma);
    setError("");

    try {
      await postJson("/api/extra-vocab/add", {
        word: word.lemma || word.displayText,
        level: word.suggestedLevel || 1,
        frequency: word.frequency === "high" ? "high" : "low",
        meaning: word.meaning || null,
        libraryId: null
      });
      await refreshLibraries();
      await runAnalyze();
    } catch (error) {
      setError(`加入补充词库失败：${error.message}`);
    } finally {
      setBusyLemma("");
    }
  };

  const handleArticleTranslate = async (forceRefresh = false) => {
    if (!text.trim()) {
      setError("请先输入文章再进行 AI 翻译。");
      return;
    }

    setArticleTranslationLoading(true);
    setError("");

    try {
      const result = await postJson("/api/ai/article-translate", {
        text,
        forceRefresh,
        settings: buildAISettingsPayload(aiSettings)
      });

      setArticleTranslation(result.translation || "");
      setArticleTranslationMeta({
        cached: !!result.cached,
        updatedAt: result.updatedAt || ""
      });
    } catch (error) {
      setError(`AI 翻译失败：${error.message}`);
    } finally {
      setArticleTranslationLoading(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>英语阅读词汇诊断 MVP</h1>
          <p>选择参与分析的词库，然后标记文章中的单词。</p>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary-btn" onClick={handleLoadSample}>
            加载示例
          </button>
          <button type="button" className="ghost-btn" onClick={handleClear}>
            清空
          </button>
        </div>
      </div>

      <div className="layout-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>1. 输入阅读并涂色</h2>
            <span>总词数 {wordCount}</span>
          </div>

          <textarea
            className="text-input"
            placeholder="请粘贴英语阅读文本..."
            value={text}
            onChange={handleTextChange}
          />

          <div className="upload-row article-ai-row">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => handleArticleTranslate(false)}
              disabled={articleTranslationLoading}
            >
              {articleTranslationLoading ? "翻译中..." : "AI 翻译全文"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => handleArticleTranslate(true)}
              disabled={articleTranslationLoading}
            >
              重新生成翻译
            </button>
            {articleTranslationMeta.updatedAt ? (
              <span className="small-tip">
                {articleTranslationMeta.cached ? "缓存结果" : "新生成"} · {articleTranslationMeta.updatedAt}
              </span>
            ) : null}
          </div>

          {articleTranslation ? (
            <div className="article-translation-box">
              <div className="glossary-title">AI 文章翻译</div>
              <pre className="glossary-content">{articleTranslation}</pre>
            </div>
          ) : null}

          <div className="mode-toolbar">
            <button
              type="button"
              className="mode-btn"
              style={selectionMode === "known" ? MODE_THEME.known : {}}
              onClick={() => setSelectionMode("known")}
            >
              认识模式
            </button>
            <button
              type="button"
              className="mode-btn"
              style={selectionMode === "fuzzy" ? MODE_THEME.fuzzy : {}}
              onClick={() => setSelectionMode("fuzzy")}
            >
              模糊模式
            </button>
            <button
              type="button"
              className="mode-btn"
              style={selectionMode === "unknown" ? MODE_THEME.unknown : {}}
              onClick={() => setSelectionMode("unknown")}
            >
              未掌握模式
            </button>
          </div>

          <div className="legend">
            <span className="legend-chip known">绿色：认识</span>
            <span className="legend-chip fuzzy">黄色：模糊</span>
            <span className="legend-chip unknown">红色：未掌握</span>
            <span className="legend-chip basic">灰色：基础词</span>
            <span className="legend-note">可以单击，也可以按住拖拽连续涂色；点击词块可展开详情</span>
          </div>

          <div className="panel-title compact">
            <h2>2. 词块标记区</h2>
            <button
              type="button"
              className="primary-btn"
              onClick={handleAnalyze}
              disabled={loading}
            >
              {loading ? "分析中..." : "开始分析"}
            </button>
          </div>

          <div className="token-stage">
            {tokens.length === 0 ? (
              <div className="empty-state">输入英文后，这里会出现可点击的小方块。</div>
            ) : (
              tokens.map((token) => {
                if (!token.isWord) {
                  return (
                    <span key={token.id} className="plain-token">
                      {token.text}
                    </span>
                  );
                }

                const miniInfo = buildTokenMiniInfo(token);
                const miniMeaning = buildTokenMeaning(token);
                const tokenClass = token.analysis?.basicIgnored
                  ? "token-basic"
                  : `token-${token.mark}`;

                return (
                  <button
                    key={token.id}
                    type="button"
                    className={`word-token ${tokenClass} ${selectedTokenId === token.id ? "token-selected" : ""}`}
                    title={buildTokenTitle(token)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handlePaintStart(token);
                    }}
                    onMouseEnter={() => handlePaintEnter(token)}
                    onClick={() => handleOpenWordDetail(token)}
                  >
                    <span className="word-main">{token.text}</span>
                    <span className="word-mark">
                      {token.analysis?.basicIgnored ? "基础词" : MARK_LABEL[token.mark]}
                    </span>
                    {miniInfo ? <span className="word-extra">{miniInfo}</span> : null}
                    {miniMeaning ? <span className="word-meaning">{miniMeaning}</span> : null}
                  </button>
                );
              })
            )}
          </div>

          {analysis?.articleGlossaryText ? (
            <div className="glossary-box">
              <div className="glossary-title">文章词义参考</div>
              <pre className="glossary-content">{analysis.articleGlossaryText}</pre>
            </div>
          ) : null}

          {error ? <div className="error-box">{error}</div> : null}
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>3. 分析结果</h2>
            <span>{analysisMode === "strict" ? "严格词库模式" : "普通学习模式"}</span>
          </div>

          {!analysis ? (
            <div className="empty-result">
              <p>还没有分析结果。</p>
              <p>先选择词库、设置模式、涂色，再点击“开始分析”。</p>
            </div>
          ) : (
            <>
              <StatsPanel stats={analysis.stats} analysisMode={analysis.analysisMode} />

              <div className="panel-subtitle">重点词清单</div>
              <div className="focus-list">
                {analysis.focusWords.length === 0 ? (
                  <div className="empty-state">这篇里没有需要优先处理的重点词。</div>
                ) : (
                  analysis.focusWords.map((word) => {
                    const selected = selectedFocusKey === word.lemma;

                    return (
                      <div
                        key={word.lemma}
                        className="focus-card"
                        style={{
                          cursor: "pointer",
                          borderColor: selected ? "#4f46e5" : undefined,
                          boxShadow: selected
                            ? "0 0 0 2px rgba(79, 70, 229, 0.14)"
                            : undefined
                        }}
                        onClick={() => handleFocusCardSelect(word)}
                      >
                        <div className="focus-main">
                          <div className="focus-word">
                            {word.displayText} <span>× {word.count}</span>
                          </div>
                          <div className="focus-meta">{buildFocusMeta(word)}</div>
                          {word.meaning ? (
                            <div className="focus-meaning">{word.meaning}</div>
                          ) : null}
                          <div className="upload-tips">
                            点击卡片展开详情与 AI 解析
                          </div>

                        </div>

                        <div className="focus-side" onClick={(event) => event.stopPropagation()}>
                          {word.canAddToExtra ? (
                            <button
                              type="button"
                              className="mini-btn"
                              onClick={() => handleAddExtraWord(word)}
                              disabled={busyLemma === word.lemma}
                            >
                              {busyLemma === word.lemma ? "加入中..." : "加入补充词库"}
                            </button>
                          ) : (
                            <span className="tag">
                              {word.libraryType === "extra" ? "补充词库" : "主词库"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {activeHomeDetail ? (
        <aside className="library-detail-drawer">
          <WordDetailPanel
            word={activeHomeDetail}
            aiEntry={activeHomeAiEntry}
            loading={wordDetailLoadingKey === activeHomeAiKey || focusDetailLoadingKey === activeHomeAiKey}
            error={selectedFocusDetail ? focusDetailError : wordDetailError}
            onQuery={() => selectedFocusDetail ? handleFocusDetailQuery(false) : handleWordDetailQuery(false)}
            onRefresh={() => selectedFocusDetail ? handleFocusDetailQuery(true) : handleWordDetailQuery(true)}
            onClose={() => { setSelectedTokenId(null); setSelectedFocusKey(""); }}
            onAddToExtra={() => handleAddExtraWord(selectedFocusWord || activeHomeDetail)}
          />
        </aside>
      ) : null}
    </div>
  );
}

function MasteryOverview({ overview }) {
  const levels = overview?.levels ?? {};
  return (
    <div className="mastery-grid">
      {Array.from({ length: 13 }, (_, index) => index).map((level) => (
        <div key={level} className={`mastery-card ${levelClass(level)}`}>
          <div className="mastery-level">{level}</div>
          <div className="mastery-name">{LEVEL_LABEL[level]}</div>
          <div className="mastery-value">{levels[String(level)] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

function BasicWhitelistPage() {
  const [library, setLibrary] = useState(null);
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const fetchBasicWords = async () => {
    setLoading(true);
    setError("");

    try {
      const result = await getJson("/api/basic-words");
      setLibrary(result.library);
      setWords(result.words || []);
    } catch (error) {
      setError(`读取基础词白名单失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBasicWords();
  }, []);

  const handleAdd = async () => {
    const rawItems = inputValue
      .split(/[\n,，;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (rawItems.length === 0) {
      setError("请先输入要加入白名单的单词。");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result = await postJson("/api/basic-words/add", {
        words: rawItems
      });

      setMessage(`成功加入 ${result.count} 个基础词。`);
      setInputValue("");
      await fetchBasicWords();
    } catch (error) {
      setError(`添加失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (lemma) => {
    if (!window.confirm(`确定从白名单移除“${lemma}”吗？`)) return;
    try {
      await postJson("/api/basic-words/delete", { words: [lemma] });
      setMessage(`已移除 ${lemma}。`);
      await fetchBasicWords();
    } catch (error) {
      setError(`移除失败：${error.message}`);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("确定清空自定义基础词白名单吗？此操作不可恢复。")) return;
    try {
      await postJson("/api/basic-words/reset", {});
      setMessage("基础词白名单已清空。");
      await fetchBasicWords();
    } catch (error) {
      setError(`清空失败：${error.message}`);
    }
  };

  const visibleWords = words.filter((word) => `${word.lemma} ${word.meaning || ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>基础词白名单</h2>
        <span>{library?.count ?? 0} 词</span>
      </div>

      <div className="upload-row">
        <textarea
          className="text-input basic-words-input"
          placeholder="输入单词后添加到基础词白名单，支持空格、逗号、换行分隔"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
        />
      </div>

      <div className="upload-row">
        <button
          type="button"
          className="primary-btn"
          onClick={handleAdd}
          disabled={saving}
        >
          {saving ? "添加中..." : "添加基础词"}
        </button>
      </div>

      <div className="upload-tips">
        分析时若开启“忽略基础功能词”，白名单中的词会按基础词处理。可随时检索、移除或清空。
      </div>

      <div className="search-filter-bar">
        <input className="search-input" placeholder="搜索白名单单词或释义" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="danger-btn" onClick={handleReset}>清空白名单</button>
      </div>

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {loading ? (
        <div className="empty-state">加载中...</div>
      ) : (
        <div className="word-grid">
          {visibleWords.map((word, index) => (
            <div
              key={`${word.lemma}-${index}`}
              className="vocab-card level-bg-0"
              title={`${word.lemma}\n${word.meaning || "基础功能词"}`}
            >
              <div className="vocab-word">{word.lemma}</div>
              <div className="vocab-meta">{word.meaning || "基础功能词"}</div>
              <div className="vocab-level">白名单</div>
              <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => handleDelete(word.lemma)}>移除</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryWordsPage({
  libraries,
  refreshLibraries,
  needLibraryRefresh,
  wordAiCache,
  fetchWordAi,
  clearWordAiCache
}) {
  const mainLibraries = libraries.filter((lib) => lib.type === "main");
  const extraLibraries = libraries.filter((lib) => lib.type === "extra");

  const [viewMode, setViewMode] = useState("merged");
  const [selectedSingleLibraryId, setSelectedSingleLibraryId] = useState("");
  const [selectedExtraLibraryId, setSelectedExtraLibraryId] = useState("");
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [wordData, setWordData] = useState({
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
    overview: { levels: {}, trackedWords: 0 }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedCardKey, setSelectedCardKey] = useState("");
  const [detailLoadingKey, setDetailLoadingKey] = useState("");
  const [detailError, setDetailError] = useState("");
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewMessage, setReviewMessage] = useState("");

  const activeLibraryId = selectedSingleLibraryId || mainLibraries[0]?.id || "";
  const activeExtraLibraryId = selectedExtraLibraryId || extraLibraries[0]?.id || "";

  useEffect(() => {
    if (!selectedSingleLibraryId && mainLibraries.length > 0) {
      setSelectedSingleLibraryId(mainLibraries[0].id);
    }
  }, [mainLibraries, selectedSingleLibraryId]);

  useEffect(() => {
    if (!selectedExtraLibraryId && extraLibraries.length > 0) {
      setSelectedExtraLibraryId(extraLibraries[0].id);
    }
  }, [extraLibraries, selectedExtraLibraryId]);

  useEffect(() => {
    setPage(1);
  }, [viewMode, selectedSingleLibraryId, selectedExtraLibraryId, query, levelFilter]);

  useEffect(() => {
    fetchWords();
  }, [
    viewMode,
    selectedSingleLibraryId,
    selectedExtraLibraryId,
    query,
    levelFilter,
    page,
    libraries,
    needLibraryRefresh
  ]);

  useEffect(() => {
    if (!selectedCardKey) return;
    const exists = wordData.items.some(
      (word) => `${word.libraryId}-${word.lemma}` === selectedCardKey
    );
    if (!exists) {
      setSelectedCardKey("");
      setDetailError("");
    }
  }, [wordData.items, selectedCardKey]);

  const fetchWords = async () => {
    setLoading(true);
    setError("");

    try {
      let url = "";

      if (viewMode === "merged") {
        const libraryIds = mainLibraries.map((lib) => lib.id).join(",");
        url =
          `/api/libraries/merged/words?libraryIds=${encodeURIComponent(libraryIds)}` +
          `&includeExtra=false&includeBasic=false&page=${page}&pageSize=${PAGE_SIZE}` +
          `&query=${encodeURIComponent(query)}&levelFilter=${encodeURIComponent(levelFilter)}`;
      } else if (viewMode === "extra") {
        if (!activeExtraLibraryId) {
          setWordData({
            items: [],
            page: 1,
            pageSize: PAGE_SIZE,
            total: 0,
            totalPages: 1,
            overview: { levels: {}, trackedWords: 0 }
          });
          return;
        }

        url =
          `/api/libraries/${activeExtraLibraryId}/words?page=${page}&pageSize=${PAGE_SIZE}` +
          `&query=${encodeURIComponent(query)}&levelFilter=${encodeURIComponent(levelFilter)}`;
      } else {
        if (!activeLibraryId) {
          setWordData({
            items: [],
            page: 1,
            pageSize: PAGE_SIZE,
            total: 0,
            totalPages: 1,
            overview: { levels: {}, trackedWords: 0 }
          });
          return;
        }

        url =
          `/api/libraries/${activeLibraryId}/words?page=${page}&pageSize=${PAGE_SIZE}` +
          `&query=${encodeURIComponent(query)}&levelFilter=${encodeURIComponent(levelFilter)}`;
      }

      const result = await getJson(url);
      setWordData(result);
    } catch (error) {
      setError(`读取单词库失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    const ok = window.confirm("确定要重置所有单词的认识情况吗？词库本身不会删除。");
    if (!ok) return;

    setLoading(true);
    setError("");

    try {
      await postJson("/api/user-status/reset", {});
      await refreshLibraries();
      await fetchWords();
    } catch (error) {
      setError(`重置失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectWord = (word) => {
    const nextKey = `${word.libraryId}-${word.lemma}`;
    setSelectedCardKey((prev) => (prev === nextKey ? "" : nextKey));
    setDetailError("");
  };

  const handleExport = () => {
    const libraryId = viewMode === "single" ? activeLibraryId : viewMode === "extra" ? activeExtraLibraryId : "";
    if (!libraryId) {
      setError("请先切换到单个主词库或补充词库后导出。");
      return;
    }
    window.open(`${API_BASE_URL}/api/libraries/${encodeURIComponent(libraryId)}/export`, "_blank", "noopener,noreferrer");
  };

  const handleDeleteLibrary = async () => {
    const libraryId = viewMode === "single" ? activeLibraryId : viewMode === "extra" ? activeExtraLibraryId : "";
    if (!libraryId || (viewMode !== "single" && viewMode !== "extra")) {
      setError("删除仅适用于当前选中的主词库或补充词库。");
      return;
    }
    const library = [...mainLibraries, ...extraLibraries].find((item) => item.id === libraryId);
    if (!window.confirm(`确定删除“${library?.name || "该词库"}”吗？此操作不可恢复。`)) return;
    try {
      await request(`/api/libraries/${encodeURIComponent(libraryId)}?confirm=DELETE`, { method: "DELETE" });
      await refreshLibraries();
      setSelectedCardKey("");
    } catch (error) {
      setError(`删除失败：${error.message}`);
    }
  };

  const loadReview = async () => {
    try {
      const result = await getJson("/api/review/due?limit=12");
      setReviewItems(result.items || []);
      setReviewMessage(result.total ? `已加载 ${result.total} 个待复习词。` : "当前没有待复习词。");
    } catch (error) {
      setError(`加载复习失败：${error.message}`);
    }
  };

  const markReview = async (word, mark) => {
    try {
      await postJson("/api/review/mark", { lemma: word.lemma, mark });
      setReviewItems((prev) => prev.filter((item) => item.lemma !== word.lemma));
      await fetchWords();
    } catch (error) {
      setError(`复习记录失败：${error.message}`);
    }
  };

  const selectedWord =
    wordData.items.find((word) => `${word.libraryId}-${word.lemma}` === selectedCardKey) ||
    null;

  const selectedWordAiKey = getWordAiKey(selectedWord);
  const selectedWordAiEntry = selectedWordAiKey
    ? wordAiCache[selectedWordAiKey]
    : null;

  const handleWordDetailQuery = async (forceRefresh = false) => {
    if (!selectedWord) return;

    const key = getWordAiKey(selectedWord);
    setDetailLoadingKey(key);
    setDetailError("");

    try {
      if (forceRefresh) {
        clearWordAiCache(key);
      }

      await fetchWordAi({
        key,
        word: selectedWord.lemma,
        libraryContext: {
          libraryName: selectedWord.libraryName,
          unit: selectedWord.unit,
          page: selectedWord.page,
          locations: selectedWord.locations,
          meaning: selectedWord.meaning,
          customFields: selectedWord.customFields
        },
        forceRefresh
      });
    } catch (error) {
      setDetailError(`AI 解析失败：${error.message}`);
    } finally {
      setDetailLoadingKey("");
    }
  };

  const handleAddDetailToExtra = async () => {
    if (!selectedWord) return;
    try {
      await postJson("/api/extra-vocab/add", {
        word: selectedWord.lemma,
        frequency: selectedWordAiEntry?.data?.frequency || selectedWord.frequency,
        meaning: selectedWordAiEntry?.data?.meaning || selectedWord.meaning || "",
        libraryId: null
      });
      await refreshLibraries();
      setReviewMessage(`已将 ${selectedWord.lemma} 加入补充词库。`);
    } catch (error) {
      setDetailError(`加入补充词库失败：${error.message}`);
    }
  };

  return (
    <section className="panel">
      <div className="page-header">
        <div>
          <h1>单词库</h1>
          <p>查看主词库、补充词库、合并词库，并管理 0~12 掌握等级。</p>
        </div>
        <button type="button" className="danger-btn" onClick={handleReset}>
          重置认识情况
        </button>
      </div>

      <div className="library-tabs">
        <button
          type="button"
          className={`tab-btn ${viewMode === "merged" ? "active" : ""}`}
          onClick={() => setViewMode("merged")}
        >
          合并查看
        </button>
        <button
          type="button"
          className={`tab-btn ${viewMode === "single" ? "active" : ""}`}
          onClick={() => setViewMode("single")}
        >
          单个主词库
        </button>
        <button
          type="button"
          className={`tab-btn ${viewMode === "extra" ? "active" : ""}`}
          onClick={() => setViewMode("extra")}
        >
          补充词库
        </button>
      </div>

      {viewMode === "single" ? (
        <select
          className="select-input wide-select"
          value={activeLibraryId}
          onChange={(event) => setSelectedSingleLibraryId(event.target.value)}
        >
          {mainLibraries.map((lib) => (
            <option key={lib.id} value={lib.id}>
              {lib.name}，{lib.count} 词
            </option>
          ))}
        </select>
      ) : null}

      {viewMode === "extra" ? (
        <select
          className="select-input wide-select"
          value={activeExtraLibraryId}
          onChange={(event) => setSelectedExtraLibraryId(event.target.value)}
        >
          {extraLibraries.map((lib) => (
            <option key={lib.id} value={lib.id}>
              {lib.name}，{lib.count} 词
            </option>
          ))}
        </select>
      ) : null}

      <div className="search-filter-bar">
        <input
          className="search-input"
          placeholder="搜索单词、Unit、页码、词库名、词义..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <select
          className="select-input"
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value)}
        >
          <option value="all">全部等级</option>
          <option value="0">0 未追踪</option>
          <option value="1">1 不认识</option>
          <option value="2">2 模糊</option>
          <option value="known">3~5 认识</option>
          <option value="stableish">6~11 较稳定</option>
          <option value="12">12 稳定</option>
        </select>
        <button type="button" className="ghost-btn" onClick={handleExport}>导出当前词库</button>
        {viewMode === "single" || viewMode === "extra" ? <button type="button" className="danger-btn" onClick={handleDeleteLibrary}>删除当前词库</button> : null}
        <button type="button" className="secondary-btn" onClick={loadReview}>开始复习</button>
      </div>

      {reviewMessage ? <div className="success-box">{reviewMessage}</div> : null}
      {reviewItems.length ? (
        <div className="review-strip">
          {reviewItems.map((word) => (
            <div key={`${word.libraryId}-${word.lemma}`} className="review-card">
              <strong>{word.lemma}</strong><span>{word.meaning || "暂无释义"}</span>
              <div><button type="button" className="mini-btn" onClick={() => markReview(word, "known")}>认识</button><button type="button" className="ghost-btn mini-ghost-btn" onClick={() => markReview(word, "fuzzy")}>模糊</button><button type="button" className="danger-btn mini-ghost-btn" onClick={() => markReview(word, "unknown")}>不认识</button></div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="panel-subtitle">掌握分布</div>
      <MasteryOverview overview={wordData.overview} />

      <div className="panel-title compact">
        <h2>单词列表</h2>
        <span>
          共 {wordData.total} 个，当前第 {wordData.page} / {wordData.totalPages} 页
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="empty-state">加载中...</div> : null}

      {!loading && wordData.items.length === 0 ? (
        <div className="empty-state">没有找到符合条件的单词。</div>
      ) : (
        <div className="word-grid">
          {wordData.items.map((word) => {
            const cardKey = `${word.libraryId}-${word.lemma}`;

            return (
              <div
                key={cardKey}
                className={`vocab-card clickable ${levelClass(word.level)} ${
                  selectedCardKey === cardKey ? "selected" : ""
                }`}
                title={word.libraryType === "extra"
                  ? `${word.lemma}
词库：${word.libraryName || "补充词库"}
等级：${word.level} ${word.levelLabel}
词义：${word.meaning || ""}`
                  : `${word.lemma}
词库：${word.libraryName || ""}
Unit：${word.unit || ""}
页码：${word.page || ""}
频率：${word.frequencyText || ""}
等级：${word.level} ${word.levelLabel}
词义：${word.meaning || ""}`}
                onClick={() => handleSelectWord(word)}
              >
                <div className="vocab-word">{word.lemma}</div>
                {word.libraryType === "extra" ? <div className="vocab-meta">补充词库</div> : <>
                  <div className="vocab-meta">{word.unit || "无 Unit"}</div>
                  <div className="vocab-meta">
                    {word.page ? `p.${word.page}` : "无页码"} · {word.frequencyText || "暂无频率"}
                  </div>
                </>}
                {word.meaning ? <div className="vocab-meta">{word.meaning}</div> : null}
                <div className="vocab-level">
                  {word.level} · {word.levelLabel}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pagination">
        <button
          type="button"
          className="ghost-btn"
          disabled={wordData.page <= 1}
          onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
        >
          上一页
        </button>
        <span>
          第 {wordData.page} / {wordData.totalPages} 页
        </span>
        <button
          type="button"
          className="ghost-btn"
          disabled={wordData.page >= wordData.totalPages}
          onClick={() => setPage((prev) => prev + 1)}
        >
          下一页
        </button>
      </div>

      {selectedWord ? (
        <aside className="library-detail-drawer">
          <WordDetailPanel
            word={selectedWord}
            aiEntry={selectedWordAiEntry}
            loading={detailLoadingKey === selectedWordAiKey}
            error={detailError}
            onQuery={() => handleWordDetailQuery(false)}
            onRefresh={() => handleWordDetailQuery(true)}
            onClose={() => setSelectedCardKey("")}
            onAddToExtra={handleAddDetailToExtra}
          />
        </aside>
      ) : null}
    </section>
  );
}

function LibraryManagementPage({ libraries, defaultExtraLibraryId, refreshLibraries }) {
  const mainLibraries = libraries.filter((library) => library.type === "main");
  const extraLibraries = libraries.filter((library) => library.type === "extra");
  const [firstSourceId, setFirstSourceId] = useState("");
  const [secondSourceId, setSecondSourceId] = useState("");
  const [mergedName, setMergedName] = useState("");
  const [deleteSources, setDeleteSources] = useState(false);
  const [newExtraName, setNewExtraName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mainLibraries.length < 2) return;
    if (!mainLibraries.some((library) => library.id === firstSourceId)) setFirstSourceId(mainLibraries[0].id);
    if (!mainLibraries.some((library) => library.id === secondSourceId) || secondSourceId === firstSourceId) setSecondSourceId(mainLibraries.find((library) => library.id !== firstSourceId)?.id || mainLibraries[1].id);
  }, [mainLibraries, firstSourceId, secondSourceId]);

  const complete = async (action, successMessage) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refreshLibraries();
      setMessage(successMessage);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = () => {
    if (!firstSourceId || !secondSourceId || firstSourceId === secondSourceId) {
      setError("请选择两个不同的主词库。");
      return;
    }
    if (!mergedName.trim()) {
      setError("请填写合并后词库名称。");
      return;
    }
    if (deleteSources && !window.confirm("合并后将删除两个来源词库。确定继续吗？")) return;
    complete(
      () => postJson("/api/libraries/merge", { sourceLibraryIds: [firstSourceId, secondSourceId], name: mergedName, deleteSources }),
      deleteSources ? "已实质合并并删除来源词库。" : "已创建合并后的新词库，原词库仍被保留。"
    );
  };

  const handleCreateExtra = () => {
    if (!newExtraName.trim()) {
      setError("请填写补充词库名称。");
      return;
    }
    complete(async () => {
      await postJson("/api/extra-libraries", { name: newExtraName });
      setNewExtraName("");
    }, "已创建补充词库。");
  };

  const handleRename = (library) => {
    const name = window.prompt("输入新的词库名称", library.name);
    if (name == null || !name.trim() || name.trim() === library.name) return;
    complete(() => request(`/api/libraries/${encodeURIComponent(library.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }), "词库名称已更新。");
  };

  const handleDefault = (library) => complete(
    () => postJson("/api/extra-libraries/default", { libraryId: library.id }),
    `已将“${library.name}”设为默认补充词库。`
  );

  const handleDelete = (library) => {
    if (!window.confirm(`确定删除补充词库“${library.name}”吗？词条将一并删除。`)) return;
    complete(() => request(`/api/libraries/${encodeURIComponent(library.id)}?confirm=DELETE`, { method: "DELETE" }), "补充词库已删除。");
  };

  return (
    <section className="panel library-management-page">
      <div className="page-header">
        <div><h1>词库管理</h1><p>在此实质合并两个主词库，并维护多个补充词库与默认识别加入位置。</p></div>
      </div>
      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      <section className="management-section">
        <div className="panel-title"><h2>实质合并主词库</h2><span>不会替代“合并查看”</span></div>
        <p className="upload-tips">同一单词会合并教材位置与非空自定义字段；没有重复的词条会完整保留到新词库。</p>
        {mainLibraries.length < 2 ? <div className="warning-box">至少需要两个主词库才能合并。</div> : <>
          <div className="management-form-grid">
            <select className="select-input" value={firstSourceId} onChange={(event) => setFirstSourceId(event.target.value)}>{mainLibraries.map((library) => <option key={library.id} value={library.id}>{library.name}，{library.count} 词</option>)}</select>
            <select className="select-input" value={secondSourceId} onChange={(event) => setSecondSourceId(event.target.value)}>{mainLibraries.filter((library) => library.id !== firstSourceId).map((library) => <option key={library.id} value={library.id}>{library.name}，{library.count} 词</option>)}</select>
            <input className="text-mini-input" placeholder="合并后词库名称" value={mergedName} onChange={(event) => setMergedName(event.target.value)} />
          </div>
          <label className="check-row management-check"><input type="checkbox" checked={deleteSources} onChange={(event) => setDeleteSources(event.target.checked)} /><span>合并成功后删除两个来源词库</span></label>
          <button type="button" className="primary-btn" onClick={handleMerge} disabled={saving}>创建合并词库</button>
        </>}
      </section>

      <section className="management-section">
        <div className="panel-title"><h2>主词库</h2><span>{mainLibraries.length} 个</span></div>
        <div className="management-library-list">
          {mainLibraries.map((library) => <div key={library.id} className="management-library-row">
            <div><strong>{library.name}</strong><span>{library.count} 词</span></div>
            <div className="management-actions">
              <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => handleRename(library)} disabled={saving}>改名</button>
            </div>
          </div>)}
        </div>
      </section>

      <section className="management-section">
        <div className="panel-title"><h2>补充词库</h2><span>{extraLibraries.length} 个</span></div>
        <div className="upload-row">
          <input className="text-mini-input" placeholder="新补充词库名称" value={newExtraName} onChange={(event) => setNewExtraName(event.target.value)} />
          <button type="button" className="secondary-btn" onClick={handleCreateExtra} disabled={saving}>新建补充词库</button>
        </div>
        <div className="management-library-list">
          {extraLibraries.map((library) => <div key={library.id} className="management-library-row">
            <div><strong>{library.name}</strong><span>{library.count} 词 {library.id === defaultExtraLibraryId ? "· 默认识别加入位置" : ""}</span></div>
            <div className="management-actions">
              {library.id !== defaultExtraLibraryId ? <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => handleDefault(library)} disabled={saving}>设为默认</button> : <span className="tag">默认</span>}
              <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => handleRename(library)} disabled={saving}>改名</button>
              <button type="button" className="danger-btn mini-ghost-btn" onClick={() => handleDelete(library)} disabled={saving || library.id === defaultExtraLibraryId || extraLibraries.length <= 1}>删除</button>
            </div>
          </div>)}
        </div>
        <div className="upload-tips">默认补充词库不能删除；请先设定另一个默认库。至少保留一个补充词库。</div>
      </section>
    </section>
  );
}

function LibraryPage({
  libraries,
  defaultExtraLibraryId,
  refreshLibraries,
  needLibraryRefresh,
  wordAiCache,
  fetchWordAi,
  clearWordAiCache,
  aiSettings
}) {
  return (
    <div className="page-content">
      <LibraryWordsPage
        libraries={libraries}
        refreshLibraries={refreshLibraries}
        needLibraryRefresh={needLibraryRefresh}
        wordAiCache={wordAiCache}
        fetchWordAi={fetchWordAi}
        clearWordAiCache={clearWordAiCache}
      />
    </div>
  );
}

function AIChatPage({
  aiSettings,
  providerOptions
}) {
  const [sessions, setSessions] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const result = await getJson("/api/chat/sessions");
        const loaded = result.sessions || [];
        setSessions(loaded);
        if (loaded[0]) setSelectedChatId(loaded[0].id);
        else await handleCreateSession();
      } catch (error) {
        setError(`读取聊天记录失败：${error.message}`);
      }
    };
    loadSessions();
  }, []);

  const currentSession =
    sessions.find((session) => session.id === selectedChatId) || sessions[0] || null;

  const loadSession = async (sessionId) => {
    const result = await getJson(`/api/chat/sessions/${encodeURIComponent(sessionId)}`);
    setSessions((prev) => prev.map((item) => item.id === sessionId ? result.session : item));
    setSelectedChatId(sessionId);
  };

  const handleCreateSession = async () => {
    try {
      const result = await postJson("/api/chat/sessions", { title: "新对话" });
      setSessions((prev) => [result.session, ...prev]);
      setSelectedChatId(result.session.id);
      setError("");
    } catch (error) { setError(`创建对话失败：${error.message}`); }
  };

  const handleDeleteSession = async (sessionId) => {
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return;

    const ok = window.confirm(`确定删除“${target.title}”吗？`);
    if (!ok) return;

    try {
      await request(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);
      if (selectedChatId === sessionId) {
        if (remaining[0]) await loadSession(remaining[0].id);
        else await handleCreateSession();
      }
    } catch (error) { setError(`删除对话失败：${error.message}`); }
  };

  const handleSend = async (forceRefresh = false) => {
    if (!inputMessage.trim()) {
      setError("请输入聊天内容。");
      return;
    }

    if (!currentSession) {
      setError("对话正在初始化，请稍后再试。");
      return;
    }
    const activeSession = currentSession;
    const activeSessionId = activeSession.id;

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("message", inputMessage);
      formData.append("forceRefresh", String(forceRefresh));
      formData.append("settingsJson", JSON.stringify(buildAISettingsPayload(aiSettings)));
      formData.append("sessionId", activeSessionId);

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const result = await postForm("/api/ai/chat", formData);

      await loadSession(activeSessionId);
      const title = currentSession?.title || "新对话";
      if (title === "新对话") {
        const nextTitle = buildChatTitleFromMessage(inputMessage, title);
        await request(`/api/chat/sessions/${encodeURIComponent(activeSessionId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: nextTitle }) });
        await loadSession(activeSessionId);
      }
      setInputMessage("");
      setSelectedFiles([]);
    } catch (error) {
      setError(`AI 对话失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectedProvider =
    providerOptions.find((item) => item.id === aiSettings.provider) || null;

  return (
    <div className="page-content">
      <div className="chat-layout">
        <ChatSidebar
          sessions={sessions}
          selectedChatId={currentSession?.id || ""}
          onSelect={loadSession}
          onCreate={handleCreateSession}
          onDelete={handleDeleteSession}
        />

        <section className="panel chat-main-panel">
          <div className="chat-main-header">
            <h1 className="chat-main-title">{currentSession?.title || "AI 对话"}</h1>
            <div className="chat-main-subtitle">
              当前平台：{selectedProvider?.name || aiSettings.provider || "未设置"} ·
              模型：{aiSettings.model || "未设置"}
            </div>
          </div>

          {error ? <div className="error-box">{error}</div> : null}

          <ChatWindow session={currentSession} loading={loading} />

          <ChatComposer
            inputMessage={inputMessage}
            setInputMessage={setInputMessage}
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
            loading={loading}
            onSend={() => handleSend(false)}
            onSendFresh={() => handleSend(true)}
          />
        </section>
      </div>
    </div>
  );
}

function AISettingsPage({ aiSettings, setAiSettings, providerOptions, fieldHelp }) {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>AI 设置</h1>
          <p>配置 OpenAI 兼容服务。API Key 仅在当前浏览器会话中使用，不会保存到项目数据。</p>
        </div>
      </div>
      <AISettingsPanel
        aiSettings={aiSettings}
        setAiSettings={setAiSettings}
        providerOptions={providerOptions}
        fieldHelp={fieldHelp}
        title="AI 服务设置"
        subtitle="设置后可用于单词解析、全文翻译和 AI 对话"
      />
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("home");
  const [libraries, setLibraries] = useState([]);
  const [defaultExtraLibraryId, setDefaultExtraLibraryId] = useState("");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState([]);
  const [includeExtra, setIncludeExtra] = useState(true);
  const [analysisMode, setAnalysisMode] = useState("friendly");
  const [ignoreBasicWords, setIgnoreBasicWords] = useState(true);
  const [needLibraryRefresh, setNeedLibraryRefresh] = useState(0);
  const [providerOptions, setProviderOptions] = useState([]);
  const [fieldHelp, setFieldHelp] = useState({
    temperature: "",
    timeoutSeconds: "",
    verifySSL: ""
  });
  const [aiSettings, setAiSettings] = useState({
    provider: "openai-compatible",
    baseUrl: "",
    model: "",
    apiKey: "",
    apiKeyMasked: "",
    hasApiKey: false,
    temperature: 0.2,
    timeoutSeconds: 30,
    verifySSL: true
  });
  const [wordAiCache, setWordAiCache] = useState(() =>
    readLocalStorageJson(WORD_AI_CACHE_STORAGE_KEY, {})
  );

  useEffect(() => {
    writeLocalStorageJson(WORD_AI_CACHE_STORAGE_KEY, wordAiCache);
  }, [wordAiCache]);

  const clearWordAiCache = (key) => {
    if (!key) return;
    setWordAiCache((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const fetchWordAi = async ({ key, word, context = null, libraryContext = null, forceRefresh = false }) => {
    const cacheKey = key || getWordAiKey({ lemma: word });
    if (!cacheKey) {
      throw new Error("无效单词。");
    }

    if (!forceRefresh && wordAiCache[cacheKey]) {
      return wordAiCache[cacheKey];
    }

    if (forceRefresh) {
      clearWordAiCache(cacheKey);
    }

    const result = await postJson("/api/ai/word-query", {
      word,
      context,
      libraryContext,
      forceRefresh,
      settings: buildAISettingsPayload(aiSettings)
    });

    setWordAiCache((prev) => ({
      ...prev,
      [cacheKey]: result
    }));

    return result;
  };

  const refreshLibraries = async () => {
    const result = await getJson("/api/libraries");
    setLibraries(result.libraries || []);
    setDefaultExtraLibraryId(result.defaultExtraLibraryId || "");

    const mainLibraries = (result.libraries || []).filter((lib) => lib.type === "main");

    setSelectedLibraryIds((prev) => {
      const existingIds = new Set(mainLibraries.map((lib) => lib.id));
      const stillValid = prev.filter((id) => existingIds.has(id));

      if (stillValid.length > 0) {
        return stillValid;
      }

      if (mainLibraries.length > 0) {
        return [mainLibraries[0].id];
      }

      return [];
    });
  };

  const refreshAISettings = async () => {
    const result = await getJson("/api/ai/settings");
    setAiSettings((prev) => ({
      ...prev,
      provider: result.provider || "openai-compatible",
      baseUrl: result.baseUrl || "",
      model: result.model || "",
      apiKey: "",
      apiKeyMasked: result.apiKeyMasked || "",
      hasApiKey: !!result.hasApiKey,
      temperature: result.temperature ?? 0.2,
      timeoutSeconds: result.timeoutSeconds ?? 30,
      verifySSL: result.verifySSL ?? true
    }));
    setProviderOptions(result.providers || []);
    setFieldHelp(result.fieldHelp || {
      temperature: "",
      timeoutSeconds: "",
      verifySSL: ""
    });
  };

  useEffect(() => {
    refreshLibraries();
    refreshAISettings();
  }, []);

  return (
    <div className="app-layout">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="main-area">
        {activePage === "home" ? (
          <HomePage
            libraries={libraries}
            refreshLibraries={refreshLibraries}
            selectedLibraryIds={selectedLibraryIds}
            setSelectedLibraryIds={setSelectedLibraryIds}
            includeExtra={includeExtra}
            setIncludeExtra={setIncludeExtra}
            setNeedLibraryRefresh={setNeedLibraryRefresh}
            wordAiCache={wordAiCache}
            fetchWordAi={fetchWordAi}
            clearWordAiCache={clearWordAiCache}
            aiSettings={aiSettings}
            analysisMode={analysisMode}
            ignoreBasicWords={ignoreBasicWords}
          />
        ) : activePage === "home-libraries" || activePage === "home-analysis" ? (
          <HomeConfigurationPage
            section={activePage === "home-libraries" ? "libraries" : "analysis"}
            libraries={libraries}
            selectedLibraryIds={selectedLibraryIds}
            setSelectedLibraryIds={setSelectedLibraryIds}
            includeExtra={includeExtra}
            setIncludeExtra={setIncludeExtra}
            analysisMode={analysisMode}
            setAnalysisMode={setAnalysisMode}
            ignoreBasicWords={ignoreBasicWords}
            setIgnoreBasicWords={setIgnoreBasicWords}
          />
        ) : activePage === "library" ? (
          <LibraryPage
            libraries={libraries}
            defaultExtraLibraryId={defaultExtraLibraryId}
            refreshLibraries={refreshLibraries}
            needLibraryRefresh={needLibraryRefresh}
            wordAiCache={wordAiCache}
            fetchWordAi={fetchWordAi}
            clearWordAiCache={clearWordAiCache}
            aiSettings={aiSettings}
          />
        ) : activePage === "library-import" ? (
          <div className="page-content"><UploadPanel libraries={libraries} refreshLibraries={refreshLibraries} selectedLibraryIds={[]} setSelectedLibraryIds={() => {}} aiSettings={aiSettings} /></div>
        ) : activePage === "library-basic" ? (
          <div className="page-content"><BasicWhitelistPage /></div>
        ) : activePage === "library-manage" ? (
          <div className="page-content"><LibraryManagementPage libraries={libraries} defaultExtraLibraryId={defaultExtraLibraryId} refreshLibraries={refreshLibraries} /></div>
        ) : activePage === "ai-settings" ? (
          <AISettingsPage
            aiSettings={aiSettings}
            setAiSettings={setAiSettings}
            providerOptions={providerOptions}
            fieldHelp={fieldHelp}
          />
        ) : (
          <AIChatPage
            aiSettings={aiSettings}
            providerOptions={providerOptions}
          />
        )}
      </main>
    </div>
  );
}