'use strict';

// Suppression de compte (droit à l'effacement, nLPD / RGPD) et export des données.
// Les commandes sont conservées (obligation comptable) mais détachées de toute identité.

const ACTIVE_ORDER_STATUSES = ['En attente', 'Confirmée', 'En préparation', 'En livraison'];
const DELETABLE_ROLES = ['client', 'restaurant', 'livreur'];

const canDeleteRole = (role) => DELETABLE_ROLES.includes(String(role || '').toLowerCase());

// Champs à écraser pour rendre le compte anonyme et inutilisable.
const buildAnonymizedFields = (userId, randomPassword, now = new Date()) => ({
  name: 'Compte supprimé',
  email: `deleted-${userId}@deleted.afroeat.invalid`,
  phone: '',
  address: '',
  profileImage: '',
  pushToken: '',
  password: randomPassword,
  accountStatus: 'deleted',
  isAvailable: false,
  isIdentityVerified: false,
  isWorkAuthorized: false,
  deletedAt: now,
});

const accountDeletionPageHtml = (supportEmail = 'support@afroeat.app') => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Supprimer mon compte AFROEAT</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#0d1c11;background:#fbf6ec}h1{font-size:26px}</style>
</head><body>
<h1>Supprimer mon compte AFROEAT</h1>
<p>Vous pouvez supprimer votre compte directement dans l'application : <strong>Profil → Confidentialité → Supprimer mon compte</strong>. Votre mot de passe est demandé pour confirmer.</p>
<p>Ce qui est supprimé : votre nom, e-mail, téléphone, adresses, photo, jeton de notification, cartes enregistrées et pièces justificatives.</p>
<p>Ce qui est conservé : les commandes passées, sans lien avec votre identité, pendant la durée légale de conservation comptable.</p>
<p>Une commande en cours doit être terminée ou annulée avant la suppression.</p>
<p>Impossible d'accéder à l'application ? Écrivez-nous depuis l'adresse du compte à <a href="mailto:${supportEmail}">${supportEmail}</a> : nous traitons la demande sous 30 jours.</p>
</body></html>`;

module.exports = { ACTIVE_ORDER_STATUSES, DELETABLE_ROLES, canDeleteRole, buildAnonymizedFields, accountDeletionPageHtml };
