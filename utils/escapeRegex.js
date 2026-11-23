'use strict';

// Échappe les métacaractères RegExp d'une valeur fournie par le client.
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { escapeRegex };
