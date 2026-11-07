'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const {
  Run,
  RE_PROGRESS_ATTEMPT,
  RE_ERROR_ATTEMPT,
  normalizeEndReason,
  isPythonExecutable,
  END_REASONS,
} = require('../../src/scrapper/runner');
const { killTree, killTreeWithGrace } = require('../../src/scrapper/killTree');
const registry = require('../../src/scrapper/registry');

const FAKE_SCRAPPER = path.resolve(
  __dirname, '..', 'fixtures', 'fake_scrapper.js'
);

// V1.6 : Run exige `dest` au constructeur. On utilise un chemin stable
// en tmpdir. Le fake_scrapper n'écrit rien, l'existence n'est pas requise.
const FAKE_DEST = path.join(os.tmpdir(), 'mpv2-unit-test-dest');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeRes() {
  const frames = [];
  const listeners = {};
  const res = {
    writableEnded: false,
    write(chunk) {
      frames.push(String(chunk));
      return true;
    },
    end() {
      this.writableEnded = true;
      if (listeners.close) listeners.close.forEach((fn) => fn());
    },
    on(evt, fn) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    once(evt, fn) {
      const wrapper = (...args) => {
        const i = listeners[evt].indexOf(wrapper);
        if (i >= 0) listeners[evt].splice(i, 1);
        fn(...args);
      };
      this.on(evt, wrapper);
    },
    _frames: frames,
  };
  return res;
}

