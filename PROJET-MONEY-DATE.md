# Projet Money Date

Notes de conception, pas encore un chantier. Rien de ce qui suit n'est implémenté.

Première session le 24/09/2026 ; reprise et arbitrages le 19/10/2026 (contenu de la vue
essentielle, les deux axes, les trois configurations, la bascule). Les maquettes citées ont
été fabriquées à partir de l'app réelle, pas dessinées à côté.

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

### 1. La vue essentielle (arrêté le 19/10/2026)

Un réglage dans son propre compte pour ne garder que l'essentiel.

Ce qui la rend bonne : c'est **chacun pour soi et réversible**. Personne n'impose rien à
personne, et le passager peut regarder en détail le jour où ça l'intéresse — ce qui arrive,
parce que les rôles bougent (projet immobilier, enfant, perte d'emploi).

**Le réglage doit vivre dans `S.ui`, jamais dans `S.settings`.** `settings` fait partie des
`SYNC_KEYS` : y mettre la préférence d'affichage la déclencherait aussi chez le partenaire.
`S.ui` est local à l'appareil, comme le thème sombre.

#### Ce n'est pas une lecture seule

La personne qui ne gère pas dépense quand même, et déclarer sa dépense est la seule chose
que l'autre ne peut pas faire à sa place. **Les deux saisissent, dans les deux modes.** Ce
qu'on retire n'est pas un droit, c'est le travail de configuration. La dictée est d'ailleurs
l'outil taillé pour cette personne : dire « 42 euros chez Carrefour » et avoir fini.

#### Ce qui reste

Barre du bas : **Vue, +, Projets**. Historique et Analyse disparaissent ; qui veut chercher
une vieille dépense repasse en vue détaillée.

Écran Vue :

- **Restant pour ce mois**, le grand chiffre avec « en avance / en retard » ;
- **Budgets par catégorie**, inchangé — il affiche déjà « 79 € / 170 € » et « reste 91 €
  (report inclus) ». Les chiffres sont indispensables, les jauges seules ne suffisent pas ;
- **Derniers mouvements** ;
- la carte Money Date, selon la configuration du couple (voir plus bas).

Retirés : le **Rythme du mois** (progression semaine par semaine), le sélecteur
**Mois / Semaine**, le bouton **Ajuster notre budget**, les liens **Détail →**.

Projets : en lecture. Où on en est, combien il y a, l'objectif, la mensualité. La **cagnotte
commune** reste visible.

Menu : **Notre budget** retiré ; Réglages, Money Date, l'aide et le partage gardés.

#### La bascule

Un bloc **« Mode d'affichage »** en bas de la Vue, juste avant la photo : un interrupteur à
deux états, `Vue essentielle | Vue détaillée`, l'état actif en blanc. C'est le sélecteur
`.seg` déjà utilisé pour Mois / Semaine, donc un geste déjà connu. Il montre les deux modes
en même temps : on sait où on est sans avoir à le déduire. Le même bloc, au même endroit,
dans les deux modes.

**Pourquoi pas dans la barre du bas**, qui était l'envie de départ : mesuré dans le
navigateur, le **+** est centré avec 3 ou 5 entrées, mais part **48 px à gauche** avec 4
(onglet « Détail » en mode essentiel) et 27 px avec 6. Le bouton le plus utilisé de l'app
changerait donc de place selon le mode — exactement ce qu'on a refusé pour « Valider » sur
l'écran de saisie, et ici sur un bouton qu'on vise au pouce sans regarder.

#### Le nom

« Vue essentielle », pas « vue simplifiée » : le premier dit ce qu'on garde, le second
laisse entendre qu'on a retiré quelque chose à quelqu'un. Jamais « mode limité » ni « mode
débutant » — c'est souvent pour l'autre qu'on l'active dans sa tête, et l'étiquette
deviendrait vexante.

#### Garde-fou

La vue essentielle ne doit **jamais** masquer une demande adressée à la personne. Si un
brouillon attend sa validation, ça doit se voir même dans la vue la plus dépouillée.

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

## Deux axes, pas un seul (19/10/2026)

Le réglage d'affichage ne suffit pas : **le Money Date aussi peut être délégué**. Une fois
la trame posée, le rendez-vous mensuel peut très bien être tenu par celui qui gère, sans
que l'autre ait à s'y mettre. Ce sont donc deux réglages indépendants :

| Situation | La vue | Le Money Date |
|---|---|---|
| « Mon conjoint gère, je veux juste voir » | essentielle | tenu par lui |
| « On décide à deux, 50-50 » | détaillée des deux côtés | à deux |
| « Je gère tout, mais on garde nos Money Dates » | détaillée | à deux |

Conséquence technique, à ne pas confondre : **la vue est personnelle et locale** (`S.ui`),
**le réglage du Money Date est un réglage de couple et doit être synchronisé**
(`S.settings`), puisqu'il décide à qui partent les mails.

### Quand pose-t-on la question

**À l'inscription, seulement celle de la vue.** Chacun répond pour soi, au moment où il crée
son compte ; le second y répondra en rejoignant avec le code.

**Pas celle du Money Date.** À l'inscription, le premier crée le couple et le second n'existe
pas encore : lui demander qui gère reviendrait à faire répondre quelqu'un à la place de son
conjoint, et à coller une étiquette à une personne absente.

**Le premier Money Date se fait ensemble, quelle que soit la suite.** C'est à la fin de ce
premier rendez-vous qu'on demande au couple comment il veut procéder pour les suivants —
quand les deux savent de quoi il s'agit.

### Ce que ça change aux mails

Configuration « à deux » : rien ne change, c'est ce que font les relances aujourd'hui.

Configuration « l'un gère » :

- les rappels de la veille et du jour J ne partent qu'au gestionnaire ; inutile de convoquer
  quelqu'un à un rendez-vous auquel il a dit ne pas vouloir venir ;
- l'autre reçoit, une fois le Money Date terminé, un message court : où vous en êtes ce
  mois-ci, ce qui a été décidé. C'est la vue essentielle, par mail.

---

## La relance J+2

Conséquence de tout ce qui précède : arrêter de vendre le partenaire comme une étape à
franchir, et vendre ce qu'il lui en coûtera — « il n'aura presque rien à faire ». C'est la
vraie objection du gestionnaire, et la seule chose qu'il a besoin d'entendre pour oser
demander.

Mais ça n'a de sens qu'une fois la vue simplifiée en place : sinon la promesse est fausse.

---

## Ce qui reste à vérifier avant de construire

Tout ce qui précède reposait sur une hypothèse : que le passager veut savoir sans faire.

**Elle a reçu un premier appui le 19/10/2026**, de la bouche des couples concernés : « mon
mari gère le budget et je lui fais confiance ; à la rigueur si j'ai une vue simplifiée, ça
me va très bien ». C'est la situation 1 ci-dessous, et c'est la seule des quatre qui
justifie encore deux comptes. Ce n'est pas une enquête, mais ce n'est plus une supposition.

Le retour d'origine recouvre quatre situations très différentes, qui n'appellent pas du tout
les mêmes réponses :

1. « Je ne veux pas des corvées » → rôles asymétriques, le second reçoit plus qu'il ne
   saisit. **C'est celle qu'on a entendue ; c'est elle qu'on traite.**
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
