// ============================================================================
// Extracteur GPS/EXIF pour Niantic Wayfarer
// Outil 100% statique : aucun serveur, tout se passe dans le navigateur.
// ============================================================================

const TIMEOUT_MS = 15000; // délai max par tentative de téléchargement
const CONCURRENCY = 4;    // nombre d'analyses en parallèle

// ----- Références DOM -----
const urlInput = document.getElementById('url-input');
const analyzeBtn = document.getElementById('analyze-btn');
const clearBtn = document.getElementById('clear-btn');
const progressBar = document.getElementById('progress-bar');
const progressInfo = document.getElementById('progress-info');

const resultsSection = document.getElementById('results');
const singleResultEl = document.getElementById('single-result');
const multiResultEl = document.getElementById('multi-result');
const resultCountEl = document.getElementById('result-count');
const tbody = document.getElementById('results-tbody');
const detailPanel = document.getElementById('detail-panel');
const exportCsvBtn = document.getElementById('export-csv-btn');

const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const proxyUrlInput = document.getElementById('proxy-url');
const saveSettingsBtn = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');

const localFallback = document.getElementById('local-file-fallback');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const localResultsEl = document.getElementById('local-results');

const cardTemplate = document.getElementById('result-card-template');

// État courant (partagé pour l'export CSV et le panneau de détail)
let currentResults = [];
// Instances Leaflet actuellement affichées (pour les détruire proprement avant d'en recréer)
let activeMaps = [];

// ============================================================================
// Paramètres (proxy CORS, stocké en localStorage)
// ============================================================================

function getProxyUrl() {
  return (localStorage.getItem('wayfarerGpsProxyUrl') || '').trim();
}

function setProxyUrl(value) {
  if (value) {
    localStorage.setItem('wayfarerGpsProxyUrl', value);
  } else {
    localStorage.removeItem('wayfarerGpsProxyUrl');
  }
}

settingsToggle.addEventListener('click', () => {
  proxyUrlInput.value = getProxyUrl();
  settingsPanel.showModal();
});

saveSettingsBtn.addEventListener('click', () => {
  setProxyUrl(proxyUrlInput.value.trim());
  settingsPanel.close();
});

closeSettingsBtn.addEventListener('click', () => settingsPanel.close());

// ============================================================================
// Génération des variantes d'URL (spécifique à lh3.googleusercontent.com)
// Google encode la taille/le mode de téléchargement après le dernier "="
// de l'URL. On essaie plusieurs variantes connues pour maximiser les
// chances de récupérer une image conservant ses métadonnées EXIF.
// ============================================================================

function generateUrlVariants(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return [urlStr];
  }

  const variants = [urlStr];

  if (u.hostname.endsWith('googleusercontent.com')) {
    const href = u.href;
    const lastEq = href.lastIndexOf('=');
    const lastSlash = href.lastIndexOf('/');
    // On ne coupe que si le "=" appartient bien au dernier segment de chemin
    const base = lastEq > lastSlash ? href.slice(0, lastEq) : href;

    for (const suffix of ['=s0', '=d', '=s0-d']) {
      const candidate = base + suffix;
      if (!variants.includes(candidate)) variants.push(candidate);
    }
    if (!variants.includes(base)) variants.push(base);
  }

  return variants;
}

// ============================================================================
// Téléchargement avec timeout, puis repli sur le proxy CORS si configuré
// ============================================================================

function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, mode: 'cors' }).finally(() => clearTimeout(timer));
}

async function tryDownload(url, proxyUrl) {
  // 1) Tentative directe
  try {
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      return { blob: await res.blob(), viaProxy: false };
    }
    return { httpError: res.status };
  } catch (e) {
    const timedOut = e.name === 'AbortError';

    // 2) Repli sur le proxy CORS si l'utilisateur en a configuré un
    if (proxyUrl) {
      try {
        const proxied = proxyUrl.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(url);
        const res2 = await fetchWithTimeout(proxied);
        if (res2.ok) {
          return { blob: await res2.blob(), viaProxy: true };
        }
        return { httpError: res2.status, viaProxy: true };
      } catch (e2) {
        return { networkError: true, timedOut: e2.name === 'AbortError' };
      }
    }

    return { networkError: true, timedOut };
  }
}

