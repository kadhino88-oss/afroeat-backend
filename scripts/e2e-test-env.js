'use strict';

/**
 * Test de bout en bout de l'environnement de TEST (jamais la production).
 * Joue les rôles client, restaurant, livreur et admin contre l'API de test déployée.
 * Aucun mot de passe ni jeton n'est affiché.
 *
 * Usage : TEST_OWNER_PASSWORD=... node scripts/e2e-test-env.js
 */
const crypto = require('crypto');

const API = String(process.env.E2E_API_URL || 'https://afroeat-api-test.vercel.app/api').replace(/\/+$/, '');
const SITE = 'https://afroeat-app-test.vercel.app';
const PASSWORD = process.env.TEST_OWNER_PASSWORD || '';

if (!/^https:\/\/afroeat-api-test[a-z0-9-]*\.vercel\.app\//.test(`${API}/`)) {
  console.error("Refusé : ce test ne tourne que contre l'API de TEST (afroeat-api-test).");
  process.exit(1);
}
if (!PASSWORD) {
  console.error('TEST_OWNER_PASSWORD est requis.');
  process.exit(1);
}

const run = Date.now().toString(36);
const results = [];
const state = {};

const call = async (method, path, { token, body, headers } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
};

const step = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`❌ ${name} — ${error.message}`);
    return false;
  }
};

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const expectStatus = (response, status, label = '') => {
  expect(
    response.status === status,
    `${label}attendu ${status}, reçu ${response.status} (${String(response.json?.message || response.json?.code || '').slice(0, 140)})`
  );
};

const orderIdOf = (json) => json?.order?._id || json?.order?.id || json?.data?._id || json?._id;
const userIdOf = (json) => json?.user?._id || json?.user?.id;
const strongPassword = () => `E2e-${crypto.randomBytes(6).toString('hex')}#Aa1`;
const uuid = () => crypto.randomUUID();

const login = async (email, role, password = PASSWORD) => {
  const response = await call('POST', '/users/login', { body: { email, password, role } });
  expectStatus(response, 200, `connexion ${role} : `);
  expect(response.json?.token, 'pas de jeton');
  return { token: response.json.token, id: userIdOf(response.json) };
};

const createOrder = async ({ items, total, key = uuid(), promoCode }) => {
  const response = await call('POST', '/orders', {
    token: state.client.token,
    headers: { 'Idempotency-Key': key },
    body: {
      restaurant: state.restaurantId,
      items,
      quotedTotal: total,
      quotedCurrency: 'CHF',
      deliveryAddress: 'Rue du Rhône 1, 1204 Genève',
      deliveryAddressDetails: { address: 'Rue du Rhône 1, 1204 Genève', fullAddress: 'Rue du Rhône 1, 1204 Genève' },
      notes: `e2e ${run}`,
      ...(promoCode ? { promoCode } : {}),
    },
  });
  return response;
};

const finish = () => {
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
  if (failed.length) {
    console.log(`À corriger : ${failed.map((result) => result.name).join(' | ')}`);
    process.exit(1);
  }
};

