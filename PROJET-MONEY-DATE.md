# Projet Money Date

Notes de conception, pas encore un chantier. Rien de ce qui suit n'est implémenté.

**Le point de départ**, remonté plusieurs fois par des testeurs : dans beaucoup de couples,
une seule personne gère l'argent. L'autre lui fait confiance, et c'est plus simple comme ça.
C'est un défi direct pour une app qui s'appelle Budget à Deux, dont le rituel central est un
rendez-vous à deux, et dont les relances insistent pour que le partenaire rejoigne.

---

## Le principe directeur

**Le second en fait moins mais décide autant.**

Le retour ci-dessus mélange deux choses : *gérer* et *savoir*. Celui qui ne gère pas ne
renonce pas à savoir où on en est — il renonce aux corvées (saisir, classer, arbitrer).
« Il me fait confiance » veut le plus souvent dire « je ne veux pas du travail », rarement
« je ne veux rien voir ».

L'erreur de l'app n'est donc pas de demander deux personnes : c'est de leur demander **le
même rôle**. Les deux reçoivent les mêmes écrans et les mêmes devoirs ; pour celui qui n'a
jamais voulu gérer, l'expérience est « voilà un outil de budget, au travail ».

La réponse n'est pas de basculer vers une app solo avec un partenaire optionnel : le partage
est la seule différence face à Bankin', Linxo ou YNAB. La réponse est de rendre le rôle du
second **léger et quand même utile**. D'où le principe : moins de charge, autant de voix.
C'est ce qui rend le rôle tenable — personne n'accepte d'être spectateur, tout le monde
accepte d'être celui qui dit oui.

---

## Ce que le code dit aujourd'hui (vérifié le 24/09/2026)

**L'app ne bloque pas sur le partenaire.** `S.auth.partnerLinked` ne conditionne aucune
fonctionnalité. Il change seulement :

- la pastille de connexion (`connStatus()` → `'unlinked'`, « Non relié ») ;
- une ligne des Réglages (« En attente que votre partenaire rejoigne avec ce code ») et la
  ligne du partenaire dans la carte du couple ;
- les options proposées par `openDeleteAccount()`.

`needsSetup()` ne regarde que les revenus / contributions fixes. Un gestionnaire seul peut
donc déjà tout faire : poser le budget, le valider, saisir, faire son Money Date.

**Conséquence : ce qui « bloque » est narratif, pas technique.** Le chantier est plus petit
qu'il n'en a l'air. Ce qu'il reste à corriger, c'est que l'app présente comme un manque
(« Non relié », « En attente que… ») ce qui est souvent un choix assumé.

---

## Les trois directions

### 1. Vue simplifiée, par personne

Un réglage dans son propre compte pour ne garder que l'essentiel.

