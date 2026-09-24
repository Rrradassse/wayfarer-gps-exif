# 📍 GPS depuis photo — extracteur EXIF pour Wayfarer

Petit outil web 100 % statique qui extrait les coordonnées GPS des métadonnées
EXIF d'une photo à partir de son URL. Pensé pour vérifier rapidement les
propositions de PokéStops sur **Niantic Wayfarer** : colle l'adresse de
l'image, obtiens instantanément une carte, des liens Google Maps/Street View
et les coordonnées.

Aucune clé d'API, aucun serveur applicatif, aucun build : juste du
HTML/CSS/JS vanilla, hébergeable gratuitement sur GitHub Pages.

## Mode d'emploi (le parcours principal)

1. Dans Wayfarer, **clic droit sur la photo** de la proposition → **« Copier
   l'adresse de l'image »**.
2. Colle l'URL dans le grand champ de texte de l'outil (`Ctrl+V`). (url de l'outil : https://rrradassse.github.io/wayfarer-gps-exif/ ) 
3. L'analyse démarre automatiquement au collage (ou clique sur
   « Analyser »). En quelques secondes, tu obtiens :
   - une mini-carte avec un marqueur sur la position ;
   - des liens directs vers **Google Maps** et **Street View** ;
   - les coordonnées en décimal (avec un bouton **Copier**, prêtes à coller
     dans Google Maps) et en degrés/minutes/secondes ;
   - une miniature de la photo, la date de prise de vue et l'appareil si
     ces informations sont disponibles.
4. Le champ reprend automatiquement le focus (texte sélectionné) : colle
   directement l'URL suivante pour enchaîner les vérifications.

Tu peux aussi coller **plusieurs URL** (une par ligne) : un tableau
récapitulatif s'affiche, avec export CSV et clic sur une ligne pour voir sa
carte en détail.

## Analyser les photos d'un dossier de ton ordinateur

Sous le champ d'URL, la zone **« photos de ton ordinateur »** est toujours
disponible : clique sur **Choisir un dossier** (sous-dossiers inclus) ou
**Choisir des photos**, ou glisse-dépose un dossier / des fichiers dessus.
Les résultats s'affichent dans le même tableau que pour les URL (nom avec
chemin, statut, coordonnées, liens, carte au clic, export CSV). Les photos
restent sur ton ordinateur : rien n'est envoyé.

## Comment l'outil récupère les coordonnées (URL)

Dans l'ordre, et automatiquement (aucune action de ta part) :

1. **Téléchargement direct** de l'URL telle que collée, puis lecture EXIF.
2. Si aucune coordonnée GPS n'est trouvée : essai des **variantes de
   suffixe** utilisées par `lh3.googleusercontent.com` (`=s0`, `=d`,
   `=s0-d`, sans suffixe), en remplaçant ce qui suit le dernier `=` de
   l'URL. Certaines variantes conservent l'EXIF là où d'autres le
   suppriment.
3. Si le téléchargement échoue à cause d'une restriction **CORS** : la
   requête est retentée via un **proxy Cloudflare Worker**, si tu en as
   configuré un dans le panneau **Paramètres** (⚙️, en haut à droite).
4. **En tout dernier recours**, si tout a échoué : un message clair explique
   la cause (CORS, 404, timeout, URL invalide...) ; tu peux alors télécharger
   la photo et la déposer dans la zone « photos de ton ordinateur ».

Si l'image n'a pas de coordonnées GPS, l'outil l'indique clairement mais
affiche quand même les autres métadonnées disponibles (date, appareil...).
Une erreur sur une URL ne bloque jamais l'analyse des autres.

## Publier sur GitHub Pages

1. Crée un dépôt GitHub et pousse ce dossier (voir section Git ci-dessous).
2. Dans le dépôt : **Settings → Pages → Build and deployment → Source :
   Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. L'outil est en ligne à `https://<ton-compte>.github.io/<nom-du-repo>/`.

Aucune étape de build n'est nécessaire : `index.html`, `style.css` et
`app.js` sont servis tels quels.

