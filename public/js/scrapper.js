'use strict';

/**
 * scrapper.js — client SSE pour la page /scrapper (V1.5 → V1.6).
 *
 * ⚠️ Le transport est volontairement `fetch()` + `ReadableStream` et
 * NON `EventSource` :
 *   - EventSource ne permet pas de lire le statut HTTP (400/401/409/503)
 *   - EventSource reconnecte automatiquement → relancerait le script
 *   - EventSource ne supporte pas l'annulation propre (AbortController)
 *
 * Le serveur émet en SSE : `event: <type>\ndata: <json>\n\n`
 * Types : meta, log, stderr, phase (progress|error), error, end.
 *
 * V1.6 : deux <select> (série de destination + type de dossier) sont
 * obligatoires avant lancement. Le serveur construit le chemin destination
 * et le passe en argv[2] au script Python.
 *
 * V1.5.3 — Console :
 *   - Auto-scroll qui suit réellement les nouvelles lignes, même sur
 *     de très grosses sorties (cap dur sur le nombre de lignes).
 *   - Bouton « Suivre » (id `scrapper-follow`) :
 *       * état « actif » : suivi automatique en cours (discret)
 *       * état « pause » : dès que l'utilisateur remonte le scroll
 *         (sortie de la zone des 40 px du bas), l'auto-scroll cesse
 *         et le bouton passe en vert pour inviter au clic
 *       * clic → ré-active le suivi + scroll forcé en bas
 *       * revenir en bas au scroll ré-active aussi le suivi
 *   - Flag `programmaticScroll` (via rAF) pour ne pas déclencher la
 *     pause sur nos propres scrolls programmatiques.
 *
 * Dépendances : window.api (api.js) doit être chargé avant ce script.
 */
