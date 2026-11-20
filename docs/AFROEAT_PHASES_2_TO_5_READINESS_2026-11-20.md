# AFROEAT — phases 2 à 5 et état de préparation

Date de vérification : 20 novembre 2026, 15:55 UTC

Ce document résume les changements préparés pour revue et distingue les contrôles locaux de l’état réel des services en ligne. Il ne certifie pas l’ouverture commerciale.

## Références vérifiées

- Application : `main` sur `97e354979561de5804d7477c9a75bb96e88eb777`, branche de revue `codex/afroeat-commercial-readiness` sur `ecf269b4f74591ab2127c04fce0a1af792815b75` (7 commits au-dessus de `main`). Le déploiement Vercel de production `dpl_ENpRjAGaRf2nKVrpdAqQm9YSuqkG` est `READY` sur `https://afroeat-app.vercel.app`.
- Le projet Vercel `afroeat-app` est le site web : `vercel.json` exporte Expo vers `dist` et renvoie les routes vers `index.html`. Il ne contient pas de routes backend Vercel ; l’application consomme une API séparée via `EXPO_PUBLIC_API_URL`.
- Aucun domaine acheté n’est requis pour cet hébergement : le site est déjà accessible sur son domaine Vercel `afroeat-app.vercel.app`. Une API peut également utiliser une adresse `.vercel.app` avant d’ajouter un domaine personnalisé.
- Application web : le bundle JavaScript de production contient désormais `https://afroeat-api.vercel.app/api`, et non l’adresse staging. Le test HTTP depuis l’origine `https://afroeat-app.vercel.app` confirme l’autorisation CORS.
- Backend `main` : `fec5e21ae840d8208923737baf59c3df04a9c871`. La branche de revue `codex/afroeat-commercial-readiness` est à `3a99846b85195caf0b1dfed930efc73a0aed4892` (6 commits au-dessus de `main`).
- API de production : déploiement Vercel `dpl_BtnMnUkZsc9cieP4fXdFuf3nt8Q4`, `READY`, région `fra1`, alias public `https://afroeat-api.vercel.app`. Son `/health` répond HTTP 200 et confirme la base `afroeat_live` connectée.
- Les secrets Stripe `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` sont maintenant présents en Production dans Vercel. Le `/health` confirme `features.stripe: true`. Leurs valeurs n’ont pas été lues. La validité du secret webhook sur l’URL live et le mode de la clé n’ont pas été vérifiés par une transaction ; le propriétaire a confirmé le mode Live.
- Les taux configurés pour CHF/EUR restent 15 % de commission plateforme et 80 % des frais de livraison au livreur, pour le pilote CH/FR. `AFROEAT_LIVE_COMMERCE=closed` et `STRIPE_CONNECT_PAYOUTS_ENABLED=false` restent en place jusqu’aux contrôles restants.
- Le projet staging reste distinct et ne doit pas être utilisé pour des commandes de production.
- Les contrôles Vercel des projets de test ont signalé une limite de créations de déploiements. Les déploiements de production app et API sont `READY` ; ne pas multiplier les builds si cette limite réapparaît.

## Phase 2 — cohérence opérationnelle

- La prise en charge manuelle d’une livraison compare maintenant l’affectation et l’état attendus avant mise à jour atomique. Une requête répétée pour le livreur déjà affecté reste idempotente ; une course concurrente reçoit un conflit et ne remplace pas silencieusement le livreur.
- Le compteur de commandes sans livreur utilise le filtre des commandes réellement disponibles à l’affectation.
- Les chiffres de chiffre d’affaires des restaurants ne comptent que les états explicites de paiement encaissé. Le texte « Non payé » et le seul état « Livrée » ne sont plus assimilés à une recette.

## Phase 3 — tableaux de bord

- L’API admin fournit les encaissements confirmés par devise et reprend uniquement les répartitions déjà enregistrées pour la commission AFROEAT, le commerce et le livreur.
- Les commandes encaissées sans répartition historique sont signalées pour rapprochement ; aucun pourcentage ni revenu n’est déduit ou inventé.
- Le tableau de bord admin affiche ces montants par devise et le nombre de demandes de support ouvertes. Les nouveaux libellés sont disponibles en français, anglais, allemand, espagnol, italien et chinois.

