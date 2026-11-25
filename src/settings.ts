import type { GraphicsQuality } from './types';

export interface GameSettings {
  quality: GraphicsQuality;
  autoQuality: boolean;
  mouseSensitivity: number;
  fpFov: number;
  cameraShake: boolean;
  autoPauseOnBlur: boolean;
  masterVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  radioVolume: number;
  language: 'zh' | 'en';
}

const STORAGE_KEY = 'outbreak-settings-v1';
const LEGACY_QUALITY_KEY = 'outbreak-quality';
const LEGACY_LANGUAGE_KEY = 'outbreak-language';

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  autoQuality: true,
  mouseSensitivity: 1.0,
  fpFov: 68,
  cameraShake: true,
  autoPauseOnBlur: true,
  masterVolume: 0.85,
  sfxVolume: 1.0,
  ambientVolume: 0.85,
  radioVolume: 0.85,
  language: 'zh'
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function isGraphicsQuality(value: unknown): value is GraphicsQuality {
  return value === 'high' || value === 'medium' || value === 'low';
}

export function loadSettings(): GameSettings {
  const settings: GameSettings = { ...DEFAULT_SETTINGS };
  try {
    const legacyQuality = localStorage.getItem(LEGACY_QUALITY_KEY);
    if (isGraphicsQuality(legacyQuality)) {
      settings.quality = legacyQuality;
    }
    const legacyLang = localStorage.getItem(LEGACY_LANGUAGE_KEY);
    if (legacyLang === 'en' || legacyLang === 'zh') {
      settings.language = legacyLang;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return settings;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    if (parsed && typeof parsed === 'object') {
      if (isGraphicsQuality(parsed.quality)) settings.quality = parsed.quality;
      if (typeof parsed.autoQuality === 'boolean') settings.autoQuality = parsed.autoQuality;
      settings.mouseSensitivity = clampNumber(parsed.mouseSensitivity, 0.4, 2.2, DEFAULT_SETTINGS.mouseSensitivity);
      settings.fpFov = clampNumber(parsed.fpFov, 60, 85, DEFAULT_SETTINGS.fpFov);
      if (typeof parsed.cameraShake === 'boolean') settings.cameraShake = parsed.cameraShake;
      if (typeof parsed.autoPauseOnBlur === 'boolean') settings.autoPauseOnBlur = parsed.autoPauseOnBlur;
      settings.masterVolume = clampNumber(parsed.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume);
      settings.sfxVolume = clampNumber(parsed.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume);
      settings.ambientVolume = clampNumber(parsed.ambientVolume, 0, 1, DEFAULT_SETTINGS.ambientVolume);
      settings.radioVolume = clampNumber(parsed.radioVolume, 0, 1, DEFAULT_SETTINGS.radioVolume);
      if (parsed.language === 'en' || parsed.language === 'zh') settings.language = parsed.language;
    }
  } catch {
    // Storage may be unavailable in embedded or restricted contexts.
  }
  return settings;
}

export function saveSettings(settings: GameSettings): void {
  try {
    const normalized: GameSettings = {
      quality: isGraphicsQuality(settings.quality) ? settings.quality : DEFAULT_SETTINGS.quality,
      autoQuality: Boolean(settings.autoQuality),
      mouseSensitivity: clampNumber(settings.mouseSensitivity, 0.4, 2.2, DEFAULT_SETTINGS.mouseSensitivity),
      fpFov: clampNumber(settings.fpFov, 60, 85, DEFAULT_SETTINGS.fpFov),
      cameraShake: Boolean(settings.cameraShake),
      autoPauseOnBlur: Boolean(settings.autoPauseOnBlur),
      masterVolume: clampNumber(settings.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume),
      sfxVolume: clampNumber(settings.sfxVolume, 0, 1, DEFAULT_SETTINGS.sfxVolume),
      ambientVolume: clampNumber(settings.ambientVolume, 0, 1, DEFAULT_SETTINGS.ambientVolume),
      radioVolume: clampNumber(settings.radioVolume, 0, 1, DEFAULT_SETTINGS.radioVolume),
      language: settings.language === 'en' ? 'en' : 'zh'
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    localStorage.setItem(LEGACY_QUALITY_KEY, normalized.quality);
    localStorage.setItem(LEGACY_LANGUAGE_KEY, normalized.language);
  } catch {
    // Ignore storage write errors.
  }
}
