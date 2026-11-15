'use strict';

const MAX_SAVED_ADDRESSES = 5;

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

// Valide et normalise une adresse à enregistrer. Renvoie { error } ou { value }.
const parseAddressInput = (body = {}) => {
  const address = clean(body.address);
  const label = clean(body.label).slice(0, 40);
  if (address.length < 5 || address.length > 300) {
    return { error: 'Adresse invalide (5 à 300 caractères).' };
  }
  return { value: { label, address, isDefault: Boolean(body.isDefault) } };
};

// Ajoute une adresse : refuse au-delà du maximum, évite les doublons, gère l'adresse par défaut.
const addAddress = (list, input) => {
  const current = Array.isArray(list) ? list.map((a) => ({ label: a.label, address: a.address, isDefault: Boolean(a.isDefault), _id: a._id })) : [];
  const existing = current.find((a) => a.address.toLowerCase() === input.address.toLowerCase());
  if (!existing && current.length >= MAX_SAVED_ADDRESSES) return { error: `Maximum ${MAX_SAVED_ADDRESSES} adresses enregistrées.` };
  let next = existing ? current.map((a) => (a === existing ? { ...a, label: input.label || a.label } : a)) : [...current, { ...input, isDefault: false }];
  const makeDefault = input.isDefault || next.length === 1;
  if (makeDefault) {
    const target = (existing || next[next.length - 1]).address;
    next = next.map((a) => ({ ...a, isDefault: a.address === target }));
  }
  return { list: next };
};

// Retire une adresse ; si c'était l'adresse par défaut, la première restante le devient.
const removeAddress = (list, id) => {
  const next = (Array.isArray(list) ? list : []).filter((a) => String(a._id) !== String(id)).map((a) => ({ label: a.label, address: a.address, isDefault: Boolean(a.isDefault), _id: a._id }));
  if (next.length && !next.some((a) => a.isDefault)) next[0].isDefault = true;
  return next;
};

module.exports = { MAX_SAVED_ADDRESSES, parseAddressInput, addAddress, removeAddress };
