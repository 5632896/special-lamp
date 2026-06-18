import { useEffect, useMemo, useRef, useState } from "react";

const WORD_REGEX = /[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z\s]+|\s+/g;
const REQUEST_TIMEOUT_MS = 20000;
const PAGE_SIZE = 50;
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
    const response = await fetch(url, {
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

  if (item.sourceText && item.libraryType === "extra") {
    parts.push("补充词库");
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

  if (word.unit && word.page) {
    parts.push(`${word.unit} / p.${word.page}`);
  } else if (word.unit) {
    parts.push(word.unit);
  }

  if (word.outside) {
    parts.push(word.outsideText);
  } else if (word.libraryType === "extra") {
    parts.push("补充词库");
  } else {
    parts.push("主词库");
  }

  if (word.frequencyText) {
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
  const raw = Array.isArray(result?.derivatives) ? result.derivatives : [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const [wordPart, meaningPart = ""] = item.split(/[:：]\s*/);
        return {
          word: (wordPart || "").trim(),
          meaning: (meaningPart || "").trim()
        };
      }
      return {
        word: item?.word || item?.lemma || item?.name || "",
        meaning: item?.meaning || item?.translation || ""
      };
    })
    .filter((item) => item.word || item.meaning);
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
    outside: !!word?.outside,
    outsideText: word?.outsideText || "",
    basicIgnored: !!word?.basicIgnored,
    selectionMark: word?.focusMark || "unknown"
  };
}