## Phase 4 — sécurité, fiabilité et performance

- Aucun paiement réel, donnée MongoDB ou réglage de facturation n’a été modifié. Les secrets Stripe ont été ajoutés par le propriétaire dans Vercel ; aucune valeur secrète n’a été lue ou copiée.
- L’audit npm de l’application signalait `minimatch` via Expo Fingerprint. Un override limité à cette dépendance utilise la version corrigée `11.0.8` ; les deux audits `npm audit --omit=dev` indiquent maintenant zéro vulnérabilité. L’override force un changement majeur sous Expo : le retirer quand Expo élargira sa plage de versions, après revalidation.
- Les contrôles réalisés couvrent les tests existants et les régressions ciblées ; ils ne représentent pas un audit de sécurité exhaustif.
- Le propriétaire indique que Stripe est en mode Live et que l’éligibilité Connect est confirmée. L’API de production voit maintenant Stripe configuré. Cela ne prouve pas la bonne signature du webhook ni l’activation Connect effective d’un compte partenaire.

## Phase 5 — préparation commerciale

Le parcours de candidature partenaire, les écrans de menus, les pages légales et les principaux espaces client, commerce, livreur et administration sont déjà présents dans le dépôt. Avant une ouverture commerciale, vérifier et valider explicitement :

- confirmer que le secret `STRIPE_WEBHOOK_SECRET` correspond à l’endpoint live `https://afroeat-api.vercel.app/api/payments/webhook`, puis vérifier la signature avec un événement de test Stripe sans créer de paiement ;
- tester l’authentification avec un compte autorisé sans transmettre de mot de passe dans un rapport. Les comptes stockés dans `afroeatDB` ne sont pas automatiquement présents dans `afroeat_live` ; toute migration doit être explicitement préparée et contrôlée ;
- la sauvegarde, la restauration et la supervision de la base de production, sans modifier les données existantes ;
- le mode de paiement Stripe, les webhooks live, l’intégration Connect et l’activation des versements pour chaque pays ouvert ; aucune clé ni transaction réelle n’a été inspectée ou testée ici ;
- les conditions commerciales, frais, délais, zones de livraison, disponibilité effective des livreurs et procédures de réclamation par marché ;
- les obligations légales locales et la validation des opérations avant l’ouverture de la Belgique, de l’Allemagne, du Royaume-Uni ou de l’Espagne ;
- une build mobile EAS basée sur la révision destinée à la sortie. La build Android de production la plus récente consultée est terminée, mais elle provient du commit `78861c28d3d066abe6940779b1d3d0f2888dab81`, antérieur à la révision web courante. Aucune nouvelle build n’a été créée pendant ces travaux.

## Contrôles exécutés sur les branches de travail

- Backend : `npm test` — 351 tests réussis, 0 échec ; `npm run check:syntax` — 205 fichiers JavaScript vérifiés.
- Application : `node --test scripts/*.test.cjs` — 187 tests réussis, 0 échec après rétablissement d’un accès visible au choix d’espace depuis l’écran de connexion. `npm run lint` — 0 erreur, 57 avertissements existants. La correction locale de connexion doit encore être poussée puis déployée ; la production actuelle reste sur le commit `ecf269b4...`.
- Dépendances de production : `npm audit --omit=dev` affiche zéro vulnérabilité dans chacun des deux dépôts après le correctif ciblé.
- Les tests de commande et de paiement réellement validés par le propriétaire restent un historique de référence ; aucun paiement réel n’a été rejoué.

## Décision de préparation

Les garde-fous applicatifs sont présents sur les branches de revue : le build web refuse les hôtes API de test/staging en production, et l’API refuse de répondre si la base ne correspond pas au nom configuré. Le site et l’API de production sont accessibles, MongoDB est relié à `afroeat_live` et Stripe est chargé côté API. Le lancement commercial reste bloqué tant que le webhook live, l’authentification par compte, les contrôles opérationnels/légaux, la sauvegarde/restauration et la build mobile candidate ne sont pas validés. Les commandes réelles et versements restent fermés.
