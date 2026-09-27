export const DEFAULT_WORD_LIST_FIELDS = [
  { key: "meaning", label: "释义", source: "meaning", enabled: true, showEmpty: false },
  { key: "ipa", label: "音标", source: "ipa", enabled: true, showEmpty: false },
  { key: "unit", label: "单元", source: "unit", enabled: true, showEmpty: false }
];

export function tileFieldsForWord(word, fields = DEFAULT_WORD_LIST_FIELDS) {
  return (Array.isArray(fields) ? fields : DEFAULT_WORD_LIST_FIELDS)
    .filter((field) => field && field.enabled !== false)
    .map((field) => {
      const source = field.source || "";
      const value = source.startsWith("customFields.")
        ? word?.customFields?.[source.slice("customFields.".length)]
        : word?.[source];
      const isEmpty = value === null || value === undefined || String(value).trim() === "";
      if (isEmpty && !field.showEmpty) return null;
      return {
        key: field.key || source,
        label: field.label || source,
        value: isEmpty ? "-" : String(value)
      };
    })
    .filter(Boolean);
}
