#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""convert_to_jxl.py — Convertit récursivement des images en JPEG XL.

V1.6.3 — support Windows : contournement des PermissionError sur %TEMP%
         (verrou antivirus / Accès contrôlé aux dossiers).
         - Nouvelle fonction mkstemp_retry() avec backoff
         - Nouvelle option --temp-dir pour rediriger %TEMP%
         - run_djxl_verify() n'utilise plus NamedTemporaryFile (bug Windows)

V1.6.2 — correctif JPEG : force --lossless_jpeg=0 sur les entrées JPEG
         pour permettre la conversion avec -d X.

V1.6.1 — GIFs animés convertis par défaut (désactivable via --no-gif).

Usage :
    python tools/convert_to_jxl.py <dossier> [options]

Options principales :
    --temp-dir PATH    Répertoire temporaire à utiliser (défaut : système).
                       Utile si %TEMP% est verrouillé par un antivirus.
    --no-gif           Ignore les .gif (défaut : conversion en .jxl animé)
    --dry-run          Simule sans rien modifier
    --keep-source      Ne supprime pas les sources après conversion
    --overwrite        Écrase les .jxl existants (défaut : skip + warning)
    --verify           Décode le .jxl avec djxl avant suppression de la source
    --lossless         Encode sans perte (PNG/GIF/etc. → -d 0 ; JPEG → -d 1.0)
    --distance FLOAT   cjxl -d (défaut 1.0 = visuellement lossless)
    --effort INT       cjxl -e (1-10, défaut 7)
    --jobs INT         Parallélisme (0 = auto = nb CPU)
    --skip-dir NAME    Dossier à ignorer (répétable)
    -y, --yes          Ne demande pas confirmation avant démarrage

Dépendances :
    - cjxl (libjxl)   → https://github.com/libjxl/libjxl/releases
      Windows : extraire cjxl.exe dans un dossier du PATH
      macOS   : brew install jpeg-xl
      Linux   : apt install libjxl-tools
    - djxl (libjxl)   → même package, requis seulement si --verify
    - Pillow          → pip install Pillow  (requis pour webp/avif/bmp/tiff)

Windows — dépannage Permission denied sur %TEMP% :
    1. Réessayer avec --temp-dir C:\\TempJXL
    2. Ajouter une exclusion Windows Defender pour %TEMP% ou C:\\TempJXL
    3. Autoriser python.exe et cjxl.exe dans l'Accès contrôlé aux dossiers

Comportement de --lossless selon le format d'entrée :
    .png .webp .gif .bmp .tif .tiff → cjxl -d 0 (lossless pixel natif)
    .jpg .jpeg                      → cjxl --lossless_jpeg=0 -d 1.0
                                      (visuellement lossless + compressé)

Nommage des fichiers de sortie :
    ⚠️  Le stem (nom sans extension) est STRICTEMENT PRÉSERVÉ.
        Seule l'extension est changée : "my-comic-0001.gif" → "my-comic-0001.jxl".

Sécurité :
    - N'écrase JAMAIS un .jxl existant (sauf --overwrite)
    - Ne supprime la source QUE si cjxl a réussi
    - --verify décode le .jxl avec djxl avant suppression
    - Écriture atomique : pas de .jxl partiel si crash

Code retour :
    0 = tout OK
    1 = annulé par l'utilisateur
    2 = erreur de configuration (cjxl introuvable, chemin invalide)
    3 = au moins une conversion a échoué
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

# Pillow est optionnel : requis seulement pour webp/avif/bmp/tiff
try:
    from PIL import Image, ImageOps  # noqa: F401
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Extensions lues nativement par cjxl (aucun intermédiaire)
DIRECT_INPUT_EXTS = {'.png', '.jpg', '.jpeg'}

# Extensions nécessitant un décodage Pillow → PNG temp → cjxl
PIL_INPUT_EXTS = {'.webp', '.avif', '.bmp', '.tif', '.tiff'}