Ce qui la rend bonne : c'est **chacun pour soi et réversible**. Personne n'impose rien à
personne, et le passager peut regarder en détail le jour où ça l'intéresse — ce qui arrive,
parce que les rôles bougent (projet immobilier, enfant, perte d'emploi).

**Le réglage doit vivre dans `S.ui`, jamais dans `S.settings`.** `settings` fait partie des
`SYNC_KEYS` : y mettre la préférence d'affichage la déclencherait aussi chez le partenaire.
`S.ui` est local à l'appareil, comme le thème sombre.

La difficulté n'est pas le bouton, c'est de définir « essentiel ». Si ça revient à masquer
deux cartes, personne ne l'activera. Ce que veut le passager tient probablement en trois
choses : où on en est ce mois-ci, est-ce qu'on est dans les clous, où en sont les projets.
Pas le détail charge par charge, pas les modes de répartition, pas l'historique.

Le nom compte : « vue simplifiée » ou « l'essentiel ». Jamais « mode limité » ni « mode
débutant » — c'est pour l'autre qu'on l'active dans sa tête, et ça deviendrait vexant.

Garde-fou : la vue simplifiée ne doit **jamais** masquer une demande adressée à la personne.
Si un brouillon attend sa validation, ça doit se voir même dans la vue la plus dépouillée.

### 2. Le partenaire reste requis à l'inscription

Décidé : on garde. Le second compte n'existe pas pour le confort du second, il existe pour
que les données soient partagées et que le rituel soit possible. Sans lui : plus de Money
Date, plus de répartition, plus de « vous ».

Ce qui change n'est pas l'architecture, c'est le discours (voir la section précédente sur
l'état solo), et le fait que la vue simplifiée rend le coût du second compte beaucoup plus
faible. On garde l'exigence, on en baisse le prix.

### 3. Mode brouillon : l'un prépare, l'autre valide

**La moitié existe déjà.** `pilotFrozen`, `pilotSnapshot`, le bandeau orange « vos
ajustements ne sont pas encore officiels », le bouton « Valider » : c'est exactement un
brouillon en attente de validation. Il manque seulement :

1. **Savoir qui valide.** Surtout ne pas créer de rôle déclaré (« gestionnaire » /
   « passager ») : ça fige ce qui doit rester fluide et ça colle une étiquette à quelqu'un.
   La synchro enregistre déjà `updated_by` — l'état « préparé par l'un, en attente de
   l'autre » peut se déduire sans rien demander à personne, et il suit tout seul quand les
   rôles s'inversent.
2. **Prévenir l'autre.** Le brouillon n'existe aujourd'hui que pour celui qui est devant
   l'écran. Le canal email existe déjà (Edge Function `money-date-reminder`).

Trois pièges, par ordre de gravité :

- **Le blocage.** Si le budget ne devient officiel qu'une fois validé par l'autre, et que
  l'autre n'ouvre jamais l'app, c'est le gestionnaire — celui qui se débrouillait très bien
  seul — qui se retrouve coincé par la personne qui ne voulait pas s'en occuper. L'exact
  contraire du but. Il faut que la validation soit facultative, ou qu'elle s'applique d'elle
  même au bout de quelques jours, ou que le gestionnaire puisse passer outre.
- **Le reproche.** « Tu n'as toujours pas validé » est un motif de dispute livré clé en main.
  Tout est dans la formulation.
- **La synchro.** Un brouillon en attente est précisément l'état où les deux téléphones
  risquent de toucher la même chose. Or `applyShared()` écrase `settings` et `pilotFrozen`
  en bloc avec la version distante : le dernier qui pousse gagne (contrairement aux tableaux,
  fusionnés par `mergeArraysWithRemote`). Ça tient aujourd'hui parce que personne ne modifie
  en même temps ; un aller-retour « je prépare / tu valides » rendrait ce cas fréquent.
  **À regarder avant de construire, pas après.**

---

## La relance J+2

Conséquence de tout ce qui précède : arrêter de vendre le partenaire comme une étape à
franchir, et vendre ce qu'il lui en coûtera — « il n'aura presque rien à faire ». C'est la
vraie objection du gestionnaire, et la seule chose qu'il a besoin d'entendre pour oser
demander.

Mais ça n'a de sens qu'une fois la vue simplifiée en place : sinon la promesse est fausse.

---

## Ce qui reste à vérifier avant de construire

Tout ce qui précède repose sur une hypothèse non vérifiée : que le passager veut savoir sans
faire. Elle est plausible, pas démontrée. Le retour d'origine recouvre quatre situations très
différentes, qui n'appellent pas du tout les mêmes réponses :

1. « Je ne veux pas des corvées » → rôles asymétriques, le second reçoit plus qu'il ne saisit.
2. « Je n'ai pas besoin de regarder » → le second compte est effectivement inutile, et il
   faudrait assumer un mode où l'un pilote et l'autre est simplement tenu au courant.
3. « Je ne veux pas voir, ou ne pas être vu » → rien ne le corrige. L'argent dans un couple
   est aussi une affaire de pouvoir et parfois de secret ; une app qui rend tout visible aux
   deux est un service pour certains couples et une menace pour d'autres. Ce n'est pas le
   couple cible, et il ne faut pas essayer de le rattraper.
4. « C'est une app de plus à installer pour rien » → le frein n'est pas le concept, c'est le
   compte.

Ce sont quatre produits différents. Avec trois testeurs, la réponse s'obtient en trois
conversations — et c'est exactement ce que la relance J+7 est faite pour aller chercher.

---

## Le plus petit premier pas

Le seul morceau qui ne dépend d'aucune réponse de testeur et ne ferme aucune porte : le
discours sur l'état solo. La pastille « Non relié » et le « En attente que votre partenaire
rejoigne » présentent comme un manque ce qui est souvent un choix. Une demi-heure.
