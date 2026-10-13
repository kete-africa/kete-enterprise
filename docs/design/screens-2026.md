# The screens of the center — reference (2026-10-13)

What Kete Enterprise looks like once the plan of `docs/ROADMAP.md` (steps C1 to C14) is delivered:
four places named by what a person does there — **Décider**, **Demander**, **Déléguer**, **Planifier** —
with the apps and the Administration behind (doctrine D-042 to D-046, D-050 to D-054). This document is the reference the
steps are built against; each screen names its step.

- The screens are drawn in text so that they live with the code and are reviewed like it.
- Names, amounts and limits are **invented examples**; the words on the screens are French, like
  the product.
- None of these screens has been used by a person yet: a real manager at KYA validates them.

## The rules every screen follows

The signature (doctrine D-045):

1. The product opens on what waits for the person, not on a menu.
2. One main gesture per screen.
3. The agent prepares, the person decides — the same verification card everywhere.
4. Every figure carries its unit, its period and its source; « Comment ? » sits beside it.
5. Sentences, not settings — except rights, where a table of boxes is safer.
6. Everything can be undone.
7. The same thing through WhatsApp and Telegram.

How an agent is shown: six states, the same everywhere; three levels of detail (one line, the
steps, the run); always interruptible; the same object during and after (« Comment ? »); a failure
is said; never dressed as a human.

## The frame (step C1)

Four places (Planifier joined them with D-050), the projects with their threads, what she pinned —
« Mon tableau » first; apps and the Administration below.
« Demander » (Ctrl K) is at the top, everywhere.

### Décider (step C2)

One decision at a time with its evidence, then what comes next, then what agents are doing
meanwhile. « Aujourd'hui » and « À faire » merge here.

```text
+---------------------+----------------------------------------------------------------+
| KETE    KYA Energy  | Décider, mardi 13 octobre                      2 sur 5 réglées |
| [Demander   Ctrl K] | .............................................................. |
|                     | Achat de pièces, 2 000 000 F CFA           demandé par Kofi    |
| > DÉCIDER         5 |  2 pièces sous le seuil [Stock]   3 devis [Achats]             |
|   DEMANDER          |  Budget SAV restant: 3 400 000 F CFA [Budget]                  |
|   DÉLÉGUER    2 (~) |  Circuit: Kofi > Vous > Direction                              |
|                     |                                                                |
| PROJETS             |  [Refuser]   [Approuver]   [Demander]              Comment ?   |
| v SAV Lomé          | .............................................................. |
|     Relances    (~) | ENSUITE                                                        |
|     Pièces rupture  |  7 relances WhatsApp à envoyer            Agent SAV            |
| > Audit ISO         |  Devis Garage Bè                          demande de Awa       |
| > Achats T4         |  Congé de Yao                             Yao                  |
| ÉPINGLÉS            |                                                                |
|   Tableau SAV       | PENDANT CE TEMPS                                               |
|                     |  (~) Agent SAV     Relances: étape 3 sur 4        [Arrêter]    |
| Apps                |  (?) Agent Achats  Attend votre choix            [Répondre]    |
| Administration      |                                                                |
| Awa  v     [cloche] |                                                                |
+---------------------+----------------------------------------------------------------+
```

The morning on a phone: a pile of decisions, then « tout est réglé ».

```text
+------------------------------------+-------------------------------+
| MATIN            2 sur 5 réglées   | TOUT EST RÉGLÉ        7 h 44  |
| .................................. | ............................. |
| Achat de pièces, 2 000 000 F CFA   | 5 décisions en 3 minutes.     |
| Kofi demande. 2 pièces sous le     |                               |
| seuil, 3 devis, budget suffisant.  | Vos agents continuent:        |
|                                    |  Relances envoyées à 8 h      |
|    [ Non ]     [ Oui ]             |  Devis Garage Bè à 10 h       |
|    Demander    Comment ?           |                               |
| .................................. | Je vous préviens si quelque   |
| Ensuite: 7 relances, congé de Yao  | chose change.                 |
+------------------------------------+-------------------------------+
```

### Ctrl K

```text
+------------------------------------------------------------+
| > relances impayés_                                        |
| .......................................................... |
| ALLER      Fil « Relances impayés », SAV Lomé              |
|            Agent SAV                                       |
| TROUVER    Facture F-0412, Garage Bè, 310 000 F CFA        |
|            Procédure « Relance client », Entreprise        |
| DEMANDER   « Qui doit plus de 100 000 depuis 30 jours ? »  |
| FAIRE      Confier à l'Agent SAV...                        |
|            Nouvelle note                                   |
+------------------------------------------------------------+
```

### On a phone, and the system's three states

```text
+--------------------------------+--------------------------------+
| Agent SAV          (~) 1 min   | Mode voix                 [x]  |
| .............................. | .............................. |
| Relances impayés               |                                |
| Étape 3 sur 4                  |        ~~~~~ ~~~ ~~~~~         |
| 3 messages rédigés sur 7       |                                |
|                                | « Qui me doit de l’argent ? »  |
| Lit: Factures, Clients         | Trois clients, 535 000 F CFA.  |
| Écrit: des brouillons          | Le premier: Garage Bè...       |
|                                |                                |
| [Pause] [Arrêter] [Détail]     | [Clavier]   [Muet]   [Fin]     |
+--------------------------------+--------------------------------+
```

```text
+----------------------+----------------------+----------------------+
| HORS LIGNE           | ERREUR               | LIMITE ATTEINTE      |
| .................... | .................... | .................... |
| Vos messages partent | Je n'ai pas pu lire  | Budget IA du mois    |
| au retour du réseau. | Stock (délai).       | atteint. Votre       |
| 2 en attente         | Rien n'a changé.     | espace reste ouvert. |
|                      | [Réessayer] [Sans]   | [Voir les offres]    |
+----------------------+----------------------+----------------------+
```

### Notifications and personal settings