function parseFrames(frames) {
  const out = [];
  for (const raw of frames) {
    const blocks = raw.split('\n\n').filter(Boolean);
    for (const block of blocks) {
      let evt = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length === 0) continue;
      try {
        out.push({ event: evt, data: JSON.parse(data.join('\n')) });
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

function makeRun(input, dest = FAKE_DEST) {
  return new Run({
    input,
    sessionId: 'test-session',
    cfg: {
      script_path: FAKE_SCRAPPER,
      python_executable: process.execPath,
      cwd: path.dirname(FAKE_SCRAPPER),
      timeout_seconds: 20,
      max_concurrent_per_session: 1,
      max_concurrent_global: 3,
      allowed_roles: ['admin'],
      rate_limit: { windowMinutes: 5, maxAttempts: 10 },
      create_dest_if_missing: true,
    },
    dest,
    seriesDest: 'onepiece',
    folderDest: 'comics',
  });
}

// ---------------------------------------------------------------------------
// Regex de détection des marqueurs
// ---------------------------------------------------------------------------

test('RE_PROGRESS_ATTEMPT : capte les marqueurs valides', () => {
  const cases = [
    '[PHASE:1, PROGRESS:0]',
    '[PHASE:1,PROGRESS:50]',
    '[PHASE:3, PROGRESS:100]',
    '  [PHASE:2, PROGRESS:75]  ',
  ];
  for (const line of cases) {
    assert.ok(RE_PROGRESS_ATTEMPT.test(line), `devrait matcher: ${line}`);
  }
});

test('RE_PROGRESS_ATTEMPT : capte aussi les tentatives malformées', () => {
  const cases = [
    '[PHASE:4, PROGRESS:50]',
    '[PHASE:1, PROGRESS:999]',
    '[PHASE:0, PROGRESS:10]',
  ];
  for (const line of cases) {
    assert.ok(RE_PROGRESS_ATTEMPT.test(line), `devrait matcher: ${line}`);
  }
});

test('RE_PROGRESS_ATTEMPT : ne matche pas un log classique', () => {
  const cases = [
    'Connexion au site',
    '[PHASE:1] échec',
    'PROGRESS:50',
    '[PHASE:1, PROGRESS:50] trailing',
  ];
  for (const line of cases) {
    assert.ok(!RE_PROGRESS_ATTEMPT.test(line), `ne devrait PAS matcher: ${line}`);
  }
});

test('RE_ERROR_ATTEMPT : capte [PHASE:X, ERROR]', () => {
  assert.ok(RE_ERROR_ATTEMPT.test('[PHASE:2, ERROR]'));
  assert.ok(RE_ERROR_ATTEMPT.test('[PHASE:2,ERROR]'));
  assert.ok(RE_ERROR_ATTEMPT.test('  [PHASE:3, ERROR]  '));
});

test('RE_ERROR_ATTEMPT : capte aussi les phases hors plage', () => {
  assert.ok(RE_ERROR_ATTEMPT.test('[PHASE:4, ERROR]'));
});

// ---------------------------------------------------------------------------
// normalizeEndReason
// ---------------------------------------------------------------------------

test('normalizeEndReason : mappe les alias', () => {
  assert.equal(normalizeEndReason('ok'), 'ok');
  assert.equal(normalizeEndReason('timeout'), 'timeout');
  assert.equal(normalizeEndReason('error'), 'error');
  assert.equal(normalizeEndReason('client_disconnected'), 'disconnected');
  assert.equal(normalizeEndReason('shutdown'), 'killed');
  assert.equal(normalizeEndReason('unknown'), 'killed');
  assert.equal(normalizeEndReason(null), 'error');
});

test('END_REASONS : contient les 5 valeurs du protocole', () => {
  for (const r of ['ok', 'error', 'timeout', 'killed', 'disconnected']) {
    assert.ok(END_REASONS.has(r));
  }
});

// ---------------------------------------------------------------------------
// Run — constructeur V1.6
// ---------------------------------------------------------------------------

test('Run : dest manquant → throw (V1.6)', () => {
  assert.throws(
    () => {
      new Run({
        input: 'ok',
        sessionId: 's',
        cfg: {
          script_path: FAKE_SCRAPPER,
          python_executable: process.execPath,
        },
      });
    },
    /dest est requis/,
  );
});

test('Run : dest bien propagé dans le meta SSE (V1.6)', async () => {
  const run = makeRun('ok', '/tmp/mpv2-dest-check');
  const fakeRes = makeFakeRes();
  run.attach(fakeRes);
  const done = new Promise((resolve) => { run.onDone = resolve; });
  run.start();
  await done;

  const frames = parseFrames(fakeRes._frames);
  assert.equal(frames[0].event, 'meta');
  assert.equal(frames[0].data.dest, '/tmp/mpv2-dest-check');
  assert.equal(frames[0].data.seriesDest, 'onepiece');
  assert.equal(frames[0].data.folderDest, 'comics');
});

// ---------------------------------------------------------------------------
// Run — scénarios réels avec fake_scrapper.js
// ---------------------------------------------------------------------------

test('Run : succès complet (input="ok") → 3 phases, end raison "ok"', async () => {
  const run = makeRun('ok');
  const fakeRes = makeFakeRes();
  run.attach(fakeRes);

  const done = new Promise((resolve) => { run.onDone = resolve; });
  run.start();
  await done;

  const frames = parseFrames(fakeRes._frames);

  assert.equal(frames[0].event, 'meta');
  assert.equal(frames[0].data.input, 'ok');

  assert.ok(
    frames.some((f) => f.event === 'log' && /Connexion au site/.test(f.data.line)),
  );

  for (const phase of [1, 2, 3]) {
    const has100 = frames.some(
      (f) => f.event === 'phase' && f.data.phase === phase && f.data.progress === 100,
    );
    assert.ok(has100, `phase ${phase} devrait atteindre 100`);
  }

  const endFrame = frames[frames.length - 1];
  assert.equal(endFrame.event, 'end');
  assert.equal(endFrame.data.reason, 'ok');
  assert.equal(endFrame.data.exitCode, 0);
});

test('Run : échec phase 2 → phase 2 en erreur, end "error"', async () => {
  const run = makeRun('fail-phase-2');
  const fakeRes = makeFakeRes();
  run.attach(fakeRes);

  const done = new Promise((resolve) => { run.onDone = resolve; });
  run.start();
  await done;

  const frames = parseFrames(fakeRes._frames);

  const phaseErr = frames.find(
    (f) => f.event === 'phase' && f.data.phase === 2 && f.data.status === 'error',
  );
  assert.ok(phaseErr, 'phase 2 devrait être marquée en erreur');

  const stderr = frames.find(
    (f) => f.event === 'stderr' && /Simulated phase 2 failure/.test(f.data.line),
  );
  assert.ok(stderr);

  const endFrame = frames[frames.length - 1];
  assert.equal(endFrame.event, 'end');
  assert.equal(endFrame.data.reason, 'error');
  assert.equal(endFrame.data.exitCode, 1);
});

test('Run : crash sans marqueur (input="crash") → D18, phase 1 en erreur', async () => {
  const run = makeRun('crash');
  const fakeRes = makeFakeRes();
  run.attach(fakeRes);

  const done = new Promise((resolve) => { run.onDone = resolve; });
  run.start();
  await done;

  const frames = parseFrames(fakeRes._frames);

  const phaseErr = frames.find(
    (f) => f.event === 'phase' && f.data.phase === 1 && f.data.status === 'error',
  );
  assert.ok(phaseErr, 'D18 : phase 1 devrait être marquée en erreur');

  const endFrame = frames[frames.length - 1];
  assert.equal(endFrame.event, 'end');
  assert.equal(endFrame.data.reason, 'error');
});

test('Run : kill() → end raison "killed"', async () => {
  const run = makeRun('long');
  const fakeRes = makeFakeRes();
  run.attach(fakeRes);

  const done = new Promise((resolve) => { run.onDone = resolve; });
  run.start();

  await new Promise((r) => setTimeout(r, 200));

  run.kill('shutdown');
  await done;

  const frames = parseFrames(fakeRes._frames);
  const endFrame = frames[frames.length - 1];
  assert.equal(endFrame.event, 'end');
  assert.equal(endFrame.data.reason, 'killed');
});

test('Run : timeout court → end raison "timeout"', async () => {
  const run = new Run({
    input: 'long',
    sessionId: 'test-timeout',
    cfg: {
      script_path: FAKE_SCRAPPER,
      python_executable: process.execPath,
      cwd: path.dirname(FAKE_SCRAPPER),
      timeout_seconds: 10,
      max_concurrent_per_session: 1,
      max_concurrent_global: 3,
      allowed_roles: ['admin'],
      rate_limit: { windowMinutes: 5, maxAttempts: 10 },
      create_dest_if_missing: true,
    },
    dest: FAKE_DEST,
    seriesDest: 'onepiece',
    folderDest: 'comics',
  });
  run.cfg.timeout_seconds = 1;

  const fakeRes = makeFakeRes();
  run.attach(fakeRes);

  const done = new Promise((resolve) => { run.onDone = resolve; });
  run.start();
  await done;

  const frames = parseFrames(fakeRes._frames);
  const endFrame = frames[frames.length - 1];
  assert.equal(endFrame.event, 'end');
  assert.equal(endFrame.data.reason, 'timeout');
});

// ---------------------------------------------------------------------------
// killTree
// ---------------------------------------------------------------------------

test('killTree : no-op sur un process déjà terminé', () => {
  const fake = { pid: 99999, exitCode: 0, signalCode: null };
  assert.equal(killTree(fake, 'SIGTERM'), false);
});

test('killTree : no-op sur un objet null', () => {
  assert.equal(killTree(null, 'SIGTERM'), false);
  assert.equal(killTree(undefined, 'SIGTERM'), false);
});

test('killTreeWithGrace : ne throw pas sur un process déjà mort', () => {
  assert.doesNotThrow(() => {
    killTreeWithGrace({ pid: 99999, exitCode: 0, signalCode: null }, { graceMs: 10 });
  });
});

test('killTree : tue un vrai process Node', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });

  await new Promise((r) => setTimeout(r, 100));
  assert.ok(child.pid);

  killTree(child, 'SIGTERM');

  const killed = await new Promise((resolve) => {
    const to = setTimeout(() => resolve(false), 3000);
    child.on('exit', () => { clearTimeout(to); resolve(true); });
  });

  assert.ok(killed, 'le process aurait dû être tué');
});

