# AFROEAT — phases 2 à 5 et état de préparation

Date de vérification : 20 novembre 2026

Ce document résume les changements préparés pour revue et distingue les contrôles locaux de l’état réel des services en ligne. Il ne certifie pas l’ouverture commerciale.

## Références vérifiées

- Application : `main` sur `97e354979561de5804d7477c9a75bb96e88eb777` ; le déploiement Vercel de production associé est `READY` et `https://afroeat-app.vercel.app` répond HTTP 200.
- Le projet Vercel `afroeat-app` est le site web : `vercel.json` exporte Expo vers `dist` et renvoie les routes vers `index.html`. Il ne contient pas de routes backend Vercel ; l’application consomme une API séparée via `EXPO_PUBLIC_API_URL`.
- Aucun domaine acheté n’est requis pour cet hébergement : le site est déjà accessible sur son domaine Vercel `afroeat-app.vercel.app`. Une API peut également utiliser une adresse `.vercel.app` avant d’ajouter un domaine personnalisé.
- Backend staging : `main` sur `fec5e21ae840d8208923737baf59c3df04a9c871` ; le projet Vercel `afroeat-api-staging` est `READY` et son endpoint de santé répond HTTP 200. La base annoncée par cet endpoint est `afroeat_staging`, connectée.
- Le bundle JavaScript réellement servi par le site public contient `https://afroeat-api-staging.vercel.app/api`. Cet alias répond HTTP 200 et son endpoint de santé confirme la connexion à `afroeat_staging`. L’application web publiée pointe donc vers le backend staging.
- Un projet Vercel de production `afroeat-api` vient d’être créé et relié au dépôt `kadhino88-oss/afroeat-backend` ; il utilise Express, Node 22 et la région `fra1`. Il n’a encore ni déploiement, ni domaine assigné, ni `MONGO_URI` de production.
- La configuration de ce nouveau projet attend explicitement la base `afroeat_live`. Les secrets JWT et de chiffrement dédiés sont créés ; les origines web, taux CHF/EUR (15 % de commission, 80 % des frais de livraison au livreur) et pays du pilote CH/FR sont préparés. Les commandes, paiements et versements y restent fermés jusqu’à validation.
- Le projet staging contient `AFROEAT_LIVE_COMMERCE=open`, alors que son endpoint indique la base `afroeat_staging`. Le mode de la clé Stripe n’a pas pu être déchiffré ni confirmé dans cette session ; ne pas confondre cette configuration avec une production vérifiée.
- Les contrôles des projets Vercel de test échouent actuellement sur la limite de créations de déploiements. Les contrôles de l’application de production et du backend staging sont réussis ; cette limite ne constitue pas un échec des tests locaux.

## Phase 2 — cohérence opérationnelle

- La prise en charge manuelle d’une livraison compare maintenant l’affectation et l’état attendus avant mise à jour atomique. Une requête répétée pour le livreur déjà affecté reste idempotente ; une course concurrente reçoit un conflit et ne remplace pas silencieusement le livreur.
- Le compteur de commandes sans livreur utilise le filtre des commandes réellement disponibles à l’affectation.
- Les chiffres de chiffre d’affaires des restaurants ne comptent que les états explicites de paiement encaissé. Le texte « Non payé » et le seul état « Livrée » ne sont plus assimilés à une recette.

## Phase 3 — tableaux de bord

- L’API admin fournit les encaissements confirmés par devise et reprend uniquement les répartitions déjà enregistrées pour la commission AFROEAT, le commerce et le livreur.
- Les commandes encaissées sans répartition historique sont signalées pour rapprochement ; aucun pourcentage ni revenu n’est déduit ou inventé.
- Le tableau de bord admin affiche ces montants par devise et le nombre de demandes de support ouvertes. Les nouveaux libellés sont disponibles en français, anglais, allemand, espagnol, italien et chinois.

## Phase 4 — sécurité, fiabilité et performance