```text
+---------------------------------+----------------------------------+
| NOTIFICATIONS        [Tout lu]  | MES RÉGLAGES                     |
| ............................... | ................................ |
| * Agent SAV vous attend         | Langue       Français v          |
|   7 relances à décider    9 h   | Thème        Automatique v       |
| * Kofi vous a mentionnée        | Voix         Activée             |
|   « Achat de pièces »     8 h   | Modèle       Choisi par l'entr.  |
|   Recherche terminée     hier   | Me prévenir  WhatsApp puis appli |
|                                 | Mémoire      Activée     [Voir]  |
| [Appli] [Push] [WhatsApp]       | Appareils    2          [Gérer]  |
+---------------------------------+----------------------------------+
```

## Demander

### A thread in a project (steps C3 to C5)

Files as cards in the thread, a message waiting in line while the agent works, and the task panel
with its tabs: plan, sources, files, summary.

```text
+---------------------+----------------------------------+------------------------------+
| KETE    KYA Energy  | Relances impayés           [...] | Plan Sources [Fichiers] Bref |
| [Demander   Ctrl K] | Awa, Kofi, Agent SAV             | ............................ |
|                     | ................................ | PRODUITS (2)                 |
|   DÉCIDER         5 | AWA                              |  XLS Relances.xlsx     v2    |
| > DEMANDER          |  Voici le relevé de septembre.   |  DOC Lettre-type.docx  v1    |
|   DÉLÉGUER    2 (~) |  [PDF releve-sept.pdf   3 p.]    |                              |
|                     |  [IMG photo-facture.jpg]         | REÇUS (3)                    |
| PROJETS             |                                  |  PDF releve-sept.pdf         |
| v SAV Lomé          | AGENT SAV      3 étapes v  12 s  |  IMG photo-facture.jpg       |
|     Relances    (~) |  7 factures, 1 240 000 F CFA.    |  VOX note vocale 0:42        |
|     Pièces rupture  |  [XLS Relances.xlsx  v2]         |                              |
| > Audit ISO         |  [DOC Lettre-type.docx  v1]      | LIENS (2)                    |
| > Achats T4         |  +- À DÉCIDER ---------------+   |  Facture F-0412              |
| ÉPINGLÉS            |  | Envoyer 7 relances        |   |  Ticket T-112                |
|   Tableau SAV       |  | [Valider] [Corriger] [Non]|   | ............................ |
|                     |  +---------------------------+   | [Tout voir]                  |
| Apps                | ................................ | [Ajouter au projet]          |
| Administration      | En file: « ajoute la date » [x]  |                              |
| Awa  v     [cloche] | [+] Écrire...           [micro]  |                              |
+---------------------+----------------------------------+------------------------------+
```

### An answer (step C3)

Steps that unfold, figures computed by code, numbered sources, gestures under the answer.

```text
+--------------------------------------------------------------------+
| Mon assistant > Impayés du mois                     [Partager] ... |
| .................................................................. |
| VOUS                                                        9 h 02 |
|  Qui doit plus de 100 000 depuis 30 jours ?            [Modifier]  |
|                                                                    |
| ASSISTANT                                      4 étapes ^      8 s |
|  | 1 Lire les factures impayées       Factures            fait     |
|  | 2 Garder celles de plus de 30 j    calcul par le code  fait     |
|  | 3 Lire les clients concernés       Clients             fait     |
|  | 4 Rédiger la réponse                                   fait     |
|  Trois clients doivent plus de 100 000 F CFA depuis 30 jours:      |
|    Garage Bè        310 000 F CFA    42 jours   [1]                |
|    M. Kossi         120 000 F CFA    35 jours   [2]                |
|    Hôtel du Golfe   105 000 F CFA    31 jours   [3]                |
|  Total: 535 000 F CFA.                                             |
|  Sources: [1 Facture F-0412] [2 F-0398] [3 F-0421]                 |
|  [Copier] [Refaire] [Ouvrir en tableau] [Chaque lundi] [+] [-]     |
|                                                                    |
|  Suite possible: [Préparer les relances] [Voir leur historique]    |
| .................................................................. |
| [+]  Écrire ou dicter...                                  [micro]  |
| Mode: Rapide v    Outils: 6 v    Projet: SAV Lomé v     [Envoyer]  |
+--------------------------------------------------------------------+
```

An answer can be a tool: a table she sorts, filters and acts on.

```text
+--------------------------------------------------------------------+
| « Qui me doit de l’argent ? »                                      |
| .................................................................. |
| CLIENT           DÛ          DEPUIS     DERNIER CONTACT            |
| Garage Bè        310 000     42 jours   relance le 9    [Relancer] |
| M. Kossi         120 000     35 jours   aucun           [Relancer] |
| Hôtel du Golfe   105 000     31 jours   promesse le 2    [Appeler] |
| .................................................................. |
| Trier: montant v    Filtrer: plus de 30 jours v    [Tout relancer] |
| Source: Factures, ce matin 7 h 40.        [Garder sur Aujourd’hui] |
+--------------------------------------------------------------------+
```

The input, piece by piece:

```text
+----------+---------------------------------------------------------+
| [+]      | Joindre: fichier, photo, capture, pièce d'un projet     |
| @        | Mentionner: une personne, un agent, une app, une fiche  |
| /        | Commander: /résumer /comparer /tableau /routine /note   |
| Mode     | Rapide, Réfléchi, ou Recherche longue: elle tourne en   |
|          | arrière-plan et rend un rapport avec ses sources        |
| Outils   | Les apps et connecteurs que vos droits permettent       |
| micro    | Dicter un message, ou parler en continu (mode voix)     |
| Stop     | Remplace Envoyer dès que l'assistant écrit              |
+----------+---------------------------------------------------------+
```

The empty screen proposes her day:

