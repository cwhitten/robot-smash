import { isTouch } from './input.js';

const KEY = 'robot-smash-save-v1';

const DEFAULTS = {
  coins: 0,
  owned: ['jimmy'],
  current: 'jimmy',
  musicVol: 0.5,
  sfxVol: 0.8,
  quality: 'high',
  kills: 0,
  bosses: 0,
  totalEarned: 0,
};

// Ask the browser not to evict our save (Safari otherwise may clear it under storage pressure).
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const data = { ...DEFAULTS, ...JSON.parse(raw) };
    if (!Array.isArray(data.owned) || !data.owned.includes('jimmy')) data.owned = ['jimmy', ...(data.owned || [])];
    if (!data.owned.includes(data.current)) data.current = 'jimmy';
    data.coins = Math.max(0, Math.floor(Number(data.coins) || 0));
    return data;
  } catch {
    return fresh();
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage may be unavailable (private mode) - progress just won't persist */
  }
}

export function resetSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return fresh();
}

// Touch devices (iPads) start on the lighter graphics setting; it can be changed in Pause.
function fresh() {
  return { ...DEFAULTS, owned: [...DEFAULTS.owned], quality: isTouch ? 'fast' : DEFAULTS.quality };
}
