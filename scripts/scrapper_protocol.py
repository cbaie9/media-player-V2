"""
Protocole de communication Scrapper ↔ Node.js (media-player-v2 V1.5 → V1.6).

Ce module NE contient AUCUNE logique métier. Il expose 4 helpers que
le script Python doit utiliser pour parler à l'interface web :

    log_msg("Connexion au site...")
        → affiché tel quel dans la console noire de l'UI

    phase_progress(1, 50)
        → "[PHASE:1, PROGRESS:50]" → la phase 1 passe à 50 %

    phase_error(2)
        → "[PHASE:2, ERROR]" → la phase 2 devient rouge

    get_destination_folder()   (V1.6)
        → Path absolu du dossier de destination (argv[2])

Règles de conformité au CDC V1.5 (§5.3) / V1.6 (§2.4) :
  - Chaque marqueur DOIT tenir sur UNE SEULE ligne
  - Chaque marqueur DOIT être flush (sinon le streaming SSE est retardé)
  - Les phases valides sont 1, 2, 3 (hors plage = ligne ignorée)
  - Les progress valides sont 0..100 (hors plage = ligne ignorée)
  - Toute autre sortie stdout = log classique
  - stderr = affiché en rouge dans la console (erreurs)
  - exit code 0 = succès, ≠ 0 = échec (la phase courante devient rouge
    si aucun marqueur d'erreur explicite n'a été émis)

Arguments reçus du serveur Node.js (V1.6) :
    sys.argv[1] = input (URL/texte saisi par l'utilisateur)
    sys.argv[2] = dossier de destination absolu

⚠️ NE PAS utiliser argparse : l'input est passé en argv[1] et peut
commencer par "-" (ex: "-1"). argparse le confondrait avec une option.
Lire sys.argv directement.
"""

import sys
from pathlib import Path


def _emit(line: str) -> None:
    """Écrit une ligne sur stdout avec flush immédiat."""
    print(line, flush=True)


def log_msg(text: str) -> None:
    """Affiche un log classique dans la console de l'UI."""
    _emit(str(text))


def phase_progress(phase: int, progress: int) -> None:
    """
    Met à jour la barre de progression d'une phase.

    :param phase: 1, 2 ou 3
    :param progress: 0 à 100
    :raises ValueError: si les valeurs sont hors plage
    """
    phase = int(phase)
    progress = int(progress)
    if phase not in (1, 2, 3):
        raise ValueError(f"phase invalide : {phase} (attendu 1, 2 ou 3)")
    if not (0 <= progress <= 100):
        raise ValueError(f"progress invalide : {progress} (attendu 0..100)")
    _emit(f"[PHASE:{phase}, PROGRESS:{progress}]")


def phase_error(phase: int) -> None:
    """
    Marque une phase comme échouée (elle devient rouge dans l'UI).

    :param phase: 1, 2 ou 3
    :raises ValueError: si la phase est hors plage
    """
    phase = int(phase)
    if phase not in (1, 2, 3):
        raise ValueError(f"phase invalide : {phase} (attendu 1, 2 ou 3)")
    _emit(f"[PHASE:{phase}, ERROR]")


def get_input() -> str:
    """
    Récupère l'input passé en argv[1] (URL ou texte saisi par
    l'utilisateur dans le champ INPUT).

    :returns: l'input, tel quel
    :raises SystemExit: si argv[1] est manquant (exit code 2)
    """
    if len(sys.argv) < 2:
        print("Argument manquant : input attendu en argv[1]",
              file=sys.stderr, flush=True)
        sys.exit(2)
    return sys.argv[1]


def get_destination_folder(argv=None) -> Path:
    """
    Récupère le dossier de destination passé en argv[2] et le résout
    en chemin absolu.

    V1.6 : le serveur Node.js construit le chemin à partir de
    ROOT_DIR/{series}/{folder} après validation, il est donc déjà
    absolu et sûr. Ce helper ne fait que le normaliser.

    :param argv: optionnel, tableau argv (défaut: sys.argv)
    :returns: Path absolu vers le dossier de destination
    :raises SystemExit: si argv[2] est manquant (exit code 2)
    """
    if argv is None:
        argv = sys.argv
    if len(argv) < 3:
        print("Argument manquant : dossier de destination attendu en argv[2]",
              file=sys.stderr, flush=True)
        sys.exit(2)
    return Path(argv[2]).resolve()


def ensure_destination(path) -> Path:
    """
    Crée le dossier de destination (et ses parents) s'il n'existe pas.

    V1.6 : le serveur Node.js crée déjà le dossier avant de spawn
    (cf. config `python_module.create_dest_if_missing`). Ce helper est
    une sécurité défensive pour les cas où le script est lancé
    manuellement.

    :param path: chemin (str ou Path)
    :returns: le Path (résolu) du dossier, garanti existant
    """
    p = Path(path).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p