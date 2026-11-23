# AfroEat Backend

API Node.js / Express 5 / MongoDB (Mongoose 9) d'une marketplace de livraison de repas (clients, restaurants/partenaires, livreurs, admins). Concurrents visés: Uber Eats, Just Eat, Deliveroo → exigence de **sécurité**, **fiabilité des paiements** et **rapidité**. Consommée par `afroeat-app` (Expo).

## Commandes
- `npm ci` · `npm start` · `npm run dev`
- `npm run check:syntax` (CI) · `npm test` (= `node --test`, CI)
- `npm run db:sync-indexes` — les index (ex. clé d'idempotence des commandes) sont **requis** pour les garanties de concurrence.

## Architecture
`server.js` (helmet, CORS strict via `CORS_ORIGINS`, rate-limiters global/auth/order/payment, mongo-sanitize, hpp) → `routes/` → `controllers/` → `models/`. Middlewares: `authMiddleware`, `roleMiddleware`, `adminMiddleware`, `security.js`. Entrée Vercel: `api/index.js`. Tests dans `tests/*.test.js`.

## Règles non négociables
- **Jamais** de secret dans le code ou les logs (JWT, Stripe, Mongo). Documenter les variables dans `.env.example` uniquement.
- Toute route est authentifiée + contrôle de rôle **et** de propriété de la ressource (pas d'IDOR).
- Les prix, frais et disponibilités viennent **toujours** de la base, jamais du client.
- Paiements: webhook Stripe sur payload brut signé; opérations idempotentes; la prod est verrouillée (`utils/runtimeEnvironment.js`) mais le verrou ne vérifie que la présence de variables, pas un ledger: ne pas l'ouvrir avant d'avoir fermé les lacunes P0 du README (« Known gaps before production »).
- Entrées validées/typées; aucune requête Mongo construite depuis un objet client brut.
- Toute nouvelle route/comportement = un test `node --test`. La CI doit rester verte.
- Performance: pagination obligatoire sur les listes, `.lean()` en lecture, index pour chaque filtre/tri fréquent, pas de N+1.
- Ne pas modifier `.env*`, `package-lock.json` (hook de blocage); `vercel.json` et `.github/workflows/` demandent confirmation.

## Automatisations Claude (`.claude/`)
- Hooks: blocage fichiers secrets · vérification de syntaxe après édition.
- Agents: `security-reviewer`, `performance-reviewer`.
- Skills: `/check-all`, `/new-endpoint`.
- MCP: context7 (docs à jour Express 5 / Mongoose 9 / Stripe).
