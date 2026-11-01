'use strict';

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const crypto = require('node:crypto');

const { killTreeWithGrace } = require('./killTree');

// ---------------------------------------------------------------------------
// Log shim (V1.5) — compatible avec ou sans le Lot 1 appliqué.
// ---------------------------------------------------------------------------

function safeLog(level, event, fields = {}) {
  try {
    const logger = require('../logger');
    if (logger && typeof logger.logEvent === 'function') {
      logger.logEvent(level, event, fields);
    }
  } catch {
    /* no-op : pas de logger disponible → on n'a rien à faire */
  }
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Capture toute tentative de marqueur PROGRESS, y compris malformée. */
const RE_PROGRESS_ATTEMPT =
  /^\[PHASE:\s*(\d+)\s*,\s*PROGRESS:\s*(\d+)\s*\]\s*$/;

/** Capture toute tentative de marqueur ERROR, y compris malformée. */
const RE_ERROR_ATTEMPT =
  /^\[PHASE:\s*(\d+)\s*,\s*ERROR\s*\]\s*$/;

const MAX_LINE = 16 * 1024;
const MAX_LOG_INPUT = 200;
const HEARTBEAT_MS = 15000;
const KILL_GRACE_MS = 3000;

/** Raisons de fin exposées au client (D21). */
const END_REASONS = new Set([
  'ok',
  'error',
  'timeout',
  'killed',
  'disconnected',
]);

/**
 * Normalise une raison interne vers une raison du protocole SSE.
 * @param {string} raw
 * @returns {'ok'|'error'|'timeout'|'killed'|'disconnected'}
 */
function normalizeEndReason(raw) {
  if (!raw) return 'error';
  if (raw === 'client_disconnected') return 'disconnected';
  if (raw === 'shutdown') return 'killed';
  if (END_REASONS.has(raw)) return raw;
  return 'killed';
}

// ---------------------------------------------------------------------------
// Classe Run
// ---------------------------------------------------------------------------

class Run {
  /**
   * @param {object} params
   * @param {string} params.input
   * @param {string} params.sessionId
   * @param {object} params.cfg - Bloc `python_module` validé (cf. Lot 1)
   */
  constructor({ input, sessionId, cfg }) {
    if (!cfg || typeof cfg !== 'object') {
      throw new Error('Run: cfg est requis');
    }
    if (typeof cfg.script_path !== 'string' || !cfg.script_path) {
      throw new Error('Run: cfg.script_path est requis');
    }
    if (typeof cfg.python_executable !== 'string' || !cfg.python_executable) {
      throw new Error('Run: cfg.python_executable est requis');
    }

    this.id = crypto.randomUUID();
    this.input = String(input ?? '');
    this.sessionId = String(sessionId ?? '');
    this.cfg = cfg;

    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null;

    /** @type {import('express').Response | null} */
    this.res = null;

    /** @type {'starting'|'running'|'done'|'killed'} */
    this.state = 'starting';

    /** @type {string | null} */
    this.killReason = null;

    this.lastPhase = 1;
    this.anyError = false;

    this.startedAt = Date.now();
    this.endedAt = null;

    /** @type {NodeJS.Timeout | null} */
    this.timer = null;

    /** @type {NodeJS.Timeout | null} */
    this.heartbeat = null;

    this.seq = 0;
    this.finished = false;

    /** @type {((run: Run) => void) | null} */
    this.onDone = null;
  }

  /**
   * Attache la réponse HTTP (SSE). Doit être appelé avant `start()`.
   * @param {import('express').Response} res
   */
  attach(res) {
    if (this.res) throw new Error('Run.attach() déjà appelé');
    this.res = res;
  }

  /**
   * Émet un événement SSE. Applique la backpressure (D16) en pausant
   * `child.stdout` si `res.write()` retourne false.
   * @param {string} type
   * @param {object} data
   */
  _emit(type, data) {
    if (!this.res || this.res.writableEnded) return;

    const frame =
      `id: ${this.seq++}\n` +
      `event: ${type}\n` +
      `data: ${JSON.stringify(data)}\n\n`;

    let ok = false;
    try {
      ok = this.res.write(frame);
    } catch {
      return;
    }

    if (
      !ok &&
      this.child &&
      this.child.stdout &&
      !this.child.stdout.destroyed
    ) {
      try {
        this.child.stdout.pause();
        this.res.once('drain', () => {
          try {
            if (
              this.child &&
              this.child.stdout &&
              !this.child.stdout.destroyed
            ) {
              this.child.stdout.resume();
            }
          } catch {
            /* ignore */
          }
        });
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Démarre le sous-processus Python.
   * Émet immédiatement un `meta` avant le spawn (D21).
   */
  start() {
    if (this.state !== 'starting') {
      throw new Error(`Run.start() appelé dans un état invalide : ${this.state}`);
    }

    this._emit('meta', {
      runId: this.id,
      input: this.input,
      startedAt: new Date(this.startedAt).toISOString(),
    });

    const scriptAbs = this.cfg.script_path;
    const cwdAbs = this.cfg.cwd || path.dirname(scriptAbs);
    const pythonExec = this.cfg.python_executable;
    const timeoutSeconds = Number(this.cfg.timeout_seconds) || 0;

    // Env minimal exposé au sous-processus (D13).
    const baseEnv = {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || process.env.USERPROFILE || '',
      LANG: process.env.LANG || 'C.UTF-8',
      LC_ALL: process.env.LC_ALL || 'C.UTF-8',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    };

    // Windows : variables essentielles pour que python.exe trouve ses DLLs.
    if (process.platform === 'win32') {
      for (const k of [
        'SYSTEMROOT',
        'PATHEXT',
        'APPDATA',
        'LOCALAPPDATA',
        'USERPROFILE',
        'TEMP',
        'TMP',
      ]) {
        if (process.env[k]) baseEnv[k] = process.env[k];
      }
    }

    try {
      this.child = spawn(pythonExec, ['-u', scriptAbs, this.input], {
        cwd: cwdAbs,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: baseEnv,
        windowsHide: true,
      });
    } catch (err) {
      this.state = 'done';
      this._emit('error', { message: `spawn_failed: ${err.message}` });
      safeLog('error', 'scrapper_run_error', {
        runId: this.id,
        sessionId: this.sessionId,
        message: `spawn_failed: ${err.message}`,
      });
      this._finish('error', -1, null);
      return;
    }

    this.state = 'running';

    safeLog('info', 'scrapper_run_start', {
      runId: this.id,
      sessionId: this.sessionId,
      input: this.input.slice(0, MAX_LOG_INPUT),
      pid: this.child.pid,
    });

    this._wireStdout();
    this._wireStderr();
    this._wireClose();
    this._wireError();

    // Timeout global (D7)
    if (timeoutSeconds > 0) {
      this.timer = setTimeout(() => {
        if (this.finished) return;
        this._emit('error', { message: `timeout après ${timeoutSeconds}s` });
        this.kill('timeout');
      }, timeoutSeconds * 1000);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }

    // Heartbeat SSE (D17)
    this.heartbeat = setInterval(() => {
      if (!this.res || this.res.writableEnded) return;
      try {
        this.res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_MS);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
  }

  _wireStdout() {
    if (!this.child || !this.child.stdout) return;

    const rl = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (raw) => {
      if (raw.length === 0) return;

      const line =
        raw.length > MAX_LINE ? raw.slice(0, MAX_LINE) + '…' : raw;

      // Tentative de marqueur PROGRESS
      let m;
      if ((m = RE_PROGRESS_ATTEMPT.exec(line))) {
        const phase = Number(m[1]);
        const progress = Number(m[2]);
        if (phase >= 1 && phase <= 3 && progress >= 0 && progress <= 100) {
          this.lastPhase = phase;
          this._emit('phase', { phase, progress });
        } else {
          safeLog('warn', 'scrapper_bad_marker', {
            runId: this.id,
            phase,
            progress,
            line: line.slice(0, MAX_LINE),
          });
        }
        return;
      }

      // Tentative de marqueur ERROR
      if ((m = RE_ERROR_ATTEMPT.exec(line))) {
        const phase = Number(m[1]);
        if (phase >= 1 && phase <= 3) {
          this.anyError = true;
          this.lastPhase = phase;
          this._emit('phase', { phase, status: 'error' });
        } else {
          safeLog('warn', 'scrapper_bad_marker', {
            runId: this.id,
            phase,
            line: line.slice(0, MAX_LINE),
          });
        }
        return;
      }

      // Log classique
      this._emit('log', { line });
    });
  }

  _wireStderr() {
    if (!this.child || !this.child.stderr) return;

    const rl = readline.createInterface({
      input: this.child.stderr,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (line.length === 0) return;
      const trimmed =
        line.length > MAX_LINE ? line.slice(0, MAX_LINE) + '…' : line;
      this._emit('stderr', { line: trimmed });
    });
  }

  _wireClose() {
    if (!this.child) return;

    this.child.on('close', (code, signal) => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }

      if (this.finished) return;

      // Kill demandé par l'extérieur : on respecte la raison
      if (this.state === 'killed') {
        this._finish(this.killReason || 'killed', code ?? -1, signal);
        return;
      }

      // D18 : exit ≠ 0 sans marqueur d'erreur explicite
      if (code !== 0 && !this.anyError) {
        this._emit('phase', { phase: this.lastPhase, status: 'error' });
      }

      const reason = code === 0 ? 'ok' : 'error';
      this._finish(reason, code ?? -1, signal);
    });
  }

  _wireError() {
    if (!this.child) return;

    this.child.on('error', (err) => {
      this._emit('error', { message: `child_error: ${err.message}` });

      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }

      if (!this.finished) this._finish('error', -1, null);
    });
  }

  /**
   * Demande l'arrêt du run.
   *
   * D9 : pas de grâce — SIGTERM puis SIGKILL à +3 s.
   * `reason` sera normalisé dans `_finish()`.
   *
   * @param {string} [reason]
   */
  kill(reason = 'killed') {
    if (this.finished) return;
    this.state = 'killed';
    this.killReason = reason;

    safeLog('info', 'scrapper_kill', {
      runId: this.id,
      sessionId: this.sessionId,
      reason,
    });

    if (this.child) {
      killTreeWithGrace(this.child, {
        graceMs: KILL_GRACE_MS,
        isFinished: () => this.finished,
      });
    } else {
      // Spawn a échoué avant : rien à tuer, on finalise tout de suite
      this._finish(this.killReason, -1, null);
    }
  }

  /**
   * Finalise le run : émet `end`, ferme le flux SSE, log, notifie
   * `onDone`. Idempotent.
   *
   * @param {string} rawReason
   * @param {number} exitCode
   * @param {string | null} [signal]
   */
  _finish(rawReason, exitCode, signal = null) {
    if (this.finished) return;
    this.finished = true;
    this.state = 'done';
    this.endedAt = Date.now();

    const durationMs = this.endedAt - this.startedAt;
    const reason = normalizeEndReason(this.killReason || rawReason);

    // D21 : end est toujours le dernier événement
    this._emit('end', { exitCode, durationMs, reason });

    try {
      if (this.res) this.res.end();
    } catch {
      /* ignore */
    }

    const level = reason === 'ok' ? 'info' : 'warn';
    safeLog(level, 'scrapper_run_end', {
      runId: this.id,
      sessionId: this.sessionId,
      exitCode,
      durationMs,
      reason,
      signal: signal || null,
    });

    if (typeof this.onDone === 'function') {
      try {
        this.onDone(this);
      } catch {
        /* ignore : le registry ne doit jamais crasher à cause d'un callback */
      }
    }
  }
}

module.exports = {
  Run,
  RE_PROGRESS_ATTEMPT,
  RE_ERROR_ATTEMPT,
  MAX_LINE,
  END_REASONS,
  normalizeEndReason,
};