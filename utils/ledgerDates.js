'use strict';

// Validation stricte des dates de période, SANS expression régulière (entrées client : temps linéaire,
// longueur bornée avant tout parcours). Formes acceptées, toujours en UTC :
//   YYYY-MM-DD                      (minuit UTC)
//   YYYY-MM-DDTHH:mm:ssZ
//   YYYY-MM-DDTHH:mm:ss.sssZ
// La période est semi-ouverte : [from, to).

const MAX_DATE_LENGTH = 24; // « 2026-01-31T23:59:59.999Z »
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// Lit `length` chiffres à partir de `start` ; -1 si un caractère n'est pas un chiffre.
const readDigits = (text, start, length) => {
  if (start + length > text.length) return -1;
  let value = 0;
  for (let i = start; i < start + length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return -1;
    value = value * 10 + (code - 48);
  }
  return value;
};

/** @returns {Date|null} */
const parseIsoInstant = (value) => {
  if (typeof value !== 'string') return null;
  if (value.length < 10 || value.length > MAX_DATE_LENGTH) return null;

  const year = readDigits(value, 0, 4);
  const month = readDigits(value, 5, 2);
  const day = readDigits(value, 8, 2);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (value[4] !== '-' || value[7] !== '-') return null;

  let hour = 0;
  let minute = 0;
  let second = 0;
  let millis = 0;

  if (value.length !== 10) {
    if (value[10] !== 'T' || value[13] !== ':' || value[16] !== ':') return null;
    hour = readDigits(value, 11, 2);
    minute = readDigits(value, 14, 2);
    second = readDigits(value, 17, 2);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    if (value.length === 20) {
      if (value[19] !== 'Z') return null;
    } else if (value.length === 24) {
      if (value[19] !== '.' || value[23] !== 'Z') return null;
      millis = readDigits(value, 20, 3);
      if (millis < 0) return null;
    } else {
      return null;
    }
  }

  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const date = new Date(timestamp);
  // Refuse les jours inexistants (30 février, 31 avril…) que Date.UTC « corrige » silencieusement.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

/**
 * Valide `from` et `to` (tous deux obligatoires, chaînes uniques).
 * @returns {{ ok: true, from: Date, to: Date } | { ok: false, code: string, message: string }}
 */
const parsePeriod = (query) => {
  const rawFrom = query?.from;
  const rawTo = query?.to;
  if (typeof rawFrom !== 'string' || typeof rawTo !== 'string') {
    return { ok: false, code: 'INVALID_PERIOD', message: 'Les paramètres from et to sont obligatoires.' };
  }
  const from = parseIsoInstant(rawFrom);
  const to = parseIsoInstant(rawTo);
  if (!from || !to) {
    return { ok: false, code: 'INVALID_DATE', message: 'Dates invalides : utiliser le format ISO 8601 en UTC (AAAA-MM-JJ ou AAAA-MM-JJThh:mm:ssZ).' };
  }
  if (from.getTime() >= to.getTime()) {
    return { ok: false, code: 'INVALID_PERIOD', message: 'from doit être strictement antérieur à to.' };
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    return { ok: false, code: 'PERIOD_TOO_LONG', message: `La période ne peut pas dépasser ${MAX_RANGE_DAYS} jours.` };
  }
  return { ok: true, from, to };
};

// « La veille » en UTC : [00:00 d'hier, 00:00 d'aujourd'hui).
const getYesterdayPeriodUtc = (now = new Date()) => {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: new Date(to.getTime() - DAY_MS), to };
};

module.exports = { parseIsoInstant, parsePeriod, getYesterdayPeriodUtc, MAX_RANGE_DAYS, MAX_DATE_LENGTH };
