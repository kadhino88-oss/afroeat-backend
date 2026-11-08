'use strict';

const TYPES = ['restaurant', 'grocery', 'shop', 'drinks', 'other'];
const STATUSES = ['new', 'contacted', 'approved', 'rejected'];

const text = (value, max) => String(value ?? '').trim().slice(0, max);

// Valide et nettoie le corps de la demande. Lève une Error au message lisible.
const validateApplication = (body = {}) => {
  const data = {
    businessName: text(body.businessName, 120),
    businessType: text(body.businessType, 20).toLowerCase(),
    contactName: text(body.contactName, 120),
    email: text(body.email, 160).toLowerCase(),
    phone: text(body.phone, 30),
    address: text(body.address, 200),
    city: text(body.city, 100),
    country: text(body.country, 80),
    website: text(body.website, 200),
    message: text(body.message, 1000),
    osmPlaceId: text(body.osmPlaceId, 60),
    consent: body.consent === true || body.consent === 'true',
  };

  if (data.businessName.length < 2) throw new Error('Le nom du commerce est obligatoire.');
  if (!TYPES.includes(data.businessType)) throw new Error('Le type de commerce est invalide.');
  if (data.contactName.length < 2) throw new Error('Le nom du contact est obligatoire.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) throw new Error("L'adresse email est invalide.");
  if (data.phone.replace(/\D/g, '').length < 7 || !/^[+\d\s().-]+$/.test(data.phone)) {
    throw new Error('Le numéro de téléphone est invalide.');
  }
  if (data.address.length < 3) throw new Error("L'adresse est obligatoire.");
  if (data.city.length < 2) throw new Error('La ville est obligatoire.');
  if (data.website && !/^https?:\/\//i.test(data.website)) {
    throw new Error("Le site web doit commencer par http:// ou https://.");
  }
  if (!data.consent) throw new Error('Ton accord pour être contacté est obligatoire.');

  return data;
};

module.exports = { validateApplication, TYPES, STATUSES };
