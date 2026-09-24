/**
 * Proxy CORS minimal pour Cloudflare Workers (gratuit).
 *
 * Rôle : télécharger une image (n'importe quel site) et la renvoyer avec
 * des en-têtes CORS permissifs, pour les cas où le téléchargement direct
 * depuis l'outil échoue (site qui ne renvoie pas d'en-tête CORS, comme
 * image-heberg.fr par exemple).
 *
 * Usage : GET https://<mon-worker>.workers.dev/?url=<URL_IMAGE_ENCODEE>
 *
 * Sécurité : ce proxy est volontairement ouvert à tous les domaines (pour
 * marcher avec n'importe quel hébergeur de photos sans configuration), mais
 * ne relaie que des réponses dont le Content-Type commence par "image/" —
 * il ne peut donc pas servir de proxy CORS générique pour du contenu
 * quelconque (pages HTML, JSON, etc.).
 */

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');

    if (!target) {
      return new Response('Paramètre "url" manquant.', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response('URL invalide.', { status: 400 });
    }

    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return new Response('Seules les URL http:// ou https:// sont autorisées.', { status: 400 });
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'wayfarer-gps-exif-proxy' },
      });
    } catch (e) {
      return new Response('Échec du téléchargement de l\'image cible.', { status: 502 });
    }

    if (!upstream.ok) {
      return new Response(`L'image cible a renvoyé une erreur (${upstream.status}).`, {
        status: upstream.status,
      });
    }

    // On ne relaie que des images, pour ne pas devenir un proxy CORS généraliste
    const contentType = upstream.headers.get('Content-Type') || '';
    if (!contentType.startsWith('image/')) {
      return new Response('Ce proxy ne relaie que des images.', { status: 415 });
    }

    // On relaie le corps de la réponse tel quel, en ajoutant les en-têtes CORS
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
