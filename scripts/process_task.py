#!/usr/bin/env python3
"""
Point d'entrée Scrapper — media-player-v2 V1.5 → V1.6.

⚠️ CE FICHIER EST UN SQUELETTE. Remplace les fonctions `do_phase_*`
   par des appels à TON script existant.

Arguments reçus du serveur Node.js (V1.6) :
    sys.argv[1] = input (URL/texte saisi par l'utilisateur)
    sys.argv[2] = dossier de destination absolu
                  (ex: /media/naruto/comics)

Le dossier de destination est déjà créé par le serveur Node.js
(cf. config `python_module.create_dest_if_missing`). Ton script
n'a plus qu'à y écrire les fichiers scrapés.

Trois façons d'intégrer ton code existant :

  ─── OPTION A (recommandé) : import direct ────────────────────────────
  Si ton script expose une fonction réutilisable :

      from mon_script import run_scraping
      def do_phase_1_scrapping(url, dest):
          return run_scraping(url, dest)   # → True/False

  ─── OPTION B : subprocess (si ton script est monolithique) ────────────
      import subprocess, sys
      def do_phase_1_scrapping(url, dest):
          r = subprocess.run(
              [sys.executable, "/chemin/vers/mon_script.py", url, str(dest)],
              capture_output=True, text=True,
          )
          for line in r.stdout.splitlines():
              log_msg(line)
          return r.returncode == 0

  ─── OPTION C : copier les helpers dans ton script existant ────────────
  Colle le contenu de scrapper_protocol.py dans ton script, utilise
  directement les fonctions, et déclare ton script existant comme
  `script_path` dans config.json. Pas de process_task.py du tout.
"""

import sys

from scrapper_protocol import (
    log_msg,
    phase_progress,
    phase_error,
    get_input,
    get_destination_folder,
    ensure_destination,
)


# ---------------------------------------------------------------------------
# À REMPLACER : ta logique métier
# ---------------------------------------------------------------------------

def do_phase_1_scrapping(url: str, dest) -> bool:
    """Phase 1 : scrapping. Retourne True si OK, False si échec."""
    try:
        log_msg(f"Scrapping {url} → {dest}")
        for pct in range(0, 101, 20):
            log_msg(f"Scrapping {url} … {pct}%")
            phase_progress(1, pct)
        return True
    except Exception as exc:
        print(f"Erreur scrapping : {exc}", file=sys.stderr, flush=True)
        phase_error(1)
        return False


def do_phase_2_traduction(url: str, dest) -> bool:
    """Phase 2 : traduction. Retourne True si OK, False si échec."""
    try:
        for pct in range(0, 101, 25):
            log_msg(f"Traduction … {pct}%")
            phase_progress(2, pct)
        return True
    except Exception as exc:
        print(f"Erreur traduction : {exc}", file=sys.stderr, flush=True)
        phase_error(2)
        return False


def do_phase_3_copie(url: str, dest) -> bool:
    """Phase 3 : copie. Retourne True si OK, False si échec."""
    try:
        for pct in range(0, 101, 33):
            log_msg(f"Copie vers {dest} … {pct}%")
            phase_progress(3, pct)
        return True
    except Exception as exc:
        print(f"Erreur copie : {exc}", file=sys.stderr, flush=True)
        phase_error(3)
        return False


# ---------------------------------------------------------------------------
# Orchestration (ne pas modifier sauf besoin spécifique)
# ---------------------------------------------------------------------------

def main() -> int:
    url = get_input()
    dest = get_destination_folder()
    ensure_destination(dest)

    log_msg(f"Démarrage : {url}")
    log_msg(f"Destination : {dest}")

    if not do_phase_1_scrapping(url, dest):
        return 1
    if not do_phase_2_traduction(url, dest):
        return 1
    if not do_phase_3_copie(url, dest):
        return 1

    log_msg("Terminé.")
    return 0


if __name__ == "__main__":
    sys.exit(main())