```text
+------------------------------------------------------------+
|                                                            |
|   Bonjour Awa.                                             |
|   Trois choses vous attendent ce matin.                    |
|                                                            |
|   [ Décider l'achat de pièces demandé par Kofi        ]    |
|   [ Lire ce que l'Agent SAV a fait cette nuit         ]    |
|   [ Préparer la réunion de 10 h                       ]    |
|                                                            |
|   +----------------------------------------------------+   |
|   | Demandez, ou dites ce que vous voulez faire...     |   |
|   | [+] [micro]   @ mention   / commande     [Envoyer] |   |
|   +----------------------------------------------------+   |
|                                                            |
+------------------------------------------------------------+
```

### Files and pieces (step C4)

Every file and medium of a thread, listed once:

```text
+--------------------------------------------------------------------+
| FICHIERS ET MÉDIAS DU FIL             [Grille] [Liste]  [Chercher] |
| .................................................................. |
| PRODUITS PAR L'ASSISTANT ET LES AGENTS                             |
|  XLS Relances.xlsx     v2   Agent SAV  9 h 12  [Ouvrir] [Versions] |
|  DOC Lettre-type.docx  v1   Agent SAV  9 h 14  [Ouvrir] [PDF]      |
| ENVOYÉS PAR LES PERSONNES                                          |
|  PDF releve-sept.pdf   3 p.  Awa       9 h 02  [Ouvrir]            |
|  IMG photo-facture.jpg       Awa       9 h 03  [Ouvrir]            |
|  VOX note vocale 0:42        Kofi      9 h 20  [Écouter] [Texte]   |
| LIENS ET FICHES                                                    |
|  Facture F-0412 (Factures)      Ticket T-112 (Support)             |
| .................................................................. |
| [Ajouter au projet] [Tout télécharger]     Gardés 12 mois (règle)  |
+--------------------------------------------------------------------+
```

A cited source opens the file at its page, the line highlighted:

```text
+--------------------------------------------+-----------------------+
| releve-sept.pdf   p. 2 / 3   [-] 100 % [+] | SUR CE FICHIER        |
| .......................................... | ..................... |
|   RELEVÉ DE SEPTEMBRE                      | [Résumer]             |
|   Client         Dû        Depuis          | [Extraire le tableau] |
|  >Garage Bè      310 000   42 jours<       | [Comparer à août]     |
|   M. Kossi       120 000   35 jours        |                       |
|   Mme Adjovi      85 000   38 jours        | COMMENTAIRES (1)      |
|                                            |  Kofi, p. 2:          |
|   (la ligne citée par la réponse est       |  « payé hier ? »      |
|    surlignée)                              |                       |
| .......................................... | ..................... |
| [Télécharger] [Imprimer] [Ouvrir à côté]   | [Écrire...    micro]  |
+--------------------------------------------+-----------------------+
```

```text
+--------------------------------------------------------------------+
| Relances.xlsx  v2   Feuille: Relances v     [Versions] [Exporter]  |
| .................................................................. |
|     A Client       B Facture   C Montant   D Jours   E Canal       |
|  1  Mme Adjovi     F-0388         85 000      38     WhatsApp      |
|  2  M. Kossi       F-0398        120 000      35     WhatsApp      |
|  3  Garage Bè      F-0412        310 000      42     Telegram      |
|  ... 4 lignes               Total 1 240 000  (calculé par le code) |
| .................................................................. |
| [Modifier par une phrase: « retire ceux qui ont payé hier »     ]  |
+--------------------------------------------------------------------+
```

```text
+---------------------------------+----------------------------------+
| VUE FOCALISÉE            2 / 4  | VUE CANEVAS            4 images  |
| +-----------------------------+ | +--------+ +--------+ +--------+ |
| |                             | | | 1      | | 2    x | | 3      | |
| |        (image 2)            | | +--------+ +--------+ +--------+ |
| |            (1) « plus net » | | +--------+                       |
| |                             | | | 4    x |      2 choisies       |
| +-----------------------------+ | +--------+                       |
| [<] [>]  [Commenter] [Choisir]  | [Modifier les choisies: « … » ]  |
+---------------------------------+----------------------------------+
```

The review of changes serves a document as well as code:

```text
+---------------------------------+----------------------------------+
| REVUE  Lettre-type  v1 > v2     | 3 changements   [Tout accepter]  |
| AVANT                           | APRÈS                            |
| ............................... | ................................ |
|   Nous vous rappelons que       |   Nous vous rappelons que        |
| - votre facture est due.        | + votre facture F-0388 de        |
|                                 | + 85 000 F CFA est due           |
|                                 | + depuis 38 jours.               |
|                                 |       [Accepter] [Refuser]       |
|   Cordialement,                 |   Cordialement,                  |
|                                 |                                  |
|  Kofi: « ton trop sec ? »       |  [Répondre] [Demander autre]     |
+---------------------------------+----------------------------------+
```

### Projects, memory, long research, sharing (step C5)

```text
+--------------------------------------------------------------------+
| SAV Lomé                           6 membres  [Partager] [Régler]  |
| .................................................................. |
| FILS (12)         Relances impayés (~)   Pièces en rupture   + 10  |
| FICHIERS (34)     Relances.xlsx   Procédure SAV.pdf          + 32  |
| PIÈCES ÉPINGLÉES  [Tableau SAV]   [Suivi des tickets]              |
| CONSIGNES         « Réponds en français, cite la procédure SAV. »  |
| MÉMOIRE (8)       « Garage Bè paie toujours en fin de mois. »      |
| AGENTS            Agent SAV (~)   Agent Achats                     |
| CONNECTEURS       Support   Stock   Frappe (lecture)               |
| ROUTINES          Tickets, ven. 16 h    Impayés, lun. 8 h          |
| .................................................................. |
| [+ Nouveau fil dans ce projet]                                     |
+--------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| CE QUE L'ASSISTANT RETIENT        [Mettre en pause] [Tout effacer] |
| .................................................................. |
| SUR VOUS                                                           |
|  Vous préférez les réponses courtes.        dit le 2 oct.     [x]  |
|  Vous validez les achats le matin.          déduit le 5 oct.  [x]  |
| SUR LE PROJET SAV LOMÉ                                             |
|  Garage Bè paie en fin de mois.   Kofi, 9 oct.   expire 9/2027 [x] |
| JAMAIS RETENU (règle de l'entreprise)                              |
|  Santé, salaires, mots de passe                                    |
+--------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| RECHERCHE LONGUE « Pourquoi les impayés montent depuis juillet ? » |
| Terminée en 6 min, 4 apps lues, 23 sources    [Refaire] [Partager] |
| .................................................................. |
| EN BREF                                                            |
|  Trois clients font la plus grande part du retard.                 |
| CE QUE J'AI TROUVÉ                                                 |
|  1 Trois clients concentrent le retard            [1] [2] [3]      |
|  2 Les relances partent 12 jours trop tard        [4] [5]          |
| CE QUE JE N'AI PAS PU VÉRIFIER                                     |
|  Les paiements en espèces non saisis                               |
| .................................................................. |
| [Ouvrir en document] [En faire un tableau] [Confier la suite]      |
+--------------------------------------------------------------------+
```