// ---------------------------------------------------------------------------
// registry (isolé)
// ---------------------------------------------------------------------------

test('registry : __resetForTests + stats', () => {
  registry.__resetForTests();
  assert.equal(registry.total(), 0);
  assert.equal(registry.countForSession('x'), 0);
  const stats = registry.stats();
  assert.deepEqual(stats.runIds, []);
});

test('registry : create transmet dest/seriesDest/folderDest à la factory', () => {
  registry.__resetForTests();

  let captured = null;
  registry.setRunnerFactory((args) => {
    captured = args;
    let onDone = null;
    return {
      id: 'fake-' + args.input,
      input: args.input,
      finished: false,
      start() {},
      kill() {},
      get onDone() { return onDone; },
      set onDone(fn) { onDone = fn; },
    };
  });

  registry.create({
    input: 'x',
    sessionId: 's1',
    cfg: {},
    dest: '/media/onepiece/comics',
    seriesDest: 'onepiece',
    folderDest: 'comics',
  });

  assert.ok(captured, 'la factory doit être appelée');
  assert.equal(captured.dest, '/media/onepiece/comics');
  assert.equal(captured.seriesDest, 'onepiece');
  assert.equal(captured.folderDest, 'comics');

  registry.__resetForTests();
});

// ---------------------------------------------------------------------------
// isPythonExecutable
// ---------------------------------------------------------------------------

test('isPythonExecutable : détecte les binaires Python', () => {
  assert.ok(isPythonExecutable('python3'));
  assert.ok(isPythonExecutable('python'));
  assert.ok(isPythonExecutable('/usr/bin/python3.11'));
  assert.ok(isPythonExecutable('C:\\Python311\\python.exe'));
  assert.ok(isPythonExecutable('py'));
  assert.ok(isPythonExecutable('py.exe'));
});

test('isPythonExecutable : rejette les non-Python (node, etc.)', () => {
  assert.equal(isPythonExecutable(process.execPath), false);
  assert.equal(isPythonExecutable('/usr/bin/node'), false);
  assert.equal(isPythonExecutable('C:\\Program Files\\nodejs\\node.exe'), false);
  assert.equal(isPythonExecutable('sh'), false);
  assert.equal(isPythonExecutable(''), false);
  assert.equal(isPythonExecutable(null), false);
});

test('Run avec exécutable Node : ne reçoit PAS de flag -u (régression Lot 8)', async () => {
  const run = makeRun('ok');
  const fakeRes = makeFakeRes();
  run.attach(fakeRes);

  const done = new Promise((resolve) => { run.onDone = resolve; });
  run.start();
  await done;

  const frames = parseFrames(fakeRes._frames);
  const end = frames[frames.length - 1];

  assert.equal(end.data.reason, 'ok');
  assert.equal(end.data.exitCode, 0);

  assert.ok(
    frames.some((f) => f.event === 'log' && /Connexion au site/.test(f.data.line)),
    'le log de démarrage devrait être présent (pas de crash silencieux)',
  );
});