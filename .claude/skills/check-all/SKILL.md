---
name: check-all
description: Lance toute la validation locale du backend (syntaxe + tests + audit des dépendances) comme la CI.
disable-model-invocation: true
---
Exécute dans l'ordre et rapporte le résultat de chacune (arrête-toi et analyse au premier échec):
1. `npm run check:syntax`
2. `npm test`
3. `npm ls --depth=0`
4. `npm audit --omit=dev` (rapporte uniquement high/critical)
Termine par un verdict clair: « prêt pour PR » ou la liste exacte des corrections à faire.