function classifyError(dl, hasProxy) {
  if (!dl) return "Erreur inconnue lors du téléchargement.";
  if (dl.httpError === 404) return "Image introuvable (erreur 404). Vérifie l'URL.";
  if (dl.httpError) return `Le serveur a renvoyé une erreur (code ${dl.httpError}).`;
  if (dl.timedOut) return "Le délai de téléchargement a été dépassé (15 s). Réessaie ou vérifie ta connexion.";
  if (dl.networkError) {
    return hasProxy
      ? "Échec du téléchargement même via le proxy CORS configuré. L'URL est peut-être invalide, expirée, ou l'image n'existe plus."
      : "Échec du téléchargement, probablement à cause d'une restriction CORS. Configure un proxy dans les Paramètres (⚙️), ou utilise l'option « fichier local » ci-dessous.";
  }
  return "Erreur inconnue lors du téléchargement.";
}

// ============================================================================
// Lecture des métadonnées EXIF (via la librairie exifr, chargée par CDN)
// ============================================================================

async function safeParseGps(blob) {
  try {
    const gps = await exifr.gps(blob);
    if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
      return gps;
    }
  } catch (e) {
    // Pas d'EXIF exploitable : on continue simplement sans coordonnées
  }
  return null;
}

async function safeParseMeta(blob) {
  try {
    const data = await exifr.parse(blob, { tiff: true, exif: true, ifd0: true });
    return data || {};
  } catch (e) {
    return {};
  }
}

function formatDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) {
    return val.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }
  return String(val);
}

// ============================================================================
// Analyse d'une URL : essaie chaque variante jusqu'à trouver des coordonnées,
// et garde le meilleur résultat obtenu (téléchargement réussi même sans GPS,
// sinon message d'erreur explicite).
// ============================================================================

async function analyzeUrl(originalUrl, proxyUrl) {
  try {
    new URL(originalUrl);
  } catch (e) {
    return {
      url: originalUrl,
      status: 'error',
      errorMessage: "URL invalide — vérifie qu'il s'agit bien d'une adresse complète (commençant par http:// ou https://).",
    };
  }

  const variants = generateUrlVariants(originalUrl);
  let bestDownload = null; // meilleur téléchargement réussi, même sans GPS
  let lastFailure = null;

  for (const variant of variants) {
    const dl = await tryDownload(variant, proxyUrl);

    if (dl.blob) {
      const gps = await safeParseGps(dl.blob);
      if (gps) {
        const meta = await safeParseMeta(dl.blob);
        return {
          url: originalUrl,
          status: 'ok',
          lat: gps.latitude,
          lng: gps.longitude,
          thumbUrl: URL.createObjectURL(dl.blob),
          dateTaken: formatDate(meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate),
          make: meta.Make,
          model: meta.Model,
          viaProxy: dl.viaProxy,
        };
      }
      // Téléchargement OK mais pas de GPS : on garde en réserve et on
      // continue d'essayer les autres variantes (une taille différente a
      // parfois conservé l'EXIF que Google a supprimé sur une autre).
      if (!bestDownload) bestDownload = dl;
      continue;
    }

    lastFailure = dl;
  }

  if (bestDownload) {
    const meta = await safeParseMeta(bestDownload.blob);
    return {
      url: originalUrl,
      status: 'nogps',
      thumbUrl: URL.createObjectURL(bestDownload.blob),
      dateTaken: formatDate(meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate),
      make: meta.Make,
      model: meta.Model,
      viaProxy: bestDownload.viaProxy,
    };
  }

  return {
    url: originalUrl,
    status: 'error',
    errorMessage: classifyError(lastFailure, !!proxyUrl),
  };
}

// ============================================================================
// Analyse d'un fichier local (dernier recours)
// ============================================================================

async function analyzeLocalFile(file) {
  try {
    const gps = await safeParseGps(file);
    const meta = await safeParseMeta(file);
    const thumbUrl = URL.createObjectURL(file);
    const base = {
      url: file.name,
      thumbUrl,
      dateTaken: formatDate(meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate),
      make: meta.Make,
      model: meta.Model,
    };
    if (gps) {
      return { ...base, status: 'ok', lat: gps.latitude, lng: gps.longitude };
    }
    return { ...base, status: 'nogps' };
  } catch (e) {
    return { url: file.name, status: 'error', errorMessage: "Impossible de lire ce fichier." };
  }
}

// ============================================================================
// Utilitaires d'affichage (liens, formats de coordonnées, copie...)
// ============================================================================

function buildGoogleMapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function buildStreetViewUrl(lat, lng) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