```text
+---------------------------------+----------------------------------+
| CRÉER UN ESPACE (Cockpit)       | PARTAGER CE FIL                  |
| ............................... | ................................ |
| Entreprise  Garage Bè           | Avec    Kofi, équipe SAV         |
| Admin       e-mail ou numéro    | Droit   Lire | Participer        |
| Offre       Essai 14 jours v    | [x] Avec ses fichiers            |
| Modules     Centre, Support     | [ ] Lien externe                 |
| Région      Europe v            |     (interdit par l'entreprise)  |
|                                 |                                  |
| [Créer et inviter]              | [Partager]                       |
+---------------------------------+----------------------------------+
```

### Asking a colleague (step C5, doctrine D-044)

A request goes to a **person**. Who asks sees a state; who receives sees her own rule at work.

```text
+---------------------------------+----------------------------------+
| CE QUE VOIT AWA (elle demande)  | CE QUE VOIT KOFI (il reçoit)     |
| ............................... | ................................ |
| Demande à Kofi                  | Demande de Awa: devis Garage Bè  |
| « Chiffre le devis Garage Bè »  | Ma règle: « devis --> Agent      |
| Pour jeudi          1 pièce     | Devis prépare, je valide »       |
|                                 |                                  |
|  v Reçue            9 h 02      |  Agent Devis (privé)   (~) 2 min |
|  > Prise en charge  9 h 03      |  Prix demandés à Agent Achats    |
|    Vous attend                  |                                  |
|    Rendue                       |  À la fin: carte à décider       |
|                                 |  avant tout retour à Awa         |
| [Relancer]  [Annuler]           | [Reprendre la main] [Refuser]    |
+---------------------------------+----------------------------------+
```

### The assistant beside any page

```text
+-----------------------------------------+--------------------------+
| Support > Ticket T-112                  | ASSISTANT            [x] |
| ....................................... | ........................ |
| Garage Bè: onduleur en panne            | Il voit: ce ticket,      |
| Critique, ouvert depuis 3 jours         | son client, 4 pièces.    |
|                                         |                          |
| Historique                              | [Résumer ce ticket]      |
|  10 oct.  Visite de Yao                 | [Proposer une réponse]   |
|  11 oct.  Pièce commandée               | [Confier à Agent SAV]    |
|  13 oct.  Client relance                |                          |
|                                         | ........................ |
| (la page de l’app, inchangée)           | [Écrire...       micro]  |
+-----------------------------------------+--------------------------+
```

### The same thread in WhatsApp

```text
+------------------------------------+
| Kete, SAV Lomé                     |
| .................................. |
| Agent SAV (IA)                     |
|  7 relances sont prêtes,           |
|  1 240 000 F CFA au total.         |
|  1 Valider   2 Voir   3 Refuser    |
|                                    |
|                            Vous: 2 |
| Agent SAV (IA)                     |
|  Garage Bè 310 000, M. Kossi       |
|  120 000, Mme Adjovi 85 000...     |
|  [Ouvrir dans Kete]                |
+------------------------------------+
```

## Déléguer

### My agents, private or shared (step C6)

```text
+---------------------+----------------------+-----------------------------------------+
| KETE    KYA Energy  | MES AGENTS (3)       | Agent Devis          propriétaire: Kofi |
| [Demander   Ctrl K] | .................... | Chiffre les devis du SAV                |
|                     | > Agent Devis  privé | ....................................... |
|   DÉCIDER         5 |   Agent Relances     | AUTONOMIE PAR TYPE DE TÂCHE             |
|   DEMANDER          |                privé |  Lire prix et stock    Seul             |
| > DÉLÉGUER    2 (~) |   Agent Achats       |  Rédiger un devis      Prépare          |
|                     |              partagé |  Envoyer au client     Jamais seul      |
| PROJETS             |                      |                                         |
| v SAV Lomé          | PARTAGÉS AVEC MOI    | SA SEMAINE                              |
|     Relances    (~) |   Agent Qualité      |  12 devis, 10 gardés, 2 corrigés        |
|     Pièces rupture  |                      |  Demandes reçues: Awa (3), Yao (1)      |
| > Audit ISO         | [Mon accueil]        |                                         |
| > Achats T4         | [Routines]           | [Essai à blanc sur la semaine passée]   |
| ÉPINGLÉS            | [+ Créer d'une       | [Rendre partagé]   [Lui parler]         |
|   Tableau SAV       |    phrase]           | [Arrêt d'urgence]                       |
|                     |                      |                                         |
| Apps                |                      |                                         |
| Administration      |                      |                                         |
| Awa  v     [cloche] |                      |                                         |
+---------------------+----------------------+-----------------------------------------+
```

```text
+----------------------+-----------+-----------------------------------+
| MES AGENTS           | VISIBLE   | QUI PEUT L’APPELER                |
| .................... | ......... | ................................. |
| Agent Devis          | Privé     | Moi. Les autres passent par moi.  |
| Agent Relances       | Privé     | Moi. Les autres passent par moi.  |
| Agent Achats         | Partagé   | SAV, Direction: @Agent Achats     |
|                      |           |                                   |
| [+ Créer]            |           | L’admin voit tout au registre.    |
+----------------------+-----------+-----------------------------------+
```

