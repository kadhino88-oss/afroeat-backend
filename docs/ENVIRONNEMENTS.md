# Carte des environnements AfroEat

Document unique pour savoir **qui est quoi** : projets Vercel, bases MongoDB, comptes Stripe.
Le nom d'un projet est parfois trompeur (voir §1) : en cas de doute, ce document fait foi, et
toute correction doit y être reportée.

> **Aucun secret ici.** Seuls les *noms* de variables apparaissent. Les valeurs se saisissent
> uniquement dans Vercel, Stripe ou Atlas, jamais dans une conversation ni dans le code.

## 1. Vue d'ensemble

| Rôle | Projet / ressource | Adresse | Base de données | Stripe |
|---|---|---|---|---|
| **API réelle (production)** | Vercel `afroeat-api-staging` (**nom trompeur**) | `afroeat-api-staging.vercel.app` | `afroeatDB` | compte **Afro Eat**, clés réelles |
| Site client web | Vercel `afroeat-app` | voir le projet Vercel | via l'API réelle | clé *publiable* seulement |
| Site d'administration | Vercel (site admin) | `afroeat-admin.vercel.app` | via l'API réelle | aucune |
| API de test | Vercel `afroeat-api-test` | voir le projet Vercel | `afroeat_test` | clés **test** (`sk_test_…`) |
| Site de test | Vercel `afroeat-app-test` | voir le projet Vercel | via l'API de test | clé publiable de test |
| Projet à ne pas utiliser | Vercel `afroeat-api` | — | — | — |

- Le projet `afroeat-api-staging` déploie la branche `main` et **sert le vrai trafic**. Le
  renommer casserait les adresses déjà configurées (webhooks Stripe, CORS, application mobile) :
  on garde le nom et on le documente.
- `afroeat-api` (sans suffixe) a déjà reçu par erreur des variables de production : ne rien y
  configurer, le supprimer quand plus personne ne le référence.

## 2. Bases MongoDB (Atlas, projet « Afroeat », cluster « Afroeat »)

| Base | Usage | Remarque |
|---|---|---|
| `afroeatDB` | **Production.** C'est la seule base lue par l'API réelle (`AFROEAT_MONGO_DB_NAME=afroeatDB`). | Le garde-fou `utils/databaseEnvironment.js` refuse tout nom contenant staging, test, dev, sandbox ou local quand `AFROEAT_DEPLOY_ENV=production`. |
| `afroeat_staging` | **Ancienne base.** Contient les premières données (dont des restaurants, menus et partenaires). | Elle n'est plus lue par la production. Le compte administrateur y a été copié dans `afroeatDB`. Voir §5. |
| `afroeat_test` | Base de l'API de test (recette Stripe en mode test). | Peut être vidée sans conséquence. |

Tous les rôles (client, restaurant, livreur, admin) sont dans la **même collection** `users`.

## 3. Stripe

| Compte | Mode | Utilisé par |
|---|---|---|
| **Afro Eat** | réel | API réelle (`afroeat-api-staging`) |
| Afro Eat (mode test) | test | API de test (`afroeat-api-test`) |

Points de réception (webhooks) de l'API réelle, à créer **sur le compte Afro Eat** :

| Point | Adresse | Secret (variable) | Événements clés |
|---|---|---|---|
| Paiements | `/api/payments/webhook` | `STRIPE_WEBHOOK_SECRET` | `checkout.session.completed`/`expired`, `payment_intent.succeeded`/`payment_failed`/`canceled`, `charge.refunded`, `refund.updated`/`failed`, `charge.dispute.created`/`updated`/`closed` |
| Comptes connectés | `/api/payments/webhook/connect` | `STRIPE_CONNECT_WEBHOOK_SECRET` | `account.updated` |

Chaque point a **son propre secret** : ne jamais réutiliser celui de l'autre.

## 4. Variables sensibles de l'API réelle (noms uniquement)

| Variable | Valeur attendue aujourd'hui | Rôle |
|---|---|---|
| `AFROEAT_DEPLOY_ENV` | `production` | active les garde-fous de production |
| `AFROEAT_MONGO_DB_NAME` | `afroeatDB` | base utilisée |
| `AFROEAT_LIVE_COMMERCE` | `closed` | **verrou des commandes réelles** : passer à `open` seulement après la recette (`docs/RECETTE_STRIPE_TEST.md`) |
| `STRIPE_CONNECT_PAYOUTS_ENABLED` | `false` | les versements aux partenaires restent suspendus : l'argent encaissé reste sur le compte de la plateforme |
| `ADMIN_2FA_ENFORCE_AFTER` | `2026-11-25T00:00:00Z` | un administrateur sans double authentification est bloqué après cette date |
| `ADMIN_WEB_ORIGINS` | site d'administration | limite l'origine des connexions admin |
| `CRON_SECRET` | défini | protège les tâches planifiées (relance des versements 02:00, rapprochement du ledger 03:00 UTC) |
| `HEALTH_DETAILS_TOKEN` | défini | détails de santé réservés |
| `ALERT_EMAIL` | optionnel | destinataire des alertes de rapprochement (sinon `PARTNER_NOTIFY_EMAIL`) |

Le plan Vercel gratuit limite les tâches planifiées à **une exécution par jour** chacune.

## 5. Ce qui reste à décider ou à vérifier

1. **Données de `afroeat_staging`** : constat du 27/11/2026, l'API de production (`afroeatDB`) répond
   0 restaurant et 0 lieu. Copie des collections `restaurants`, `menuitems` et `places` (jamais `users`)
   avec le bouton GitHub **« Copier restaurants, menus et lieux vers la production »** (onglet Actions) :
   1. ajouter le secret `MIGRATION_MONGO_URI` (utilisateur Atlas autorisé à lire `afroeat_staging` et à
      écrire dans `afroeatDB`) dans Settings → Secrets and variables → Actions ;
   2. lancer d'abord **sans** cocher `apply` : les nombres par collection s'affichent, rien n'est écrit ;
   3. relancer en cochant `apply` et en tapant `afroeatDB` dans `confirm`. Seuls les documents absents de
      la cible sont insérés ; rien n'est supprimé ni modifié. Les index existent déjà (créés au déploiement).
   Sauvegarde Atlas recommandée avant l'étape 3.
2. **Journal de construction Vercel** : vérifier au prochain déploiement qu'il n'y a plus de
   conflit d'index sur les commandes.
3. **Recette Stripe en mode test** : à faire avant `AFROEAT_LIVE_COMMERCE=open`.
4. **Second compte administrateur** : facultatif, utile seulement pour récupérer l'accès si le
   téléphone de l'unique administrateur est perdu.

## 6. Règles pour ne plus se tromper

- Avant de créer une variable ou un point de réception : nommer **le projet Vercel et le compte
  Stripe** visés, et relire ce tableau.
- Un agent qui travaille via Composio doit préciser le compte Stripe (`stripe_mcp_vivid-urate` pour
  Afro Eat).
- Jamais de clé `sk_live_…` sur l'API de test ; jamais de clé `sk_test_…` sur l'API réelle.
- Toute modification de ce tableau passe par une demande de fusion relue.
