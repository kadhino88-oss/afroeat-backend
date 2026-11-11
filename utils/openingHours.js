'use strict';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIMEZONE = 'Europe/Zurich'; // Genève, Annemasse et Annecy partagent le même fuseau.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (value) => {
  const match = TIME_RE.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * Valide les horaires reçus : un créneau par jour (mon..sun), "HH:MM", ou jour fermé.
 * La fermeture peut passer minuit (ex. 18:00 → 02:00). Renvoie { value } ou { error }.
 */
const normalizeOpeningHours = (input) => {
  if (!Array.isArray(input)) return { error: 'Horaires invalides.' };
  if (input.length === 0) return { value: [] };
  const byDay = new Map();
  for (const slot of input) {
    const day = String(slot?.day || '').toLowerCase();
    if (!DAYS.includes(day)) return { error: 'Jour invalide.' };
    if (byDay.has(day)) return { error: 'Jour en double.' };
    if (slot?.isClosed === true) {
      byDay.set(day, { day, open: '', close: '', isClosed: true });
      continue;
    }
    const open = toMinutes(slot?.open);
    const close = toMinutes(slot?.close);
    if (open === null || close === null) return { error: 'Heure invalide (format HH:MM).' };
    if (open === close) return { error: 'L’ouverture et la fermeture doivent être différentes.' };
    byDay.set(day, { day, open: slot.open, close: slot.close, isClosed: false });
  }
  return { value: DAYS.filter((d) => byDay.has(d)).map((d) => byDay.get(d)) };
};

const localParts = (now) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = String(get('weekday')).toLowerCase().slice(0, 3);
  return { day, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
};

/** true si aucun horaire n'est défini (le bouton manuel ouvert/fermé fait foi), sinon selon l'heure locale. */
const isWithinOpeningHours = (hours, now = new Date()) => {
  if (!Array.isArray(hours) || hours.length === 0) return true;
  const { day, minutes } = localParts(now);
  const index = DAYS.indexOf(day);
  const today = hours.find((h) => h.day === day);
  const yesterday = hours.find((h) => h.day === DAYS[(index + 6) % 7]);

  if (today && !today.isClosed) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (open !== null && close !== null) {
      if (open < close && minutes >= open && minutes < close) return true;
      if (open > close && minutes >= open) return true; // passe minuit : la suite est dans le créneau d'hier
    }
  }
  if (yesterday && !yesterday.isClosed) {
    const open = toMinutes(yesterday.open);
    const close = toMinutes(yesterday.close);
    if (open !== null && close !== null && open > close && minutes < close) return true;
  }
  return false;
};

/** Ouvert pour commander : bouton manuel ET horaires. */
const isRestaurantOpenNow = (restaurant, now = new Date()) =>
  restaurant?.isOpen !== false && isWithinOpeningHours(restaurant?.openingHours, now);

module.exports = { DAYS, normalizeOpeningHours, isWithinOpeningHours, isRestaurantOpenNow };
