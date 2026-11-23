---
name: new-endpoint
description: Crée un nouvel endpoint API conforme aux conventions AfroEat (route, controller, auth/rôle, validation, test).
disable-model-invocation: true
argument-hint: <ressource> <verbe> <description>
---
Pour l'endpoint demandé (`$ARGUMENTS`):
1. Lis une route et un controller existants proches (`routes/`, `controllers/`) et reproduis le style (CommonJS, `'use strict'`, gestion d'erreurs, format de réponse).
2. Route: middleware d'auth + `roleMiddleware` adapté; ajoute le rate-limiter existant si l'endpoint est sensible (auth, commande, paiement).
3. Controller: valide et type toutes les entrées (rejette les objets `$`), vérifie la **propriété** de la ressource, ne fait jamais confiance au client pour prix/rôle/statut, pagine les listes (`limit` plafonnée, `.lean()`).
4. Modèle: ajoute les index nécessaires et mentionne `npm run db:sync-indexes`.
5. Test `tests/<nom>.test.js` (`node --test`) couvrant: succès, non authentifié (401), mauvais rôle/propriétaire (403), entrée invalide (400).
6. Enregistre la route dans `server.js`, puis lance `npm run check:syntax && npm test`.
