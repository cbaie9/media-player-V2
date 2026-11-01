'use strict';

/**
 * scrapper.js — client SSE pour la page /scrapper (V1.5).
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
  const segs = Array.from(document.querySelectorAll('.scrapper-seg'));

  // -----------------------------------------------------------------------
  // État
  // -----------------------------------------------------------------------
  let abortCtrl = null;
  let running = false;
  let moduleDisabled = false;

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

  function hidePlaceholder() {
    if (placeholder) placeholder.hidden = true;
  }

  /**
   * Ajoute une ligne dans la console noire.
   * Auto-scroll uniquement si l'utilisateur était déjà proche du bas
   * (D22 — préserve la lecture s'il est remonté).
   *
   * @param {string} text
   * @param {'stderr'|'meta'|undefined} kind
   */
  function appendLog(text, kind) {
    hidePlaceholder();
    if (!consoleEl) return;

    const atBottom =
      consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 40;

    const div = document.createElement('div');
    div.className = 'scrapper-line' + (kind ? ' scrapper-line--' + kind : '');
    div.textContent = text;
    consoleEl.appendChild(div);

    if (atBottom) {
      consoleEl.scrollTop = consoleEl.scrollHeight;
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
  }

  function setBusy(busy) {
    running = busy;
    if (busy) {
      if (input) input.disabled = true;
      if (submit) submit.disabled = true;
    } else if (!moduleDisabled) {
      if (input) input.disabled = false;
      if (submit) submit.disabled = false;
    }
  }

  function disableModule(message) {
    moduleDisabled = true;
    hidePlaceholder();
    appendLog('[ERREUR] ' + message, 'stderr');
    if (input) input.disabled = true;
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
        // Premier événement : masque le placeholder
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

  async function run(url) {
    resetUI();
    setBusy(true);

    abortCtrl = new AbortController();
    const endpoint = '/api/run?url=' + encodeURIComponent(url);

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
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }
    run(value);
  });

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
  // Vérification au chargement : le module est-il activé côté serveur ?
  // -----------------------------------------------------------------------

  (async () => {
    try {
      const cfg = await api.getJSON('/api/scrapper/config');
      if (!cfg || !cfg.enabled) {
        disableModule('Le module Scrapper n\'est pas configuré sur le serveur.');
      }
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