- Aucun secret existant, donnée de production, réglage de facturation ou transaction Stripe n’a été modifié. Des secrets neufs ont été générés uniquement pour le nouveau projet `afroeat-api`, sans accès aux données tant que `MONGO_URI` n’est pas défini.
- L’audit npm de l’application signalait `minimatch` via Expo Fingerprint. Un override limité à cette dépendance utilise la version corrigée `11.0.8` ; les deux audits `npm audit --omit=dev` indiquent maintenant zéro vulnérabilité. L’override force un changement majeur sous Expo : le retirer quand Expo élargira sa plage de versions, après revalidation.
- Les contrôles réalisés couvrent les tests existants et les régressions ciblées ; ils ne représentent pas un audit de sécurité exhaustif.
- Le propriétaire indique que Stripe est en mode live et que l’éligibilité Connect est confirmée. Le connecteur Stripe exige une réauthentification dans cette session, donc ces deux éléments n’ont pas pu être vérifiés indépendamment. L’endpoint de santé staging indique seulement que Stripe est configuré, sans révéler son mode.

## Phase 5 — préparation commerciale

Le parcours de candidature partenaire, les écrans de menus, les pages légales et les principaux espaces client, commerce, livreur et administration sont déjà présents dans le dépôt. Avant une ouverture commerciale, vérifier et valider explicitement :

- la chaîne `MONGO_URI` d’un utilisateur MongoDB dédié à `afroeat_live`, puis un déploiement réussi de `afroeat-api` et un contrôle `/health` confirmant exactement cette base ; le bundle web publié pointe encore vers l’API staging ;
- la clé Stripe Live à enregistrer dans `afroeat-api` et un nouvel endpoint webhook live vers `https://afroeat-api.vercel.app/api/payments/webhook` ; le secret webhook actuel ne peut pas être réutilisé sans confirmer l’URL à laquelle il est associé ;
- la sauvegarde, la restauration et la supervision de la base de production, sans modifier les données existantes ;
- le mode de paiement Stripe, les webhooks live, l’intégration Connect et l’activation des versements pour chaque pays ouvert ; aucune clé ni transaction réelle n’a été inspectée ou testée ici ;
- les conditions commerciales, frais, délais, zones de livraison, disponibilité effective des livreurs et procédures de réclamation par marché ;
- les obligations légales locales et la validation des opérations avant l’ouverture de la Belgique, de l’Allemagne, du Royaume-Uni ou de l’Espagne ;
- une build mobile EAS basée sur la révision destinée à la sortie. La build Android de production la plus récente consultée est terminée, mais elle provient du commit `78861c28d3d066abe6940779b1d3d0f2888dab81`, antérieur à la révision web courante. Aucune nouvelle build n’a été créée pendant ces travaux.

## Contrôles exécutés sur les branches de travail

- Backend : 346 tests de référence réussis, 0 échec ; contrôle de syntaxe réussi sur 205 fichiers JavaScript. Le garde-fou de base de production ajouté ensuite passe 5 tests ciblés.
- Application : 201 tests réussis, 0 échec ; lint du tableau de bord admin sans erreur ni avertissement ; export web Expo terminé.
- Dépendances de production : `npm audit --omit=dev` affiche zéro vulnérabilité dans chacun des deux dépôts après le correctif ciblé.
- Les tests de commande et de paiement réellement validés par le propriétaire restent un historique de référence ; aucun paiement réel n’a été rejoué.

## Décision de préparation

Les garde-fous applicatifs sont poussés sur les branches de revue : le build web refuse les hôtes API de test/staging en production, et l’API refusera de répondre si le nom de la base ne correspond pas au nom explicitement configuré. La nouvelle API Vercel est préparée, mais le lancement reste bloqué jusqu’à l’ajout de la chaîne MongoDB de production et des paramètres Stripe Live/webhook, puis aux vérifications réelles et à la build mobile de sortie.
