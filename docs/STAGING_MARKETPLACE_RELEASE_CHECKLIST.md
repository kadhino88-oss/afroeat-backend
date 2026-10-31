# Afroeat — checklist de validation staging avant mise en production

> Objectif : prouver le parcours complet client → restaurant → livreur → règlement, sans utiliser de fonds réels.
> **Ne jamais supprimer les gardes de production pour réussir un test.** Les tests de paiement doivent utiliser un environnement Stripe de test isolé.

## 0. Préparation et sécurité

- [ ] Déployer cette version du backend sur un environnement staging isolé de la production.
- [ ] Configurer une base MongoDB staging avec des données synthétiques, sans données personnelles copiées de production.
- [ ] Vérifier `NODE_ENV`, `EXPO_PUBLIC_APP_ENV` et `EXPO_PUBLIC_API_URL` pour chaque build ; l’application ne doit pas pointer vers la production pendant les tests.
- [ ] Utiliser uniquement les clés Stripe de test et vérifier que les secrets privés restent côté serveur.
- [ ] Créer des comptes de test distincts : client, restaurant propriétaire, restaurant non propriétaire, livreur, administrateur.
- [ ] Vérifier que les journaux ne contiennent ni secrets, ni données de carte, ni tokens complets.

## 1. Création et tarification de commande

- [ ] Créer une commande avec un article actif et une quantité valide ; le serveur recharge le menu et calcule les prix.
- [ ] Modifier le prix ou le total dans la requête client : le serveur ignore ces valeurs et conserve le total calculé côté serveur.
- [ ] Tester quantité zéro/négative, article inexistant/inactif, article d’un autre restaurant, panier vide et identifiants invalides : requêtes rejetées proprement.
- [ ] Envoyer deux fois la même requête avec la même clé `Idempotency-Key` : aucune commande en double.
- [ ] Réutiliser la même clé avec un payload différent : la requête est rejetée.
- [ ] Vérifier l’adresse de livraison, la devise, les frais et l’arrondi des montants.

## 2. Stripe Connect et paiement carte

- [ ] Connecter un compte test appartenant au restaurant attendu et vérifier l’état des capacités requises.
- [ ] Confirmer qu’un restaurant ne peut pas consulter/modifier le compte connecté d’un autre restaurant.
- [ ] Créer un PaymentIntent de test uniquement pour une commande staging éligible ; vérifier montant, devise, identifiant de commande et métadonnées.
- [ ] Tester paiement réussi, refusé, authentification 3-D Secure requise, annulation et délai réseau.
- [ ] Confirmer côté serveur à partir de l’identifiant PaymentIntent attendu ; ne jamais accepter le seul signal de réussite du client.
- [ ] Vérifier la signature du webhook avec le secret staging, puis tester signature invalide, événement dupliqué, événement retardé et ordre d’arrivée différent.
- [ ] Vérifier l’idempotence du webhook : le même événement ne doit ni dupliquer le paiement ni changer deux fois le statut.
- [ ] Vérifier qu’un paiement destiné à une commande ne peut pas être appliqué à une autre commande ou à un autre utilisateur.

## 3. Cycle de vie et versements marketplace

- [ ] Vérifier les transitions de statut autorisées et refuser les transitions interdites.
- [ ] Tester l’affectation d’un livreur autorisé et refuser l’accès d’un livreur non affecté.
- [ ] Tester la livraison complète, les coordonnées et l’horodatage de suivi.
- [ ] Vérifier le calcul des commissions et parts restaurant/livreur à partir de règles approuvées.
- [ ] Déclencher le versement test seulement lorsque les conditions prévues sont remplies ; vérifier les montants nets et les identifiants Stripe.
- [ ] Simuler un versement échoué, retardé ou indisponible ; la commande doit rester réconciliable et générer une alerte exploitable.
- [ ] Vérifier que les versements ne peuvent pas être déclenchés deux fois pour la même commande.

## 4. Remboursements, litiges et rapprochement

- [ ] Tester remboursement total et partiel, y compris les limites de montant.
- [ ] Tester l’échec du remboursement et vérifier que l’état de la commande et le journal de rapprochement restent cohérents.
- [ ] Vérifier la gestion des annulations, litiges et renversements de transfert, sans créditer deux fois un partenaire.
- [ ] Vérifier les droits administrateur, la séparation des rôles et les journaux d’audit.
- [ ] Comparer les commandes, PaymentIntents, remboursements, transferts et soldes Connect avec un rapport de rapprochement.
- [ ] Vérifier que les écarts restent visibles jusqu’à résolution explicite ; aucune résolution silencieuse.

## 5. Paiement en espèces

- [ ] Ne pas activer le paiement en espèces en production avant d’avoir défini le responsable de collecte, la preuve de collecte, le rapprochement et le traitement des écarts.
- [ ] En staging, tester l’acceptation, le refus, la double soumission et les commandes annulées.
- [ ] Vérifier que le statut « payé » ne peut pas être défini par le seul client.
- [ ] Tester la réconciliation de la collecte du livreur, la confirmation restaurant et les écarts de caisse.

## 6. Validation mobile et Web

- [ ] Construire l’application iOS et Android avec EAS en utilisant les secrets du propriétaire du projet.
- [ ] Installer les builds sur appareils réels ou simulateurs pris en charge.
- [ ] Tester inscription/connexion, récupération de session, rôles, recherche, filtres de cuisine, fiche restaurant, menu, panier, adresse et erreurs réseau.
- [ ] Tester notifications et autorisations, géolocalisation, suivi livreur et statuts de commande.
- [ ] Vérifier les parcours paiement selon les méthodes réellement annoncées par le backend ; une méthode indisponible doit rester désactivée.
- [ ] Tester le Web séparément : les moyens de paiement disponibles sur mobile ne doivent pas être présentés comme disponibles sur Web s’ils ne le sont pas.
- [ ] Vérifier que le panier n’est effacé qu’après confirmation serveur du résultat attendu.

## 7. Preuves et décision de mise en production

Pour chaque test, enregistrer : date, commit SHA, environnement, rôle de test, scénario, résultat attendu, résultat observé, identifiant de commande de test, identifiant d’événement Stripe non sensible et lien vers les logs expurgés.

- [ ] Toutes les étapes critiques réussissent deux fois, y compris les scénarios d’échec et de reprise.
- [ ] Aucun bug critique/haut non résolu ; CI backend et mobile verte sur les commits candidats.
- [ ] Procédure de rollback et personne responsable de l’astreinte identifiées.
- [ ] Approbation écrite des commissions, frais, devises, pays couverts, responsabilité des remboursements et règles de versement par les responsables métier/comptabilité.
- [ ] Revue finale des permissions et des secrets.
- [ ] Activation de production uniquement via un changement explicite, revu, avec tests de non-régression et possibilité de retour arrière.

## État initial

- CI backend : vérifier le dernier run lié au commit candidat.
- CI mobile Expo SDK 58 : vérifier le dernier run lié au commit candidat.
- Les builds EAS, les tests sur appareils réels et l’approbation métier/comptabilité ne sont pas réputés accomplis tant que leurs preuves ne sont pas attachées.
- Les gardes de production sur commandes et paiements restent actives jusqu’à validation formelle de tous les critères applicables.
