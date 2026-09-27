import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { changeSourceMapping, getSourceTarget, getSuggestedTarget } from "./importMapping.js";
import { DEFAULT_WORD_LIST_FIELDS, tileFieldsForWord } from "./wordListDisplay.js";

const WORD_REGEX = /[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z\s]+|\s+/g;
const REQUEST_TIMEOUT_MS = 20000;
const IMPORT_TIMEOUT_MS = 120000;
const ANALYZE_TIMEOUT_MS = 60000;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "reading_vocab_sidebar_collapsed_v1";
const APPEARANCE_STORAGE_KEY = "reading_vocab_appearance_v1";
const DEFAULT_APPEARANCE = {
  themeMode: "light",
  primaryColor: "#4f46e5",
  backgroundMode: "solid",
  backgroundColor: "#f3f6fb",
  backgroundImage: "",
  backgroundOverlay: 0.08,
  backgroundBlur: 0,
  panelOpacity: 0.96
};
const PAGE_SIZE = 50;
const IMPORT_MAPPING_TARGETS = [
  { key: "lemma", label: "单词（必填）" },
  { key: "meaning", label: "释义" },
  { key: "unit", label: "单元" },
  { key: "lesson", label: "课程/章节" },
  { key: "page", label: "页码" },
  { key: "frequency", label: "频率" },
  { key: "pos", label: "词性" },
  { key: "ipa", label: "音标" },
  { key: "audio_url", label: "音频链接" },
  { key: "serial", label: "序号" },
  { key: "in_syllabus", label: "是否书内" }
];
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

const DEFAULT_DETAIL_FIELDS = [
  { key: "meaning", label: "释义", source: "meaning", enabled: true, showEmpty: false },
  { key: "unit", label: "单元", source: "unit", enabled: true, showEmpty: false },
  { key: "page", label: "页码", source: "page", enabled: true, showEmpty: false },
  { key: "frequency", label: "频率", source: "frequencyText", enabled: true, showEmpty: false }
];

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
      const seconds = Math.round(timeoutMs / 1000);
      throw new Error(`请求超时（${seconds} 秒），请缩短内容后重试；若后端未启动，请先启动本地服务。`);
    }
    if (error instanceof TypeError && /fetch|network|failed/i.test(error.message || "")) {
      throw new Error("无法连接本地后端，请确认后端已启动且前端代理端口正确。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getJson(url) {
  return request(url);
}

function postJson(url, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, timeoutMs);
}

function putJson(url, body) {
  return request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function postForm(url, formData, timeoutMs = 60000) {
  return request(
    url,
    {
      method: "POST",
      body: formData
    },
    timeoutMs
  );
}

function levelClass(level) {
  const n = Math.min(Math.max(Number(level) || 0, 0), 12);
  return `level-bg-${n}`;
}

function buildTokenTitle(token, displayConfig) {
  if (!token.analysis) return "";
  const item = token.analysis;

  const lines = buildConfiguredFields(item, displayConfig?.tooltipFields, "\n");
  if (!lines && item.basicIgnored) {
    return "基础词";
  }
  if (!lines && item.outside) {
    return item.outsideText || "";
  }
  return lines;
}

function resolveDisplayValue(item, source) {
  if (!item || !source) return "";
  if (source.startsWith("customFields.")) {
    return item.customFields?.[source.slice("customFields.".length)] ?? "";
  }
  return item[source] ?? "";
}

function buildConfiguredFields(item, fields, separator = " · ") {
  return (fields || [])
    .filter((field) => field.enabled)
    .map((field) => {
      const value = resolveDisplayValue(item, field.source);
      return value || field.showEmpty ? `${field.label}: ${value || "-"}` : "";
    })
    .filter(Boolean)
    .join(separator);
}

async function copyText(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function hasTextSelection() {
  return typeof window !== "undefined" && !!window.getSelection?.().toString().trim();
}

function buildTokenMiniInfo(token, displayConfig) {
  if (!token.analysis) return "";
  const item = token.analysis;

  if (item.basicIgnored) {
    return "基础词";
  }

  if (item.outside) {
    return item.outsideText;
  }

  return buildConfiguredFields(item, displayConfig?.tokenFields);
}

function buildTokenMeaning(token, displayConfig) {
  return buildConfiguredFields(token.analysis, (displayConfig?.tokenFields || []).filter((field) => field.source === "meaning"), " ");
}

function buildFocusMeta(word, displayConfig) {
  const limit = Math.max(1, Math.min(12, Number(displayConfig?.focusFieldLimit) || 5));
  const fields = (displayConfig?.focusFields || []).filter((field) => field.enabled).slice(0, limit);
  return buildConfiguredFields(word, fields);
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

function playWordAudio(word) {
  if (!word) return;
  const audioUrl = word.audioUrl || getCustomField(word.customFields, ["音频链接", "audio_url", "audio", "sound_url"]);
  if (audioUrl) {
    const audio = new Audio(audioUrl);
    audio.play().catch(() => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(word.lemma || word.word || "");
        utterance.lang = "en-US";
        window.speechSynthesis.speak(utterance);
      }
    });
    return;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.lemma || word.word || "");
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  }
}