### The six states, and « Pendant ce temps »

```text
+-------+--------------+----------------------------------------------+
| SIGNE | ÉTAT         | CE QUE VOUS VOYEZ                            |
| ..... | ............ | ............................................ |
| ( )   | En veille    | Sa prochaine routine                         |
| (~)   | Travaille    | L'étape en cours, le temps écoulé            |
| (?)   | Vous attend  | Sa question, ou la carte à décider           |
| (!)   | Bloqué       | Ce qui lui manque, en une phrase             |
| (=)   | En pause     | Qui l'a mis en pause, depuis quand           |
| (x)   | Arrêté       | Qui l'a arrêté, et ce qu'il a laissé         |
+-------+--------------+----------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| PENDANT CE TEMPS                                      [Tout voir]  |
| .................................................................. |
| (~) Agent SAV      Relances: étape 3 sur 4      1 min   [Arrêter]  |
| (?) Agent Achats   Attend votre choix du fournisseur   [Répondre]  |
| (~) Agent Atelier  Écrit l'app « Congés »: 6 fichiers       [Voir] |
| ( ) Agent Qualité  Prochaine routine: vendredi 16 h                |
+--------------------------------------------------------------------+
```

### An agent at work (step C6)

Its plan, the step in progress, what it touches, its budget, and the person's controls.

```text
+---------------------------+------------------------------------------+
| Agent SAV, pour Awa       | (~) 1 min 12           [Pause] [Arrêter] |
| Relances impayés          |                                          |
| ......................... | ........................................ |
| PLAN                      | EN COURS: 3 Rédiger 7 messages           |
|  v 1 Lire les factures    |  « Bonjour Mme Adjovi, votre facture     |
|  v 2 Lire les clients     |    F-0388 de 85 000 F CFA attend... »    |
|  > 3 Rédiger 7 messages   |  3 rédigés sur 7                         |
|    4 Vous les présenter   |                                          |
|                           | CE QU'IL TOUCHE                          |
| BUDGET                    |  Lit     Factures, Clients               |
|  Temps   1 min sur 10     |  Écrit   rien: des brouillons seulement  |
|  Modèle  12 % du plafond  |  Règle   aucun message externe seul      |
|                           |                                          |
| [Reprendre la main]       | [Lui écrire...                    micro] |
+---------------------------+------------------------------------------+
```

A hand-over between agents shows in the thread:

```text
+--------------------------------------------------------------------+
| AGENT SAV                                                          |
|  Il me manque le prix des pièces pour chiffrer le devis.           |
|  --> passe à @Agent Achats: « prix actuel des 3 pièces »           |
|                                                                    |
| AGENT ACHATS                                  2 étapes v     20 s  |
|  Prix au 13 octobre. Sources: [Fournisseurs 3]                     |
|  <-- rend la main à @Agent SAV                                     |
|                                                                    |
| AGENT SAV                                                          |
|  Devis prêt: 148 000 F CFA.                                        |
|  +-- À DÉCIDER -----------------------------------------+          |
|  | Envoyer le devis à Garage Bè                         |          |
|  | [Valider] [Corriger] [Refuser]            Comment ?  |          |
|  +------------------------------------------------------+          |
+--------------------------------------------------------------------+
```

« Comment ? », once it is done:

```text
+------------------------------------------------------------+
| COMMENT ?   Relances préparées, mardi 9 h 12               |
| .......................................................... |
| Demandé par   Awa (responsable SAV)                        |
| Fait par      Agent SAV, pour Awa, jamais plus qu'elle     |
| Autonomie     Prépare. N'envoie rien seul.                 |
|                                                            |
| ÉTAPES                                DROIT UTILISÉ        |
|  1  Lire les factures impayées        factures: lire       |
|  2  Lire les numéros des clients      clients: lire        |
|  3  Rédiger 7 messages                modèle interne       |
|                                                            |
| RÈGLES APPLIQUÉES                                          |
|  - Aucun message externe sans une personne                 |
|  - Données clients: modèle hébergé chez nous               |
|                                                            |
| SOURCES   Factures (7)   Clients (7)                       |
|                                    [Annuler ce geste]      |
+------------------------------------------------------------+
```

### An agent writing code (step C7)

The factory's agent, in its isolated sandbox: its plan, the file it writes, the terminal, the app
taking shape, the tests. It never deploys: it hands a card back.

```text
+----------------------+------------------------------------------+------------------------+
| Agent Atelier        | (~) 14 min             [Pause] [Arrêter] | APERÇU                 |
| App « Congés »       | src/features/leave/commands.ts           | (bac à sable)          |
| pour Kofi, accord IT |                                          |                        |
| .................... | ........................................ | ...................... |
| PLAN                 | + export const requestLeave =            | +------------------+   |
|  v Lire la demande   | +   defineCommand({                      | | Congés           |   |
|  v Créer l'app       | +     name: 'leave_request',             | | [Demander]       |   |
|  v Modèle de données | +     input: leaveInput,                 | | Yao  3 j  attend |   |
|  > Écrire les gestes | +     reversible: true,                  | +------------------+   |
|    Écrire les écrans | -   // TODO                              |                        |
|    Tests             | ........................................ | TESTS                  |
|    Ouvrir la demande | TERMINAL                                 |  12 passent            |
|                      |  $ pnpm test                             |   1 échoue             |
| FICHIERS (6)         |  12 passed, 1 failed                     |                        |
|  migrations.ts   +48 |  leave.test.ts: solde négatif accepté    | GARDE-FOUS             |
|  commands.ts     +96 |  -> il relit la règle du solde           |  Bac à sable isolé     |
|  leave.test.ts   +71 |  -> il corrige commands.ts               |  Aucun secret          |
+----------------------+------------------------------------------+------------------------+
```

