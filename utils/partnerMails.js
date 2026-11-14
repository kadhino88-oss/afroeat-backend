'use strict';

/**
 * Textes des e-mails liés aux candidatures partenaires (texte brut, pas de HTML :
 * rien de ce que saisit le candidat ne peut donc injecter de code dans le message).
 */
const TYPE_LABELS = {
  restaurant: 'Restaurant',
  grocery: 'Épicerie',
  shop: 'Commerce',
  other: 'Autre commerce',
  courier: 'Livreur',
};

const typeLabel = (type) => TYPE_LABELS[String(type || '').toLowerCase()] || String(type || '');
const line = (label, value) => (value ? `${label} : ${value}` : null);

/** Pour l'équipe AfroEat : une nouvelle candidature vient d'arriver. */
const adminNewApplicationEmail = (application, adminUrl) => ({
  subject: `AfroEat – Nouvelle candidature : ${application.businessName || application.contactName} (${typeLabel(application.businessType)})`,
  text: [
    'Une nouvelle candidature partenaire vient d’arriver.',
    '',
    line('Type', typeLabel(application.businessType)),
    line('Établissement', application.businessName),
    line('Contact', application.contactName),
    line('E-mail', application.email),
    line('Téléphone', application.phone),
    line('Ville', [application.city, application.country].filter(Boolean).join(', ')),
    '',
    adminUrl ? `Pour l’examiner et inviter le partenaire : ${adminUrl}` : 'Ouvre l’écran Candidatures partenaires de l’espace admin pour la traiter.',
  ].filter((value) => value !== null).join('\n'),
});

/** Pour le candidat : accusé de réception. */
const applicantConfirmationEmail = (application) => ({
  subject: 'AfroEat – Nous avons bien reçu ta candidature',
  text: [
    `Bonjour ${application.contactName || ''},`.replace(' ,', ','),
    '',
    `Merci d’avoir candidaté pour rejoindre AfroEat avec « ${application.businessName || 'ton activité'} ».`,
    'Notre équipe examine ta demande et te répond très vite.',
    'Si elle est acceptée, tu recevras un lien personnel pour créer ton compte et choisir ton mot de passe toi-même.',
    '',
    'À bientôt,',
    'L’équipe AfroEat',
  ].join('\n'),
});

/** Pour le candidat accepté : son lien personnel, à usage unique. */
const inviteEmail = (application, inviteUrl, expiresAt) => {
  const days = Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 86400000));
  return {
    subject: 'AfroEat – Ta candidature est acceptée, crée ton compte',
    text: [
      `Bonjour ${application.contactName || ''},`.replace(' ,', ','),
      '',
      `Bonne nouvelle : « ${application.businessName || 'ton activité'} » est acceptée sur AfroEat.`,
      `Crée ton compte avec ce lien personnel (valable ${days} jours, utilisable une seule fois) :`,
      inviteUrl,
      '',
      'Tu choisis toi-même ton mot de passe : personne d’autre ne le connaît, pas même nous.',
      'Ne transmets ce lien à personne.',
    ].join('\n'),
  };
};

module.exports = { typeLabel, adminNewApplicationEmail, applicantConfirmationEmail, inviteEmail };
