'use strict';

/** Retire les « / » finaux en temps linéaire (évite une regex /\/+$/ quadratique sur une entrée client). */
const trimTrailingSlashes = (value) => {
  const text = String(value ?? '');
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 47) end -= 1;
  return text.slice(0, end);
};

module.exports = { trimTrailingSlashes };