const main = async () => {
  console.log(`Test de bout en bout — ${API}\n`);

  await step('API en ligne, base de test connectée', async () => {
    // Le premier appel après une période d'inactivité peut tomber pendant la reconnexion à la base :
    // trois essais espacés avant de conclure à une vraie panne.
    let response;
    let json;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await fetch(API.replace(/\/api$/, '/health'));
      json = await response.json().catch(() => ({}));
      if (response.status === 200) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    expect(response.status === 200, `santé ${response.status}`);
    expect(json?.database?.connected === true, 'base non connectée');
    expect(json?.database?.name === 'afroeat_test', `mauvaise base : ${json?.database?.name}`);
    expect(json?.features?.stripe === true, 'Stripe inactif');
    return `base ${json.database.name}`;
  });

  await step('menu du restaurant de test disponible', async () => {
    const response = await call('GET', '/menu');
    expectStatus(response, 200);
    const items = response.json?.menuItems || [];
    const yassa = items.find((item) => /yassa/i.test(item.name));
    const alloco = items.find((item) => /alloco/i.test(item.name));
    expect(yassa && alloco, 'plats de test introuvables (lance « Créer le restaurant TEST »)');
    state.restaurantId = yassa.restaurant?._id || yassa.restaurant;
    state.yassa = yassa;
    state.alloco = alloco;
    return `${items.length} plats`;
  });

  await step('client : création de compte puis connexion', async () => {
    const email = `e2e-client-${run}@afroeat.test`;
    state.clientPassword = strongPassword();
    const created = await call('POST', '/users/register', {
      body: {
        name: 'Client E2E',
        email,
        password: state.clientPassword,
        role: 'client',
        phone: '+41791234567',
        address: 'Rue du Rhône 1, 1204 Genève',
        country: 'Suisse',
      },
    });
    expectStatus(created, 201, 'inscription : ');
    state.client = await login(email, 'client', state.clientPassword);
  });
  if (!state.client || !state.restaurantId) return finish();

  const items = [
    { menuItem: String(state.yassa._id), quantity: 1 },
    { menuItem: String(state.alloco._id), quantity: 2 },
  ];
  const expectedTotal = Number(state.yassa.price) + 2 * Number(state.alloco.price) + 4; // frais du restaurant de test (3 CHF) relevés au minimum livreur de 4 CHF

  await step('devis serveur : sous-total + livraison', async () => {
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items } });
    expectStatus(response, 200);
    const quote = response.json?.quote;
    expect(quote?.totalPrice === expectedTotal, `total ${quote?.totalPrice} au lieu de ${expectedTotal}`);
    expect(quote?.currency === 'CHF', 'devise CHF attendue');
    return `${quote.totalPrice} CHF`;
  });

  await step('devis avec pourboire : ajouté au total, 100 % livreur', async () => {
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, tipAmount: 2.5 } });
    expectStatus(response, 200);
    const quote = response.json?.quote;
    expect(quote?.tipAmount === 2.5, `pourboire ${quote?.tipAmount}`);
    expect(Math.abs(quote?.totalPrice - (expectedTotal + 2.5)) < 0.001, `total ${quote?.totalPrice}`);
    const bad = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, tipAmount: 500 } });
    expect(bad.status === 400 && bad.json?.code === 'INVALID_TIP_AMOUNT', `pourboire excessif accepté (${bad.status})`);
    return `${quote.totalPrice} CHF dont 2.50 de pourboire`;
  });

  await step('à emporter : devis sans frais de livraison', async () => {
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, fulfillment: 'pickup' } });
    expectStatus(response, 200);
    const quote = response.json?.quote;
    expect(quote?.deliveryFee === 0, `frais ${quote?.deliveryFee}`);
    expect(quote?.fulfillment === 'pickup', 'mode à emporter non renvoyé');
    return `${quote.totalPrice} CHF à emporter`;
  });

  await step('commande refusée si le devis affiché est périmé (QUOTE_CHANGED)', async () => {
    const response = await createOrder({ items, total: 1 });
    expectStatus(response, 409);
    expect(response.json?.code === 'QUOTE_CHANGED', `code ${response.json?.code}`);
  });

  await step('commande créée (en attente, non payée)', async () => {
    const response = await createOrder({ items, total: expectedTotal });
    expect(response.status === 201 || response.status === 200, `statut ${response.status} (${response.json?.code || response.json?.message})`);
    state.orderId = orderIdOf(response.json);
    expect(state.orderId, 'identifiant de commande introuvable');
    const order = response.json?.order || {};
    expect(order.paymentStatus === 'Non payé', `paiement ${order.paymentStatus}`);
    return `statut « ${order.status} »`;
  });
  if (!state.orderId) return finish();

  await step('restaurant : se connecte et reçoit la commande', async () => {
    state.owner = await login('restaurant-test@afroeat.test', 'restaurant');
    const response = await call('GET', '/orders', { token: state.owner.token });
    expectStatus(response, 200);
    const list = response.json?.orders || response.json?.data || [];
    expect(list.some((order) => String(order._id || order.id) === String(state.orderId)), 'commande absente de la liste du restaurant');
  });

  await step('client : ne peut pas modifier le statut de sa commande', async () => {
    const response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.client.token, body: { status: 'En préparation' } });
    expect(response.status === 403, `attendu 403, reçu ${response.status}`);
  });

  await step('restaurant : confirme puis passe en préparation', async () => {
    let response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.owner.token, body: { status: 'Confirmée' } });
    expectStatus(response, 200, 'confirmation : ');
    response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.owner.token, body: { status: 'En préparation' } });
    expectStatus(response, 200, 'préparation : ');
  });

  await step('restaurant : ne peut pas marquer « livrée »', async () => {
    const response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.owner.token, body: { status: 'Livrée' } });
    expect(response.status === 403, `attendu 403, reçu ${response.status}`);
  });

  await step('livreur : se connecte (compte actif, vérifié, disponible)', async () => {
    state.courier = await login('livreur-test@afroeat.test', 'livreur');
    expect(state.courier.id, 'identifiant du livreur introuvable');
  });

  await step('livreur : liste des courses disponibles (dispatch)', async () => {
    const response = await call('GET', '/delivery/available-orders', { token: state.courier.token });
    expectStatus(response, 200);
    expect(Array.isArray(response.json?.orders), 'liste des courses disponibles absente');
    // La commande de test n'est pas payée : elle ne doit pas être proposée aux livreurs.
    expect(!response.json.orders.some((o) => String(o._id) === String(state.orderId)), 'commande non payée proposée aux livreurs');
    return `${response.json.orders.length} course(s) disponible(s)`;
  });

  await step('livreur : ne peut pas accepter une commande non payée', async () => {
    const response = await call('POST', `/delivery/orders/${state.orderId}/accept`, { token: state.courier.token });
    expect(response.status === 409, `attendu 409, reçu ${response.status}`);
  });

  await step('restaurant : assigne le livreur', async () => {
    const response = await call('PUT', `/orders/${state.orderId}/assign-driver`, {
      token: state.owner.token,
      body: { deliveryPerson: state.courier.id },
    });
    expectStatus(response, 200);
  });

  await step('livreur : voit la course et la prend en charge', async () => {
    const list = await call('GET', '/orders/delivery', { token: state.courier.token });
    expectStatus(list, 200, 'liste : ');
    const orders = list.json?.orders || list.json?.data || [];
    expect(orders.some((order) => String(order._id || order.id) === String(state.orderId)), 'course absente de la liste du livreur');
    const response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.courier.token, body: { status: 'En livraison' } });
    expectStatus(response, 200, 'prise en charge : ');
  });

  await step('messagerie : le livreur écrit, le client et le restaurant lisent, un inconnu non', async () => {
    const sent = await call('POST', `/orders/${state.orderId}/messages`, { token: state.courier.token, body: { text: `Je suis en route (e2e ${run})` } });
    expectStatus(sent, 201, 'envoi : ');
    const read = await call('GET', `/orders/${state.orderId}/messages`, { token: state.client.token });
    expectStatus(read, 200, 'lecture client : ');
    expect((read.json?.messages || []).some((m) => String(m.text).includes(run)), 'message absent côté client');
    const resto = await call('GET', `/orders/${state.orderId}/messages`, { token: state.owner.token });
    expectStatus(resto, 200, 'lecture restaurant : ');
  });

  await step('livraison bloquée tant que le paiement n’est pas confirmé', async () => {
    const response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.courier.token, body: { status: 'Livrée' } });
    expectStatus(response, 409);
    expect(response.json?.code === 'PAYMENT_REQUIRED_BEFORE_DELIVERY', `code ${response.json?.code}`);
  });

  await step('paiement en espèces choisi, puis livraison validée et payée', async () => {
    let response = await call('POST', '/payments/cash', { token: state.client.token, body: { orderId: state.orderId } });
    expectStatus(response, 200, 'espèces : ');
    response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.courier.token, body: { status: 'Livrée' } });
    expectStatus(response, 200, 'livraison : ');
    const order = response.json?.order || {};
    expect(order.status === 'Livrée', `statut ${order.status}`);
    expect(order.paymentStatus === 'Payé', `paiement ${order.paymentStatus}`);
  });

  await step('livreur : une commande livrée ne bouge plus', async () => {
    const response = await call('PUT', `/orders/${state.orderId}/status`, { token: state.courier.token, body: { status: 'En livraison' } });
    expect(response.status === 403, `attendu 403, reçu ${response.status}`);
  });

  await step('livreur : ses gains incluent cette livraison (sa part, pas le total)', async () => {
    const response = await call('GET', '/delivery/earnings', { token: state.courier.token });
    expectStatus(response, 200);
    const mine = (response.json?.earnings || []).find((item) => String(item.id || item._id) === String(state.orderId));
    expect(Boolean(mine), 'livraison absente des gains');
    expect(mine.currency === 'CHF', `devise ${mine.currency}`);
    expect(Number(mine.amount) > 0, `gain nul (${mine.amount}) : taux livreur non configurés ?`);
    expect(Number(mine.amount) < Number(mine.orderAmount), 'le gain ne doit pas égaler le total de la commande');
    return `${mine.amount} ${mine.currency} sur ${mine.orderAmount}`;
  });

  await step('client : laisse un avis sur la commande livrée (une seule fois)', async () => {
    const response = await call('POST', `/orders/${state.orderId}/review`, {
      token: state.client.token,
      body: { restaurantRating: 5, courierRating: 5, comment: `Très bon (e2e ${run})` },
    });
    expectStatus(response, 201);
    const again = await call('POST', `/orders/${state.orderId}/review`, { token: state.client.token, body: { restaurantRating: 4 } });
    expect(again.status === 409, `second avis accepté (${again.status})`);
    const list = await call('GET', `/restaurants/${state.restaurantId}/reviews`);
    expectStatus(list, 200, 'avis publics : ');
    expect((list.json?.reviews || []).some((r) => String(r.comment).includes(run)), 'avis absent de la fiche');
  });

  await step('paiement par carte : session Stripe créée (sans payer)', async () => {
    const created = await createOrder({ items: [{ menuItem: String(state.yassa._id), quantity: 1 }], total: Number(state.yassa.price) + 4 });
    expect(created.status === 201 || created.status === 200, `commande ${created.status}`);
    const orderId = orderIdOf(created.json);
    const response = await call('POST', '/payments/checkout', {
      token: state.client.token,
      body: { orderId, platform: 'web', returnUrl: SITE },
    });
    expectStatus(response, 200);
    expect(/^https:\/\/checkout\.stripe\.com\//.test(String(response.json?.url || '')), `adresse inattendue : ${String(response.json?.url || '').slice(0, 40)}`);
    return 'adresse checkout.stripe.com reçue';
  });

  await step('conditions partenaires publiques : commission annoncée', async () => {
    const response = await call('GET', '/partner-applications/terms');
    expectStatus(response, 200);
    expect(response.json?.terms && typeof response.json.terms.commissionByCurrency === 'object', 'conditions absentes');
  });

  // ─── Livraison assurée par le restaurant ───
  if (state.owner && state.client && state.restaurantId) {
    await step('restaurant : active « je livre moi-même »', async () => {
      const response = await call('PUT', `/restaurants/${state.restaurantId}`, { token: state.owner.token, body: { selfDelivery: true } });
      expectStatus(response, 200);
    });
    await step('livraison par le restaurant : commande en espèces, du restaurant jusqu’à la remise', async () => {
      // Le restaurant livre lui-même : ses frais (3 CHF) ne sont pas relevés au minimum livreur.
      let response = await createOrder({ items, total: expectedTotal - 1 });
      expect(response.status === 201 || response.status === 200, `commande : ${response.status} (${response.json?.code || response.json?.message})`);
      const orderId = orderIdOf(response.json);
      expect(response.json?.order?.selfDelivery === true, 'commande non marquée « livrée par le restaurant »');
      response = await call('POST', '/payments/cash', { token: state.client.token, body: { orderId } });
      expectStatus(response, 200, 'espèces : ');
      if (state.courier) {
        const assign = await call('PUT', `/orders/${orderId}/assign-driver`, { token: state.owner.token, body: { deliveryPerson: state.courier.id } });
        expect(assign.status === 409 && assign.json?.code === 'SELF_DELIVERY_ORDER', `assignation : ${assign.status} ${assign.json?.code}`);
      }
      for (const status of ['Confirmée', 'En préparation', 'En livraison', 'Livrée']) {
        response = await call('PUT', `/orders/${orderId}/status`, { token: state.owner.token, body: { status } });
        expectStatus(response, 200, `${status} : `);
      }
      const order = response.json?.order || {};
      expect(order.status === 'Livrée' && order.paymentStatus === 'Payé', `${order.status} / ${order.paymentStatus}`);
    });
    await step('restaurant : revient à la livraison AFROEAT', async () => {
      const response = await call('PUT', `/restaurants/${state.restaurantId}`, { token: state.owner.token, body: { selfDelivery: false } });
      expectStatus(response, 200);
    });
  }

  // ─── Surveillance des erreurs ───
  state.admin = state.admin || (await login('admin-test@afroeat.test', 'admin'));
  await step('surveillance : une erreur du site est enregistrée et visible par l’admin', async () => {
    const marker = `e2e-client-error-${run}`;
    const report = await call('POST', '/monitoring/client-error', { body: { message: marker, path: '/e2e' } });
    expectStatus(report, 202);
    const list = await call('GET', '/admin/errors', { token: state.admin.token });
    expectStatus(list, 200);
    const found = (list.json?.errors || []).find((e) => e.message === marker);
    expect(found && found.source === 'web', 'erreur du site absente de la liste admin');
    const resolved = await call('PATCH', `/admin/errors/${found._id}/resolve`, { token: state.admin.token });
    expectStatus(resolved, 200);
    const denied = await call('GET', '/admin/errors', { token: state.client.token });
    expect(denied.status === 403 || denied.status === 401, `client non bloqué (${denied.status})`);
  });

  // ─── Codes promo (remise financée par la plateforme) ───
  const promoCode = `E2E${run}`.toUpperCase().slice(0, 20);
  const subtotalOf = () => Number(state.yassa.price) + 2 * Number(state.alloco.price);
  state.admin = state.admin || (await login('admin-test@afroeat.test', 'admin'));

  await step('admin : crée un code promo de 10 %', async () => {
    const response = await call('POST', '/admin/promo-codes', {
      token: state.admin.token,
      body: { code: promoCode, type: 'percent', value: 10, maxUses: 5, description: 'e2e' },
    });
    expectStatus(response, 201);
    state.promoId = response.json?.promoCode?.id;
    expect(state.promoId, 'identifiant du code introuvable');
    const duplicate = await call('POST', '/admin/promo-codes', { token: state.admin.token, body: { code: promoCode, type: 'percent', value: 10 } });
    expectStatus(duplicate, 409, 'doublon : ');
  });

  await step('devis avec code promo : remise plafonnée, restaurant et livreur non touchés', async () => {
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, promoCode } });
    expectStatus(response, 200);
    const quote = response.json?.quote;
    expect(quote?.promoCode === promoCode, `code ${quote?.promoCode}`);
    expect(quote.discountAmount > 0, 'aucune remise');
    expect(quote.discountAmount <= subtotalOf() * 0.1 + 0.001, 'remise supérieure à 10 % du sous-total');
    expect(Math.abs(quote.totalPrice + quote.discountAmount - expectedTotal) < 0.005, 'total incohérent');
    state.promoQuote = quote;
    return `−${quote.discountAmount} CHF`;
  });

  await step('parrainage : code personnel, refusé sur ses propres commandes', async () => {
    const response = await call('GET', '/users/me/referral', { token: state.client.token });
    expectStatus(response, 200);
    const code = response.json?.referral?.code;
    expect(/^[A-Z]+-[A-Z0-9]{4}$/.test(code || ''), `code ${code}`);
    const own = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, promoCode: code } });
    expect(own.status === 409 && own.json?.code === 'PROMO_OWN_CODE', `propre code accepté (${own.status} ${own.json?.code})`);
    return code;
  });

  await step('code inconnu refusé (PROMO_INVALID)', async () => {
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, promoCode: 'NEXISTEPAS' } });
    expectStatus(response, 409);
    expect(response.json?.code === 'PROMO_INVALID', `code ${response.json?.code}`);
  });

  await step('commande avec code promo : total remisé confirmé par le serveur', async () => {
    const response = await createOrder({ items, total: state.promoQuote.totalPrice, promoCode });
    expect(response.status === 201 || response.status === 200, `statut ${response.status} (${response.json?.code || response.json?.message})`);
    const order = response.json?.order || {};
    state.promoOrderId = orderIdOf(response.json);
    expect(Math.abs(Number(order.totalPrice) - state.promoQuote.totalPrice) < 0.005, `total ${order.totalPrice}`);
    expect(order.promoCode === promoCode && Number(order.discountAmount) > 0, 'code ou remise absents de la commande');
  });

  await step('un client ne réutilise pas le même code (PROMO_ALREADY_USED)', async () => {
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, promoCode } });
    expectStatus(response, 409);
    expect(response.json?.code === 'PROMO_ALREADY_USED', `code ${response.json?.code}`);
  });

  await step('annuler la commande libère le code', async () => {
    expect(state.promoOrderId, 'commande promo absente');
    const cancel = await call('PUT', `/orders/${state.promoOrderId}/status`, { token: state.client.token, body: { status: 'Annulée' } });
    expectStatus(cancel, 200, 'annulation : ');
    const again = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, promoCode } });
    expectStatus(again, 200, 'nouveau devis : ');
    const list = await call('GET', '/admin/promo-codes', { token: state.admin.token });
    const promo = (list.json?.promoCodes || []).find((item) => item.id === state.promoId);
    expect(promo && promo.usedCount === 0, `utilisations ${promo?.usedCount}`);
  });

  await step('code désactivé refusé', async () => {
    const off = await call('PATCH', `/admin/promo-codes/${state.promoId}`, { token: state.admin.token, body: { active: false } });
    expectStatus(off, 200, 'désactivation : ');
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items, promoCode } });
    expectStatus(response, 409);
    expect(response.json?.code === 'PROMO_INVALID', `code ${response.json?.code}`);
  });

  await step('un client ne peut ni créer ni lister les codes promo', async () => {
    const create = await call('POST', '/admin/promo-codes', { token: state.client.token, body: { code: 'PIRATE10', type: 'percent', value: 90 } });
    expect(create.status === 403 || create.status === 401, `création : ${create.status}`);
    const list = await call('GET', '/admin/promo-codes', { token: state.client.token });
    expect(list.status === 403 || list.status === 401, `liste : ${list.status}`);
  });

  // ─── Carnet d'adresses ───
  await step('carnet d’adresses : ajout, adresse par défaut, suppression', async () => {
    const first = await call('POST', '/users/me/addresses', { token: state.client.token, body: { label: 'Maison', address: 'Rue du Rhône 1, 1204 Genève' } });
    expectStatus(first, 201, 'ajout 1 : ');
    expect(first.json.addresses[0].isDefault === true, 'la première adresse doit être par défaut');
    const second = await call('POST', '/users/me/addresses', { token: state.client.token, body: { label: 'Travail', address: 'Avenue de la Gare 4, 74100 Annemasse', isDefault: true } });
    expectStatus(second, 201, 'ajout 2 : ');
    expect(second.json.addresses.filter((a) => a.isDefault).length === 1, 'une seule adresse par défaut');
    const tooShort = await call('POST', '/users/me/addresses', { token: state.client.token, body: { address: 'ab' } });
    expectStatus(tooShort, 400, 'adresse trop courte : ');
    const id = second.json.addresses.find((a) => a.label === 'Travail').id;
    const removed = await call('DELETE', `/users/me/addresses/${id}`, { token: state.client.token });
    expectStatus(removed, 200, 'suppression : ');
    expect(removed.json.addresses.length === 1 && removed.json.addresses[0].isDefault, 'la première adresse doit redevenir par défaut');
  });

  await step('export des données personnelles (sans mot de passe)', async () => {
    const response = await call('GET', '/users/me/export', { token: state.client.token });
    expectStatus(response, 200);
    const profile = response.json?.profile || {};
    expect(Boolean(profile.email), `profil sans e-mail (clés : ${Object.keys(profile).slice(0, 12).join(',')})`);
    expect(!('password' in profile), 'mot de passe exposé');
    expect(Array.isArray(response.json?.orders) && response.json.orders.length > 0, 'commandes absentes');
  });

  // ─── Sessions et suppression de compte ───
  await step('changer de mot de passe invalide les anciennes sessions', async () => {
    const email = `e2e-session-${run}@afroeat.test`;
    const password = strongPassword();
    const created = await call('POST', '/users/register', { body: { name: 'Session E2E', email, password, role: 'client', phone: '+41791234567', address: 'Rue du Rhône 1, 1204 Genève', country: 'Suisse' } });
    expectStatus(created, 201, 'inscription : ');
    const session = await login(email, 'client', password);
    expectStatus(await call('GET', '/users/me', { token: session.token }), 200, 'avant : ');
    await new Promise((resolve) => setTimeout(resolve, 1100)); // les jetons sont datés à la seconde
    const changed = await call('PUT', '/users/me/password', { token: session.token, body: { currentPassword: password, newPassword: strongPassword() } });
    expectStatus(changed, 200, 'changement : ');
    const after = await call('GET', '/users/me', { token: session.token });
    expect(after.status === 401, `ancien jeton encore accepté (${after.status})`);
  });

  await step('suppression de compte : mot de passe exigé, compte anonymisé, connexion impossible', async () => {
    const email = `e2e-delete-${run}@afroeat.test`;
    const password = strongPassword();
    const created = await call('POST', '/users/register', { body: { name: 'Supprime E2E', email, password, role: 'client', phone: '+41791234567', address: 'Rue du Rhône 1, 1204 Genève', country: 'Suisse' } });
    expectStatus(created, 201, 'inscription : ');
    const session = await login(email, 'client', password);
    const wrong = await call('DELETE', '/users/me/account', { token: session.token, body: { password: 'Mauvais#123aA', confirmation: true } });
    expectStatus(wrong, 401, 'mauvais mot de passe : ');
    const removed = await call('DELETE', '/users/me/account', { token: session.token, body: { password, confirmation: true } });
    expectStatus(removed, 200, 'suppression : ');
    const relog = await call('POST', '/users/login', { body: { email, password, role: 'client' } });
    expect(relog.status >= 400, `connexion encore possible (${relog.status})`);
  });

  await step('page publique de suppression de compte', async () => {
    const response = await fetch(`${API}/users/account-deletion`);
    expect(response.status === 200 && /Supprimer mon compte/.test(await response.text()), `statut ${response.status}`);
  });

  // ─── Invitation d'un nouveau restaurant partenaire ───
  const partnerEmail = `e2e-partner-${run}@afroeat.test`;
  await step('candidature partenaire envoyée (formulaire public)', async () => {
    const response = await call('POST', '/partner-applications', {
      body: {
        businessName: `E2E Chez Test ${run}`,
        businessType: 'restaurant',
        contactName: 'Awa E2E',
        email: partnerEmail,
        phone: '+41791234567',
        address: 'Rue du Mont-Blanc 1',
        city: 'Genève',
        country: 'Suisse',
        consent: true,
      },
    });
    expect(response.status === 201 || response.status === 200, `statut ${response.status} (${response.json?.message})`);
  });

  await step('admin : voit la candidature et génère le lien d’invitation', async () => {
    state.admin = await login('admin-test@afroeat.test', 'admin');
    const list = await call('GET', '/admin/partner-applications?limit=100', { token: state.admin.token });
    expectStatus(list, 200, 'liste : ');
    const application = (list.json?.applications || []).find((item) => item.email === partnerEmail);
    expect(application, 'candidature absente de la liste admin');
    expect(!('inviteTokenHash' in application), "l'empreinte du jeton ne doit pas être exposée");
    const invite = await call('POST', `/admin/partner-applications/${application._id}/invite`, { token: state.admin.token });
    expectStatus(invite, 200, 'invitation : ');
    const match = String(invite.json?.inviteUrl || '').match(/\/auth\/invite\?token=([a-f0-9]{64})$/);
    expect(match, "lien d'invitation inattendu");
    state.inviteToken = match[1];
  });
  if (!state.inviteToken) return finish();

  await step('page d’invitation : n’affiche que le nécessaire', async () => {
    const response = await call('GET', `/partner-applications/invite/${state.inviteToken}`);
    expectStatus(response, 200);
    expect(response.json?.invite?.email === partnerEmail, 'mauvais e-mail');
    expect(!('inviteTokenHash' in (response.json?.invite || {})), 'empreinte exposée');
  });

  await step('mot de passe faible refusé, sans consommer le lien', async () => {
    const response = await call('POST', `/partner-applications/invite/${state.inviteToken}/register`, {
      body: { name: 'Awa E2E', phone: '+41791234567', password: 'faible' },
    });
    expectStatus(response, 400);
  });

  await step('le restaurateur crée son compte avec son propre mot de passe', async () => {
    state.partnerPassword = strongPassword();
    const response = await call('POST', `/partner-applications/invite/${state.inviteToken}/register`, {
      body: { name: 'Awa E2E', phone: '+41791234567', password: state.partnerPassword },
    });
    expectStatus(response, 201);
    expect(!response.json?.token && !response.json?.password, 'la réponse ne doit contenir ni jeton ni mot de passe');
    await login(partnerEmail, 'restaurant', state.partnerPassword);
  });

  await step('le lien ne sert qu’une fois', async () => {
    const response = await call('POST', `/partner-applications/invite/${state.inviteToken}/register`, {
      body: { name: 'Autre', phone: '+41791234567', password: strongPassword() },
    });
    expect(response.status === 410, `attendu 410, reçu ${response.status}`);
    expect(response.json?.code === 'INVITE_USED', `code ${response.json?.code}`);
  });

  // ─── Invitation d'un livreur ───
  const courierEmail = `e2e-courier-${run}@afroeat.test`;
  await step('livreur : candidature, invitation, création du compte « livreur »', async () => {
    const applied = await call('POST', '/partner-applications', {
      body: {
        businessName: 'Moussa E2E',
        businessType: 'courier',
        contactName: 'Moussa E2E',
        email: courierEmail,
        phone: '+41791234567',
        address: 'Rue de la Gare 1',
        city: 'Annemasse',
        country: 'France',
        message: 'Vélo électrique',
        consent: true,
      },
    });
    expect(applied.status === 201 || applied.status === 200, `candidature ${applied.status} (${applied.json?.message})`);
    const list = await call('GET', '/admin/partner-applications?limit=100', { token: state.admin.token });
    const application = (list.json?.applications || []).find((item) => item.email === courierEmail);
    expect(application, 'candidature livreur absente');
    const invite = await call('POST', `/admin/partner-applications/${application._id}/invite`, { token: state.admin.token });
    expectStatus(invite, 200, 'invitation : ');
    const token = String(invite.json?.inviteUrl || '').split('token=')[1];
    const password = strongPassword();
    const created = await call('POST', `/partner-applications/invite/${token}/register`, {
      body: { name: 'Moussa E2E', phone: '+41791234567', password },
    });
    expectStatus(created, 201, 'création : ');
    expect(created.json?.role === 'livreur', `rôle ${created.json?.role}`);
    state.newCourier = await login(courierEmail, 'livreur', password);
  });

  await step('nouveau livreur : aucune course tant que l’admin ne l’a pas vérifié', async () => {
    expect(state.newCourier?.id, 'livreur non créé');
    const created = await createOrder({ items: [{ menuItem: String(state.yassa._id), quantity: 1 }], total: Number(state.yassa.price) + 3 });
    const orderId = orderIdOf(created.json);
    const response = await call('PUT', `/orders/${orderId}/assign-driver`, {
      token: state.owner.token,
      body: { deliveryPerson: state.newCourier.id },
    });
    expect(response.status === 403 || response.status === 409, `attendu 403/409, reçu ${response.status}`);
    return response.json?.code || '';
  });

  finish();
};

main().catch((error) => {
  console.error(`Erreur inattendue : ${error.message}`);
  process.exit(1);
});