```text
+--------------------------------------------------------------------+
| À DÉCIDER   App « Congés »: la demande de fusion est prête         |
| .................................................................. |
|  6 fichiers, 412 lignes ajoutées, 13 tests passent, 3 captures     |
|  Droits demandés par l’app: congés:lire, congés:demander           |
|  Ce que l’agent n’a pas fait: la mise en production                |
|                                                                    |
|  [Essayer l’app] [Voir le code] [Demander un changement]           |
|  [Fusionner]                                        Comment ?      |
+--------------------------------------------------------------------+
```

### An agent from a sentence, routines, « Mon accueil » (step C7)

```text
+--------------------------------------------------------------------+
| CRÉER UN AGENT                                                     |
| « Surveille les tickets critiques, préviens-moi après 4 h sans     |
|   réponse »                                                        |
| .................................................................. |
| CE QUE J'AI COMPRIS                                                |
|  Nom             Veille tickets                                    |
|  Il lit          Support: tickets critiques                        |
|  Il fait         vous prévient (appli, WhatsApp)   Seul, annulable |
|  Il ne fait pas  répondre au client                                |
|  Quand           chaque heure, de 7 h à 19 h                       |
| ESSAI À BLANC SUR LA SEMAINE PASSÉE                                |
|  Il vous aurait prévenue 3 fois: T-098, T-104, T-112               |
| .................................................................. |
| [Créer]   [Corriger la phrase]   [Annuler]                         |
+--------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| ROUTINES                                          [+ D'une phrase] |
| .................................................................. |
| QUOI                       QUAND             QUI          DERNIÈRE |
| Résumé des tickets         ven. 16 h         Agent SAV    réussie  |
| Impayés de plus de 30 j    lun. 8 h          Agent SAV    réussie  |
| Rupture de stock           quand Stock       Agent Achats 1 échec  |
|                            le signale                     [Voir]   |
| Brief du matin             chaque jour 7 h   Assistant    réussie  |
+--------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| MON ACCUEIL   ce qui arrive chez moi, et qui s’en occupe           |
| .................................................................. |
| QUAND ON ME DEMANDE          QUI S’EN OCCUPE          RETOUR       |
| Un devis                     Agent Devis prépare      je valide    |
| Mes disponibilités           Mon assistant            seul         |
| Un prix fournisseur          Agent Achats (partagé)   seul         |
| Tout ce qui vient de         Moi                      moi          |
|   la Direction                                                     |
| Le reste                     Moi                      moi          |
| .................................................................. |
| Hors de mes heures: accusé de réception, traité à 8 h.             |
| En congé du 20 au 27: tout va à Yao.                               |
| Ce que voit celui qui demande: l’état, pas mes agents privés.      |
| [+ Ajouter une règle, en une phrase]     [Essayer sur une demande] |
+--------------------------------------------------------------------+
```

## Apps (step C9)

```text
+----------------------------------------------------------------+
| Apps                                      [+ Demander une app] |
| .............................................................. |
| APP          ÉTAT        CE QUE LE CENTRE EN REÇOIT            |
| Support      Connectée   tâches, événements, 12 outils         |
| Stock        Connectée   alertes, 8 outils                     |
| Terrain      Connectée   rapports dictés                       |
| Frappe       Connecteur  demandes d'achat, congés (lecture)    |
| Performance  Pack        indicateurs, revues                   |
| Qualité ISO  Pack        contrôles, preuves                    |
|                                                                |
| VOS ADRESSES                                                   |
|   MCP  une adresse par personne, dans ses droits     [Copier]  |
|   API  lecture des données de vos apps                 [Clés]  |
+----------------------------------------------------------------+
```

```text
+---------------------------------+----------------------------------+
| DEMANDER UNE APP                | AJOUTER UN CONNECTEUR            |
| ............................... | ................................ |
| « Suivre les congés de mon      | Frappe (ERPNext)                 |
|   équipe »                      | Il pourra LIRE                   |
|                                 |   demandes d'achat, congés       |
|  1 Vous décrivez        fait    | Il ne pourra PAS                 |
|  2 L'IT approuve       en cours |   écrire, supprimer              |
|  3 Un agent la code             | Pour qui    SAV, Achats          |
|  4 Vous l'essayez               |                                  |
|  5 Elle rejoint vos apps        | [Essayer]          [Connecter]   |
+---------------------------------+----------------------------------+
```

## Administration (step C8)

Six entries: Organisation, Droits, Règles, Registre, Preuves, Offre et limites.

```text
+---------------------+----------------------------------------------------------------+
| < Retour à l'espace | Règles de l'IA                    8 actives, 1 à l'essai       |
|                     | .............................................................. |
| ADMINISTRATION      | RÈGLE, EN UNE PHRASE                         ÉTAT   MOIS PASSÉ |
|   Organisation      | Aucun agent n'envoie d'argent seul.          Active 0 refus    |
|   Droits            | Les données secrètes ne vont à aucun modèle  Active 14 refus   |
| > Règles            |   hébergé hors de chez nous.                                   |
|   Registre          | Tout message externe écrit par l'IA le dit.  Active 212 envois |
|   Preuves           | Les conversations sont gardées douze mois.   Active            |
|   Offre et limites  | Le SAV ne dépasse pas son budget IA du mois. Essai  3 bloqués  |
|                     | .............................................................. |
|                     | [+ Nouvelle règle]            [Simuler sur le mois dernier]    |
+---------------------+----------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| REGISTRE                    [Agents]  Modèles  Connecteurs  Apps   |
| .................................................................. |
| AGENT             PROPRIÉTAIRE  AUTONOMIE MAX  REVUE      ÉTAT     |
| Agent SAV         Awa           Prépare        2 oct.     Actif    |
| Agent Achats      Kofi          Prépare        28 sept.   Actif    |
| Veille contrôles  Qualité       Lit seulement  1 oct.     Actif    |
| Agent Paie        (personne)    Prépare        jamais     À revoir |
| .................................................................. |
| 1 agent sans propriétaire: mis en pause dans 7 jours.              |
+--------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| DROITS         Rôle: Responsable SAV v      Périmètre: SAV Lomé v  |
| .................................................................. |
| SUPPORT    [x] Lire les tickets  [x] Répondre  [x] Gérer les files |
| STOCK      [x] Lire              [ ] Commander                     |
| FACTURES   [x] Lire              [ ] Émettre   [ ] Annuler         |
| AGENTS     [x] Confier une tâche [ ] Créer un agent                |
| .................................................................. |
| Un agent n'a jamais plus de droits que la personne qu'il sert.     |
+--------------------------------------------------------------------+
```