# Extensions à IGNORER TOUJOURS (indépendamment des options)
SKIP_EXTS_BASE = {
    '.mp4', '.webm',     # vidéos
    '.jxl',              # déjà au bon format
    '.jpe', '.jfif',     # ambigus → traités comme jpg si besoin, sinon skip
}

# GIF : converti par défaut (V1.6.1), désactivable via --no-gif
GIF_EXT = '.gif'

# Extensions JPEG (nécessitent --lossless_jpeg=0 explicite)
JPEG_EXTS = {'.jpg', '.jpeg'}

# Priorité A3 du projet (pour arbitrer un doublon de stem a.png + a.gif)
EXT_PRIORITY = [
    'avif', 'gif', 'jpeg', 'jpg', 'jxl', 'png', 'webp',
    'mp4', 'webm', 'bmp', 'tif', 'tiff',
]
EXT_PRIORITY_INDEX = {e: i for i, e in enumerate(EXT_PRIORITY)}

TARGET_EXT = '.jxl'


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    print(msg, flush=True)


def fmt_bytes(n: int) -> str:
    f = float(n)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if abs(f) < 1024.0:
            return f'{f:.1f} {unit}'
        f /= 1024.0
    return f'{f:.1f} TB'


def fmt_ratio(in_bytes: int, out_bytes: int) -> str:
    if out_bytes <= 0 or in_bytes <= 0:
        return '—'
    return f'{in_bytes / out_bytes:.2f}×'


def ext_priority(p: Path) -> int:
    ext = p.suffix.lower().lstrip('.')
    return EXT_PRIORITY_INDEX.get(ext, 999)


def mkstemp_retry(
    *args,
    retries: int = 5,
    backoff: float = 0.15,
    **kwargs,
):
    """Encapsule tempfile.mkstemp avec une boucle de réessai.

    Sur Windows, un antivirus (Windows Defender, tiers) ou l'Accès
    contrôlé aux dossiers peut ouvrir brièvement le fichier juste après
    sa création pour l'analyser, provoquant un PermissionError (EACCES)
    transitoire. Une boucle avec backoff suffit à contourner le
    verrouillage dans la grande majorité des cas.

    Utilise tempfile.tempdir par défaut (cf. --temp-dir qui le définit).
    """
    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            return tempfile.mkstemp(*args, **kwargs)
        except PermissionError as e:
            last_err = e
            if attempt < retries:
                time.sleep(backoff)
    raise RuntimeError(
        f'mkstemp a échoué après {retries} tentatives ({last_err}). '
        "Vérifie que le dossier temporaire n'est pas verrouillé par un "
        'antivirus ou l\'Accès contrôlé aux dossiers. '
        'Essaie --temp-dir <chemin accessible en écriture>.'
    ) from last_err


# ---------------------------------------------------------------------------
# Découverte
# ---------------------------------------------------------------------------

