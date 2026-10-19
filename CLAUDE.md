# Budget à Deux — ce qu'il ne faut pas réapprendre à ses dépens

Quelques règles qui ne se devinent pas en lisant le code, et dont l'oubli ne se voit
qu'en production.

## Supabase

### Une nouvelle table de `public` doit porter ses droits elle-même

Depuis le 30 octobre 2026, Supabase ne donne plus automatiquement l'accès Data API aux
nouvelles tables du schéma `public`. Une table créée sans `grant` est injoignable depuis
l'app : l'API répond « permission denied », même avec un utilisateur connecté et des
politiques RLS parfaitement écrites.

Les droits s'écrivent dans la **même migration** que le `create table` :

```sql
grant select on public.ma_table to anon;
grant select, insert, update, delete on public.ma_table to authenticated;
grant select, insert, update, delete on public.ma_table to service_role;
```

Deux précisions :

- n'accorder à `anon` que ce qui doit vraiment être lisible sans compte. Aujourd'hui
  aucune politique RLS ne vise `anon` : il a les droits de table mais ne lit rien ;
- un `grant` n'est pas une politique RLS. Le premier ouvre la porte à l'API, la seconde
  décide qui voit quelle ligne. Il faut les deux.

Les 18 objets déjà en place (17 tables et la vue `onboarding_candidates`) ont tous leurs
droits : il n'y a rien à reprendre sur l'existant.

### Les Edge Functions se déploient avec `verify_jwt: false`

Le cron qui déclenche `money-date-reminder` n'envoie que l'en-tête `x-cron-secret`, jamais
d'`Authorization`. Déployée avec la vérification JWT active, la fonction est rejetée par la
passerelle avant même de s'exécuter, et les relances cessent en silence.

Après chaque déploiement, l'appeler avec un secret volontairement faux : la réponse
attendue est le 401 de la fonction elle-même, `{"error":"unauthorized"}`. Un
`UNAUTHORIZED_NO_AUTH_HEADER` signifie que la passerelle a intercepté l'appel, donc que le
déploiement est à refaire.

## Écriture des textes français

- Des points-virgules, jamais de tirets cadratins.
- Pas d'écriture inclusive.
- On vouvoie quand on s'adresse au couple, on tutoie quand on s'adresse à une seule
  personne. Un même mail peut donc passer de l'un à l'autre, selon à qui parle la phrase.

## Travail et déploiement

- Développer sur `claude/v2-design-w9peoa`.
- `main` est la branche que Netlify déploie sur budgetadeux.fr : n'y fusionner que sur
  demande explicite.
- Toute l'application tient dans `index.html`, style compris. Les tests sont dans `tests/`
  et se lancent avec `npx playwright test`.
