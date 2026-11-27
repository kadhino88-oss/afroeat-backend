# Recette des paiements en mode test Stripe

À faire **avant** d'ouvrir les commandes réelles (`AFROEAT_LIVE_COMMERCE=open`). Chaque case doit être cochée **avec une preuve** (identifiant d'événement Stripe, numéro de commande, capture), pas seulement « ça a l'air de marcher ».

## 0. Règles

- Environnement : l'API **de test** (`afroeat-api-test`) avec sa base de test et ses **clés Stripe en mode test** (`sk_test_…`, secret de webhook de test). **Jamais** l'API de production, jamais une clé `sk_live_…`.
- Cartes de test Stripe : `4242 4242 4242 4242` (succès), `4000 0000 0000 9995` (refusée, fonds insuffisants), `4000 0000 0000 0259` (litige à l'encaissement). Date future, CVC et code postal quelconques.
- Dans le tableau de bord Stripe, activez le **mode test** (bandeau orange) pour voir les événements et les webhooks.
- Variables à avoir sur l'API de test : `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` (point de réception de test vers `…/api/payments/webhook`), `STRIPE_CONNECT_WEBHOOK_SECRET` (point « comptes connectés » de test vers `…/api/payments/webhook/connect`, événement `account.updated`), `CRON_SECRET`, `STRIPE_CONNECT_PAYOUTS_ENABLED=true` **uniquement sur l'API de test**.
- Notez l'identifiant de la commande à chaque scénario.

## 1. Paiement par carte

- [ ] Commande, paiement `4242…` : la commande passe à « Payé » puis « Confirmée ».
- [ ] Stripe : un `payment_intent.succeeded` livré avec un code 200 (page du point de réception, onglet des livraisons).
- [ ] Une seule notification de nouvelle commande est envoyée au restaurant (pas de doublon).
- [ ] Paiement refusé `4000 0000 0000 9995` : la commande reste « Non payé », message clair côté client, possibilité de réessayer.
- [ ] Retour de paiement sans passer par le webhook (fermer l'onglet puis rouvrir la commande) : l'état final est correct.

## 2. Webhook rejoué (déduplication)

- [ ] Dans Stripe, rouvrez l'événement `payment_intent.succeeded` de la commande ci-dessus et cliquez sur « Renvoyer ». L'API répond 200, **aucun effet en double** (pas de seconde notification, pas de second changement de statut).
- [ ] Renvoyez aussi un événement de remboursement (voir §4) : même résultat.

## 3. Annulation puis paiement tardif

- [ ] Créez une commande, laissez la session de paiement ouverte, annulez la commande, puis payez avec la session encore ouverte.
- [ ] La commande reste « Annulée » et le paiement est **remboursé automatiquement** (un remboursement apparaît dans Stripe). Le client n'est jamais débité sans commande.

## 4. Remboursements

- [ ] Remboursement total par l'administration : statut « Remboursé », remboursement visible dans Stripe, événement `refund.updated` ou `charge.refunded` livré avec un code 200.
- [ ] Remboursement partiel fait **depuis le tableau de bord Stripe** : la commande **n'est pas** marquée « Remboursé » à tort.
- [ ] Devise sans décimales (si prévue : XOF ou XAF) : le montant remboursé correspond exactement au montant payé (pas de division par 100).

## 5. Litiges

- [ ] Paiement avec `4000 0000 0000 0259` : un `charge.dispute.created` est reçu et la commande est marquée en litige (versement suspendu).
- [ ] Dans Stripe, répondez au litige avec le texte de preuve `winning_evidence` : `charge.dispute.closed` (gagné), le versement reprend.
- [ ] Refaites un litige et répondez avec `losing_evidence` : `charge.dispute.closed` (perdu). Si un versement avait été fait, il est **annulé** (réversion du transfert) ; sinon la commande passe en « réconciliation requise » avec un motif lisible dans la liste d'administration.

## 6. Comptes connectés et versements

- [ ] Créez un compte partenaire (restaurant) en mode test et terminez l'inscription Stripe avec les données de test. Un `account.updated` arrive sur le point **Connect** avec un code 200 et l'état du compte se met à jour dans l'application.
- [ ] Livrez une commande payée : les transferts vers le restaurant (et le livreur si concerné) sont créés ; les montants correspondent à la commission configurée (`MARKETPLACE_RATES_JSON`) ; la somme des transferts ne dépasse jamais le montant encaissé.
- [ ] Relance en lot : `GET /api/payments/connect/retry-payouts` avec `Authorization: Bearer <CRON_SECRET>` renvoie des compteurs ; sans le secret : 401.
- [ ] Une commande dont le litige est perdu n'est jamais re-versée par une relance.

## 7. Ledger et rapprochement

- [ ] Pour une commande payée puis remboursée : les écritures `charge`, `stripe_fee` (si disponible) et `refund` existent, une seule fois chacune.
- [ ] `GET /api/admin/ledger/summary?from=…&to=…` (compte admin) : les totaux par type et par devise sont cohérents avec Stripe.
- [ ] `GET /api/payments/ledger/reconcile-daily` avec le secret : un rapport est enregistré, statut « ok ». En cas d'écart, un e-mail d'alerte arrive à l'adresse `ALERT_EMAIL`.
- [ ] Un rapprochement relancé le même jour ne renvoie pas un second e-mail.

## 8. Espèces (si proposées)

- [ ] Commande en espèces par le restaurant ou le livreur, livrée : l'écriture `cash_collected` existe ; le règlement admin crée `cash_settled`.
- [ ] Le plafond espèces (`CASH_COURIER_MAX_TOTAL`) bloque une commande trop élevée.

## 9. Sécurité

- [ ] Un appel au webhook sans signature ou avec une fausse signature répond 400.
- [ ] Un client ne peut ni lire ni payer la commande d'un autre client.
- [ ] Les routes de tâches planifiées refusent tout appel sans `CRON_SECRET`.
- [ ] La connexion administrateur demande le code à 6 chiffres ; un administrateur sans 2FA est bloqué après la date `ADMIN_2FA_ENFORCE_AFTER`.

## 10. Critère de sortie

Tout est coché avec preuve, **et** :

- [ ] Aucun événement Stripe en échec sur les trois derniers jours de test.
- [ ] Aucune commande en « réconciliation requise » non expliquée.
- [ ] Le rapprochement quotidien est « ok » plusieurs jours de suite.

## 11. Ouverture progressive de la production

1. Sur `afroeat-api-staging`, vérifier que `STRIPE_SECRET_KEY` est la clé **réelle**, que `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` et `MARKETPLACE_RATES_JSON` sont renseignés.
2. Garder `STRIPE_CONNECT_PAYOUTS_ENABLED=false` au début.
3. Passer `AFROEAT_LIVE_COMMERCE` à `open`, redéployer.
4. Faire **une** vraie commande de petit montant avec votre propre carte, puis la rembourser. Vérifier Stripe, le ledger et le rapprochement du lendemain.
5. Seulement ensuite, ouvrir aux premiers partenaires, puis activer les versements.
6. Pour refermer d'urgence : remettre `AFROEAT_LIVE_COMMERCE=closed` et redéployer.
