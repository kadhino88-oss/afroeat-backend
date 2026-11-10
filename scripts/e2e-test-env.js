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

const createOrder = async ({ items, total, key = uuid() }) => {
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
    },
  });
  return response;
};

const main = async () => {
  console.log(`Test de bout en bout — ${API}\n`);

  await step('API en ligne, base de test connectée', async () => {
    const response = await fetch(API.replace(/\/api$/, '/health'));
    const json = await response.json();
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
  if (!state.client || !state.restaurantId) return;

  const items = [
    { menuItem: String(state.yassa._id), quantity: 1 },
    { menuItem: String(state.alloco._id), quantity: 2 },
  ];
  const expectedTotal = Number(state.yassa.price) + 2 * Number(state.alloco.price) + 3;

  await step('devis serveur : sous-total + livraison', async () => {
    const response = await call('POST', '/orders/quote', { token: state.client.token, body: { restaurant: state.restaurantId, items } });
    expectStatus(response, 200);
    const quote = response.json?.quote;
    expect(quote?.totalPrice === expectedTotal, `total ${quote?.totalPrice} au lieu de ${expectedTotal}`);
    expect(quote?.currency === 'CHF', 'devise CHF attendue');
    return `${quote.totalPrice} CHF`;
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
  if (!state.orderId) return;

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

  await step('paiement par carte : session Stripe créée (sans payer)', async () => {
    const created = await createOrder({ items: [{ menuItem: String(state.yassa._id), quantity: 1 }], total: Number(state.yassa.price) + 3 });
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
  if (!state.inviteToken) return;

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

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
  if (failed.length) {
    console.log(`À corriger : ${failed.map((result) => result.name).join(' | ')}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(`Erreur inattendue : ${error.message}`);
  process.exit(1);
});