function toDMS(deg, isLat) {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = ((minFloat - m) * 60).toFixed(2);
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'O');
  return `${d}° ${m}' ${s}" ${dir}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function copyText(text, btn) {
  const original = btn.textContent;
  navigator.clipboard.writeText(text).then(
    () => {
      btn.textContent = 'Copié !';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1500);
    },
    () => {
      // Permission refusée par le navigateur : on informe simplement l'utilisateur
      btn.textContent = 'Échec de la copie';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  );
}

function clearActiveMaps() {
  activeMaps.forEach((m) => {
    try { m.remove(); } catch (e) { /* déjà détruite */ }
  });
  activeMaps = [];
}

// ============================================================================
// Fond de carte : tuiles vectorielles OpenFreeMap (gratuites, sans clé d'API)
// avec les libellés forcés en français quand la traduction existe dans
// OpenStreetMap (tag "name:fr"), au lieu de la langue locale par défaut.
// ============================================================================

const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> — tuiles <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>';

// Remplace, dans chaque calque de libellés, l'expression d'origine par une
// priorité : nom français > nom anglais > nom en alphabet latin > nom local.
function preferFrenchLabels(style) {
  const frenchFirst = ['coalesce', ['get', 'name:fr'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
  (style.layers || []).forEach((layer) => {
    const textField = layer.layout && layer.layout['text-field'];
    // On ne touche qu'aux calques dont le libellé dépend bien d'un nom de lieu
    // (on laisse intacts les numéros de rue, les références d'autoroute, etc.)
    if (textField && JSON.stringify(textField).includes('"name')) {
      layer.layout['text-field'] = frenchFirst;
    }
  });
  return style;
}

// Le style est récupéré et adapté une seule fois, puis réutilisé pour toutes
// les cartes affichées pendant la session.
let mapStylePromise = null;
function getMapStyle() {
  if (!mapStylePromise) {
    mapStylePromise = fetch(OPENFREEMAP_STYLE_URL)
      .then((res) => res.json())
      .then(preferFrenchLabels)
      // En cas d'échec (hors ligne, service indisponible...), on retombe sur
      // l'URL du style brut : la carte reste fonctionnelle, juste en langue locale.
      .catch(() => OPENFREEMAP_STYLE_URL);
  }
  return mapStylePromise;
}

// ============================================================================
// Construction d'une carte de résultat (mode simple ou détail du tableau)
// ============================================================================

function createResultCard(result) {
  const node = cardTemplate.content.cloneNode(true);
  const article = node.querySelector('.result-card');
  const mapWrapper = node.querySelector('.card-map-wrapper');
  const mapEl = node.querySelector('.card-map');
  const statusEl = node.querySelector('.card-status');
  const thumbEl = node.querySelector('.card-thumb');
  const metaEl = node.querySelector('.card-meta');
  const linksEl = node.querySelector('.card-links');
  const coordsEl = node.querySelector('.card-coords');

  if (result.status === 'loading') {
    statusEl.textContent = 'Analyse en cours...';
    statusEl.className = 'card-status status-loading';
    mapWrapper.style.display = 'none';
    return article;
  }

  if (result.status === 'error') {
    statusEl.textContent = '❌ ' + result.errorMessage;
    statusEl.className = 'card-status status-error';
    mapWrapper.style.display = 'none';
    return article;
  }

  if (result.status === 'nogps') {
    statusEl.textContent = '⚠️ Aucune coordonnée GPS dans cette image';
    statusEl.className = 'card-status status-nogps';
    mapWrapper.style.display = 'none';
  } else {
    statusEl.textContent = '✅ Coordonnées GPS trouvées';
    statusEl.className = 'card-status status-ok';
  }

  if (result.thumbUrl) {
    thumbEl.src = result.thumbUrl;
    thumbEl.hidden = false;
  }

  const metaLines = [];
  if (result.dateTaken) metaLines.push(`📅 ${result.dateTaken}`);
  if (result.make || result.model) metaLines.push(`📷 ${[result.make, result.model].filter(Boolean).join(' ')}`);
  if (result.viaProxy) metaLines.push('🔁 Téléchargé via le proxy CORS');
  metaEl.innerHTML = metaLines.length
    ? metaLines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')
    : '<div>Aucune métadonnée supplémentaire disponible</div>';

  if (result.status === 'ok') {
    const gmaps = buildGoogleMapsUrl(result.lat, result.lng);
    const sview = buildStreetViewUrl(result.lat, result.lng);
    linksEl.innerHTML = `
      <a href="${gmaps}" target="_blank" rel="noopener">🗺️ Google Maps</a>
      <a href="${sview}" target="_blank" rel="noopener">🚶 Street View</a>
    `;

    const decimal = `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`;
    const dms = `${toDMS(result.lat, true)}  ${toDMS(result.lng, false)}`;
    coordsEl.innerHTML = `
      <div class="coord-row">
        <span class="coord-label">Décimal</span>
        <span class="coord-value">${decimal}</span>
        <button class="btn-copy" type="button">Copier</button>
      </div>
      <div class="coord-row">
        <span class="coord-label">DMS</span>
        <span class="coord-value">${dms}</span>
      </div>
    `;
    coordsEl.querySelector('.btn-copy').addEventListener('click', (e) => copyText(decimal, e.currentTarget));

    // La carte doit être initialisée une fois l'élément inséré dans le DOM
    // (Leaflet a besoin de connaître les dimensions réelles du conteneur).
    requestAnimationFrame(() => {
      const map = L.map(mapEl, { maxZoom: 19 }).setView([result.lat, result.lng], 17);
      getMapStyle().then((style) => {
        L.maplibreGL({ style, attribution: MAP_ATTRIBUTION }).addTo(map);
      });
      L.marker([result.lat, result.lng]).addTo(map);
      activeMaps.push(map);
      setTimeout(() => map.invalidateSize(), 50);
    });
  } else {
    linksEl.innerHTML = '';
    coordsEl.innerHTML = '';
  }

  return article;
}

// ============================================================================
// Vue "une seule URL"
// ============================================================================

function renderSingle(result) {
  singleResultEl.innerHTML = '';
  singleResultEl.appendChild(createResultCard(result));
}

// ============================================================================
// Vue "plusieurs URL" (tableau récapitulatif + panneau de détail)
// ============================================================================

function renderTableSkeleton(results) {
  resultCountEl.textContent = results.length;
  tbody.innerHTML = '';
  detailPanel.hidden = true;
  detailPanel.innerHTML = '';
  delete detailPanel.dataset.currentId;

  results.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    tr.innerHTML = `
      <td></td>
      <td><span class="badge status-loading">Analyse...</span></td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
    `;
    tr.addEventListener('click', () => showDetail(r.id));
    tbody.appendChild(tr);
  });
}

function updateTableRow(result) {
  const tr = tbody.querySelector(`tr[data-id="${result.id}"]`);
  if (!tr) return;
  const cells = tr.children;

  cells[0].innerHTML = result.thumbUrl
    ? `<img class="table-thumb" src="${result.thumbUrl}" alt="">`
    : '';

  let badgeClass, badgeText;
  if (result.status === 'ok') {
    badgeClass = 'status-ok';
    badgeText = '✅ GPS trouvé';
  } else if (result.status === 'nogps') {
    badgeClass = 'status-nogps';
    badgeText = '⚠️ Pas de GPS';
  } else {
    badgeClass = 'status-error';
    badgeText = '❌ Erreur';
  }
  cells[1].innerHTML = `<span class="badge ${badgeClass}">${badgeText}</span>`;

  cells[2].textContent = result.status === 'ok' ? result.lat.toFixed(6) : '—';
  cells[3].textContent = result.status === 'ok' ? result.lng.toFixed(6) : '—';

  if (result.status === 'ok') {
    cells[4].innerHTML = `<a href="${buildGoogleMapsUrl(result.lat, result.lng)}" target="_blank" rel="noopener">Maps</a> · <a href="${buildStreetViewUrl(result.lat, result.lng)}" target="_blank" rel="noopener">SV</a>`;
  } else {
    cells[4].textContent = '—';
  }

  // Si cette ligne est actuellement affichée dans le panneau de détail, on la rafraîchit
  if (detailPanel.dataset.currentId === String(result.id)) {
    showDetail(result.id);
  }
}

function showDetail(id) {
  const result = currentResults[id];
  if (!result) return;

  clearActiveMaps();
  detailPanel.innerHTML = '';
  detailPanel.hidden = false;
  detailPanel.dataset.currentId = String(id);
  detailPanel.appendChild(createResultCard(result));

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.classList.toggle('selected', tr.dataset.id === String(id));
  });

  detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================================
// Export CSV
// ============================================================================

function csvEscape(field) {
  const s = String(field ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCsv() {
  const header = ['URL', 'Statut', 'Latitude', 'Longitude', 'Google Maps', 'Street View', 'Date de prise de vue', 'Appareil'];
  const rows = currentResults.map((r) => {
    const statusLabel =
      r.status === 'ok' ? 'GPS trouvé' :
      r.status === 'nogps' ? 'Pas de GPS' :
      'Erreur : ' + (r.errorMessage || '');
    return [
      r.url,
      statusLabel,
      r.status === 'ok' ? r.lat.toFixed(6) : '',
      r.status === 'ok' ? r.lng.toFixed(6) : '',
      r.status === 'ok' ? buildGoogleMapsUrl(r.lat, r.lng) : '',
      r.status === 'ok' ? buildStreetViewUrl(r.lat, r.lng) : '',
      r.dateTaken || '',
      [r.make, r.model].filter(Boolean).join(' '),
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  // Le BOM UTF-8 assure un bon affichage des accents dans Excel
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gps-photos-wayfarer-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

exportCsvBtn.addEventListener('click', exportCsv);

// ============================================================================
// Traitement en parallèle avec limite de concurrence
// ============================================================================

function runWithConcurrency(items, limit, worker, onEach) {
  return new Promise((resolve) => {
    let idx = 0;
    let active = 0;
    let completed = 0;

    function next() {
      if (idx >= items.length && active === 0) {
        resolve();
        return;
      }
      while (active < limit && idx < items.length) {
        const i = idx++;
        active++;
        worker(items[i], i).then((result) => {
          active--;
          completed++;
          onEach(result, i, completed, items.length);
          next();
        });
      }
    }

    next();
  });
}

// ============================================================================
// Point d'entrée : analyse de la liste d'URL collées
// ============================================================================

async function analyze() {
  const urls = urlInput.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (urls.length === 0) return;

  clearActiveMaps();
  resultsSection.hidden = false;
  singleResultEl.hidden = urls.length !== 1;
  multiResultEl.hidden = urls.length === 1;
  analyzeBtn.disabled = true;
  progressBar.hidden = false;
  progressInfo.hidden = false;
  progressBar.value = 0;
  progressInfo.textContent = `0 / ${urls.length}`;

  currentResults = urls.map((u, i) => ({ id: i, url: u, status: 'loading' }));

  if (urls.length === 1) {
    renderSingle(currentResults[0]);
  } else {
    renderTableSkeleton(currentResults);
  }

  const proxyUrl = getProxyUrl();

  await runWithConcurrency(
    urls,
    CONCURRENCY,
    async (url, i) => {
      const result = await analyzeUrl(url, proxyUrl);
      result.id = i;
      currentResults[i] = result;
      return result;
    },
    (result, i, completed, total) => {
      progressBar.value = Math.round((completed / total) * 100);
      progressInfo.textContent = `${completed} / ${total}`;

      if (result.status === 'error') {
        localFallback.hidden = false;
      }

      if (urls.length === 1) {
        renderSingle(result);
      } else {
        updateTableRow(result);
      }
    }
  );

  progressBar.hidden = true;
  progressInfo.hidden = true;
  analyzeBtn.disabled = false;

  // On redonne le focus (et on sélectionne le texte) pour enchaîner
  // rapidement : un simple collage remplace le contenu et relance l'analyse.
  urlInput.focus();
  urlInput.select();
}

analyzeBtn.addEventListener('click', analyze);

urlInput.addEventListener('paste', () => {
  setTimeout(() => {
    if (urlInput.value.trim()) analyze();
  }, 0);
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  resultsSection.hidden = true;
  singleResultEl.hidden = true;
  multiResultEl.hidden = true;
  clearActiveMaps();
  currentResults = [];
  urlInput.focus();
});

// ============================================================================
// Repli "fichier local" (dernier recours, visible seulement après un échec)
// ============================================================================

async function handleLocalFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;

  for (const file of files) {
    const placeholder = document.createElement('p');
    placeholder.textContent = `Analyse de ${file.name}...`;
    localResultsEl.appendChild(placeholder);

    const result = await analyzeLocalFile(file);
    const card = createResultCard(result);
    localResultsEl.replaceChild(card, placeholder);
  }
}

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  handleLocalFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => handleLocalFiles(e.target.files));

// Focus initial pour être prêt à coller dès l'ouverture de la page
urlInput.focus();