```text
+---------------------------------+----------------------------------+
| ORGANISATION   [Arbre] Tableau  | SAV LOMÉ                         |
| ............................... | ................................ |
| KYA Energy                      | Responsable  Awa                 |
|  +- Direction                   | Postes       Technicien (4)      |
|  +- SAV                         |              Accueil (1)         |
|  |   +- SAV Lomé        6       | Agents       Agent SAV           |
|  |   +- SAV Kpalimé     3       | Apps         Support, Stock      |
|  +- Achats              4       | Intérim      Kofi, du 20 au 27   |
|  +- Qualité             2       |                                  |
|                                 |                                  |
| [+ Unité] [Importer un tableur] | [Décrire en une phrase...]       |
+---------------------------------+----------------------------------+
```

```text
+--------------------------------------------------------------------+
| CIRCUIT  Achat                                [Essayer sur un cas] |
| .................................................................. |
|  Demandeur --> Responsable --> Direction --> Comptabilité          |
|                jusqu'à          au-delà       toujours informée    |
|                500 000                                             |
|  Intérim: le remplaçant désigné décide.                            |
|  Sans réponse en 48 h: rappel, puis le niveau au-dessus.           |
|  Un agent peut préparer la demande, jamais la décider.             |
+--------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------+
| PREUVES   Référentiel: ISO 42001 v            21 couverts sur 27   |
| .................................................................. |
| CONTRÔLE                                PREUVE             ÉTAT    |
| Chaque agent a un propriétaire          Registre, ce jour  1 écart |
| Les gestes d'agents sont journalisés    Journal 312 lignes Couvert |
| Une personne décide les gestes risqués  9 brouillons       Couvert |
| Les journaux sont gardés 12 mois        Règle de garde     Couvert |
| .................................................................. |
| [Dossier d'audit en PDF]                                           |
+--------------------------------------------------------------------+
```

## Entering (step D1)

```text
+----------------------+----------------------+----------------------+
| 1 VOTRE COMPTE       | 2 VOTRE ENTREPRISE   | 3 PREMIER PAS        |
| .................... | .................... | .................... |
| E-mail ou numéro     | Nom                  | [Données d'exemple]  |
| Passkey ou code      | Taille   5 à 20 v    | [Inviter collègues]  |
|                      | Essai de 14 jours    | [Poser une question] |
| [Continuer]          | [Créer mon espace]   |                      |
+----------------------+----------------------+----------------------+
```

The fleet, in Kete Cockpit — counters, never a client's data:

```text
+----------------------+--------------+-----------+-----------+------------+----------+
| ESPACE               | OFFRE        | PERSONNES | IA / MOIS | STOCKAGE   | ÉTAT     |
| .................... | ............ | ......... | ......... | .......... | ........ |
| Pressing Afi         | Essai  J-9   | 4 / 5     | 62 %      | 0,3 / 2 Go | Sain     |
| Garage Bè            | Offre 1      | 5 / 5     | 100 %     | 1,9 / 2 Go | Limite   |
| Clinique Tokoin      | Offre 2      | 31 / 50   | 48 %      | 12 / 50 Go | Sain     |
| KYA Energy           | À part       | -         | -         | -          | Chez eux |
|                      |              |           |           |            |          |
| [+ Créer un espace]  |              |           |           |            |          |
+----------------------+--------------+-----------+-----------+------------+----------+
```

## The method, time and memory (doctrine D-050 to D-054)

Added on 2026-10-13, evening, from the canvas 3.1 the author validated. Each screen is built on the
modules of `kete-core`'s phase 9 (L1 to L8); the steps are in `docs/ROADMAP.md`.

### Décider through the day (step C2)

Décider carries a moment: **Matin**, **Soir**, **Semaine** (D-051). The morning is the pile drawn
above; the evening closes the day; the week reviews it.

```text
+--------------------------------------------------------------------+
| Clôturer la journée            mardi 13 octobre   [Matin][Soir][Semaine]
| .................................................................. |
| VOTRE NOTE                                   2 min · écrite ou dite |
|  Fait      Décidé l'outillage. Validé l'acompte. Point chantier.   |
|  Pas fait  Le rapport au Fonds.                                    |
|  Bloqué    La réception de vendredi : Kossi est en congé.          |
|  Demain    Le rapport le matin. Appeler la Pharmacie du Port.      |
|  Appris    La mairie exige 3 devis au-delà de 500 000 F.           |
| .................................................................. |
| CE QUE JE PROPOSE DE RANGER                          5 sur 6 cochés |
|  [x] Bloquer   demain 8 h 30 – 10 h 30 · Rapport au Fonds          |
|  [x] Reporter  « Relancer la Pharmacie du Port » à demain 11 h     |
|  [x] Confier   Réception vendredi 10 h → Yao (il peut refuser)     |
|  [x] Clore     « Point chantier du 13 » — compte rendu au fil      |
|  [ ] Corriger  Fiche École La Colombe : paie à 30 jours            |
|  [x] Leçon     « 3 devis pour un achat public » → Devis solaire    |
|  [Ranger la sélection]        rien ne change sans ce geste         |
| .................................................................. |
| VOTRE RÉSUMÉ DU JOUR             chiffres figés à 18 h · indexé ?  |
|  5 décisions · 0 F encaissé · 4 339 500 F disponible               |
|  Envoyé à : moi, équipe La Colombe   [Indexer : projet La Colombe] |
|  [Envoyer et indexer]   [À 18 h]                                   |
+--------------------------------------------------------------------+
```