(function () {
  'use strict';

  const form = document.getElementById('scrapper-form');
  if (!form) return; // Pas sur la page /scrapper

  const input = document.getElementById('scrapper-input');
  const submit = document.getElementById('scrapper-submit');
  const consoleEl = document.getElementById('scrapper-lines');
  const placeholder = document.getElementById('scrapper-placeholder');
  const followBtn = document.getElementById('scrapper-follow');
  const segs = Array.from(document.querySelectorAll('.scrapper-seg'));

  // V1.6 — sélection destination
  const seriesSelect = document.getElementById('scrapper-series-dest');
  const folderSelect = document.getElementById('scrapper-folder-dest');
  const previewPath = document.getElementById('scrapper-dest-preview-path');

  // -----------------------------------------------------------------------
  // État
  // -----------------------------------------------------------------------
  let abortCtrl = null;
  let running = false;
  let moduleDisabled = false;
  let rootDir = '';

  // V1.5.3 — suivi de la console
  let follow = true;             // true = auto-scroll actif
  let programmaticScroll = false; // true = notre scroll en cours (à ignorer)
  const MAX_LINES = 5000;        // cap dur quand follow = true
  const BOTTOM_THRESHOLD = 40;   // px — « on est en bas »

  // -----------------------------------------------------------------------
  // Parseur SSE
  // -----------------------------------------------------------------------

  /**
   * Consomme un flux SSE depuis `fetch()` + ReadableStream.
   * Résout quand le flux se termine (done), rejette sur erreur réseau.
   *
   * @param {string} url
   * @param {AbortSignal} signal
   * @param {(evt: {event: string, data: any}) => void} onEvent
   */
  async function consumeSSE(url, signal, onEvent) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'text/event-stream' },
      signal,
    });

    if (!res.ok) {
      let errorCode = 'http_' + res.status;
      try {
        const body = await res.json();
        if (body && body.error) errorCode = body.error;
      } catch {
        /* ignore : réponse non JSON */
      }
      throw new Error(errorCode);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const evt = parseSSEFrame(frame);
          if (evt) onEvent(evt);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }

  /**
   * Parse une frame SSE brute.
   * Gère `event:`, `data:`, `id:`, `retry:`, commentaires `:` (ping).
   *
   * @param {string} frame
   * @returns {{event: string, data: any} | null}
   */
  function parseSSEFrame(frame) {
    let event = 'message';
    const dataLines = [];

    for (const line of frame.split('\n')) {
      if (!line) continue;
      if (line.startsWith(':')) continue; // commentaire / ping heartbeat
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
      // id: et retry: ignorés (non utilisés par le serveur)
    }

    if (dataLines.length === 0) return null;

    const rawData = dataLines.join('\n');
    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      data = { raw: rawData };
    }
    return { event, data };
  }

  // -----------------------------------------------------------------------
  // Helpers UI
  // -----------------------------------------------------------------------

  /**
   * V1.5.3 — Masque le placeholder et révèle le bouton « Suivre ».
   * Appelé au premier log, ou sur un événement `meta`.
   */
  function hidePlaceholder() {
    if (placeholder) placeholder.hidden = true;
    if (followBtn) followBtn.hidden = false;
  }

  /**
   * @returns {boolean} true si la console est « collée au bas ».
   */
  function isAtBottom() {
    if (!consoleEl) return true;
    return (
      consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight <
      BOTTOM_THRESHOLD
    );
  }

  /**
   * V1.5.3 — Scroll programmatique vers le bas.
   * Pose `programmaticScroll = true` le temps du paint suivant, pour
   * que le listener `scroll` n'interprète pas ce mouvement comme un
   * scroll utilisateur (qui déclencherait la pause).
   */
  function scrollToBottomProgrammatic() {
    if (!consoleEl) return;
    programmaticScroll = true;
    consoleEl.scrollTop = consoleEl.scrollHeight;
    requestAnimationFrame(() => {
      programmaticScroll = false;
    });
  }

  /**
   * V1.5.3 — Synchronise la classe + l'attribut ARIA du bouton
   * « Suivre » avec l'état `follow`.
   */
  function updateFollowButton() {
    if (!followBtn) return;
    followBtn.classList.toggle('scrapper-follow--active', follow);
    followBtn.setAttribute('aria-pressed', follow ? 'true' : 'false');
    followBtn.title = follow
      ? 'Suivi actif — cliquez pour figer'
      : 'Cliquez pour suivre les dernières lignes';
  }

  /**
   * Ajoute une ligne dans la console noire.
   *
   * V1.5.3 :
   *   - si `follow === true` : cap dur à MAX_LINES puis scroll en bas.
   *     Le cap évite de dépasser la limite `scrollHeight` des navigateurs
   *     (≈16M px) qui empêchait sinon l'auto-scroll de suivre.
   *   - si `follow === false` : on n'ajoute pas de scroll (l'utilisateur
   *     lit les anciennes lignes) ET on ne cape pas (sinon on lui
   *     retirerait du contenu sous les yeux). Le prochain clic
   *     « Suivre » nettoiera le surplus d'un coup.
   *
   * @param {string} text
   * @param {'stderr'|'meta'|undefined} kind
   */
  function appendLog(text, kind) {
    hidePlaceholder();
    if (!consoleEl) return;

    const div = document.createElement('div');
    div.className = 'scrapper-line' + (kind ? ' scrapper-line--' + kind : '');
    div.textContent = text;
    consoleEl.appendChild(div);

    if (follow) {
      while (consoleEl.childElementCount > MAX_LINES) {
        consoleEl.firstElementChild.remove();
      }
      scrollToBottomProgrammatic();
    }
  }

  function setProgress(phase, pct) {
    const seg = segs[phase - 1];
    if (!seg) return;
    if (seg.dataset.status === 'error') return; // on n'écrase pas une erreur
    const fill = seg.querySelector('.scrapper-fill');
    if (!fill) return;
    const clamped = Math.max(0, Math.min(100, pct));
    fill.style.width = clamped + '%';
    seg.setAttribute('aria-valuenow', String(clamped));
    if (clamped >= 100) seg.dataset.status = 'done';
  }

  function setPhaseError(phase) {
    const seg = segs[phase - 1];
    if (!seg) return;
    seg.dataset.status = 'error';
    seg.setAttribute('aria-valuenow', '100');
    const fill = seg.querySelector('.scrapper-fill');
    if (fill) fill.style.width = '100%';
  }

  function resetUI() {
    for (const seg of segs) {
      delete seg.dataset.status;
      const fill = seg.querySelector('.scrapper-fill');
      if (fill) fill.style.width = '0%';
      seg.setAttribute('aria-valuenow', '0');
    }
    if (consoleEl) consoleEl.innerHTML = '';
    if (placeholder) placeholder.hidden = false;
    if (followBtn) followBtn.hidden = true;

    // V1.5.3 — on repart en mode « suivre »
    follow = true;
    updateFollowButton();
  }

  // -----------------------------------------------------------------------
  // V1.6 — Sélection destination
  // -----------------------------------------------------------------------

  /**
   * @returns {boolean} true si les 3 champs requis sont renseignés.
   */
  function fieldsReady() {
    if (!input || !input.value.trim()) return false;
    if (!seriesSelect || !seriesSelect.value) return false;
    if (!folderSelect || !folderSelect.value) return false;
    return true;
  }

  function updateSubmitEnabled() {
    if (!submit) return;
    if (running || moduleDisabled) {
      submit.disabled = true;
      return;
    }
    submit.disabled = !fieldsReady();
  }

  /**
   * Peuple le <select> des séries depuis `cfg.series`.
   * Si la liste est vide, désactive le select et propose un message.
   *
   * @param {string[]} series
   */
  function populateSeries(series) {
    if (!seriesSelect) return;
    seriesSelect.innerHTML = '';

    if (!Array.isArray(series) || series.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— Aucune série disponible —';
      opt.disabled = true;
      opt.selected = true;
      seriesSelect.appendChild(opt);
      seriesSelect.disabled = true;
      return;
    }

    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = '— Choisir —';
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    seriesSelect.appendChild(placeholderOpt);

    for (const name of series) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      seriesSelect.appendChild(opt);
    }
    seriesSelect.disabled = false;
  }

  /**
   * Met à jour l'aperçu du chemin destination.
   * Format : {rootDir}/{series_dest}/{folder_dest}/
   * Séparateur d'affichage : `/` (toujours), même sous Windows.
   */
  function updatePreview() {
    if (!previewPath) return;
    const s = seriesSelect ? seriesSelect.value : '';
    const f = folderSelect ? folderSelect.value : '';
    if (!s || !f || !rootDir) {
      previewPath.textContent = '—';
      return;
    }
    const root = String(rootDir).replace(/[\\/]+$/, '');
    previewPath.textContent = root + '/' + s + '/' + f + '/';
  }

  // -----------------------------------------------------------------------
  // Busy / disable
  // -----------------------------------------------------------------------

  function setBusy(busy) {
    running = busy;
    const disabled = busy || moduleDisabled;
    if (input) input.disabled = disabled;
    if (seriesSelect) seriesSelect.disabled = disabled || !seriesSelect.options.length;
    if (folderSelect) folderSelect.disabled = disabled;
    if (submit) {
      if (disabled) submit.disabled = true;
      else submit.disabled = !fieldsReady();
    }
  }

  function disableModule(message) {
    moduleDisabled = true;
    hidePlaceholder();
    appendLog('[ERREUR] ' + message, 'stderr');
    if (input) input.disabled = true;
    if (seriesSelect) seriesSelect.disabled = true;
    if (folderSelect) folderSelect.disabled = true;
    if (submit) submit.disabled = true;
  }

  // -----------------------------------------------------------------------
  // Gestion des événements SSE
  // -----------------------------------------------------------------------

  /**
   * @param {{event: string, data: any}} evt
   * @returns {'continue'|'end'}
   */
  function handleEvent({ event, data }) {
    switch (event) {
      case 'meta':
        // Premier événement : masque le placeholder, révèle le bouton
        hidePlaceholder();
        return 'continue';

      case 'log':
        if (data && typeof data.line === 'string') appendLog(data.line);
        return 'continue';

      case 'stderr':
        if (data && typeof data.line === 'string') {
          appendLog(data.line, 'stderr');
        }
        return 'continue';

      case 'phase':
        if (data && data.status === 'error') {
          setPhaseError(data.phase);
          appendLog('[échec] phase ' + data.phase, 'stderr');
        } else if (data && typeof data.progress === 'number') {
          setProgress(data.phase, data.progress);
        }
        return 'continue';

      case 'error':
        if (data && data.message) {
          appendLog('[ERREUR] ' + data.message, 'stderr');
        }
        return 'continue';

      case 'end':
        if (data) {
          const sec = ((data.durationMs || 0) / 1000).toFixed(2);
          appendLog(
            '[fin] code ' + data.exitCode + ' · ' + sec + ' s · ' + data.reason,
            'meta'
          );
        }
        return 'end';

      default:
        return 'continue';
    }
  }

  // -----------------------------------------------------------------------
  // Lancement
  // -----------------------------------------------------------------------

  /**
   * @param {string} url
   * @param {string} seriesDest
   * @param {string} folderDest
   */
  async function run(url, seriesDest, folderDest) {
    resetUI();
    setBusy(true);

    abortCtrl = new AbortController();
    const endpoint =
      '/api/run?url=' + encodeURIComponent(url) +
      '&series_dest=' + encodeURIComponent(seriesDest) +
      '&folder_dest=' + encodeURIComponent(folderDest);

    try {
      await consumeSSE(endpoint, abortCtrl.signal, handleEvent);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // Abort manuel (unload ou fermeture) : rien à afficher
        return;
      }
      hidePlaceholder();
      const msg = err && err.message ? err.message : String(err);
      appendLog('[ERREUR] ' + msg, 'stderr');
    } finally {
      abortCtrl = null;
      setBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Listeners
  // -----------------------------------------------------------------------

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (running || moduleDisabled) return;
    if (!fieldsReady()) {
      // Focus sur le premier champ manquant
      if (input && !input.value.trim()) input.focus();
      else if (seriesSelect && !seriesSelect.value) seriesSelect.focus();
      else if (folderSelect && !folderSelect.value) folderSelect.focus();
      return;
    }
    const url = input.value.trim();
    const s = seriesSelect.value;
    const f = folderSelect.value;
    run(url, s, f);
  });

  if (input) input.addEventListener('input', updateSubmitEnabled);

  if (seriesSelect) {
    seriesSelect.addEventListener('change', () => {
      updatePreview();
      updateSubmitEnabled();
    });
  }
  if (folderSelect) {
    folderSelect.addEventListener('change', () => {
      updatePreview();
      updateSubmitEnabled();
    });
  }

  // -----------------------------------------------------------------------
  // V1.5.3 — Suivi de la console (bouton + auto-pause)
  // -----------------------------------------------------------------------

  if (consoleEl) {
    consoleEl.addEventListener('scroll', () => {
      if (programmaticScroll) return; // notre propre scroll : on ignore
      const atBottom = isAtBottom();
      if (atBottom && !follow) {
        // L'utilisateur a scrollé jusqu'en bas → ré-active le suivi
        follow = true;
        updateFollowButton();
      } else if (!atBottom && follow) {
        // L'utilisateur a scrollé vers le haut → pause
        follow = false;
        updateFollowButton();
      }
    });
  }

  if (followBtn) {
    followBtn.addEventListener('click', () => {
      // Ré-active le suivi et force le scroll en bas
      follow = true;
      updateFollowButton();
      scrollToBottomProgrammatic();
    });
  }

  // État initial du bouton (cohérent avec hidden + classe dans le HTML)
  updateFollowButton();

  // Annulation propre à la fermeture / navigation (D9)
  window.addEventListener('beforeunload', () => {
    if (abortCtrl) {
      try { abortCtrl.abort(); } catch { /* ignore */ }
    }
  });

  // Annulation explicite si l'onglet est masqué (Safari mobile)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && abortCtrl) {
      try { abortCtrl.abort(); } catch { /* ignore */ }
    }
  });

  // -----------------------------------------------------------------------
  // Initialisation : récupération de la config + peuplement des selects
  // -----------------------------------------------------------------------

  (async () => {
    try {
      const cfg = await api.getJSON('/api/scrapper/config');

      if (!cfg || !cfg.enabled) {
        disableModule('Le module Scrapper n\'est pas configuré sur le serveur.');
        return;
      }

      // V1.6 : l'endpoint renvoie `allowed` selon le rôle.
      if (cfg.allowed === false) {
        disableModule('Vous n\'êtes pas autorisé à utiliser le Scrapper.');
        return;
      }

      if (typeof cfg.rootDir === 'string') {
        rootDir = cfg.rootDir;
      }

      populateSeries(cfg.series);
      updatePreview();
      updateSubmitEnabled();
    } catch (err) {
      // 401 : header.js redirige déjà vers /login, on laisse faire
      if (err && err.status === 401) return;
      // 404 : endpoint absent (plateforme non migrée)
      if (err && err.status === 404) {
        disableModule('Module Scrapper indisponible (endpoint manquant).');
        return;
      }
      // Autre : on n'empêche pas l'utilisation — l'erreur remontera au submit
    }
  })();
})();