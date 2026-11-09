'use strict';

/**
 * Environnement d'exécution et garde-fous « marketplace ».
 *
 * En production, la prise de commande, le paiement par carte et le paiement à la livraison
 * restent verrouillés (fail-closed) tant que les versements aux partenaires ne sont pas validés.
 *
 * Un environnement de TEST (staging) peut lever ces verrous, mais seulement si DEUX conditions
 * sont réunies :
 *   1. AFROEAT_ENV=staging ;
 *   2. la clé Stripe est une clé de TEST (sk_test_ / rk_test_) → aucun paiement réel possible.
 * Avec une clé live (sk_live_), le verrou de production reste fermé quoi qu'il arrive.
 */
const isStripeTestKey = (env = process.env) =>
  /^(sk|rk)_test_/.test(String(env.STRIPE_SECRET_KEY || ''));

const isStagingSandbox = (env = process.env) =>
  String(env.AFROEAT_ENV || '').trim().toLowerCase() === 'staging' && isStripeTestKey(env);

/** Vrai quand les verrous marketplace de production doivent s'appliquer. */
const isProductionLocked = (env = process.env) =>
  env.NODE_ENV === 'production' && !isStagingSandbox(env);

module.exports = { isStripeTestKey, isStagingSandbox, isProductionLocked };