function Sidebar({ activePage, setActivePage, collapsed, onToggle, mobileOpen, onClose }) {
  const sidebarGroups = [
    {
      id: "home",
      icon: "⌂",
      label: "首页",
      defaultPage: "home",
      children: [
        { id: "home-libraries", icon: "▣", label: "参与分析词库" },
        { id: "home-analysis", icon: "☷", label: "分析设置" }
      ]
    },
    {
      id: "library",
      icon: "▥",
      label: "单词库",
      defaultPage: "library",
      children: [
        { id: "library-import", icon: "＋", label: "导入词库" },
        { id: "library-basic", icon: "◇", label: "基础词白名单" },
        { id: "library-manage", icon: "⚙", label: "词库管理" }
      ]
    },
    {
      id: "chat",
      icon: "✦",
      label: "AI 对话",
      defaultPage: "chat",
      children: [
        { id: "ai-settings", icon: "⚙", label: "AI 设置" }
      ]
    }
  ];
  const activeGroup = sidebarGroups.find((group) => activePage === group.id || activePage.startsWith(`${group.id}-`))?.id || "library";
  const [openGroup, setOpenGroup] = useState(() => readLocalStorageJson("reading_vocab_sidebar_group_v1", activeGroup));

  useEffect(() => {
    writeLocalStorageJson("reading_vocab_sidebar_group_v1", openGroup);
  }, [openGroup]);

  const navigate = (id) => {
    setActivePage(id);
    onClose?.();
  };

  const toggleGroup = (group) => {
    // On compact screens, keep the drawer open so its child pages remain reachable.
    // Child navigation and the explicit close button dismiss the drawer.
    setOpenGroup(group.id);
    setActivePage(group.defaultPage);
    if (!mobileOpen) onClose?.();
  };

  return (
    <>
      {mobileOpen ? <button type="button" className="sidebar-overlay" aria-label="关闭导航" onClick={onClose} /> : null}
      <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand-mark">V</div>
          <div className="sidebar-title">词汇诊断</div>
          <button type="button" className="sidebar-toggle" onClick={mobileOpen ? onClose : onToggle} aria-label={mobileOpen ? "关闭导航" : collapsed ? "展开侧栏" : "收缩侧栏"} title={mobileOpen ? "关闭导航" : collapsed ? "展开侧栏" : "收缩侧栏"}>
            {mobileOpen ? "×" : collapsed ? "›" : "‹"}
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {sidebarGroups.map((group) => {
            const isActive = activePage === group.id || activePage.startsWith(`${group.id}-`);
            const isOpen = (mobileOpen || !collapsed) && openGroup === group.id;
            return (
              <div className="sidebar-group" key={group.id}>
                <button type="button" className={`sidebar-item sidebar-mainitem ${isActive ? "active" : ""}`} onClick={() => toggleGroup(group)} title={collapsed ? group.label : undefined}>
                  <span className="sidebar-icon" aria-hidden="true">{group.icon}</span>
                  <span className="sidebar-label">{group.label}</span>
                  <span className="sidebar-chevron" aria-hidden="true">{isOpen ? "⌄" : "›"}</span>
                </button>
                {isOpen ? (
                  <div className="sidebar-subdrawer">
                    {group.children.map((item) => (
                      <button key={item.id} type="button" className={`sidebar-item sidebar-subitem ${activePage === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}>
                        <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>
                        <span className="sidebar-label">{item.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          <button type="button" className={`sidebar-item sidebar-mainitem ${activePage === "appearance" ? "active" : ""}`} onClick={() => navigate("appearance")} title={collapsed ? "外观设置" : undefined}>
            <span className="sidebar-icon" aria-hidden="true">◐</span>
            <span className="sidebar-label">外观设置</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-status-dot" />
          <span className="sidebar-label">本地模式</span>
        </div>
      </aside>
    </>
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
  const [fieldDefinitions, setFieldDefinitions] = useState([]);
  const [editableRows, setEditableRows] = useState([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [customHeader, setCustomHeader] = useState("");
  const [customDefaultValue, setCustomDefaultValue] = useState("");

  const applyDraft = (result, message) => {
    setPreview(result);
    setMapping(result.mapping || {});
    setFieldDefinitions(result.fieldDefinitions || []);
    setEditableRows((result.rows || []).map((row) => [...row]));
    setPreviewPage(0);
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

      const result = await postForm("/api/vocab/import-preview", formData, IMPORT_TIMEOUT_MS);
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
        mapping,
        fieldDefinitions
      }, IMPORT_TIMEOUT_MS);
      await refreshLibraries();
      if (result.library?.id) {
        setSelectedLibraryIds((prev) => prev.includes(result.library.id) ? prev : [...prev, result.library.id]);
      }
      setMessage(`导入成功：${result.library.name}，共 ${result.importedCount} 个词条。`);
      setPreview(null);
      setMapping({});
      setFieldDefinitions([]);
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
  const previewPageCount = Math.max(1, Math.ceil(editableRows.length / PAGE_SIZE));
  const pagedRows = editableRows.slice(previewPage * PAGE_SIZE, (previewPage + 1) * PAGE_SIZE);

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

  const addMappingField = () => {
    setFieldDefinitions((prev) => [...prev, {
      key: `field_${prev.length + 1}`,
      label: "新增字段",
      sourceHeader: preview.headers[0] || ""
    }]);
    setError("");
  };

  const updateMappingField = (index, property, value) => {
    setFieldDefinitions((prev) => prev.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, [property]: value } : field
    )));
  };

  const mappingTargets = preview?.mappingFields?.length ? preview.mappingFields : IMPORT_MAPPING_TARGETS;
  const labelForTarget = (target) => {
    if (!target) return "";
    const customTarget = fieldDefinitions.find((field) => `custom:${field.key}` === target);
    if (customTarget) return `${customTarget.label || customTarget.key}（自定义）`;
    return mappingTargets.find((item) => item.key === target)?.label || target;
  };
  const sourceTarget = (header) => getSourceTarget(mapping, fieldDefinitions, header);
  const suggestedTargetFor = (header) => getSuggestedTarget(preview?.mapping, fieldDefinitions, header);
  const updateSourceMapping = (header, choice) => {
    const next = changeSourceMapping(mapping, fieldDefinitions, preview?.mapping, header, choice);
    setMapping(next.mapping);
    setFieldDefinitions(next.fieldDefinitions);
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
            <span>仅单词必填；文件最大 5 MB</span>
          </div>
          <div className="import-map-intro">
            <strong>按实际表头映射</strong>
            <span>系统已识别的源表头会直接带入目标字段；你只需要逐列选择“映射到什么”或“不映射”。未映射列仍会保存到 customFields。</span>
          </div>
          <div className="import-map-grid import-map-grid-by-source">
            <div className="import-map-header"><span>源表头</span><span>是否映射</span><span>自动识别结果</span></div>
            {preview.headers.map((header, index) => {
              const target = sourceTarget(header);
              const targetLabel = labelForTarget(target || suggestedTargetFor(header));
              const mappingChoice = target ? "mapped" : "";
              return (
                <div key={`${header}-${index}`} className="import-map-row">
                  <div className="import-source-name"><strong>{header || `第 ${index + 1} 列`}</strong><small>{preview.rows?.[0]?.[index] ?? "空值示例"}</small></div>
                  <select className="select-input" value={mappingChoice} onChange={(event) => updateSourceMapping(header, event.target.value)}>
                    <option value="">不映射</option>
                    <option value="mapped">映射</option>
                  </select>
                  <div className="mapping-status-cell"><span className={`mapping-status ${target ? "is-mapped" : "is-unmapped"}`}>{target ? `已识别 · ${targetLabel || "自定义字段"}` : "不映射，保留原列"}</span></div>
                </div>
              );
            })}
          </div>
          <div className="custom-column-editor">
            <div>
              <strong>新增可映射字段</strong>
              <span>从实际表头选择源列，给它设置名称和保存字段。例如“词频次数”可与预设“频率”同时映射、分别显示。</span>
            </div>
            <button type="button" className="secondary-btn" onClick={addMappingField}>添加映射字段</button>
            {fieldDefinitions.length ? (
              <div className="mapping-definition-list">
                {fieldDefinitions.map((field, index) => (
                  <div key={`${field.key}-${index}`} className="mapping-definition-row">
                    <input className="text-mini-input" aria-label="字段显示名称" value={field.label || ""} onChange={(event) => updateMappingField(index, "label", event.target.value)} placeholder="显示名称，例如：词频次数" />
                    <select className="select-input" aria-label="字段源列" value={field.sourceHeader || field.source || ""} onChange={(event) => updateMappingField(index, "sourceHeader", event.target.value)}>
                      <option value="">请选择源列</option>
                      {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                    <input className="text-mini-input" aria-label="保存字段名" value={field.key || ""} onChange={(event) => updateMappingField(index, "key", event.target.value)} placeholder="保存字段名，例如 frequency_count" />
                    <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => setFieldDefinitions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
                  </div>
                ))}
              </div>
            ) : null}
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
                {pagedRows.map((row, pageRowIndex) => {
                  const rowIndex = previewPage * PAGE_SIZE + pageRowIndex;
                  return <tr key={`editable-row-${rowIndex}`}>
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
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="pagination-row">
            <span>第 {previewPage + 1} / {previewPageCount} 页，共 {editableRows.length} 行</span>
            <button type="button" className="ghost-btn mini-ghost-btn" disabled={previewPage === 0} onClick={() => setPreviewPage((page) => page - 1)}>上一页</button>
            <button type="button" className="ghost-btn mini-ghost-btn" disabled={previewPage >= previewPageCount - 1} onClick={() => setPreviewPage((page) => page + 1)}>下一页</button>
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

const ANALYSIS_DISPLAY_OPTIONS = [
  { source: "meaning", label: "释义" },
  { source: "unit", label: "单元" },
  { source: "page", label: "页码" },
  { source: "frequencyText", label: "频率" },
  { source: "libraryName", label: "词库" },
  { source: "lemma", label: "词形" },
  { source: "sourceText", label: "来源" },
  { source: "outsideText", label: "词库外说明" },
  { source: "level", label: "掌握等级" },
  { source: "levelLabel", label: "掌握等级名称" },
  { source: "pos", label: "词性" },
  { source: "ipa", label: "音标" },
  { source: "audioUrl", label: "音频链接" },
  { source: "basicText", label: "基础词状态" },
  { source: "count", label: "出现次数" },
  { source: "fuzzyCount", label: "模糊次数" },
  { source: "unknownCount", label: "未掌握次数" },
  { source: "suggestedLevel", label: "建议等级" }
];

function AnalysisSettings({
  analysisMode,
  setAnalysisMode,
  ignoreBasicWords,
  setIgnoreBasicWords,
  libraries,
  displayConfig,
  setDisplayConfig,
  refreshLibraries
}) {
  const DISPLAY_GROUPS = ["tokenFields", "tooltipFields", "focusFields", "wordListFields", "detailFields"];
  const DEFAULT_FIELDS = {
    tokenFields: [
      { key: "meaning", label: "释义", source: "meaning", enabled: true, showEmpty: false },
      { key: "unit", label: "单元", source: "unit", enabled: true, showEmpty: false },
      { key: "page", label: "页码", source: "page", enabled: true, showEmpty: false },
      { key: "frequency", label: "频率", source: "frequencyText", enabled: true, showEmpty: false }
    ],
    tooltipFields: [
      { key: "lemma", label: "词形", source: "lemma", enabled: true, showEmpty: false },
      { key: "basicText", label: "基础词", source: "basicText", enabled: true, showEmpty: false },
      { key: "outsideText", label: "词库外", source: "outsideText", enabled: true, showEmpty: false },
      { key: "sourceText", label: "来源", source: "sourceText", enabled: true, showEmpty: false },
      { key: "unit", label: "单元", source: "unit", enabled: true, showEmpty: false },
      { key: "page", label: "页码", source: "page", enabled: true, showEmpty: false },
      { key: "frequencyText", label: "频率", source: "frequencyText", enabled: true, showEmpty: false },
      { key: "level", label: "掌握等级", source: "levelLabel", enabled: true, showEmpty: false },
      { key: "meaning", label: "词义", source: "meaning", enabled: true, showEmpty: false }
    ],
    focusFields: [
      { key: "meaning", label: "释义", source: "meaning", enabled: true, showEmpty: false },
      { key: "libraryName", label: "词库", source: "libraryName", enabled: true, showEmpty: false },
      { key: "unit", label: "单元", source: "unit", enabled: true, showEmpty: false },
      { key: "page", label: "页码", source: "page", enabled: true, showEmpty: false },
      { key: "frequency", label: "频率", source: "frequencyText", enabled: true, showEmpty: false }
    ],
    wordListFields: DEFAULT_WORD_LIST_FIELDS,
    detailFields: DEFAULT_DETAIL_FIELDS,
    focusFieldLimit: 5
  };
  const buildDraftFromConfig = (config) => {
    const source = config || {};
    return Object.fromEntries([
      ...DISPLAY_GROUPS.map((group) => [
        group,
        Array.isArray(source[group]) && (source[group].length || group === "wordListFields") ? source[group] : DEFAULT_FIELDS[group]
      ]),
      ["focusFieldLimit", Math.max(1, Math.min(12, Number(source.focusFieldLimit) || DEFAULT_FIELDS.focusFieldLimit))]
    ]);
  };
  const configurableLibraries = libraries.filter((library) => library.type === "main" || library.type === "extra");
  const [configLibraryId, setConfigLibraryId] = useState(configurableLibraries[0]?.id || "");
  const [configDraft, setConfigDraft] = useState(displayConfig || {});
  const [configMessage, setConfigMessage] = useState("");
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const loadedLibraryRef = useRef(null);

  useEffect(() => {
    const selected = configurableLibraries.find((library) => library.id === configLibraryId) || configurableLibraries[0];
    if (!selected) return;
    if (selected.id !== configLibraryId) {
      setConfigLibraryId(selected.id);
      return;
    }
    if (loadedLibraryRef.current !== selected.id) {
      loadedLibraryRef.current = selected.id;
      setConfigDraft(buildDraftFromConfig(selected.displayConfig || {}));
    }
  }, [configLibraryId, configurableLibraries, displayConfig]);

  const updateField = (group, index, patch) => {
    setConfigDraft((prev) => ({
      ...prev,
      [group]: (prev[group] || []).map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field)
    }));
  };

  const availableFields = useMemo(() => {
    const library = configurableLibraries.find((item) => item.id === configLibraryId);
    const libraryFields = (library?.availableFields || [])
      .filter((field) => field && field.source)
      .map((field) => ({
        source: field.source,
        label: field.label || field.source,
        present: field.present === true
      }));
    const merged = [...libraryFields, ...ANALYSIS_DISPLAY_OPTIONS.map((field) => ({ ...field, present: false }))];
    return merged.filter((field, index, list) => list.findIndex((item) => item.source === field.source) === index);
  }, [configurableLibraries, configLibraryId]);

  const autoFields = availableFields.filter((field) => field.present);
  const optionalFields = availableFields.filter((field) => !field.present);
  const commonOptionalSources = new Set(["libraryName", "lemma", "sourceText", "outsideText", "levelLabel", "basicText"]);
  const commonOptionalFields = optionalFields.filter((field) => commonOptionalSources.has(field.source));
  const advancedOptionalFields = optionalFields.filter((field) => !commonOptionalSources.has(field.source));

  const autoConfigureFields = () => {
    if (!configLibraryId || autoFields.length === 0) {
      setConfigMessage("当前词库没有检测到可自动匹配的字段，仍可手动选择其他字段。");
      return;
    }
    setConfigDraft((prev) => {
      const next = { ...prev };
      DISPLAY_GROUPS.forEach((group) => {
        const current = prev[group] || DEFAULT_FIELDS[group];
        const used = new Set(current.map((field) => field.source));
        // Adjust only unchanged preset rows; keep added custom rows and their labels.
        const matchedPresets = current.map((field) => {
          const isPreset = DEFAULT_FIELDS[group].some((preset) => preset.key === field.key && preset.source === field.source);
          const isLibraryColumn = !["lemma", "libraryName", "sourceText", "outsideText", "level", "levelLabel", "basicText"].includes(field.source);
          return isPreset && isLibraryColumn ? { ...field, enabled: autoFields.some((item) => item.source === field.source) } : field;
        });
        const candidates = autoFields.filter((field) => !used.has(field.source) && (
          group === "detailFields" || DEFAULT_FIELDS[group].some((preset) => preset.source === field.source)
        ));
        next[group] = [...matchedPresets, ...candidates.map((field) => ({
          key: `${group}:${field.source}`,
          source: field.source,
          label: field.label,
          enabled: true,
          displayType: "text",
          showEmpty: false
        }))];
      });
      return next;
    });
    setConfigMessage("已匹配当前词库字段；未匹配的预设字段保留但关闭，其他手动配置未删除。保存后生效。");
  };

  const addField = (group) => {
    const usedSources = new Set((configDraft[group] || []).map((field) => field.source));
    const candidate = autoFields.find((field) => !usedSources.has(field.source))
      || commonOptionalFields.find((field) => !usedSources.has(field.source))
      || (showAdvancedFields ? advancedOptionalFields.find((field) => !usedSources.has(field.source)) : null);
    if (!candidate) {
      setConfigMessage(showAdvancedFields ? "没有可添加的新字段。" : "没有常用字段可添加；需要其他字段请先展开“更多可选字段”。");
      return;
    }
    setConfigDraft((prev) => ({
      ...prev,
      [group]: [...(prev[group] || []), { ...candidate, key: `${group}:${candidate.source}`, enabled: true, displayType: "text", showEmpty: false }]
    }));
  };

  const removeField = (group, index) => {
    setConfigDraft((prev) => ({
      ...prev,
      [group]: (prev[group] || []).filter((_, fieldIndex) => fieldIndex !== index)
    }));
  };

  const saveConfig = async () => {
    if (!configLibraryId) return;
    try {
      const selected = configurableLibraries.find((library) => library.id === configLibraryId);
      // Saving analysis fields must not reset the library's independent list/rush settings.
      const payload = { ...(selected?.displayConfig || {}), ...configDraft };
      const result = await putJson(`/api/libraries/${encodeURIComponent(configLibraryId)}/display-config`, { displayConfig: payload });
      const next = result.displayConfig || payload;
      loadedLibraryRef.current = configLibraryId;
      setDisplayConfig(next);
      setConfigDraft(buildDraftFromConfig(next));
      await refreshLibraries();
      setConfigMessage("已保存字段显示设置。");
    } catch (error) {
      setConfigMessage(`保存失败：${error.message}`);
    }
  };

  const resetConfig = () => {
    const library = configurableLibraries.find((item) => item.id === configLibraryId);
    setConfigDraft(buildDraftFromConfig(library?.displayConfig || {}));
    setConfigMessage("");
  };

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

      <div className="analysis-setting-block">
        <div className="setting-title-row">
          <div>
            <div className="setting-title">词库字段显示</div>
            <div className="setting-caption">优先显示当前词库已有字段，其他字段仍可手动选择。</div>
          </div>
          <div className="analysis-field-actions">
            <button type="button" className="ghost-btn mini-ghost-btn auto-map-analysis-btn" onClick={autoConfigureFields} disabled={!configLibraryId}>自动匹配当前词库</button>
            <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => setShowAdvancedFields((shown) => !shown)} aria-expanded={showAdvancedFields}>{showAdvancedFields ? "收起更多字段" : "更多可选字段"}</button>
          </div>
        </div>
        <select className="select-input analysis-library-select" value={configLibraryId} onChange={(event) => setConfigLibraryId(event.target.value)}>
          {configurableLibraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
        </select>
        {DISPLAY_GROUPS.map((group) => {
          const fields = configDraft[group] || DEFAULT_FIELDS[group];
          return (
          <div key={group} className="display-field-group">
            <strong>{group === "tokenFields" ? "词块标记区" : group === "tooltipFields" ? "词块悬浮提示" : group === "focusFields" ? "重点词清单外部字段" : group === "wordListFields" ? "单词库词块表面字段" : "词块点击详情字段"}</strong>
            {group === "wordListFields" ? <p className="upload-tips">单词库切换到词块样式后，这些字段显示在词块表面；单词本身和掌握等级始终显示。</p> : null}
            {fields.map((field, index) => (
              <div key={field.key} className="check-row">
                <input type="checkbox" aria-label={`显示${field.label || field.source}`} checked={field.enabled !== false} onChange={(event) => updateField(group, index, { enabled: event.target.checked })} />
                <select className="select-input analysis-field-select" value={field.source} onChange={(event) => {
                  const source = event.target.value;
                  const option = availableFields.find((item) => item.source === source);
                  updateField(group, index, { source, label: option?.label || field.label });
                }}>
                  {!availableFields.some((option) => option.source === field.source) ? (
                    <option value={field.source}>{field.label || field.source}（当前词库未提供）</option>
                  ) : null}
                  {autoFields.length ? <optgroup label="当前词库已有字段">
                    {autoFields.map((option) => <option key={`auto-${option.source}`} value={option.source}>{option.label}</option>)}
                  </optgroup> : null}
                  <optgroup label="其他常用字段">
                    {commonOptionalFields.map((option) => <option key={`optional-${option.source}`} value={option.source}>{option.label}</option>)}
                  </optgroup>
                  {(showAdvancedFields || advancedOptionalFields.some((option) => option.source === field.source)) && advancedOptionalFields.length ? <optgroup label="更多可选字段">
                    {advancedOptionalFields.filter((option) => showAdvancedFields || option.source === field.source).map((option) => <option key={`advanced-${option.source}`} value={option.source}>{option.label}</option>)}
                  </optgroup> : null}
                </select>
                <input className="text-mini-input analysis-field-label" value={field.label} onChange={(event) => updateField(group, index, { label: event.target.value })} />
                <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => removeField(group, index)}>删除</button>
              </div>
            ))}
            <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => addField(group)}>添加字段</button>
            {group === "focusFields" ? <label className="check-row"><span>外部最多显示字段数</span><input className="text-mini-input analysis-field-limit" type="number" min="1" max="12" value={configDraft.focusFieldLimit || DEFAULT_FIELDS.focusFieldLimit} onChange={(event) => setConfigDraft((prev) => ({ ...prev, focusFieldLimit: Math.max(1, Math.min(12, Number(event.target.value) || 1)) }))} /><em>限制卡片上显示的字段数量,不影响上方已添加的字段</em></label> : null}
          </div>
          );
        })}
        <div className="button-row">
          <button type="button" className="primary-btn" onClick={saveConfig} disabled={!configLibraryId}>保存字段显示</button>
          <button type="button" className="secondary-btn" onClick={resetConfig}>恢复当前配置</button>
          {configMessage ? <span className="upload-tips">{configMessage}</span> : null}
        </div>
      </div>
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
  setIgnoreBasicWords,
  displayConfig,
  setDisplayConfig,
  refreshLibraries
}) {
  const isLibraries = section === "libraries";

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>{isLibraries ? "参与分析词库" : "分析设置"}</h1>
          <p className="selectable-copy">{isLibraries ? "选择本次阅读诊断所使用的词库。" : "调整阅读诊断的识别规则。页面说明、提示和词卡文字均可直接拖选复制。"}</p>
        </div>
      </div>
      {isLibraries ? (
        <LibrarySelector libraries={libraries} selectedLibraryIds={selectedLibraryIds} setSelectedLibraryIds={setSelectedLibraryIds} includeExtra={includeExtra} setIncludeExtra={setIncludeExtra} />
      ) : (
        <AnalysisSettings analysisMode={analysisMode} setAnalysisMode={setAnalysisMode} ignoreBasicWords={ignoreBasicWords} setIgnoreBasicWords={setIgnoreBasicWords} libraries={libraries} displayConfig={displayConfig} setDisplayConfig={setDisplayConfig} refreshLibraries={refreshLibraries} />
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
  onAddToExtra,
  displayConfig
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
          <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => copyText(buildWordDetailText(word))}>复制</button>
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
      {(displayConfig?.detailFields?.length ? displayConfig.detailFields : DEFAULT_DETAIL_FIELDS).some((field) => field.enabled) ? <DetailSection title="词库字段"><div className="meta-list">{(displayConfig?.detailFields?.length ? displayConfig.detailFields : DEFAULT_DETAIL_FIELDS).filter((field) => field.enabled).map((field) => {
        const value = resolveDisplayValue(word, field.source);
        return value || field.showEmpty ? <div key={field.key}><strong>{field.label}</strong><span>{String(value || "-")}</span></div> : null;
      })}</div></DetailSection> : null}

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
  ignoreBasicWords,
  displayConfig
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

  const handleTokenClick = (token) => {
    if (hasTextSelection()) return;
    handleOpenWordDetail(token);
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
    if (hasTextSelection()) return;
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
    }, ANALYZE_TIMEOUT_MS);

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
    if (loading) return;
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

                const miniInfo = buildTokenMiniInfo(token, displayConfig);
                const miniMeaning = buildTokenMeaning(token, displayConfig);
                const tokenClass = token.analysis?.basicIgnored
                  ? "token-basic"
                  : `token-${token.mark}`;

                return (
                  <button
                    key={token.id}
                    type="button"
                    className={`word-token ${tokenClass} ${selectedTokenId === token.id ? "token-selected" : ""}`}
                    title={buildTokenTitle(token, displayConfig)}
                    onMouseDown={(event) => {
                      if (event.altKey) {
                        event.preventDefault();
                        handlePaintStart(token);
                      }
                    }}
                    onMouseEnter={() => handlePaintEnter(token)}
                    onClick={() => handleTokenClick(token)}
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
                          <div className="focus-word selectable-copy">
                            {word.displayText} <span>× {word.count}</span>
                          </div>
                          <div className="focus-meta selectable-copy">{buildFocusMeta(word, displayConfig)}</div>
                          <div className="upload-tips selectable-copy">
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
            displayConfig={displayConfig}
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

function LibraryWordsPage({ libraries, refreshLibraries, needLibraryRefresh, wordAiCache, fetchWordAi, clearWordAiCache, displayConfig = {}, onOpenRush }) {
  const mainLibraries = libraries.filter((lib) => lib.type === "main");
  const extraLibraries = libraries.filter((lib) => lib.type === "extra");
  const [viewMode, setViewMode] = useState("merged");
  const [selectedSingleLibraryId, setSelectedSingleLibraryId] = useState("");
  const [selectedExtraLibraryId, setSelectedExtraLibraryId] = useState("");
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [wordData, setWordData] = useState({ items: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1, overview: { levels: {}, trackedWords: 0 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [favoriteKeys, setFavoriteKeys] = useState(() => new Set(readLocalStorageJson("reading_vocab_favorites_v1", [])));
  const [detailLoadingKey, setDetailLoadingKey] = useState("");
  const [detailError, setDetailError] = useState("");
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewMessage, setReviewMessage] = useState("");
  const [floatingWord, setFloatingWord] = useState(null);
  const [inlineAiKey, setInlineAiKey] = useState("");

  const activeLibraryId = selectedSingleLibraryId || mainLibraries[0]?.id || "";
  const activeExtraLibraryId = selectedExtraLibraryId || extraLibraries[0]?.id || "";
  const selectedLibrary = viewMode === "single" ? libraries.find((item) => item.id === activeLibraryId) : viewMode === "extra" ? libraries.find((item) => item.id === activeExtraLibraryId) : mainLibraries[0];
  const effectiveConfig = { listMode: "recall", listLayout: "list", wordListFields: DEFAULT_WORD_LIST_FIELDS, detailPlacement: "below", allowMultipleExpanded: true, ...displayConfig, ...(selectedLibrary?.displayConfig || {}) };
  const listMode = effectiveConfig.listMode || "recall";
  const listLayout = effectiveConfig.listLayout === "tiles" ? "tiles" : "list";

  useEffect(() => { if (!selectedSingleLibraryId && mainLibraries.length) setSelectedSingleLibraryId(mainLibraries[0].id); }, [mainLibraries, selectedSingleLibraryId]);
  useEffect(() => { if (!selectedExtraLibraryId && extraLibraries.length) setSelectedExtraLibraryId(extraLibraries[0].id); }, [extraLibraries, selectedExtraLibraryId]);
  useEffect(() => {
    setPage(1);
    setExpandedKeys(new Set());
    setFloatingWord(null);
    setInlineAiKey("");
    setDetailError("");
  }, [viewMode, selectedSingleLibraryId, selectedExtraLibraryId, query, levelFilter]);
  useEffect(() => {
    setFloatingWord(null);
    setInlineAiKey("");
    setDetailError("");
  }, [page]);
  useEffect(() => { writeLocalStorageJson("reading_vocab_favorites_v1", Array.from(favoriteKeys)); }, [favoriteKeys]);
  useEffect(() => { fetchWords(); }, [viewMode, selectedSingleLibraryId, selectedExtraLibraryId, query, levelFilter, page, libraries, needLibraryRefresh]);

  const fetchWords = async () => {
    setLoading(true); setError("");
    try {
      let url = "";
      if (viewMode === "merged") {
        const ids = mainLibraries.map((lib) => lib.id).join(",");
        url = `/api/libraries/merged/words?libraryIds=${encodeURIComponent(ids)}&includeExtra=false&includeBasic=false&page=${page}&pageSize=${PAGE_SIZE}&query=${encodeURIComponent(query)}&levelFilter=${encodeURIComponent(levelFilter)}`;
      } else {
        const id = viewMode === "extra" ? activeExtraLibraryId : activeLibraryId;
        if (!id) { setWordData((prev) => ({ ...prev, items: [], total: 0 })); return; }
        url = `/api/libraries/${encodeURIComponent(id)}/words?page=${page}&pageSize=${PAGE_SIZE}&query=${encodeURIComponent(query)}&levelFilter=${encodeURIComponent(levelFilter)}`;
      }
      setWordData(await getJson(url));
    } catch (requestError) { setError(`读取单词库失败：${requestError.message}`); }
    finally { setLoading(false); }
  };

  const selectedWord = floatingWord;
  const selectedWordAiKey = getWordAiKey(selectedWord);
  const selectedWordAiEntry = selectedWordAiKey ? wordAiCache[selectedWordAiKey] : null;

  const toggleExpand = (word) => {
    if (hasTextSelection()) return;
    const key = `${word.libraryId}-${word.lemma}`;
    const isOpening = !expandedKeys.has(key);
    if (isOpening) {
      playWordAudio(word);
      if (effectiveConfig.detailPlacement === "floating") setFloatingWord(word);
    } else if (effectiveConfig.detailPlacement === "floating" && floatingWord && `${floatingWord.libraryId}-${floatingWord.lemma}` === key) {
      setFloatingWord(null);
    }
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        if (!effectiveConfig.allowMultipleExpanded) next.clear();
        next.add(key);
      }
      return next;
    });
  };

  const toggleFavorite = (word) => {
    const key = `${word.libraryId}-${word.lemma}`;
    setFavoriteKeys((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  };

  const handleWordDetailQuery = async (word, forceRefresh = false) => {
    const key = getWordAiKey(word); if (!key) return;
    setDetailLoadingKey(key); setDetailError("");
    try {
      if (forceRefresh) clearWordAiCache(key);
      await fetchWordAi({ key, word: word.lemma, libraryContext: { libraryName: word.libraryName, unit: word.unit, page: word.page, locations: word.locations, meaning: word.meaning, customFields: word.customFields }, forceRefresh });
    } catch (requestError) { setDetailError(`AI 解析失败：${requestError.message}`); }
    finally { setDetailLoadingKey(""); }
  };

  const handleAddDetailToExtra = async (word) => {
    try { await postJson("/api/extra-vocab/add", { word: word.lemma, frequency: word.frequency, meaning: word.meaning || "", libraryId: null }); await refreshLibraries(); setReviewMessage(`已将 ${word.lemma} 加入补充词库。`); }
    catch (requestError) { setDetailError(`加入补充词库失败：${requestError.message}`); }
  };

  const loadReview = async () => { try { const result = await getJson("/api/review/due?limit=12"); setReviewItems(result.items || []); setReviewMessage(result.total ? `已加载 ${result.total} 个待复习词。` : "当前没有待复习词。"); } catch (requestError) { setError(`加载复习失败：${requestError.message}`); } };
  const markReview = async (word, mark) => { try { await postJson("/api/review/mark", { lemma: word.lemma, mark }); setReviewItems((prev) => prev.filter((item) => item.lemma !== word.lemma)); await fetchWords(); } catch (requestError) { setError(`复习记录失败：${requestError.message}`); } };
  const handleExport = () => { const id = viewMode === "single" ? activeLibraryId : viewMode === "extra" ? activeExtraLibraryId : ""; if (!id) return setError("请先切换到具体词库后导出。"); window.open(`${API_BASE_URL}/api/libraries/${encodeURIComponent(id)}/export`, "_blank", "noopener,noreferrer"); };
  const handleReset = async () => { if (!window.confirm("确定要重置所有单词的认识情况吗？词库本身不会删除。")) return; try { await postJson("/api/user-status/reset", {}); await refreshLibraries(); await fetchWords(); } catch (requestError) { setError(`重置失败：${requestError.message}`); } };

  const renderExpandedDetails = (word) => {
    const key = getWordAiKey(word);
    return <div className={`vocab-inline-detail ${inlineAiKey === key ? "has-inline-ai" : ""}`}>
      <div className="vocab-inline-detail-main">
        <div className="vocab-detail-line"><strong>{word.pos || "词条"}</strong><span>{word.ipa || "暂无音标"}</span></div>
        <div className="vocab-meaning">{word.meaning || "暂无释义"}</div>
        <div className="vocab-detail-meta">{[word.libraryName, word.unit && `单元 ${word.unit}`, word.page && `p.${word.page}`, word.frequencyText].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="vocab-inline-actions">
        <button type="button" className="ghost-btn mini-ghost-btn" onClick={(event) => { event.stopPropagation(); playWordAudio(word); }}>🔊 播放</button>
        <button type="button" className={`ghost-btn mini-ghost-btn ${favoriteKeys.has(`${word.libraryId}-${word.lemma}`) ? "favorite-active" : ""}`} onClick={(event) => { event.stopPropagation(); toggleFavorite(word); }}>{favoriteKeys.has(`${word.libraryId}-${word.lemma}`) ? "★ 已收藏" : "☆ 收藏"}</button>
        <button type="button" className="ghost-btn mini-ghost-btn" onClick={(event) => { event.stopPropagation(); setInlineAiKey(key); handleWordDetailQuery(word); }} disabled={detailLoadingKey === key}>{detailLoadingKey === key ? "解析中…" : "AI 详情"}</button>
      </div>
      {inlineAiKey === key ? <div className="vocab-inline-ai-panel" onClick={(event) => event.stopPropagation()}>
        <WordDetailPanel
          word={word}
          aiEntry={wordAiCache[key]}
          loading={detailLoadingKey === key}
          error={detailError}
          onQuery={() => handleWordDetailQuery(word, false)}
          onRefresh={() => handleWordDetailQuery(word, true)}
          onClose={() => setInlineAiKey("")}
          onAddToExtra={() => handleAddDetailToExtra(word)}
          displayConfig={effectiveConfig}
        />
      </div> : null}
    </div>;
  };

  return <section className="panel library-words-shell">
    <div className="page-header"><div><div className="eyebrow">VOCABULARY LIBRARY</div><h1>单词库</h1><p>可按词库选择列表或词块样式，词块表面字段在“分析设置”中配置；详情展开方式在“词库管理”中调整。</p></div><button type="button" className="danger-btn" onClick={handleReset}>重置认识情况</button></div>
    <div className="library-tabs"><button type="button" className={`tab-btn ${viewMode === "merged" ? "active" : ""}`} onClick={() => setViewMode("merged")}>合并查看</button><button type="button" className={`tab-btn ${viewMode === "single" ? "active" : ""}`} onClick={() => setViewMode("single")}>单个主词库</button><button type="button" className={`tab-btn ${viewMode === "extra" ? "active" : ""}`} onClick={() => setViewMode("extra")}>补充词库</button></div>
    {viewMode === "single" ? <select className="select-input wide-select" value={activeLibraryId} onChange={(event) => setSelectedSingleLibraryId(event.target.value)}>{mainLibraries.map((lib) => <option key={lib.id} value={lib.id}>{lib.name}，{lib.count} 词</option>)}</select> : null}
    {viewMode === "extra" ? <select className="select-input wide-select" value={activeExtraLibraryId} onChange={(event) => setSelectedExtraLibraryId(event.target.value)}>{extraLibraries.map((lib) => <option key={lib.id} value={lib.id}>{lib.name}，{lib.count} 词</option>)}</select> : null}
    <div className="search-filter-bar"><input className="search-input" placeholder="搜索单词、Unit、页码、词库名、词义..." value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" className="ghost-btn" onClick={handleExport}>导出当前词库</button><button type="button" className="secondary-btn" onClick={loadReview}>开始复习</button></div>
    <div className="vocab-filter-chips"><button type="button" className={levelFilter === "all" ? "active" : ""} onClick={() => setLevelFilter("all")}>全部</button><button type="button" className={levelFilter === "0" ? "active" : ""} onClick={() => setLevelFilter("0")}>未学习</button><button type="button" className={levelFilter === "1" ? "active" : ""} onClick={() => setLevelFilter("1")}>不认识</button><button type="button" className={levelFilter === "2" ? "active" : ""} onClick={() => setLevelFilter("2")}>复习中</button><button type="button" className={levelFilter === "known" ? "active" : ""} onClick={() => setLevelFilter("known")}>复习完成</button><button type="button" className={levelFilter === "stableish" ? "active" : ""} onClick={() => setLevelFilter("stableish")}>已标熟</button><button type="button" className={levelFilter === "12" ? "active" : ""} onClick={() => setLevelFilter("12")}>稳定</button></div>
    {reviewMessage ? <div className="success-box">{reviewMessage}</div> : null}{reviewItems.length ? <div className="review-strip">{reviewItems.map((word) => <div key={`${word.libraryId}-${word.lemma}`} className="review-card"><strong>{word.lemma}</strong><span>{word.meaning || "暂无释义"}</span><div><button type="button" className="mini-btn" onClick={() => markReview(word, "known")}>认识</button><button type="button" className="ghost-btn mini-ghost-btn" onClick={() => markReview(word, "fuzzy")}>模糊</button><button type="button" className="danger-btn mini-ghost-btn" onClick={() => markReview(word, "unknown")}>不认识</button></div></div>)}</div> : null}
    <div className="panel-title compact"><h2>单词列表</h2><span>共 {wordData.total} 个 · 第 {wordData.page} / {wordData.totalPages} 页 · {listLayout === "tiles" ? "词块" : "列表"} · {listMode === "browse" ? "浏览模式" : "回想模式"}</span></div>
    <MasteryOverview overview={wordData.overview} />
    {error ? <div className="error-box">{error}</div> : null}{detailError ? <div className="error-box">{detailError}</div> : null}{loading ? <div className="empty-state">加载中...</div> : null}
    {!loading && wordData.items.length === 0 ? <div className="empty-state">没有找到符合条件的单词。</div> : <div className={`vocab-list ${listLayout === "tiles" ? "vocab-list-tiles" : ""}`}>{wordData.items.map((word) => {
      const key = `${word.libraryId}-${word.lemma}`;
      const expanded = listMode === "browse" || expandedKeys.has(key);
      const showInline = expanded && effectiveConfig.detailPlacement === "below";
      const wordLibrary = libraries.find((library) => library.id === word.libraryId);
      const tileFields = listLayout === "tiles"
        ? tileFieldsForWord(word, wordLibrary?.displayConfig?.wordListFields || effectiveConfig.wordListFields)
        : [];
      return <div key={key} className={`vocab-row ${listLayout === "tiles" ? "vocab-tile" : ""} ${expanded ? "expanded" : ""} ${levelClass(word.level)}`} onClick={() => toggleExpand(word)}>
        {listLayout === "tiles" ? <div className="vocab-tile-face">
          <div className="vocab-tile-heading"><span className="vocab-word selectable-copy">{word.lemma}</span><span className="vocab-level">Lv.{word.level ?? 0}</span></div>
          {tileFields.length ? <div className="vocab-tile-fields">{tileFields.map((field) => <div className="vocab-tile-field selectable-copy" key={field.key}><span className="vocab-tile-field-label">{field.label}：</span><span className="vocab-tile-field-value">{field.value}</span></div>)}</div> : null}
        </div> : <div className="vocab-row-main"><span className="vocab-row-word selectable-copy">{word.lemma}</span>{expanded ? <><span className="vocab-row-ipa selectable-copy">{word.ipa || ""}</span><span className="vocab-row-meaning selectable-copy">{word.meaning || "暂无释义"}</span></> : <span className="vocab-row-hint">点击查看详情</span>}<span className="vocab-row-level">Lv.{word.level ?? 0}</span></div>}
        {showInline ? renderExpandedDetails(word) : null}
      </div>;
    })}</div>}
    {effectiveConfig.detailPlacement === "floating" && selectedWord ? <aside className="library-detail-drawer library-word-floating-drawer">
      <WordDetailPanel
        word={selectedWord}
        aiEntry={selectedWordAiEntry}
        loading={detailLoadingKey === selectedWordAiKey}
        error={detailError}
        onQuery={() => handleWordDetailQuery(selectedWord, false)}
        onRefresh={() => handleWordDetailQuery(selectedWord, true)}
        onClose={() => setFloatingWord(null)}
        onAddToExtra={() => handleAddDetailToExtra(selectedWord)}
        displayConfig={effectiveConfig}
      />
    </aside> : null}
    <div className="pagination"><button type="button" className="ghost-btn" disabled={wordData.page <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>上一页</button><span>第 {wordData.page} / {wordData.totalPages} 页</span><button type="button" className="ghost-btn" disabled={wordData.page >= wordData.totalPages} onClick={() => setPage((prev) => prev + 1)}>下一页</button></div>
    {createPortal(
      <button type="button" className="rush-floating-launcher" onClick={() => onOpenRush?.()}>⚡ 单词速刷 <span>{wordData.total || 0}</span></button>,
      document.body
    )}
  </section>;
}

function LibraryManagementPage({ libraries, defaultExtraLibraryId, refreshLibraries }) {
  const mainLibraries = libraries.filter((library) => library.type === "main");
  const extraLibraries = libraries.filter((library) => library.type === "extra");
  const [firstSourceId, setFirstSourceId] = useState("");
  const [secondSourceId, setSecondSourceId] = useState("");
  const [mergedName, setMergedName] = useState("");
  const [deleteSources, setDeleteSources] = useState(false);
  const [newExtraName, setNewExtraName] = useState("");
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [displayConfig, setDisplayConfig] = useState({ listMode: "recall", listLayout: "list", rushMode: "recall", detailPlacement: "below", allowMultipleExpanded: true });
  const [displaySaveError, setDisplaySaveError] = useState("");
  const loadedConfigLibraryId = useRef("");
  const selectedConfigLibrary = libraries.find((library) => library.id === selectedConfigId);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mainLibraries.length < 2) return;
    if (!mainLibraries.some((library) => library.id === firstSourceId)) setFirstSourceId(mainLibraries[0].id);
    if (!mainLibraries.some((library) => library.id === secondSourceId) || secondSourceId === firstSourceId) setSecondSourceId(mainLibraries.find((library) => library.id !== firstSourceId)?.id || mainLibraries[1].id);
  }, [mainLibraries, firstSourceId, secondSourceId]);
  useEffect(() => {
    if (!selectedConfigId || !libraries.some((library) => library.id === selectedConfigId)) setSelectedConfigId(mainLibraries[0]?.id || extraLibraries[0]?.id || "");
  }, [libraries, selectedConfigId, mainLibraries, extraLibraries]);
  useEffect(() => {
    if (!selectedConfigLibrary || loadedConfigLibraryId.current === selectedConfigId) return;
    loadedConfigLibraryId.current = selectedConfigId;
    setDisplayConfig({ listMode: "recall", listLayout: "list", rushMode: "recall", detailPlacement: "below", allowMultipleExpanded: true, ...selectedConfigLibrary.displayConfig });
  }, [selectedConfigId, selectedConfigLibrary]);

  const complete = async (action, successMessage) => { setSaving(true); setError(""); setMessage(""); try { await action(); await refreshLibraries(); setMessage(successMessage); } catch (requestError) { setError(requestError.message); } finally { setSaving(false); } };
  const handleMerge = () => { if (!firstSourceId || !secondSourceId || firstSourceId === secondSourceId) return setError("请选择两个不同的主词库。"); if (!mergedName.trim()) return setError("请填写合并后词库名称。"); if (deleteSources && !window.confirm("合并后将删除两个来源词库。确定继续吗？")) return; complete(() => postJson("/api/libraries/merge", { sourceLibraryIds: [firstSourceId, secondSourceId], name: mergedName, deleteSources }), deleteSources ? "已实质合并并删除来源词库。" : "已创建合并后的新词库，原词库仍被保留。"); };
  const handleCreateExtra = () => { if (!newExtraName.trim()) return setError("请填写补充词库名称。"); complete(async () => { await postJson("/api/extra-libraries", { name: newExtraName }); setNewExtraName(""); }, "已创建补充词库。"); };
  const handleRename = (library) => { const name = window.prompt("输入新的词库名称", library.name); if (name == null || !name.trim() || name.trim() === library.name) return; complete(() => putJson(`/api/libraries/${encodeURIComponent(library.id)}`, { name }), "词库名称已更新。"); };
  const handleDelete = (library) => { if (library.type === "basic") return; const ok = window.confirm(`确定删除“${library.name}”吗？\n包含 ${library.count || 0} 个词条，删除后无法恢复。`); if (!ok) return; complete(() => request(`/api/libraries/${encodeURIComponent(library.id)}?confirm=DELETE`, { method: "DELETE" }), `${library.type === "main" ? "主词库" : "补充词库"}已删除。`); };
  const handleDefault = (library) => complete(() => postJson("/api/extra-libraries/default", { libraryId: library.id }), `已将“${library.name}”设为默认补充词库。`);
  const saveDisplayConfig = async () => { if (!selectedConfigId) return; setSaving(true); setDisplaySaveError(""); setMessage(""); try { const result = await putJson(`/api/libraries/${encodeURIComponent(selectedConfigId)}/display-config`, { displayConfig }); setDisplayConfig(result.displayConfig || displayConfig); await refreshLibraries(); setMessage("单词列表与速刷显示设置已保存。"); } catch (requestError) { setDisplaySaveError(requestError.message); } finally { setSaving(false); } };

  return <section className="panel library-management-page">
    <div className="page-header"><div><h1>词库管理</h1><p>管理主词库、补充词库，并为每个词库设置单词列表与速刷的显示方式。</p></div></div>
    {message ? <div className="success-box">{message}</div> : null}{error ? <div className="error-box">{error}</div> : null}
    <section className="management-section"><div className="panel-title"><h2>实质合并主词库</h2><span>不会替代“合并查看”</span></div><p className="upload-tips">同一单词会合并教材位置与非空自定义字段；没有重复的词条会完整保留到新词库。</p>{mainLibraries.length < 2 ? <div className="warning-box">至少需要两个主词库才能合并。</div> : <><div className="management-form-grid"><select className="select-input" value={firstSourceId} onChange={(event) => setFirstSourceId(event.target.value)}>{mainLibraries.map((library) => <option key={library.id} value={library.id}>{library.name}，{library.count} 词</option>)}</select><select className="select-input" value={secondSourceId} onChange={(event) => setSecondSourceId(event.target.value)}>{mainLibraries.filter((library) => library.id !== firstSourceId).map((library) => <option key={library.id} value={library.id}>{library.name}，{library.count} 词</option>)}</select><input className="text-mini-input" placeholder="合并后词库名称" value={mergedName} onChange={(event) => setMergedName(event.target.value)} /></div><label className="check-row management-check"><input type="checkbox" checked={deleteSources} onChange={(event) => setDeleteSources(event.target.checked)} /><span>合并成功后删除两个来源词库</span></label><button type="button" className="primary-btn" onClick={handleMerge} disabled={saving}>创建合并词库</button></>}</section>
    <section className="management-section"><div className="panel-title"><h2>主词库</h2><span>{mainLibraries.length} 个</span></div><div className="management-library-list">{mainLibraries.map((library) => <div key={library.id} className="management-library-row"><div><strong>{library.name}</strong><span>{library.count} 词</span></div><div className="management-actions"><button type="button" className="ghost-btn mini-ghost-btn" onClick={() => handleRename(library)} disabled={saving}>改名</button><button type="button" className="danger-btn mini-ghost-btn" onClick={() => handleDelete(library)} disabled={saving}>删除</button></div></div>)}</div></section>
    <section className="management-section"><div className="panel-title"><h2>补充词库</h2><span>{extraLibraries.length} 个</span></div><div className="upload-row"><input className="text-mini-input" placeholder="新补充词库名称" value={newExtraName} onChange={(event) => setNewExtraName(event.target.value)} /><button type="button" className="secondary-btn" onClick={handleCreateExtra} disabled={saving}>新建补充词库</button></div><div className="management-library-list">{extraLibraries.map((library) => <div key={library.id} className="management-library-row"><div><strong>{library.name}</strong><span>{library.count} 词 {library.id === defaultExtraLibraryId ? "· 默认识别加入位置" : ""}</span></div><div className="management-actions">{library.id !== defaultExtraLibraryId ? <button type="button" className="ghost-btn mini-ghost-btn" onClick={() => handleDefault(library)} disabled={saving}>设为默认</button> : <span className="tag">默认</span>}<button type="button" className="ghost-btn mini-ghost-btn" onClick={() => handleRename(library)} disabled={saving}>改名</button><button type="button" className="danger-btn mini-ghost-btn" onClick={() => handleDelete(library)} disabled={saving || library.id === defaultExtraLibraryId || extraLibraries.length <= 1}>删除</button></div></div>)}</div><div className="upload-tips">默认补充词库不能删除；请先设定另一个默认库。至少保留一个补充词库。</div></section>
    <section className="management-section display-settings-section"><div className="panel-title"><h2>单词显示设置</h2><span>按词库保存</span></div><p className="upload-tips">列表的“回想模式”点击后才显示完整信息；词块样式始终显示在“分析设置”里选定的表面字段。点击展开时会自动播放音频。</p><select className="select-input wide-select" value={selectedConfigId} disabled={saving} onChange={(event) => { setDisplaySaveError(""); setSelectedConfigId(event.target.value); }}>{[...mainLibraries, ...extraLibraries].map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select><div className="display-settings-panels">
          <section className="display-settings-card list-settings-card">
            <div className="settings-card-heading"><span className="settings-card-kicker">LIST VIEW</span><h3>单词列表设置</h3><p>控制单词库主页的列表/词块样式和详情展开方式。</p></div>
            <label className="setting-choice"><span>单词列表显示样式</span><select className="select-input" value={displayConfig.listLayout || "list"} onChange={(event) => setDisplayConfig((prev) => ({ ...prev, listLayout: event.target.value }))}><option value="list">列表：逐行显示</option><option value="tiles">词块</option></select></label>
            <div className="setting-note">词块表面显示哪些字段，请到“分析设置 → 单词库词块表面字段”选择并保存。</div>
            <label className="setting-choice"><span>单词列表模式</span><select className="select-input" value={displayConfig.listMode} onChange={(event) => setDisplayConfig((prev) => ({ ...prev, listMode: event.target.value }))}><option value="recall">回想模式：点击显示详情</option><option value="browse">浏览模式：直接显示详情</option></select></label>
            <label className="setting-choice"><span>详情显示位置</span><select className="select-input" value={displayConfig.detailPlacement} onChange={(event) => setDisplayConfig((prev) => ({ ...prev, detailPlacement: event.target.value }))}><option value="below">在单词下方展开</option><option value="floating">悬浮窗/抽屉显示</option></select></label>
            <label className="check-row"><input type="checkbox" checked={Boolean(displayConfig.allowMultipleExpanded)} onChange={(event) => setDisplayConfig((prev) => ({ ...prev, allowMultipleExpanded: event.target.checked }))} /><span>允许同时展开多个单词</span></label>
          </section>
          <section className="display-settings-card rush-settings-card">
            <div className="settings-card-heading"><span className="settings-card-kicker">RUSH MODE</span><h3>单词速刷设置</h3><p>控制独立单词速刷页面的释义显示方式。</p></div>
            <label className="setting-choice"><span>单词速刷模式</span><select className="select-input" value={displayConfig.rushMode} onChange={(event) => setDisplayConfig((prev) => ({ ...prev, rushMode: event.target.value }))}><option value="recall">回想模式：点击显示释义</option><option value="browse">浏览模式：直接显示释义</option></select></label>
            <div className="setting-note">进入单词或切换下一个单词时自动播放音频；词库音频优先，无音频时使用浏览器朗读。</div>
          </section>
        </div><button type="button" className="primary-btn" onClick={saveDisplayConfig} disabled={saving || !selectedConfigId}>{saving ? "保存中…" : "保存显示设置"}</button>{displaySaveError ? <div className="error-box" role="alert">显示设置保存失败：{displaySaveError}</div> : null}</section>
  </section>;
}

function LibraryPage({
  libraries,
  defaultExtraLibraryId,
  refreshLibraries,
  needLibraryRefresh,
  wordAiCache,
  fetchWordAi,
  clearWordAiCache,
  aiSettings,
  onOpenRush
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
        onOpenRush={onOpenRush}
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


function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return { r: 79, g: 70, b: 229 };
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}

function AppearancePage({ appearance, setAppearance }) {
  const presets = [
    { name: "Indigo 蓝紫", color: "#4f46e5" },
    { name: "Ocean 海洋", color: "#0284c7" },
    { name: "Emerald 翡翠", color: "#059669" },
    { name: "Rose 玫红", color: "#e11d48" },
    { name: "Amber 琥珀", color: "#d97706" },
    { name: "Slate 石墨", color: "#475569" }
  ];

  const handleBackgroundImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 8 * 1024 * 1024) {
      window.alert("背景图片不能超过 8MB。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1800;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setAppearance((prev) => ({ ...prev, backgroundMode: "image", backgroundImage: canvas.toDataURL("image/webp", 0.78) }));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const rgb = hexToRgb(appearance.primaryColor);
  return (
    <div className="page-content appearance-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">PERSONALIZE YOUR STUDY DESK</div>
          <h1>外观设置</h1>
          <p>把词汇诊断调整成适合长时间阅读和速刷的学习工作台。</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => setAppearance(DEFAULT_APPEARANCE)}>恢复默认外观</button>
      </div>
      <div className="appearance-grid">
        <section className="panel appearance-card">
          <div className="panel-title"><h2>主题模式</h2><span>设置会自动保存在本机</span></div>
          <div className="appearance-segmented">
            {[['light','浅色'],['dark','深色'],['system','跟随系统']].map(([value, label]) => <button key={value} type="button" className={appearance.themeMode === value ? "active" : ""} onClick={() => setAppearance((prev) => ({ ...prev, themeMode: value }))}>{label}</button>)}
          </div>
          <div className="panel-subtitle">主色</div>
          <div className="theme-swatches">
            {presets.map((preset) => <button key={preset.color} type="button" className={`theme-swatch ${appearance.primaryColor === preset.color ? "selected" : ""}`} style={{ "--swatch": preset.color }} onClick={() => setAppearance((prev) => ({ ...prev, primaryColor: preset.color }))} title={preset.name}><span />{preset.name}</button>)}
          </div>
          <label className="color-picker-row"><span>自定义主色</span><input type="color" value={appearance.primaryColor} onChange={(event) => setAppearance((prev) => ({ ...prev, primaryColor: event.target.value }))} /><code>{appearance.primaryColor}</code></label>
        </section>
        <section className="panel appearance-card">
          <div className="panel-title"><h2>背景与可读性</h2><span>阅读页可开启沉浸背景</span></div>
          <div className="appearance-segmented">
            {[['solid','纯色'],['gradient','渐变'],['image','图片']].map(([value, label]) => <button key={value} type="button" className={appearance.backgroundMode === value ? "active" : ""} onClick={() => setAppearance((prev) => ({ ...prev, backgroundMode: value }))}>{label}</button>)}
          </div>
          {appearance.backgroundMode === "solid" ? <label className="color-picker-row"><span>页面背景颜色</span><input type="color" value={appearance.backgroundColor} onChange={(event) => setAppearance((prev) => ({ ...prev, backgroundColor: event.target.value }))} /><code>{appearance.backgroundColor}</code></label> : null}
          {appearance.backgroundMode === "image" ? <div className="background-upload-box"><label className="secondary-btn upload-background-btn">选择背景图片<input type="file" accept="image/*" onChange={handleBackgroundImage} /></label>{appearance.backgroundImage ? <button type="button" className="ghost-btn" onClick={() => setAppearance((prev) => ({ ...prev, backgroundImage: "", backgroundMode: "solid" }))}>移除图片</button> : <span>建议使用 16:9 图片，自动压缩保存</span>}</div> : null}
          {appearance.backgroundMode === "gradient" ? <div className="gradient-preview" /> : null}
          <label className="range-row"><span>背景遮罩</span><input type="range" min="0" max="0.6" step="0.01" value={appearance.backgroundOverlay} onChange={(event) => setAppearance((prev) => ({ ...prev, backgroundOverlay: Number(event.target.value) }))} /><strong>{Math.round(appearance.backgroundOverlay * 100)}%</strong></label>
          <label className="range-row"><span>面板透明度</span><input type="range" min="0.82" max="1" step="0.01" value={appearance.panelOpacity} onChange={(event) => setAppearance((prev) => ({ ...prev, panelOpacity: Number(event.target.value) }))} /><strong>{Math.round(appearance.panelOpacity * 100)}%</strong></label>
        </section>
      </div>
      <section className="appearance-preview panel" style={{ "--preview-color": `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` }}>
        <div><span className="eyebrow">LIVE PREVIEW</span><h2>学习工作台 + 沉浸阅读 + 单词速刷</h2><p>左侧导航支持桌面收缩，窄屏会自动变为抽屉；单词速刷页面会采用更高对比度的专注布局。</p></div>
        <div className="preview-mini-card"><strong>abandon</strong><span>/əˈbændən/ · 放弃</span><button type="button" className="mini-btn">认识</button></div>
      </section>
    </div>
  );
}

function WordRushPage({ libraries, onExit, aiSettings, fetchWordAi, displayConfig = {} }) {
  const mainLibraries = libraries.filter((library) => library.type === "main");
  const [libraryId, setLibraryId] = useState("");
  const [source, setSource] = useState("due");
  const [limit, setLimit] = useState(20);
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const active = items[index] || null;
  const selectedLibrary = mainLibraries.find((library) => library.id === libraryId);
  const rushMode = selectedLibrary?.displayConfig?.rushMode || displayConfig.rushMode || "recall";
  const lastPlayedKeyRef = useRef("");

  useEffect(() => { if (!libraryId && mainLibraries[0]?.id) setLibraryId(mainLibraries[0].id); }, [mainLibraries, libraryId]);
  useEffect(() => { loadQueue(); }, [source, libraryId, limit]);
  useEffect(() => {
    setRevealed(rushMode === "browse");
  }, [rushMode, active?.lemma]);
  useEffect(() => {
    if (!active?.lemma || loading) return undefined;
    const playKey = `${active.libraryId || libraryId || "rush"}-${active.lemma}`;
    if (lastPlayedKeyRef.current === playKey) return undefined;
    lastPlayedKeyRef.current = playKey;
    const timer = window.setTimeout(() => playWordAudio(active), 0);
    return () => window.clearTimeout(timer);
  }, [active?.lemma, active?.libraryId, libraryId, loading]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
      if (event.code === "Space") { event.preventDefault(); setRevealed((value) => !value); }
      if (event.key === "1") answer("unknown");
      if (event.key === "2") answer("fuzzy");
      if (event.key === "3") answer("known");
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setIndex((value) => Math.min(items.length - 1, value + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, index, loading]);

  async function loadQueue() {
    lastPlayedKeyRef.current = "";
    setLoading(true); setError(""); setMessage(""); setIndex(0); setRevealed(false); setAiResult(null);
    try {
      const result = source === "due" ? await getJson(`/api/review/due?limit=${limit}`) : await getJson(`/api/libraries/${encodeURIComponent(libraryId)}/words?page=1&pageSize=${limit}&query=&levelFilter=${source}`);
      setItems((result.items || []).slice(0, limit));
      if (!(result.items || []).length) setMessage(source === "due" ? "当前没有到期复习词，可以切换到词库速刷。" : "当前筛选下没有可速刷单词。");
    } catch (err) { setError(`加载速刷队列失败：${err.message}`); } finally { setLoading(false); }
  }

  async function answer(mark) {
    if (!active || loading) return;
    try {
      await postJson("/api/review/mark", { lemma: active.lemma, mark });
      const label = mark === "known" ? "认识" : mark === "fuzzy" ? "模糊" : "不认识";
      setMessage(`${active.lemma}：已标记为${label}`);
      setAiResult(null);
      setRevealed(false);
      if (index >= items.length - 1) setIndex(items.length);
      else setIndex((value) => value + 1);
    } catch (err) { setError(`记录复习结果失败：${err.message}`); }
  }

  function revealActive() {
    if (!active) return;
    setRevealed((value) => rushMode === "browse" ? true : !value);
  }

  async function askAi() {
    if (!active || !fetchWordAi) return;
    setAiLoading(true); setError("");
    try { setAiResult(await fetchWordAi({ key: `rush-${active.lemma}`, word: active.lemma, libraryContext: { meaning: active.meaning, unit: active.unit, page: active.page } })); setRevealed(true); }
    catch (err) { setError(`AI 解析失败：${err.message}`); }
    finally { setAiLoading(false); }
  }

  const finished = !active && items.length > 0;
  return (
    <div className="page-content word-rush-page">
      <div className="page-header">
        <div><div className="eyebrow">专注速刷</div><h1>单词速刷</h1><p>当前为{rushMode === "browse" ? "浏览模式" : "回想模式"}，进入单词或切换下一个单词时自动播放音频。</p></div>
        <button type="button" className="ghost-btn" onClick={onExit}>返回单词库</button>
      </div>
      <div className="rush-toolbar panel">
        <label>复习范围<select className="select-input" value={source} onChange={(event) => setSource(event.target.value)}><option value="due">到期复习</option><option value="all">全部词库</option><option value="1">不认识</option><option value="2">模糊</option><option value="known">认识</option><option value="stableish">较稳定</option></select></label>
        <label>词库<select className="select-input" value={libraryId} onChange={(event) => setLibraryId(event.target.value)} disabled={source === "due"}>{mainLibraries.map((lib) => <option key={lib.id} value={lib.id}>{lib.name}</option>)}</select></label>
        <label>本轮数量<select className="select-input" value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value="10">10</option><option value="20">20</option><option value="30">30</option><option value="50">50</option></select></label>
        <button type="button" className="secondary-btn" onClick={loadQueue} disabled={loading}>{loading ? "加载中…" : "重新开始"}</button>
      </div>
      {error ? <div className="error-box">{error}</div> : null}{message ? <div className="success-box">{message}</div> : null}
      <section className="rush-stage">
        <div className="rush-progress"><span>本轮进度 {Math.min(index, items.length)} / {items.length || 0}</span><div><i style={{ width: `${items.length ? Math.min(100, (index / items.length) * 100) : 0}%` }} /></div></div>
        {finished ? <div className="rush-complete panel"><div className="rush-complete-icon">✓</div><h2>本轮完成</h2><p>这轮单词已经刷完，可以重新开始或切换复习范围。</p><button type="button" className="primary-btn" onClick={loadQueue}>再来一轮</button></div> : active ? <div className="rush-card panel">
          <div className="rush-card-top"><span className="rush-level">Lv.{active.level ?? 0}</span><span>{active.libraryName || "个人词库"}</span></div>
          <div className="rush-word">{active.lemma || active.displayText}</div>
          {active.ipa ? <div className="rush-ipa">{active.ipa}</div> : null}
          <button type="button" className={`rush-reveal ${revealed ? "revealed" : ""}`} onClick={revealActive}>
            {revealed ? <><strong>{active.pos ? `${active.pos} ` : ""}{active.meaning || "暂无释义"}</strong>{active.unit || active.page ? <small>{[active.unit && `单元 ${active.unit}`, active.page && `页码 ${active.page}`].filter(Boolean).join(" · ")}</small> : null}{aiResult ? <div className="rush-ai-result">{aiResult.meaning || aiResult.translation || aiResult.explanation || "已获得 AI 解析"}</div> : null}</> : <span>点击或按 Space 查看释义</span>}
          </button>
          <div className="rush-actions"><button type="button" className="rush-answer unknown" onClick={() => answer("unknown")}>1 · 不认识</button><button type="button" className="rush-answer fuzzy" onClick={() => answer("fuzzy")}>2 · 模糊</button><button type="button" className="rush-answer known" onClick={() => answer("known")}>3 · 认识</button></div>
          <div className="rush-secondary-actions"><button type="button" className="ghost-btn" onClick={() => playWordAudio(active)}>🔊 播放音频</button><button type="button" className="ghost-btn" onClick={askAi} disabled={aiLoading}>{aiLoading ? "解析中…" : "AI 解析"}</button></div>
        </div> : <div className="rush-empty panel"><div className="rush-empty-icon">⚡</div><h2>{loading ? "正在准备词卡…" : "还没有可刷单词"}</h2><p>{message || "请先导入词库，或切换复习范围。"}</p></div>}
      </section>
      <div className="rush-shortcuts"><span>{rushMode === "browse" ? "浏览模式：释义常驻" : "点击 / Space 揭示释义"}</span><span>1 不认识</span><span>2 模糊</span><span>3 认识</span><span>← / → 切换</span></div>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLocalStorageJson(SIDEBAR_COLLAPSED_STORAGE_KEY, false));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [appearance, setAppearance] = useState(() => ({ ...DEFAULT_APPEARANCE, ...readLocalStorageJson(APPEARANCE_STORAGE_KEY, {}) }));
  const [backendStatus, setBackendStatus] = useState("checking");
  const [libraries, setLibraries] = useState([]);
  const [defaultExtraLibraryId, setDefaultExtraLibraryId] = useState("");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState([]);
  const [includeExtra, setIncludeExtra] = useState(true);
  const [analysisMode, setAnalysisMode] = useState("friendly");
  const [ignoreBasicWords, setIgnoreBasicWords] = useState(true);
  const activeDisplayLibrary = libraries.find((library) => selectedLibraryIds.includes(library.id)) || libraries.find((library) => library.type === "main");
  const [displayConfig, setDisplayConfig] = useState({});
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
    writeLocalStorageJson(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    writeLocalStorageJson(APPEARANCE_STORAGE_KEY, appearance);
    const root = document.documentElement;
    const rgb = hexToRgb(appearance.primaryColor);
    const dark = appearance.themeMode === "dark" || (appearance.themeMode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "dark" : "light";
    root.style.setProperty("--color-primary", appearance.primaryColor);
    root.style.setProperty("--color-primary-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty("--page-bg", appearance.backgroundMode === "solid" ? appearance.backgroundColor : appearance.backgroundMode === "gradient" ? `linear-gradient(135deg, ${appearance.backgroundColor}, color-mix(in srgb, ${appearance.primaryColor} 18%, white))` : "#e8eef9");
    root.style.setProperty("--panel-opacity", String(appearance.panelOpacity));
    root.style.setProperty("--background-image", appearance.backgroundImage ? `url(${appearance.backgroundImage})` : "none");
    root.style.setProperty("--background-overlay", String(appearance.backgroundOverlay));
    root.style.setProperty("--background-blur", `${appearance.backgroundBlur}px`);
    const sidebarMix = dark ? "#0f172a" : appearance.backgroundColor;
    root.style.setProperty("--sidebar-bg-start", `color-mix(in srgb, ${sidebarMix} 94%, ${appearance.primaryColor})`);
    root.style.setProperty("--sidebar-bg-end", `color-mix(in srgb, ${sidebarMix} 82%, ${appearance.primaryColor})`);
    root.style.setProperty("--sidebar-text", dark ? "#f8fafc" : "#172033");
    root.style.setProperty("--sidebar-muted", dark ? "#cbd5e1" : "#52627a");
    root.style.setProperty("--sidebar-border", `color-mix(in srgb, ${appearance.primaryColor} 22%, transparent)`);
  }, [appearance]);

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
    let disposed = false;
    let timer;
    const checkHealth = async () => {
      try {
        await request("/api/health", {}, 5000);
        if (!disposed) setBackendStatus("online");
      } catch {
        if (!disposed) {
          setBackendStatus("offline");
          timer = window.setTimeout(checkHealth, 1200);
        }
      }
    };
    checkHealth();
    return () => { disposed = true; if (timer) window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    refreshLibraries();
    refreshAISettings();
  }, []);

  useEffect(() => {
    setDisplayConfig(activeDisplayLibrary?.displayConfig || {});
  }, [activeDisplayLibrary?.id, activeDisplayLibrary?.displayConfig]);

  return (
    <div className={`app-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} mobileOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

      <main className="main-area">
        <div className="mobile-topbar"><button type="button" className="mobile-menu-btn" onClick={() => setMobileSidebarOpen((open) => !open)} aria-label={mobileSidebarOpen ? "关闭导航" : "打开导航"}>{mobileSidebarOpen ? "×" : "☰"}</button><span>词汇诊断</span><span className={`backend-health ${backendStatus}`} title={backendStatus === "online" ? "本地后端已连接" : "正在连接本地后端"}>{backendStatus === "online" ? "● 后端在线" : "○ 后端连接中"}</span><button type="button" className="mobile-appearance-btn" onClick={() => setActivePage("appearance")}>◐</button></div>
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
            displayConfig={displayConfig}
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
            displayConfig={displayConfig}
            setDisplayConfig={setDisplayConfig}
            refreshLibraries={refreshLibraries}
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
            onOpenRush={() => setActivePage("word-rush")}
          />
        ) : activePage === "library-import" ? (
          <div className="page-content"><UploadPanel libraries={libraries} refreshLibraries={refreshLibraries} selectedLibraryIds={[]} setSelectedLibraryIds={() => {}} aiSettings={aiSettings} /></div>
        ) : activePage === "library-basic" ? (
          <div className="page-content"><BasicWhitelistPage /></div>
        ) : activePage === "library-manage" ? (
          <div className="page-content"><LibraryManagementPage libraries={libraries} defaultExtraLibraryId={defaultExtraLibraryId} refreshLibraries={refreshLibraries} /></div>
        ) : activePage === "word-rush" ? (
          <WordRushPage libraries={libraries} onExit={() => setActivePage("library")} aiSettings={aiSettings} fetchWordAi={fetchWordAi} displayConfig={displayConfig} />
        ) : activePage === "appearance" ? (
          <AppearancePage appearance={appearance} setAppearance={setAppearance} />
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