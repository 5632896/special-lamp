export function getSourceTarget(mapping, fieldDefinitions, header) {
  const standard = Object.entries(mapping).find(([, source]) => source === header)?.[0];
  if (standard) return standard;
  const custom = fieldDefinitions.find((field) => (field.sourceHeader || field.source) === header && field.key);
  return custom ? `custom:${custom.key}` : "";
}

export function getSuggestedTarget(previewMapping, fieldDefinitions, header) {
  const standard = Object.entries(previewMapping || {}).find(([, source]) => source === header)?.[0];
  if (standard) return standard;
  const custom = fieldDefinitions.find((field) =>
    ((field.sourceHeader || field.source) === header || field.unmappedSourceHeader === header) && field.key
  );
  return custom ? `custom:${custom.key}` : "";
}

export function changeSourceMapping(mapping, fieldDefinitions, previewMapping, header, choice) {
  const currentTarget = getSourceTarget(mapping, fieldDefinitions, header);
  const nextTarget = choice === "mapped"
    ? (currentTarget || getSuggestedTarget(previewMapping, fieldDefinitions, header))
    : "";

  if (choice === "mapped" && !nextTarget) {
    // Unrecognized source columns need a real custom target, not just a binary UI state.
    const keys = new Set(fieldDefinitions.map((field) => field.key));
    let index = fieldDefinitions.length + 1;
    while (keys.has(`field_${index}`)) index += 1;
    return {
      mapping,
      fieldDefinitions: [...fieldDefinitions, {
        key: `field_${index}`, label: header || "自定义字段", sourceHeader: header
      }]
    };
  }

  const nextMapping = Object.fromEntries(Object.entries(mapping).filter(([, source]) => source !== header));
  if (choice === "mapped") {
    // A source column can feed more than one standard target.
    for (const [target, source] of Object.entries(previewMapping || {})) {
      if (source === header) nextMapping[target] = header;
    }
    if (nextTarget && !nextTarget.startsWith("custom:")) nextMapping[nextTarget] = header;
  }
  const nextFields = fieldDefinitions.map((field) => {
    const currentSource = field.sourceHeader || field.source;
    if (choice === "mapped") {
      // Restore every custom binding saved when this source column was unmapped.
      return currentSource === header || field.unmappedSourceHeader === header
        ? { ...field, sourceHeader: header, unmappedSourceHeader: "" }
        : field;
    }
    return currentSource === header
      ? { ...field, sourceHeader: "", source: "", unmappedSourceHeader: header }
      : field;
  });
  return { mapping: nextMapping, fieldDefinitions: nextFields };
}
