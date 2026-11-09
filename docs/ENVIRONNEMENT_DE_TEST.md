# Environnement de test AFROEAT (commande + carte, sans argent réel)

En production, la prise de commande, le paiement par carte et le paiement à la livraison sont
**volontairement verrouillés** tant que les versements aux restaurants ne sont pas validés.
Cet environnement de test sert à valider tout le parcours **sans toucher à la vraie base** et
**sans argent réel**.

## Garantie de sécurité

Les verrous ne sont levés que si **les deux** conditions sont vraies (`utils/runtimeEnvironment.js`) :

1. `AFROEAT_ENV=staging`
2. `STRIPE_SECRET_KEY` est une clé de **test** (`sk_test_…`)

Avec une clé live (`sk_live_…`), ou sans `AFROEAT_ENV=staging`, rien ne change : la production reste verrouillée.

## Étapes (à faire une seule fois)

Ne jamais coller de clé ou de mot de passe dans une conversation : saisir les valeurs uniquement
dans Vercel / GitHub.

### 1. Base de test (MongoDB Atlas)
Même cluster, **autre nom de base** : prendre l'adresse de connexion actuelle et remplacer le nom de
la base par `afroeat_test` (ex. `…mongodb.net/afroeat_test?…`).

### 2. API de test (Vercel)
Nouveau projet Vercel `afroeat-api-test`, dépôt `afroeat-backend`, branche `main`. Variables :

| Nom | Valeur |
|---|---|
| `AFROEAT_ENV` | `staging` |
| `MONGO_URI` | l'adresse de la **base de test** |
| `JWT_SECRET` | une nouvelle valeur aléatoire, **différente** de la production |
| `STRIPE_SECRET_KEY` | la clé `sk_test_…` |
| `PUBLIC_WEB_URL` | l'adresse du site de test (étape 3) |
| `CORS_EXTRA_ORIGINS` | l'adresse du site de test |

Reprendre les autres variables de l'API actuelle si besoin (e-mail, etc.).

### 3. Site de test (Vercel)
Nouveau projet `afroeat-app-test`, dépôt `afroeat-app`, branche `main`. Variables :
`EXPO_PUBLIC_API_URL` = `https://<api-de-test>.vercel.app/api` et `EXPO_PUBLIC_STRIPE_KEY` = `pk_test_…`.

### 4. Restaurant et plats de test (GitHub)
Dans `afroeat-backend` → Settings → Secrets → Actions : ajouter `TEST_MONGO_URI` (base de test) et
`TEST_OWNER_PASSWORD` (mot de passe du compte propriétaire de test). Puis Actions →
« Créer le restaurant TEST » → Run workflow. Le workflow refuse de tourner si `TEST_MONGO_URI` est
la même que la vraie base.

## Scénario de test

1. Sur le site de test, créer un compte client.
2. Ajouter une carte (`4242 4242 4242 4242`, date future, CVC au choix).
3. Ouvrir « TEST — Chez AfroEat (démo) », ajouter des plats, commander et payer par carte.
4. Se connecter avec `restaurant-test@afroeat.test` (mot de passe `TEST_OWNER_PASSWORD`) pour
   accepter la commande côté restaurant.

Les versements (Stripe Connect) restent désactivés tant que `STRIPE_CONNECT_PAYOUTS_ENABLED` n'est pas `true`.
