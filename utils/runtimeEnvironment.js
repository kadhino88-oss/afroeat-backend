'use strict';

/**
 * Environnement d'exécution et garde-fous « marketplace ».
 *
 * En production, la prise de commande et le paiement par carte restent verrouillés (fail-closed)
 * tant que l'ouverture n'a pas été décidée explicitement par le propriétaire.
 *
 * Un environnement de TEST (staging) lève ces verrous seulement si DEUX conditions sont réunies :
 *   1. AFROEAT_ENV=staging ;
 *   2. la clé Stripe est une clé de TEST (sk_test_ / rk_test_) → aucun paiement réel possible.
 *
 * La VRAIE production s'ouvre seulement si TOUT ceci est réuni (sinon elle reste verrouillée) :
 *   1. AFROEAT_LIVE_COMMERCE=open (décision explicite, réversible en retirant la variable) ;
 *   2. une clé Stripe réelle (sk_live_ / rk_live_) ;
 *   3. le secret du webhook Stripe (sans lui, les paiements ne seraient jamais confirmés) ;
 *   4. les taux de commission (MARKETPLACE_RATES_JSON).
 * Le paiement à la livraison reste désactivé en vraie production (pas de registre de collecte).
 */
const isStripeTestKey = (env = process.env) =>
  /^(sk|rk)_test_/.test(String(env.STRIPE_SECRET_KEY || ''));

const isStripeLiveKey = (env = process.env) =>
  /^(sk|rk)_live_/.test(String(env.STRIPE_SECRET_KEY || ''));

const isStagingSandbox = (env = process.env) =>
  String(env.AFROEAT_ENV || '').trim().toLowerCase() === 'staging' && isStripeTestKey(env);

/** Vrai en production réelle (argent réel possible), que le commerce soit ouvert ou non. */
const isRealProduction = (env = process.env) =>
  env.NODE_ENV === 'production' && !isStagingSandbox(env);

/** Vrai quand le propriétaire a ouvert le commerce réel ET que la configuration est complète. */
const isLiveCommerceOpen = (env = process.env) =>
  isRealProduction(env) &&
  String(env.AFROEAT_LIVE_COMMERCE || '').trim().toLowerCase() === 'open' &&
  isStripeLiveKey(env) &&
  Boolean(String(env.STRIPE_WEBHOOK_SECRET || '').trim()) &&
  Boolean(String(env.MARKETPLACE_RATES_JSON || '').trim());

/** Vrai quand les verrous marketplace de production doivent s'appliquer. */
const isProductionLocked = (env = process.env) =>
  isRealProduction(env) && !isLiveCommerceOpen(env);

module.exports = {
  isStripeTestKey,
  isStripeLiveKey,
  isStagingSandbox,
  isRealProduction,
  isLiveCommerceOpen,
  isProductionLocked,
};
