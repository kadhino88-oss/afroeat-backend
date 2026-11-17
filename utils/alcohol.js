'use strict';

// Vente d'alcool : la commande exige que le client confirme sa majorité,
// et le livreur doit contrôler une pièce d'identité à la remise.
const orderContainsAlcohol = (menuItems = []) =>
  Array.isArray(menuItems) && menuItems.some((item) => item && item.containsAlcohol === true);

const isAgeConfirmed = (value) => value === true || value === 'true';

const ageCheckError = () => ({
  success: false,
  code: 'AGE_CONFIRMATION_REQUIRED',
  message: 'Cette commande contient de l’alcool : confirmez que vous avez l’âge légal (18 ans).',
});

module.exports = { orderContainsAlcohol, isAgeConfirmed, ageCheckError };
