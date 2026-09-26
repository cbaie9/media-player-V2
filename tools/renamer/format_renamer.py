#!/usr/bin/env python3
"""
Renomme les images d'un comics selon un pattern défini.
Format de sortie : <nom>-<numero_page_sur_4chiffres>.<extension>

Exemples :
  python rename_comics.py Comic_a
  python rename_comics.py Comic_a --dir ./mes_comics
  python rename_comics.py Comic_a --dir /chemin/absolu/vers/comics
  python rename_comics.py Comic_a --dir ./comics --dry-run
"""

import re
import sys
import argparse
from pathlib import Path


# Extensions d'images supportées
EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Renomme les pages d'un comics dans le format <nom>-<page_4chiffres>.<ext>"
    )
    parser.add_argument("nom", help="Nom du comics (ex: Comic_a)")

    # --- Emplacement des comics ---
    parser.add_argument(
        "-d", "--dir", "--dossier",
        dest="dossier",
        default=".",
        help=(
            "Dossier où se trouvent les images du comics "
            "(défaut: dossier courant '.'). "
            "Accepte un chemin relatif ou absolu."
        ),
    )

    parser.add_argument(
        "--sep",
        default="_",
        help="Séparateur entre le nom et le numéro de page (défaut: '_')",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche les changements sans les appliquer",
    )
    return parser.parse_args()


def extraire_numero_page(nom_fichier: str, nom_comics: str, separateur: str):
    """
    Tente d'extraire le numéro de page d'un fichier appartenant au comics donné.
    Retourne (numero:int, extension:str) ou None si le fichier ne correspond pas.
    """
    chemin = Path(nom_fichier)
    extension = chemin.suffix
    if extension.lower() not in EXTENSIONS:
        return None

    stem = chemin.stem

    nom_echappe = re.escape(nom_comics)
    # Tolère : nom + séparateur optionnel (_, -, espace) + nombre (1 à 6 chiffres)
    motif = rf"^{nom_echappe}[_\-\s]?(\d{{1,6}})$"

    m = re.match(motif, stem, flags=re.IGNORECASE)
    if not m:
        return None

    numero = int(m.group(1))
    return numero, extension


def main():
    args = parse_args()

    # --- Résolution du dossier source ---
    dossier = Path(args.dossier).expanduser().resolve()

    print(f"Dossier source : {dossier}")

    if not dossier.exists():
        print(f"Erreur : le dossier '{dossier}' n'existe pas.")
        sys.exit(1)

    if not dossier.is_dir():
        print(f"Erreur : '{dossier}' n'est pas un dossier.")
        sys.exit(1)

    # 1. Récupérer toutes les images correspondant au comics
    correspondances = []  # (numero, extension, path)
    for f in dossier.iterdir():
        if not f.is_file():
            continue
        res = extraire_numero_page(f.name, args.nom, args.sep)
        if res is not None:
            numero, extension = res
            correspondances.append((numero, extension, f))

    if not correspondances:
        print(f"Aucun fichier trouvé pour le comics '{args.nom}' dans '{dossier}'.")
        sys.exit(0)

    # 2. Trier par numéro de page
    correspondances.sort(key=lambda x: x[0])

    print(f"Comics détecté : {args.nom}")
    print(f"Nombre de pages : {len(correspondances)}")
    print("-" * 60)

    # 3. Renommer
    for numero, extension, chemin in correspondances:
        nouveau_nom = f"{args.nom}-{numero:04d}{extension}"
        nouveau_chemin = chemin.parent / nouveau_nom

        if chemin.name == nouveau_nom:
            print(f"[=] {chemin.name}  (déjà OK)")
            continue

        if nouveau_chemin.exists():
            print(f"[!] {chemin.name} -> {nouveau_nom}  (cible existe déjà, ignoré)")
            continue

        if args.dry_run:
            print(f"[dry] {chemin.name} -> {nouveau_nom}")
        else:
            chemin.rename(nouveau_chemin)
            print(f"[+] {chemin.name} -> {nouveau_nom}")


if __name__ == "__main__":
    main()