# Passage en production : liste de contrôle

Aujourd'hui la production est **volontairement verrouillée** (prise de commande, paiement par carte,
paiement à la livraison) : voir `utils/runtimeEnvironment.js`. Ce document liste ce qu'il faut valider
**avant** d'ouvrir. Rien ici ne s'ouvre tout seul : le verrou se lève par une décision explicite,
après les contrôles ci-dessous.

## 0. Déjà validé sur l'environnement de test (carte de test, aucun argent réel)

- Compte client, adresse, panier, devis serveur, création de commande.
- Paiement Stripe Checkout, retour sur le site, commande « Confirmée ».
- Parcours des statuts : restaurant (préparation), livreur (prise en charge, livraison), blocage de la
  livraison tant que le paiement n'est pas confirmé (`tests/orderLifecycle.test.js`).

- Compte restaurant et livreur par invitation (le partenaire choisit son mot de passe), vérification des livreurs par l'admin.
- Photos des plats, logo et couverture envoyés depuis l'appli (`POST /api/images`).
- Horaires d'ouverture hebdomadaires appliqués au devis et à la commande.
- Changement de mot de passe, gains du livreur dans la devise de la commande.
- Test de bout en bout automatique (`e2e-test-env`) : 25 contrôles, client / restaurant / livreur / admin.

## 0 bis. E-mail (mot de passe oublié) : à configurer avant l'ouverture

Le parcours « Mot de passe oublié » est prêt mais **n'envoie rien tant qu'un service d'e-mail n'est pas configuré**
(sans configuration, l'API répond normalement et n'expose aucune erreur).

- [ ] Créer un compte [Resend](https://resend.com) (ou équivalent) et **vérifier le domaine d'envoi** (SPF / DKIM).
- [ ] Dans Vercel (projet API de production, variables « Sensitive ») : `RESEND_API_KEY` et `MAIL_FROM`
      (ex. `AfroEat <no-reply@votre-domaine>`).
- [ ] Définir `PUBLIC_WEB_URL` (adresse publique du site, utilisée dans le lien reçu par e-mail).
- [ ] Tester : demander une réinitialisation avec un compte de test et vérifier la réception.

## 0 ter. Données de la production

- [ ] Lancer « Importer les lieux OpenStreetMap » et « Importer les commerces africains saisis à la main » sur la base de production
      (l'environnement de test n'a pas ces lieux, c'est normal ; l'API répond une liste vide plutôt qu'une erreur).
- [ ] Inviter les vrais restaurants depuis l'écran admin « Candidatures partenaires » (« Approuver et inviter »).

## 1. Stripe (à faire par le titulaire du compte, dans le tableau de bord Stripe)

- [ ] Activer le compte Stripe en **mode live** (informations de l'entreprise, compte bancaire, pièce d'identité du représentant).
- [ ] Activer **Stripe Connect** (plateforme / marketplace) et choisir le type de comptes connectés.
- [ ] Définir le pays de la plateforme et les pays autorisés pour les versements
      (`STRIPE_PLATFORM_COUNTRY`, `STRIPE_CONNECT_COUNTRIES`, `STRIPE_CONNECT_CROSS_BORDER_COUNTRIES`).
- [ ] Vérifier que la Suisse (CHF) et la France (EUR) sont bien prises en charge pour vos comptes connectés.
- [ ] Créer le **webhook** live vers `<api>/api/payments/webhook` et copier son secret dans `STRIPE_WEBHOOK_SECRET`.
- [ ] Faire passer chaque restaurant et chaque livreur par l'inscription Stripe (vérification d'identité) avant son premier versement.
- [ ] Activer Apple Pay / Google Pay si voulu (identifiant marchand Apple `merchant.com.afroeat` à créer dans le compte Apple).

## 2. Répartition des paiements

- [ ] Décider la commission AFROEAT et la part livreur, puis renseigner `MARKETPLACE_RATES_JSON`
      (par devise, en points de base : `{"CHF":{"commissionBps":...,"courierPayoutBps":...}}`).
- [ ] Faire valider ces taux par votre comptable (TVA, facturation de la commission).
- [ ] Rejouer sur l'environnement de test avec `STRIPE_CONNECT_PAYOUTS_ENABLED=true` et des comptes connectés de test.

## 3. Juridique et conformité

- [ ] Relecture par un juriste de la politique de confidentialité et des conditions d'utilisation (`/legal/privacy`, `/legal/terms`).
- [ ] Mentions légales (identité de l'éditeur, adresse, contact) et adresse e-mail de contact (`EXPO_PUBLIC_CONTACT_EMAIL`).
- [ ] Conditions commerciales envoyées aux restaurants (commission, versements, délais).
- [ ] Alimentation : étiquetage des allergènes et règles d'hygiène côté restaurants partenaires.
- [ ] Statut des livreurs (indépendants ou salariés) et assurances selon le pays.

## 4. Sécurité et exploitation

- [ ] Nouveau `JWT_SECRET` de production (différent du test) et rotation planifiée.
- [ ] MongoDB Atlas : fermer l'accès `0.0.0.0/0`, sauvegardes activées, utilisateur dédié à la production.
- [ ] Variables de production dans Vercel uniquement (jamais dans le dépôt), clés live en « Sensitive ».
- [ ] Surveillance : alertes sur les erreurs 5xx et les échecs de paiement.
- [ ] Plan de retour arrière : savoir remettre le verrou (retirer la variable qui l'ouvre) en une minute.

## 5. Ouverture progressive

1. Un seul restaurant réel, quelques commandes réelles de faible montant, remboursement testé.
2. Vérifier dans Stripe : paiement, commission, versement au restaurant, versement au livreur.
3. Seulement ensuite, ouvrir aux autres restaurants et aux clients.

> Le verrou lui-même (`isProductionLocked`) ne doit être modifié qu'après validation écrite des points 1 à 4,
> dans un changement de code relu, avec un test qui prouve que l'ouverture reste impossible sans les
> variables de configuration attendues.

## Ouverture du commerce réel

Les commandes et paiements par carte réels s'ouvrent avec la variable `AFROEAT_LIVE_COMMERCE=open` sur l'API officielle,
à condition que la clé Stripe soit réelle, que `STRIPE_WEBHOOK_SECRET` et `MARKETPLACE_RATES_JSON` soient renseignés.
Si un élément manque, tout reste verrouillé. Pour refermer : supprimer la variable puis redéployer.
Le paiement à la livraison reste désactivé en production réelle.
