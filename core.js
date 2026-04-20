export const GOOGLE_PROVIDER = 'google-ai-studio';
export const OPENROUTER_PROVIDER = 'openrouter';
export const SOURCE_MODE_NATIVE = 'native-file';
export const SOURCE_MODE_EXTRACTED = 'extracted-text';

export const PROVIDER_LABELS = {
  [GOOGLE_PROVIDER]: 'Google AI Studio',
  [OPENROUTER_PROVIDER]: 'OpenRouter',
};

export const GOOGLE_MODELS = [
  { id: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview', supportsText: true, supportsFile: true, contextLength: 1048576 },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', supportsText: true, supportsFile: true, contextLength: 1048576 },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', supportsText: true, supportsFile: true, contextLength: 1048576 },
  { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite', supportsText: true, supportsFile: true, contextLength: 1048576 },
];

const STORAGE_KEYS = {
  prompt: 'distillboard.prompt',
  model: 'distillboard.model',
  provider: 'distillboard.provider',
  sourceMode: 'distillboard.source_mode',
  providerKeys: 'distillboard.provider_keys',
  legacyGeminiKey: 'distillboard.gemini_key',
  savedKeys: 'distillboard.saved_keys',
  savedPrompts: 'distillboard.saved_prompts',
  useTemperature: 'distillboard.useTemperature',
  temperature: 'distillboard.temperature',
  themeMode: 'distillboard.themeMode',
  autoWaitBetweenRequests: 'distillboard.autoWaitBetweenRequests',
};

export function getStorageKeys() {
  return { ...STORAGE_KEYS };
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

export function countWords(text) {
  const matches = String(text || '').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu);
  return matches ? matches.length : 0;
}

export function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function sim3(a, b) {
  const grams = value => {
    const normalized = (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const out = new Set();
    for (let i = 0; i < Math.max(0, normalized.length - 2); i++) out.add(normalized.slice(i, i + 3));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  const inter = [...left].filter(value => right.has(value)).length;
  const union = new Set([...left, ...right]).size || 1;
  return inter / union;
}

export function stripMd(md) {
  return (md || '').replace(/[>#*_`~\-]+/g, '').replace(/\n{3,}/g, '\n\n');
}

export function getFileKind(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.epub')) return 'epub';
  return '';
}

export function getFileSignature(file) {
  if (!file) return '';
  return [file.name || '', file.size || 0, file.lastModified || 0, file.type || ''].join(':');
}

export function getProviderLabel(providerId) {
  return PROVIDER_LABELS[providerId] || providerId;
}

export function getDefaultProvider() {
  return GOOGLE_PROVIDER;
}

export function getDefaultSourceMode() {
  return SOURCE_MODE_NATIVE;
}

export function getDefaultGoogleModel() {
  return GOOGLE_MODELS[1]?.id || GOOGLE_MODELS[0].id;
}

export function loadProvider(storage = localStorage) {
  const value = storage.getItem(STORAGE_KEYS.provider);
  return value === OPENROUTER_PROVIDER ? OPENROUTER_PROVIDER : GOOGLE_PROVIDER;
}

export function loadSourceMode(storage = localStorage) {
  const value = storage.getItem(STORAGE_KEYS.sourceMode);
  return value === SOURCE_MODE_EXTRACTED ? SOURCE_MODE_EXTRACTED : SOURCE_MODE_NATIVE;
}

export function loadProviderKeys(storage = localStorage) {
  const fallback = {
    [GOOGLE_PROVIDER]: '',
    [OPENROUTER_PROVIDER]: '',
  };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEYS.providerKeys) || '{}');
    return {
      ...fallback,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch {
    return fallback;
  }
}

export function persistProviderKeys(providerKeys, storage = localStorage) {
  storage.setItem(STORAGE_KEYS.providerKeys, JSON.stringify({
    [GOOGLE_PROVIDER]: providerKeys?.[GOOGLE_PROVIDER] || '',
    [OPENROUTER_PROVIDER]: providerKeys?.[OPENROUTER_PROVIDER] || '',
  }));
}

export function setStoredApiKey(providerId, key, storage = localStorage) {
  const providerKeys = loadProviderKeys(storage);
  providerKeys[providerId] = key || '';
  persistProviderKeys(providerKeys, storage);
}

export function getStoredApiKey(providerId, storage = localStorage) {
  return loadProviderKeys(storage)[providerId] || '';
}

export function clearStoredApiKey(providerId, storage = localStorage) {
  const providerKeys = loadProviderKeys(storage);
  providerKeys[providerId] = '';
  persistProviderKeys(providerKeys, storage);
}

export function normalizeSavedKeys(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(Boolean)
    .map(entry => ({
      label: entry.label || 'Default',
      key: entry.key || '',
      provider: entry.provider === OPENROUTER_PROVIDER ? OPENROUTER_PROVIDER : GOOGLE_PROVIDER,
      created: Number(entry.created) || Date.now(),
    }))
    .filter(entry => entry.key);
}

export function loadSavedKeys(storage = localStorage) {
  try {
    return normalizeSavedKeys(JSON.parse(storage.getItem(STORAGE_KEYS.savedKeys) || '[]'));
  } catch {
    return [];
  }
}

export function persistSavedKeys(savedKeys, storage = localStorage) {
  storage.setItem(STORAGE_KEYS.savedKeys, JSON.stringify(normalizeSavedKeys(savedKeys)));
}

export function migrateLegacyStorage(storage = localStorage) {
  const legacyGeminiKey = storage.getItem(STORAGE_KEYS.legacyGeminiKey);
  const providerKeys = loadProviderKeys(storage);
  let changed = false;

  if (legacyGeminiKey && !providerKeys[GOOGLE_PROVIDER]) {
    providerKeys[GOOGLE_PROVIDER] = legacyGeminiKey;
    changed = true;
  }

  if (changed) persistProviderKeys(providerKeys, storage);

  const savedKeys = loadSavedKeys(storage);
  const migratedSavedKeys = normalizeSavedKeys(savedKeys.map(entry => (
    entry.provider ? entry : { ...entry, provider: GOOGLE_PROVIDER }
  )));
  if (JSON.stringify(savedKeys) !== JSON.stringify(migratedSavedKeys)) {
    persistSavedKeys(migratedSavedKeys, storage);
  }

  return {
    providerKeys: loadProviderKeys(storage),
    savedKeys: loadSavedKeys(storage),
  };
}

export function getSavedKeysForProvider(savedKeys, providerId) {
  return normalizeSavedKeys(savedKeys).filter(entry => entry.provider === providerId);
}

export function isNextOnlyUserMessage(message) {
  if (!message || message.role !== 'user') return false;
  if (Array.isArray(message.parts)) {
    return message.parts.length === 1 && (message.parts[0]?.text || message.parts[0] || '') === 'Next';
  }
  if (typeof message.content === 'string') return message.content === 'Next';
  if (Array.isArray(message.content)) {
    return message.content.length === 1 && message.content[0]?.type === 'text' && message.content[0]?.text === 'Next';
  }
  return false;
}

export function combinedSectionsText(sectionsMeta) {
  return (sectionsMeta || []).map(section => section.text || '').join('\n\n').trim();
}

export function normalizeOpenRouterModel(model) {
  const modalities = model?.architecture?.input_modalities || [];
  const supportsText = modalities.includes('text');
  const supportsFile = modalities.includes('file');
  return {
    id: model?.id || '',
    label: model?.name || model?.id || 'Unnamed model',
    supportsText,
    supportsFile,
    contextLength: Number(model?.context_length || model?.top_provider?.context_length || 0) || 0,
    raw: model,
  };
}

export function sortOpenRouterModels(models, { preferFile = false } = {}) {
  return [...models].sort((left, right) => {
    if (preferFile && left.supportsFile !== right.supportsFile) return left.supportsFile ? -1 : 1;
    if (right.contextLength !== left.contextLength) return right.contextLength - left.contextLength;
    return left.label.localeCompare(right.label);
  });
}

export function chooseModel(currentModel, models, fallbackModel = '') {
  if (currentModel && models.some(model => model.id === currentModel)) return currentModel;
  if (fallbackModel && models.some(model => model.id === fallbackModel)) return fallbackModel;
  return models[0]?.id || '';
}

export function resolveSourceModeLabel(sourceMode) {
  return sourceMode === SOURCE_MODE_EXTRACTED ? 'Extracted text' : 'Native file';
}