The week shows the week's summary (draft, Friday 17 h), next week proposed, what was learned (the
lessons proposed and kept) and what the agents did.

### Planifier (step C12, doctrine D-050)

```text
+---------------------+----------------------------------------------------------+
| > PLANIFIER 1 conflit| Planifier   semaine du 12 oct.  [Ma vue][Mon équipe][Toute l'organisation]
|                     |                                     [Organiser ma semaine] |
|                     | (!) Vendredi 10 h, réception du matériel : Kossi, qui en  |
|                     |     est responsable, est en congé.  [Confier à Yao] [Avancer]
|                     | [x] Réunions [x] Échéances [x] Congés [x] Tâches [x] Agents |
|                     |       lun 12  mar 13  mer 14  jeu 15      ven 16   s  d   |
|                     | Jour.                       Éch. F-0003  Kossi congé       |
|                     |                             Kossi congé  (!) réception     |
|                     |  9 h          Point ch.     Relancer*                      |
|                     | 11 h          Câbles*       Ecobank                        |
|                     | 14 h          Rapport*                                     |
|                     |        * proposé par l'assistant : [Garder] [Retirer]      |
+---------------------+----------------------------------------------------------+
```

- _Mon équipe_: one row per person, a week across; an absence says « En congé », never why; the
  others' meetings show as « Occupé » unless shared.
- _Toute l'organisation_: the same, grouped by unit, with the absent counted; opened by rights.
- On a phone, and when the assistant is open beside it, the week becomes a list of days.

### Mon tableau (step C13, doctrine D-052)

One entry, three tabs: **En direct** (the board she composed), **Résumés** (the board frozen at a
moment, with where it is indexed, who read it, where the assistant cited it), **Carnet** (her notes,
each with what Kete understood: a reminder, a lesson proposed, a correction to validate). Three
cards say the three moments of the same object: looked at, sent (every evening, every Friday),
kept. « Noter » (the pencil, or N) works from every page.

### Déléguer: an agent's job description, and know-how (steps C6 and C7, D-053)

```text
+--------------------------------------------------------------------+
| Agent Relances                 Privé · responsable Afi    Vous attend
|  Faire payer les factures en retard sans abîmer la relation.       |
|  Il lit          Kete Finance : factures · Tiers : contacts        |
|  Il ne fait jamais  Accorder une remise, annuler une facture       |
|  Il se réveille  lundi 8 h · une facture passe 7 jours de retard   |
|  Son mandat      il agit pour Afi, jamais avec plus de droits      |
|  Où il tourne    sur le serveur de l'organisation, jour et nuit    |
|  Son budget      1 840 F sur 5 000 F ce mois                       |
| AUTONOMIE         Lire [Seul]  Écrire [Prépare]  Envoyer [Jamais seul]
|  [Essai à blanc] [Pause] [Arrêt d'urgence]                         |
+--------------------------------------------------------------------+
| SAVOIR-FAIRE · Design Kete v1.4 · Mawuli · Moi > Équipe > Unité > Org
|  LEÇONS EN ATTENTE (venues de l'usage, avec consentement)          |
|   « Le PDF du devis coupe le total »  → [Garder] [Essayer] [Écarter]
|  24 sur 24 cas réussis · [Publier la 1.5] [Proposer à l'Unité]     |
+--------------------------------------------------------------------+
```

The same lifecycle shows for an app born in the factory, in Apps (D-053).

### The project's memory and calendar (step C14)

The project gains a tab **Mémoire** — what the assistant knows of it (notes, instructions), each
readable and erasable, and the summaries indexed there — and a block **Calendrier** (its reception,
its works, its penalty date), opened in Planifier.

### The phone, native (steps C2 and C14, doctrine D-054)

```text
+--------------------------+  +--------------------------+  +--------------------------+
| Le matin  1 sur 5  ■□□□□ |  | Clôturer la journée      |  | Terrain   [Plein soleil] |
| Kossi · La Colombe       |  |                          |  | Maintenant · 9 h         |
| Achat « Outillage »      |  |        ( micro )         |  | POINT CHANTIER           |
| 145 000 F                |  |   Touchez pour parler    |  | LA COLOMBE               |
| Hors budget : la marge   |  | Ou une note vocale sur   |  | [ Dicter le rapport ]    |
| passe à 95 000 F.        |  | WhatsApp : même résultat |  | [ Photo ]                |
| [ Non ]  [ Oui, approuver]  |  | [Écrire plutôt]          |  | Ensuite : 11 h câbles    |
+--------------------------+  +--------------------------+  +--------------------------+
```

After the voice, the same proposals as on a computer, to tick; after a dictated report, Kete reads
it back aloud before it is validated and draws its drafts for Décider.

## Where today's menu goes

| Today                                                   | In this structure                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| Aujourd'hui, À faire                                    | **Décider**                                                       |
| Assistant, Dossiers                                     | **Demander**: a thread, or a project                              |
| Mon carnet, Tableaux de bord, Routines’ deliveries      | **Mon tableau** (D-052): En direct, Résumés, Carnet               |
| Calendrier, Mon équipe (absences)                       | **Planifier** (D-050): my view, my team, the organization         |
| Mes agents, Routines, Skills                            | **Déléguer**: an agent's card carries its routines and its skills |
| Documents, Formulaires, Données                         | Pieces in a project, pinned on Décider                            |
| Bibliothèque                                            | The shared project « Entreprise »                                 |
| Mon équipe                                              | A view of Décider for managers                                    |
| Terrain                                                 | A mode of the phone (D-054)                                       |
| Enquêtes, Performance, Réunions, Conformité, Ressources | **Apps** (step C10)                                               |
| Notifications                                           | The bell                                                          |
| Administration (thirteen entries)                       | Six entries                                                       |
