export type KallaatamCharacter = {
  name: string;
  role?: string;
  aiPlay?: boolean;
  color?: string;
  [key: string]: unknown;
};

export type KallaatamExtractedCharacter = {
  name: string;
  role: string;
};

export type KallaatamExtraction = {
  outline: string;
  characters: KallaatamExtractedCharacter[];
  parsedJson: boolean;
};

const DEFAULT_KALLAATAM_COLORS = [
  '#E53935',
  '#455A64',
  '#37474F',
  '#7B1FA2',
  '#E91E63',
  '#1E88E5',
];

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const cleanName = (value: string) =>
  value
    .replace(/\*\*/g, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeCharacters(value: unknown): KallaatamExtractedCharacter[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: KallaatamExtractedCharacter[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const rawName = typeof item === 'string'
      ? item
      : typeof record?.name === 'string'
        ? record.name
        : '';
    const name = cleanName(rawName);
    const role = typeof record?.role === 'string' ? record.role.trim() : '';
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, role });
  }
  return result.slice(0, 20);
}

function parseJsonCandidates(raw: string): unknown[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  const objectCandidate = objectStart >= 0 && objectEnd > objectStart
    ? trimmed.slice(objectStart, objectEnd + 1)
    : '';
  const candidates = [...new Set([trimmed, fenced ?? '', objectCandidate].filter(Boolean))];
  const parsed: unknown[] = [];

  for (const candidate of candidates) {
    try {
      parsed.push(JSON.parse(candidate));
      continue;
    } catch {}

    const repaired = candidate
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
    try {
      parsed.push(JSON.parse(repaired));
    } catch {}
  }
  return parsed;
}

function extractCharactersFromText(raw: string): KallaatamExtractedCharacter[] {
  const result: KallaatamExtractedCharacter[] = [];
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const numbered = line.match(/^\s*(?:[-*•]|\d+[.)])\s*(.+?)\s*$/);
    if (!numbered) continue;
    const parts = numbered[1].split(/\s+(?:—|–|-)\s+|\s*:\s*/);
    const name = cleanName(parts[0]);
    const key = normalizeName(name);
    if (!key || seen.has(key) || name.length > 120) continue;
    seen.add(key);
    result.push({ name, role: parts.slice(1).join(' — ').trim() });
  }

  if (result.length === 0) {
    for (const match of raw.matchAll(/\*\*([^*]+)\*\*/g)) {
      const name = cleanName(match[1]);
      const key = normalizeName(name);
      if (!key || seen.has(key) || name.length > 120) continue;
      seen.add(key);
      result.push({ name, role: '' });
    }
  }
  return result.slice(0, 20);
}

export function parseKallaatamExtraction(rawResponse: string): KallaatamExtraction {
  const raw = rawResponse.trim();
  for (const candidate of parseJsonCandidates(raw)) {
    const record = asRecord(candidate);
    if (!record) continue;
    const outlineValue = record.outline ?? record.storyOutline;
    const outline = typeof outlineValue === 'string' ? outlineValue.trim() : '';
    const characters = normalizeCharacters(record.characters ?? record.chars);
    if (outline || characters.length > 0) {
      return { outline, characters, parsedJson: true };
    }
  }

  return {
    outline: raw,
    characters: extractCharactersFromText(raw),
    parsedJson: false,
  };
}

export function mergeKallaatamCharacters(
  existing: KallaatamCharacter[],
  extracted: KallaatamExtractedCharacter[],
): KallaatamCharacter[] {
  const merged = existing.map(character => ({ ...character }));
  const seenExtracted = new Set<string>();

  extracted.forEach((entry, entryIndex) => {
    const name = cleanName(entry.name);
    const key = normalizeName(name);
    if (!key || seenExtracted.has(key)) return;
    seenExtracted.add(key);

    const existingIndex = merged.findIndex(character =>
      normalizeName(String(character.name ?? '')) === key
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        name,
        ...(entry.role ? { role: entry.role } : {}),
      };
      return;
    }

    const emptyIndex = merged.findIndex(character => !String(character.name ?? '').trim());
    const targetIndex = emptyIndex >= 0 ? emptyIndex : -1;
    const slot = targetIndex >= 0 ? merged[targetIndex] : undefined;
    const nextCharacter: KallaatamCharacter = {
      ...(slot ?? {}),
      name,
      ...(entry.role ? { role: entry.role } : {}),
      aiPlay: typeof slot?.aiPlay === 'boolean' ? slot.aiPlay : true,
      color: typeof slot?.color === 'string' && slot.color
        ? slot.color
        : DEFAULT_KALLAATAM_COLORS[entryIndex % DEFAULT_KALLAATAM_COLORS.length],
    };

    if (targetIndex >= 0) merged[targetIndex] = nextCharacter;
    else merged.push(nextCharacter);
  });

  return merged;
}

export function kallaatamErrorCategory(error: unknown): string {
  const message = String((error as { message?: unknown })?.message ?? error).toLowerCase();
  if (message.includes('abort') || message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('quota') || message.includes('429') || message.includes('resource_exhausted') || message.includes('rate limit')) return 'quota';
  if (message.includes('http 5') || message.includes('server') || message.includes('502') || message.includes('503')) return 'server';
  if (message.includes('json') || message.includes('parse') || message.includes('format')) return 'parse';
  if (message.includes('network') || message.includes('fetch') || message.includes('offline')) return 'network';
  return 'unknown';
}

export function kallaatamErrorDetail(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : (() => {
          try {
            return JSON.stringify(error);
          } catch {
            return String(error);
          }
        })();

  const detail = String(raw ?? '')
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted-key]')
    .replace(/(api[_ -]?key|authorization|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .trim();

  if (!detail || detail === '[object Object]' || detail === 'undefined' || detail === 'null') return '';
  return detail.length > 240 ? `${detail.slice(0, 237)}...` : detail;
}

export function kallaatamFriendlyError(
  scope: 'auto' | 'extract',
  category: string,
  error?: unknown,
): string {
  const base = category === 'quota'
    ? 'AI limit முடிந்துவிட்டது. சிறிது நேரம் கழித்து மீண்டும் முயற்சி செய்யுங்கள்.'
    : category === 'timeout'
      ? 'AI பதில் வர நேரம் எடுத்துக்கொள்கிறது. சிறிது நேரம் கழித்து மீண்டும் முயற்சி செய்யுங்கள்.'
      : category === 'server' || category === 'network'
        ? 'AI server-ஐ இப்போது அணுக முடியவில்லை. Connection-ஐ சரிபார்த்து மீண்டும் முயற்சி செய்யுங்கள்.'
        : category === 'parse'
          ? 'AI பதிலைப் புரிந்துகொள்ள முடியவில்லை. மீண்டும் முயற்சி செய்யுங்கள்.'
          : scope === 'auto'
            ? 'Automatic character extraction முடிக்க முடியவில்லை. மீண்டும் முயற்சி செய்யுங்கள்.'
            : 'Story extract முடிக்க முடியவில்லை. மீண்டும் முயற்சி செய்யுங்கள்.';
  const detail = kallaatamErrorDetail(error);
  return detail ? `${base}\n\nDetails: ${detail}` : base;
}