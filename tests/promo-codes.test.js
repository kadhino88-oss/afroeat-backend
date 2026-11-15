const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCode, validatePromo, computeDiscount, releasePromoForOrder } = require('../utils/promoCodes');
const { calculateMarketplaceSplit } = require('../utils/marketplaceAccounting');
const { parseAdminInput } = require('../controllers/promoController');

const rates = { commissionBps: 1500, courierPayoutBps: 8000 };
const split = calculateMarketplaceSplit({ itemsSubtotal: 40, deliveryFee: 5, rates }); // marge plateforme = 6 + 1 = 7
const base = { code: 'BIENVENUE', active: true, type: 'percent', value: 20, usedCount: 0, maxUses: 0, perUserLimit: 1, minSubtotal: 0 };

test('le code est normalisé en majuscules sans caractères parasites', () => {
  assert.equal(normalizeCode(' bienvenue 10 !'), 'BIENVENUE10');
});

test('la remise ne dépasse jamais 80 % de la marge de la plateforme', () => {
  // 20 % de 40 = 8, mais la marge est 7 → plafond 5,60
  assert.equal(computeDiscount({ promo: base, subtotal: 40, deliveryFee: 5, split }), 5.6);
  // une remise fixe énorme est plafonnée aussi
  assert.equal(computeDiscount({ promo: { ...base, type: 'fixed', value: 100 }, subtotal: 40, deliveryFee: 5, split }), 5.6);
});

test('le restaurant et le livreur gardent leur part intacte', () => {
  const d = computeDiscount({ promo: base, subtotal: 40, deliveryFee: 5, split });
  const total = 40 + 5 - d;
  const platformKeeps = total - split.restaurantEarning - split.driverEarning;
  assert.ok(platformKeeps >= 0, 'la plateforme ne vend pas à perte');
  assert.ok(platformKeeps >= 0.2 * 7 - 0.001, 'au moins 20 % de la marge reste pour les frais de paiement');
});

test('le total ne descend jamais sous 1', () => {
  const tiny = calculateMarketplaceSplit({ itemsSubtotal: 1, deliveryFee: 0, rates });
  assert.ok(computeDiscount({ promo: { ...base, value: 100 }, subtotal: 1, deliveryFee: 0, split: tiny }) <= 0);
});

test('validations : expiré, épuisé, déjà utilisé, minimum, première commande, devise', () => {
  const now = new Date('2026-06-01');
  const ok = { subtotal: 30, currency: 'CHF', now };
  assert.equal(validatePromo({ promo: base, ...ok }).ok, true);
  assert.equal(validatePromo({ promo: null, ...ok }).code, 'PROMO_INVALID');
  assert.equal(validatePromo({ promo: { ...base, active: false }, ...ok }).code, 'PROMO_INVALID');
  assert.equal(validatePromo({ promo: { ...base, expiresAt: new Date('2026-05-01') }, ...ok }).code, 'PROMO_EXPIRED');
  assert.equal(validatePromo({ promo: { ...base, startsAt: new Date('2026-07-01') }, ...ok }).code, 'PROMO_NOT_STARTED');
  assert.equal(validatePromo({ promo: { ...base, maxUses: 5, usedCount: 5 }, ...ok }).code, 'PROMO_EXHAUSTED');
  assert.equal(validatePromo({ promo: base, ...ok, userRedemptions: 1 }).code, 'PROMO_ALREADY_USED');
  assert.equal(validatePromo({ promo: { ...base, minSubtotal: 50 }, ...ok }).code, 'PROMO_MIN_SUBTOTAL');
  assert.equal(validatePromo({ promo: { ...base, firstOrderOnly: true }, ...ok, isFirstOrder: false }).code, 'PROMO_FIRST_ORDER_ONLY');
  assert.equal(validatePromo({ promo: { ...base, firstOrderOnly: true }, ...ok, isFirstOrder: true }).ok, true);
  assert.equal(validatePromo({ promo: { ...base, type: 'fixed', currency: 'EUR' }, ...ok }).code, 'PROMO_CURRENCY');
});

test('annuler une commande libère une seule fois l’utilisation du code', async () => {
  const calls = [];
  const PromoCode = { updateOne: async (...a) => calls.push(a) };
  const order = { promoCode: 'BIENVENUE', promoReleased: false };
  assert.equal(await releasePromoForOrder(order, PromoCode), true);
  assert.equal(await releasePromoForOrder(order, PromoCode), false);
  assert.equal(calls.length, 1);
  assert.equal(await releasePromoForOrder({ promoCode: '' }, PromoCode), false);
});

test('saisie administrateur : contrôles', () => {
  assert.ok(parseAdminInput({ code: 'ab', type: 'percent', value: 10 }).error);
  assert.ok(parseAdminInput({ code: 'OK10', type: 'percent', value: 150 }).error);
  assert.ok(parseAdminInput({ code: 'OK10', type: 'fixed', value: 5 }).error); // devise manquante
  assert.ok(parseAdminInput({ code: 'OK10', type: 'wat', value: 5 }).error);
  const good = parseAdminInput({ code: 'bienvenue10', type: 'percent', value: 10, maxUses: '100', firstOrderOnly: true });
  assert.equal(good.value.code, 'BIENVENUE10');
  assert.equal(good.value.maxUses, 100);
  assert.equal(good.value.firstOrderOnly, true);
});