def iter_candidate_files(
    root: Path,
    skip_dirs: set[str],
    include_gif: bool,
) -> Iterable[Path]:
    """Yield tous les fichiers candidats (formats supportés)."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith('.') and d not in skip_dirs
        ]
        for name in filenames:
            if name.startswith('.'):
                continue
            ext = Path(name).suffix.lower()
            if ext in SKIP_EXTS_BASE:
                continue
            if ext == GIF_EXT and not include_gif:
                continue
            if ext in DIRECT_INPUT_EXTS or ext in PIL_INPUT_EXTS or ext == GIF_EXT:
                yield Path(dirpath) / name


def group_by_stem(files: list[Path]) -> tuple[list[Path], list[tuple[Path, str]]]:
    """Regroupe les fichiers par stem, arbitre les doublons via A3."""
    by_stem: dict[Path, list[Path]] = defaultdict(list)
    for f in files:
        by_stem[f.with_suffix('')].append(f)

    to_process: list[Path] = []
    skipped: list[tuple[Path, str]] = []
    for stem, group in by_stem.items():
        if len(group) == 1:
            to_process.append(group[0])
        else:
            group.sort(key=ext_priority)
            winner = group[0]
            to_process.append(winner)
            for loser in group[1:]:
                skipped.append((
                    loser,
                    f'doublon de stem : "{winner.name}" gagne (A3)',
                ))
    return to_process, skipped


# ---------------------------------------------------------------------------
# Détection de cjxl / djxl
# ---------------------------------------------------------------------------

def find_cjxl() -> str:
    path = shutil.which('cjxl')
    if not path:
        log('❌ cjxl introuvable dans le PATH.')
        log('   Windows : https://github.com/libjxl/libjxl/releases')
        log('   macOS   : brew install jpeg-xl')
        log('   Linux   : apt install libjxl-tools')
        sys.exit(2)
    return path


def find_djxl() -> Optional[str]:
    return shutil.which('djxl')


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

def run_cjxl(
    cjxl: str,
    input_path: str,
    output_path: str,
    distance: float,
    effort: int,
    lossless: bool,
    is_animation: bool,
) -> None:
    """Exécute cjxl. Lève RuntimeError en cas d'échec.

    V1.6.2 — Gestion JPEG :
        cjxl active --lossless_jpeg=1 PAR DÉFAUT sur les JPEG (transfert
        bit-exact, incompatible avec -d X > 0). On force --lossless_jpeg=0
        pour permettre le ré-encodage avec la qualité demandée.
    """
    input_ext = Path(input_path).suffix.lower()
    is_jpeg = input_ext in JPEG_EXTS

    args = [cjxl, '-e', str(effort)]

    if is_jpeg:
        args.append('--lossless_jpeg=0')
        if lossless:
            # Pixel-lossless n'a aucun sens sur du JPEG (déjà lossy).
            args.extend(['-d', '1.0'])
        else:
            args.extend(['-d', str(distance)])
    else:
        if lossless:
            args.extend(['-d', '0'])
        else:
            args.extend(['-d', str(distance)])

    if is_animation:
        args.append('--container=1')

    args.extend([input_path, output_path])

    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or '').strip()
        raise RuntimeError(f'cjxl exit {proc.returncode}: {detail}')


def run_djxl_verify(djxl: str, jxl_path: str) -> None:
    """Décode le .jxl avec djxl pour vérifier qu'il est lisible.

    V1.6.3 — Remplace NamedTemporaryFile par mkstemp_retry + cleanup
    manuel. NamedTemporaryFile utilisait %TEMP% par défaut, ce qui
    provoquait des PermissionError sous Windows quand l'antivirus
    verrouillait le dossier. mkstemp_retry respecte --temp-dir.
    """
    fd, tmp_name = mkstemp_retry(suffix='.png')
    os.close(fd)
    tmp_png = Path(tmp_name)
    try:
        proc = subprocess.run(
            [djxl, jxl_path, str(tmp_png)],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or '').strip()
            raise RuntimeError(f'djxl verify exit {proc.returncode}: {detail}')
    finally:
        try:
            tmp_png.unlink()
        except OSError:
            pass


def pil_to_png(src: Path, tmp_png: Path) -> None:
    """Décode src avec Pillow et écrit un PNG lossless à tmp_png."""
    if not _PIL_AVAILABLE:
        raise RuntimeError('Pillow requis (pip install Pillow)')
    with Image.open(src) as im:
        try:
            im = ImageOps.exif_transpose(im)
        except Exception:
            pass
        if im.mode in ('P', 'PA'):
            im = im.convert('RGBA')
        elif im.mode == 'CMYK':
            im = im.convert('RGB')
        im.save(tmp_png, format='PNG')


@dataclass
class ConvertResult:
    status: str            # 'converted' | 'skipped' | 'error'
    message: str
    bytes_in: int = 0
    bytes_out: int = 0
    is_animation: bool = False  # compteur du résumé uniquement


def convert_one(
    src: Path,
    cjxl: str,
    djxl: Optional[str],
    distance: float,
    effort: int,
    lossless: bool,
    keep_source: bool,
    dry_run: bool,
    overwrite_existing: bool,
    verify: bool,
    include_gif: bool,
) -> ConvertResult:
    """Convertit un fichier. Ne lève pas : retourne un ConvertResult.

    ⚠️ Le nom de sortie est TOUJOURS `src.with_suffix('.jxl')` — le stem
    est strictement préservé. Le format "%nom%-%page%.%ext%" requis par
    le scanner du site reste intact.
    """
    try:
        src_size = src.stat().st_size
    except OSError as e:
        return ConvertResult('error', f'{src.name}: stat échoué ({e})')

    target = src.with_suffix(TARGET_EXT)
    ext = src.suffix.lower()
    is_animation = (ext == GIF_EXT)

    if target.exists() and not overwrite_existing:
        return ConvertResult(
            'skipped',
            f'{src.name} → {target.name} existe déjà (skip)',
            src_size,
            is_animation=is_animation,
        )

    if ext == GIF_EXT and not include_gif:
        return ConvertResult(
            'skipped',
            f'{src.name} : .gif ignoré (utiliser --include-gif)',
            src_size,
            is_animation=True,
        )

    if dry_run:
        return ConvertResult(
            'converted',
            f'[dry-run] {src.name} → {target.name}',
            src_size,
            is_animation=is_animation,
        )

    tmp_out: Optional[Path] = None
    tmp_png: Optional[Path] = None
    try:
        # Étape 1 : produire une entrée cjxl-compatible
        if ext in DIRECT_INPUT_EXTS or ext == GIF_EXT:
            cjxl_input = str(src)
        elif ext in PIL_INPUT_EXTS:
            # tmp_png dans le dossier SOURCE (pas %TEMP%) → rename rapide
            # et immunisé contre les verrous antivirus sur %TEMP%.
            fd, tmp_png_name = mkstemp_retry(
                suffix='.png', prefix=src.stem + '_', dir=str(src.parent)
            )
            os.close(fd)
            tmp_png = Path(tmp_png_name)
            pil_to_png(src, tmp_png)
            cjxl_input = str(tmp_png)
        else:
            return ConvertResult(
                'skipped',
                f'{src.name} : extension {ext} non supportée en entrée',
                src_size,
            )

        # Étape 2 : encoder dans un .jxl.tmp (même dossier → rename atomique)
        fd, tmp_out_name = mkstemp_retry(
            suffix='.jxl.tmp', prefix=src.stem + '_', dir=str(src.parent)
        )
        os.close(fd)
        tmp_out = Path(tmp_out_name)

        run_cjxl(
            cjxl, cjxl_input, str(tmp_out),
            distance, effort, lossless, is_animation,
        )

        if not tmp_out.exists() or tmp_out.stat().st_size == 0:
            raise RuntimeError('cjxl a produit un fichier vide')

        # Étape 3 : vérification optionnelle avec djxl
        if verify and djxl:
            run_djxl_verify(djxl, str(tmp_out))

        # Étape 4 : rename atomique → target
        os.replace(tmp_out, target)
        tmp_out = None  # consommé

        out_size = target.stat().st_size

        # Étape 5 : suppression de la source (UNIQUEMENT après succès total)
        if not keep_source:
            try:
                src.unlink()
            except OSError as e:
                return ConvertResult(
                    'converted',
                    f'{src.name} → {target.name} OK MAIS source non '
                    f'supprimée : {e}',
                    src_size, out_size,
                    is_animation=is_animation,
                )

        return ConvertResult(
            'converted',
            f'{src.name} → {target.name} '
            f'({fmt_bytes(src_size)} → {fmt_bytes(out_size)})',
            src_size, out_size,
            is_animation=is_animation,
        )

    except Exception as e:
        return ConvertResult('error', f'{src.name}: {e}', src_size)
    finally:
        if tmp_out and tmp_out.exists():
            try:
                tmp_out.unlink()
            except OSError:
                pass
        if tmp_png and tmp_png.exists():
            try:
                tmp_png.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

@dataclass
class Stats:
    converted: int = 0
    animations: int = 0
    skipped: int = 0
    errors: int = 0
    bytes_in: int = 0
    bytes_out: int = 0
    error_details: list[tuple[str, str]] = field(default_factory=list)
    skip_details: list[tuple[str, str]] = field(default_factory=list)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        prog='convert_to_jxl.py',
        description='Convertit récursivement des images en .jxl et '
                    'supprime la source si la conversion réussit. '
                    'Les .gif animés sont convertis par défaut.',
    )
    p.add_argument('root', type=Path, help='Dossier racine (récursif)')
    p.add_argument('--temp-dir', type=Path, default=None,
                   help='Répertoire temporaire à utiliser (défaut : système). '
                        'Utile si %TEMP% est verrouillé par un antivirus '
                        '(Windows).')
    p.add_argument('--no-gif', action='store_true',
                   help='Ignore les .gif (par défaut ils sont convertis en '
                        '.jxl animé)')
    p.add_argument('--dry-run', action='store_true',
                   help='Simule sans rien modifier')
    p.add_argument('--keep-source', action='store_true',
                   help='Ne supprime PAS les sources après conversion')
    p.add_argument('--overwrite', action='store_true',
                   help='Écrase un .jxl existant (défaut : skip)')
    p.add_argument('--verify', action='store_true',
                   help='Décode le .jxl avec djxl avant suppression')
    p.add_argument('--lossless', action='store_true',
                   help='Encode sans perte (PNG/GIF/etc. → -d 0 ; '
                        'JPEG → -d 1.0, visuellement lossless)')
    p.add_argument('--distance', type=float, default=1.0,
                   help='cjxl -d (défaut 1.0 = visuellement lossless)')
    p.add_argument('--effort', type=int, default=7,
                   help='cjxl -e (1-10, défaut 7)')
    p.add_argument('--jobs', type=int, default=0,
                   help='Parallélisme (0 = auto = nb CPU)')
    p.add_argument('--skip-dir', action='append', default=[],
                   help='Dossier à ignorer (répétable)')
    p.add_argument('-y', '--yes', action='store_true',
                   help='Ne demande pas confirmation avant démarrage')

    args = p.parse_args(argv)

    # V1.6.1 — GIFs inclus par défaut ; --no-gif désactive
    include_gif = not args.no_gif

    root: Path = args.root.resolve()
    if not root.is_dir():
        log(f'❌ Pas un dossier : {root}')
        return 2

    # V1.6.3 — --temp-dir : redirige %TEMP% vers un dossier contrôlé
    if args.temp_dir is not None:
        try:
            args.temp_dir.mkdir(parents=True, exist_ok=True)
            tempfile.tempdir = str(args.temp_dir.resolve())
        except OSError as e:
            log(f'❌ Impossible de créer --temp-dir {args.temp_dir}: {e}')
            return 2

    cjxl = find_cjxl()
    djxl = find_djxl()
    if args.verify and not djxl:
        log('⚠️  --verify demandé mais djxl introuvable → vérification désactivée')

    if not _PIL_AVAILABLE:
        log('⚠️  Pillow introuvable → webp/avif/bmp/tiff seront skippés.')
        log('   Installe : pip install Pillow')

    # Découverte
    log(f'🔎 Scan de : {root}')
    files = list(iter_candidate_files(
        root, set(args.skip_dir), include_gif=include_gif
    ))
    if not files:
        log('ℹ️  Aucun fichier à convertir.')
        return 0

    to_process, skipped_dupes = group_by_stem(files)
    total_in = sum(f.stat().st_size for f in to_process)
    log(f'📦 {len(to_process)} fichier(s) à traiter, {fmt_bytes(total_in)} au total.')
    if skipped_dupes:
        log(f'⚠️  {len(skipped_dupes)} doublon(s) de stem détecté(s) :')
        for pth, why in skipped_dupes:
            log(f'    - {pth} : {why}')

    if not args.yes and not args.dry_run:
        log('')
        log('⚠️  Les fichiers SOURCES seront SUPPRIMÉS après conversion réussie.')
        try:
            ans = input('Continuer ? [y/N] ').strip().lower()
        except EOFError:
            ans = 'n'
        if ans not in ('y', 'yes', 'o', 'oui'):
            log('Annulé.')
            return 1

    jobs = args.jobs or max(1, os.cpu_count() or 1)
    log(f'⚙️  Parallélisme : {jobs} job(s)')
    if args.dry_run:
        log('🧪 DRY-RUN : aucune modification ne sera faite')
    if args.keep_source:
        log('💾 --keep-source : sources conservées')
    if args.verify:
        log('🔬 --verify : chaque .jxl décodé par djxl avant suppression')
    if args.temp_dir is not None:
        log(f'📂 --temp-dir : {tempfile.tempdir}')

    if args.lossless:
        log('🧬 --lossless :')
        log('     PNG/WebP/GIF/BMP/TIFF → -d 0 (lossless pixel)')
        log('     JPEG                   → --lossless_jpeg=0 -d 1.0 '
            '(visuellement lossless, compresse)')
    else:
        log(f'🎨 cjxl -d {args.distance} -e {args.effort}')
        log('     JPEG → --lossless_jpeg=0 explicite (compatibilité -d)')

    if include_gif:
        log('🎞️  GIF animés : inclus (cjxl --container=1) ; désactivable '
            'via --no-gif')
    else:
        log('🎞️  GIF animés : ignorés (--no-gif)')
    log('')

    stats = Stats()
    started = time.time()
    counter_lock = threading.Lock()
    done = [0]

    def worker(src: Path) -> tuple[Path, ConvertResult]:
        return src, convert_one(
            src, cjxl, djxl,
            distance=args.distance,
            effort=args.effort,
            lossless=args.lossless,
            keep_source=args.keep_source,
            dry_run=args.dry_run,
            overwrite_existing=args.overwrite,
            verify=args.verify,
            include_gif=include_gif,
        )

    for pth, why in skipped_dupes:
        stats.skipped += 1
        stats.skip_details.append((str(pth), why))

    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(worker, f) for f in to_process]
        for fut in concurrent.futures.as_completed(futures):
            src, res = fut.result()
            with counter_lock:
                done[0] += 1
                progress = f'[{done[0]}/{len(to_process)}]'

            if res.status == 'converted':
                stats.converted += 1
                if res.is_animation:
                    stats.animations += 1
                stats.bytes_in += res.bytes_in
                stats.bytes_out += res.bytes_out
                log(f'{progress} ✅ {res.message}')
            elif res.status == 'skipped':
                stats.skipped += 1
                stats.skip_details.append((str(src), res.message))
                log(f'{progress} ⏭️  {res.message}')
            else:
                stats.errors += 1
                stats.error_details.append((str(src), res.message))
                log(f'{progress} ❌ {res.message}')

    elapsed = time.time() - started

    log('')
    log('─' * 64)
    log('Résumé')
    log('─' * 64)
    log(f'  ✅ Convertis : {stats.converted}')
    if stats.animations > 0:
        log(f'     dont GIF animés : {stats.animations}')
    log(f'  ⏭️  Ignorés   : {stats.skipped}')
    log(f'  ❌ Erreurs   : {stats.errors}')
    if stats.bytes_in > 0 and stats.bytes_out > 0:
        log(f'  📉 Octets    : {fmt_bytes(stats.bytes_in)} → '
            f'{fmt_bytes(stats.bytes_out)} '
            f'({fmt_ratio(stats.bytes_in, stats.bytes_out)})')
    log(f'  ⏱️  Durée     : {elapsed:.1f}s')

    if stats.error_details:
        log('')
        log('Erreurs détaillées :')
        for path, msg in stats.error_details:
            log(f'  - {path} : {msg}')

    if stats.skip_details and not args.dry_run:
        log('')
        log(f'Détails des skips (10 premiers sur {len(stats.skip_details)}) :')
        for path, msg in stats.skip_details[:10]:
            log(f'  - {path} : {msg}')
        if len(stats.skip_details) > 10:
            log(f'  … et {len(stats.skip_details) - 10} autres.')

    return 0 if stats.errors == 0 else 3


def lunch()->int:
    return main(sys.argv[1:])
if __name__ == '__main__':
    sys.exit(lunch())