## Déployer le proxy CORS (Cloudflare Worker, gratuit)

Ce proxy n'est utile qu'en filet de sécurité : `lh3.googleusercontent.com`
autorise déjà le téléchargement direct en CORS (vérifié lors du
développement de cet outil), mais beaucoup d'autres hébergeurs de photos
(ex. image-heberg.fr) ne renvoient aucun en-tête CORS et bloquent donc le
téléchargement direct depuis le navigateur. Configure le proxy si tu
rencontres ce type d'échec.

1. Crée un compte gratuit sur [Cloudflare](https://dash.cloudflare.com/sign-up).
2. Dans le dashboard : **Workers & Pages → Create → Create Worker**.
3. Donne-lui un nom (ex. `wayfarer-gps-proxy`), puis clique sur **Edit
   code** (Quick Edit).
4. Remplace tout le contenu par celui de [`worker/cors-proxy.js`](worker/cors-proxy.js)
   de ce dépôt, puis **Deploy**.
5. Note l'URL du Worker (ex. `https://wayfarer-gps-proxy.mon-compte.workers.dev`).
6. Dans l'outil, ouvre **Paramètres** (⚙️) et colle cette URL dans le champ
   « URL du proxy CORS », puis **Enregistrer**.

Le proxy accepte n'importe quel site (pas seulement Google), pour marcher
avec tous tes hébergeurs de photos sans configuration supplémentaire ; il
ne relaie en revanche que des réponses de type image (`Content-Type:
image/...`), pour ne pas servir de proxy CORS généraliste. Garde à l'esprit
que si l'URL de ton Worker venait à être partagée, d'autres pourraient
aussi s'en servir pour télécharger des images via ton quota Cloudflare —
le plan gratuit (100 000 requêtes/jour) absorbe largement un usage
personnel, mais évite de publier cette URL publiquement.

Alternative : `wrangler deploy` avec le [CLI Cloudflare](https://developers.cloudflare.com/workers/wrangler/)
fonctionne aussi si tu préfères la ligne de commande (crée un projet
Wrangler minimal et copie `worker/cors-proxy.js` dedans).

## Limites connues

- **Google supprime parfois l'EXIF** lors du réencodage des photos
  affichées dans Wayfarer, en particulier après certaines transformations
  de taille. C'est pour ça que l'outil essaie plusieurs variantes d'URL —
  mais si Google a supprimé l'EXIF sur toutes les variantes, aucune
  coordonnée ne peut être retrouvée par cette méthode.
- Le **CORS** peut occasionnellement être restreint ou changer côté Google
  sans préavis ; le proxy Cloudflare Worker sert de filet de sécurité dans
  ce cas.
- L'outil ne fait aucune recherche d'image inversée ni de géolocalisation
  par reconnaissance visuelle : il lit uniquement les métadonnées EXIF déjà
  présentes dans le fichier.
- Les **libellés de carte en français** dépendent du tag `name:fr` présent
  ou non dans OpenStreetMap pour chaque lieu : bien renseigné dans la
  plupart des pays, il peut manquer pour des lieux moins connus, auquel cas
  l'outil retombe sur le nom anglais, puis latin, puis local.

## Structure du dépôt

```
index.html            Interface principale
style.css              Mise en forme (clair/sombre, responsive)
app.js                  Logique : téléchargement, lecture EXIF, carte, export
worker/cors-proxy.js    Proxy CORS Cloudflare Worker (optionnel)
```

## Technologies utilisées (toutes gratuites, via CDN)

- [exifr](https://github.com/MikeKovarik/exifr) — lecture des métadonnées EXIF côté navigateur.
- [Leaflet](https://leafletjs.com/) — conteneur de carte (zoom, marqueur, contrôles).
- [MapLibre GL JS](https://maplibre.org/) + [OpenFreeMap](https://openfreemap.org/) — tuiles vectorielles (données [OpenStreetMap](https://www.openstreetmap.org/)), avec les libellés forcés en français quand la traduction existe.

## Licence

MIT — voir [LICENSE](LICENSE).