function Sidebar({ activePage, setActivePage }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-title">词汇诊断</div>
      <button
        type="button"
        className={`sidebar-item ${activePage === "home" ? "active" : ""}`}
        onClick={() => setActivePage("home")}
      >
        首页
      </button>
      <button
        type="button"
        className={`sidebar-item ${activePage === "library" ? "active" : ""}`}
        onClick={() => setActivePage("library")}
      >
        单词库
      </button>
      <button
        type="button"
        className={`sidebar-item ${activePage === "chat" ? "active" : ""}`}
        onClick={() => setActivePage("chat")}
      >
        AI 对话
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
  subtitle = "本地配置"
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
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
        apiKey: "",
        apiKeyMasked: result.apiKeyMasked,
        hasApiKey: result.hasApiKey,
        temperature: result.temperature,
        timeoutSeconds: result.timeoutSeconds,
        verifySSL: result.verifySSL
      }));

      setMessage("AI 设置已保存。");
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
              ? `已保存密钥：${aiSettings.apiKeyMasked || "已存在"}，留空则保留`
              : "API Key"
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
  setError
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [libraryName, setLibraryName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpload = async () => {
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

      const result = await postForm("/api/vocab/upload", formData);
      await refreshLibraries();

      if (result.library?.id) {
        setSelectedLibraryIds((prev) =>
          prev.includes(result.library.id) ? prev : [...prev, result.library.id]
        );
      }

      setMessage(`上传成功：${result.library.name}，共 ${result.importedCount} 个词。`);
      setLibraryName("");
      setSelectedFile(null);
    } catch (error) {
      setError(`上传失败：${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const mainCount = libraries.filter((lib) => lib.type === "main").length;

  return (
    <section className="panel upload-panel">
      <div className="panel-title">
        <h2>0. 上传词库</h2>
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
        <button
          type="button"
          className="primary-btn"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? "上传中..." : "上传为新主词库"}
        </button>
      </div>

      <div className="upload-tips">
        推荐上传 csv/xlsx。字段可包含：lemma、unit、page、frequency、in_syllabus、meaning。
      </div>

      {message ? <div className="success-box">{message}</div> : null}
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
  const extra = libraries.find((lib) => lib.type === "extra");

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
        <em>{extra?.count ?? 0} 词</em>
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

function AIWordResult({ result, wordMeta }) {
  if (!result) return null;

  const posDetails = normalizePosDetails(result);
  const derivatives = normalizeDerivativeDetails(result);

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

      <DetailSection title="词库信息">
        <div className="detail-item">
          <span className="detail-item-label">来源</span>
          <span>
            {wordMeta?.outside
              ? wordMeta.outsideText
              : wordMeta?.sourceText || wordMeta?.libraryName || "暂无"}
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-item-label">位置</span>
          <span>
            {wordMeta?.unit
              ? `${wordMeta.unit}${wordMeta.page ? ` / p.${wordMeta.page}` : ""}`
              : "暂无"}
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-item-label">等级</span>
          <span>
            {typeof wordMeta?.level === "number"
              ? `${wordMeta.level} · ${wordMeta.levelLabel || ""}`
              : "暂无"}
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-item-label">书内频率</span>
          <span>{wordMeta?.frequencyText || "暂无"}</span>
        </div>
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
                <strong>{item.word || "未命名"}</strong>
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
  onClose
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

function ChatSidebar({
  sessions,
  selectedChatId,
  onSelect,
  onCreate,
  onDelete,
  settingsExpanded,
  onToggleSettings,
  settingsContent
}) {
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

      <div className="chat-settings-shell">
        <button
          type="button"
          className="ghost-btn chat-settings-toggle"
          onClick={onToggleSettings}
        >
          {settingsExpanded ? "收起 AI 设置" : "展开 AI 设置"}
        </button>
        {settingsExpanded ? settingsContent : null}
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
  aiSettings
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
  const [analysisMode, setAnalysisMode] = useState("friendly");
  const [ignoreBasicWords, setIgnoreBasicWords] = useState(true);
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
        meaning: word.meaning || null
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
          <p>上传词库，选择参与分析的词库，然后标记文章中的单词。</p>
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

      <UploadPanel
        libraries={libraries}
        refreshLibraries={refreshLibraries}
        selectedLibraryIds={selectedLibraryIds}
        setSelectedLibraryIds={setSelectedLibraryIds}
        setError={setError}
      />

      <LibrarySelector
        libraries={libraries}
        selectedLibraryIds={selectedLibraryIds}
        setSelectedLibraryIds={setSelectedLibraryIds}
        includeExtra={includeExtra}
        setIncludeExtra={setIncludeExtra}
      />

      <AnalysisSettings
        analysisMode={analysisMode}
        setAnalysisMode={setAnalysisMode}
        ignoreBasicWords={ignoreBasicWords}
        setIgnoreBasicWords={setIgnoreBasicWords}
      />

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
                    className={`word-token ${tokenClass} ${
                      token.analysis
                        ? token.analysis.outside
                          ? "outline-outside"
                          : token.analysis.libraryType === "extra"
                          ? "outline-extra"
                          : "outline-book"
                        : ""
                    } ${selectedTokenId === token.id ? "token-selected" : ""}`}
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

          {selectedWordDetail ? (
            <WordDetailPanel
              word={selectedWordDetail}
              aiEntry={selectedWordAiEntry}
              loading={wordDetailLoadingKey === selectedWordAiKey}
              error={wordDetailError}
              onQuery={() => handleWordDetailQuery(false)}
              onRefresh={() => handleWordDetailQuery(true)}
              onClose={() => setSelectedTokenId(null)}
            />
          ) : null}

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

                          {selected ? (
                            <div onClick={(event) => event.stopPropagation()}>
                              <WordDetailPanel
                                word={selectedFocusDetail}
                                aiEntry={selectedFocusAiEntry}
                                loading={focusDetailLoadingKey === selectedFocusAiKey}
                                error={focusDetailError}
                                onQuery={() => handleFocusDetailQuery(false)}
                                onRefresh={() => handleFocusDetailQuery(true)}
                                onClose={() => setSelectedFocusKey("")}
                              />
                            </div>
                          ) : null}
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
        当前加入白名单的词不会删除。分析时若开启“忽略基础功能词”，这些词会按基础词处理。
      </div>

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {loading ? (
        <div className="empty-state">加载中...</div>
      ) : (
        <div className="word-grid">
          {words.map((word, index) => (
            <div
              key={`${word.lemma}-${index}`}
              className="vocab-card level-bg-0"
              title={`${word.lemma}\n${word.meaning || "基础功能词"}`}
            >
              <div className="vocab-word">{word.lemma}</div>
              <div className="vocab-meta">{word.meaning || "基础功能词"}</div>
              <div className="vocab-level">白名单</div>
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
  const extraLibrary = libraries.find((lib) => lib.type === "extra");

  const [viewMode, setViewMode] = useState("merged");
  const [selectedSingleLibraryId, setSelectedSingleLibraryId] = useState("");
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

  const activeLibraryId = selectedSingleLibraryId || mainLibraries[0]?.id || "";

  useEffect(() => {
    if (!selectedSingleLibraryId && mainLibraries.length > 0) {
      setSelectedSingleLibraryId(mainLibraries[0].id);
    }
  }, [mainLibraries, selectedSingleLibraryId]);

  useEffect(() => {
    setPage(1);
  }, [viewMode, selectedSingleLibraryId, query, levelFilter]);

  useEffect(() => {
    fetchWords();
  }, [
    viewMode,
    selectedSingleLibraryId,
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
        if (!extraLibrary?.id) {
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
          `/api/libraries/${extraLibrary.id}/words?page=${page}&pageSize=${PAGE_SIZE}` +
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
        forceRefresh
      });
    } catch (error) {
      setDetailError(`AI 解析失败：${error.message}`);
    } finally {
      setDetailLoadingKey("");
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
          合并主词库
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
      </div>

      <div className="panel-subtitle">掌握分布</div>
      <MasteryOverview overview={wordData.overview} />

      <div className="panel-title compact">
        <h2>单词列表</h2>
        <span>
          共 {wordData.total} 个，当前第 {wordData.page} / {wordData.totalPages} 页
        </span>
      </div>

      {selectedWord ? (
        <WordDetailPanel
          word={selectedWord}
          aiEntry={selectedWordAiEntry}
          loading={detailLoadingKey === selectedWordAiKey}
          error={detailError}
          onQuery={() => handleWordDetailQuery(false)}
          onRefresh={() => handleWordDetailQuery(true)}
          onClose={() => setSelectedCardKey("")}
        />
      ) : null}

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
                title={`${word.lemma}
词库：${word.libraryName || ""}
Unit：${word.unit || ""}
页码：${word.page || ""}
频率：${word.frequencyText || ""}
等级：${word.level} ${word.levelLabel}
词义：${word.meaning || ""}`}
                onClick={() => handleSelectWord(word)}
              >
                <div className="vocab-word">{word.lemma}</div>
                <div className="vocab-meta">{word.unit || "无 Unit"}</div>
                <div className="vocab-meta">
                  {word.page ? `p.${word.page}` : "无页码"} · {word.frequencyText || "书低频"}
                </div>
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
    </section>
  );
}

function LibraryPage({
  libraries,
  refreshLibraries,
  needLibraryRefresh,
  wordAiCache,
  fetchWordAi,
  clearWordAiCache
}) {
  const [subPage, setSubPage] = useState("libraries");

  return (
    <div className="page-content">
      <div className="layout-grid library-layout-grid">
        <section className="panel library-subnav-panel">
          <div className="panel-title">
            <h2>单词库模块</h2>
            <span>下属模块</span>
          </div>

          <div className="library-subnav">
            <button
              type="button"
              className={`tab-btn ${subPage === "libraries" ? "active" : ""}`}
              onClick={() => setSubPage("libraries")}
            >
              词库总览
            </button>
            <button
              type="button"
              className={`tab-btn ${subPage === "basic" ? "active" : ""}`}
              onClick={() => setSubPage("basic")}
            >
              基础词白名单
            </button>
          </div>
        </section>

        <div className="library-main-content">
          {subPage === "libraries" ? (
            <LibraryWordsPage
              libraries={libraries}
              refreshLibraries={refreshLibraries}
              needLibraryRefresh={needLibraryRefresh}
              wordAiCache={wordAiCache}
              fetchWordAi={fetchWordAi}
              clearWordAiCache={clearWordAiCache}
            />
          ) : (
            <BasicWhitelistPage />
          )}
        </div>
      </div>
    </div>
  );
}

function AIChatPage({
  aiSettings,
  setAiSettings,
  providerOptions,
  fieldHelp
}) {
  const [sessions, setSessions] = useState(() => {
    const stored = readLocalStorageJson(CHAT_SESSIONS_STORAGE_KEY, []);
    return Array.isArray(stored) && stored.length ? stored : [createChatSession(1)];
  });
  const [selectedChatId, setSelectedChatId] = useState(() => {
    const stored = readLocalStorageJson(CHAT_SELECTED_STORAGE_KEY, "");
    return stored || "";
  });
  const [inputMessage, setInputMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  useEffect(() => {
    writeLocalStorageJson(CHAT_SESSIONS_STORAGE_KEY, sessions);
  }, [sessions]);

  useEffect(() => {
    writeLocalStorageJson(CHAT_SELECTED_STORAGE_KEY, selectedChatId);
  }, [selectedChatId]);

  useEffect(() => {
    if (!sessions.length) {
      const first = createChatSession(1);
      setSessions([first]);
      setSelectedChatId(first.id);
      return;
    }

    if (!sessions.some((session) => session.id === selectedChatId)) {
      setSelectedChatId(sessions[0].id);
    }
  }, [sessions, selectedChatId]);

  const currentSession =
    sessions.find((session) => session.id === selectedChatId) || sessions[0] || null;

  const updateSession = (sessionId, updater) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? updater(session) : session
      )
    );
  };

  const handleCreateSession = () => {
    const next = createChatSession(sessions.length + 1);
    setSessions((prev) => [next, ...prev]);
    setSelectedChatId(next.id);
    setError("");
  };

  const handleDeleteSession = (sessionId) => {
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) return;

    const ok = window.confirm(`确定删除“${target.title}”吗？`);
    if (!ok) return;

    const remaining = sessions.filter((session) => session.id !== sessionId);

    if (remaining.length === 0) {
      const fresh = createChatSession(1);
      setSessions([fresh]);
      setSelectedChatId(fresh.id);
      setError("");
      return;
    }

    setSessions(remaining);

    if (selectedChatId === sessionId) {
      setSelectedChatId(remaining[0].id);
    }
  };

  const appendMessage = (sessionId, message, titleSource = "") => {
    updateSession(sessionId, (session) => ({
      ...session,
      title:
        session.messages.length === 0 && session.title.startsWith("新对话")
          ? buildChatTitleFromMessage(titleSource || message.content, session.title)
          : session.title,
      updatedAt: message.updatedAt || new Date().toISOString(),
      messages: [...session.messages, message]
    }));
  };

  const handleSend = async (forceRefresh = false) => {
    if (!inputMessage.trim()) {
      setError("请输入聊天内容。");
      return;
    }

    const activeSession = currentSession || createChatSession(1);
    const activeSessionId = activeSession.id;

    if (!currentSession) {
      setSessions([activeSession]);
      setSelectedChatId(activeSessionId);
    }

    setLoading(true);
    setError("");

    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputMessage,
      files: selectedFiles.map((file) => ({ name: file.name })),
      updatedAt: new Date().toISOString()
    };

    appendMessage(activeSessionId, userMessage, inputMessage);

    try {
      const formData = new FormData();
      formData.append("message", inputMessage);
      formData.append("forceRefresh", String(forceRefresh));
      formData.append("settingsJson", JSON.stringify(buildAISettingsPayload(aiSettings)));

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const result = await postForm("/api/ai/chat", formData);

      const assistantMessage = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: result.reply || "",
        files: result.files || [],
        cached: !!result.cached,
        updatedAt: result.updatedAt || new Date().toISOString()
      };

      appendMessage(activeSessionId, assistantMessage);
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
          onSelect={setSelectedChatId}
          onCreate={handleCreateSession}
          onDelete={handleDeleteSession}
          settingsExpanded={settingsExpanded}
          onToggleSettings={() => setSettingsExpanded((prev) => !prev)}
          settingsContent={
            <AISettingsPanel
              aiSettings={aiSettings}
              setAiSettings={setAiSettings}
              providerOptions={providerOptions}
              fieldHelp={fieldHelp}
              embedded
              title="AI 设置"
              subtitle="已从首页迁移到这里"
            />
          }
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

export default function App() {
  const [activePage, setActivePage] = useState("home");
  const [libraries, setLibraries] = useState([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState([]);
  const [includeExtra, setIncludeExtra] = useState(true);
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

  const fetchWordAi = async ({ key, word, context = null, forceRefresh = false }) => {
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
          />
        ) : activePage === "library" ? (
          <LibraryPage
            libraries={libraries}
            refreshLibraries={refreshLibraries}
            needLibraryRefresh={needLibraryRefresh}
            wordAiCache={wordAiCache}
            fetchWordAi={fetchWordAi}
            clearWordAiCache={clearWordAiCache}
          />
        ) : (
          <AIChatPage
            aiSettings={aiSettings}
            setAiSettings={setAiSettings}
            providerOptions={providerOptions}
            fieldHelp={fieldHelp}
          />
        )}
      </main>
    </div>
  );
}