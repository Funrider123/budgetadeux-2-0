# Les nombres

Application web pour s'entraîner sur les nombres et le calcul (CP/CE1) — un seul fichier HTML autonome, sans dépendance de build.

## Déploiement sur Netlify

Ce dossier est un projet Netlify indépendant du reste du dépôt.

1. Sur [app.netlify.com](https://app.netlify.com), cliquer sur **Add new site → Import an existing project**.
2. Choisir le dépôt GitHub `Funrider123/budgetadeux-2-0`.
3. Renseigner :
   - **Branch to deploy** : `claude/app-netlify-deployment-8tqmme` (ou `main` une fois la branche fusionnée)
   - **Base directory** : `appmaths`
   - **Build command** : (laisser vide)
   - **Publish directory** : `appmaths`
4. Déployer. Netlify servira directement `appmaths/index.html`.

Le fichier `netlify.toml` de ce dossier configure la publication et quelques en-têtes de sécurité de base.
