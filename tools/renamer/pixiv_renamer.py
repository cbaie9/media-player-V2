#!/usr/bin/env python3
"""
Renomme les images d'un comics au format :
    <id_9chiffres>_p<page_2chiffres>-<tag> <nom>.<ext>
vers :
    <nom>-<page_4chiffres>.<ext>

Le tag est entre crochets et optionnel : [img], [anim], [sfw], [teaser].

Exemples d'entrée :
    123456789_p01-[img] Anby.webp
    123456789_p22-[anim] Anby.webp
    123456789_p05-[sfw] Anby.png
    123456789_p07-[teaser] Anby.jpg
    123456789_p03- Anby.webp          (tag absent)
    123456789_p03 Anby.webp           (tag absent, espace simple)

Exemple d'utilisation :
    python format_renamer.py Anby --dir "B:\\chemin\\vers\\comics" --dry-run
    python format_renamer.py Anby --dir "B:\\chemin\\vers\\comics"
"""

import re
import sys
import argparse
from pathlib import Path


EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}

# Tags reconnus entre crochets
TAGS = {"img", "anim", "sfw", "teaser"}


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Renomme les pages d'un comics du format "
            "'<id>_p<page>-[tag] <nom>.<ext>' vers '<nom>-<page_4chiffres>.<ext>'."
        )
    )
    parser.add_argument("nom", help="Nom du comics (ex: Anby)")

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
        "--tag",
        default=None,
        help=(
            "Filtrer sur un tag précis (img, anim, sfw, teaser). "
            "Par défaut, tous les tags sont acceptés."
        ),
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Affiche les changements sans les appliquer",
    )
    return parser.parse_args()


def extraire_infos(nom_fichier: str, nom_comics: str):
    """
    Analyse un nom de fichier au format :
        <id_9chiffres>_p<page>-[<tag>] <nom>.<ext>
    Retourne (numero_page:int, tag:str|None, extension:str) ou None.
    """
    chemin = Path(nom_fichier)
    extension = chemin.suffix
    if extension.lower() not in EXTENSIONS:
        return None

    stem = chemin.stem  # nom sans extension

    # Regex :
    #   ^                       début
    #   \d{9}                   id sur 9 chiffres
    #   _p                       "_p"
    #   (\d{1,4})               page (1 à 4 chiffres, tolérant)
    #   -                        tiret obligatoire
    #   (?:\[(img|anim|sfw|teaser)\])?   tag optionnel entre crochets
    #   \s*                      espaces optionnels après le tag
    #   (.+?)                    le nom du comics (non-greedy)
    #   \s*                      espaces finaux éventuels
    #   $                        fin
    motif = re.compile(
        r"^\d{9}_p(\d{1,4})-"
        r"(?:\[(img|anim|sfw|teaser)\])?"
        r"\s*(.+?)\s*$",
        flags=re.IGNORECASE,
    )

    m = motif.match(stem)
    if not m:
        return None

    page_str, tag, nom_dans_fichier = m.group(1), m.group(2), m.group(3)

    # Vérifie que le nom dans le fichier correspond au comics demandé
    if nom_dans_fichier.lower() != nom_comics.strip().lower():
        return None

    numero = int(page_str)
    tag = tag.lower() if tag else None
    return numero, tag, extension


def diagnostic(dossier: Path, nom_comics: str):
    """Affiche des infos utiles quand rien n'a été trouvé."""
    print()
    print("=" * 60)
    print("DIAGNOSTIC")
    print("=" * 60)
    print(f"Dossier       : {dossier}")
    print(f"Existe        : {dossier.exists()}")
    print(f"Est un dossier: {dossier.is_dir()}")
    print(f"Nom recherché : {nom_comics!r}")
    print()

    if not dossier.is_dir():
        print("→ Le dossier est introuvable ou n'est pas un dossier.")
        return

    try:
        entrees = list(dossier.iterdir())
    except PermissionError:
        print("→ Permission refusée pour lire ce dossier.")
        return

    fichiers = [f for f in entrees if f.is_file()]
    sous_dossiers = [f for f in entrees if f.is_dir()]

    print(f"Fichiers présents : {len(fichiers)}")
    print(f"Sous-dossiers     : {len(sous_dossiers)}")
    print()

    if fichiers:
        print("Premiers fichiers (noms exacts, avec guillemets) :")
        for f in sorted(fichiers, key=lambda p: p.name)[:30]:
            print(f"  {f.name!r}")
        if len(fichiers) > 30:
            print(f"  ... et {len(fichiers) - 30} autres")
        print()

    if sous_dossiers:
        print("Sous-dossiers (le script ne descend PAS dedans) :")
        for d in sorted(sous_dossiers, key=lambda p: p.name)[:10]:
            print(f"  {d.name!r}/")
        if len(sous_dossiers) > 10:
            print(f"  ... et {len(sous_dossiers) - 10} autres")
        print()

    print("Format attendu :")
    print("  <id_9chiffres>_p<page>-[<tag>] <nom>.<ext>")
    print("Ex : 123456789_p01-[img] Anby.webp")
    print("     (le tag [img]/[anim]/[sfw]/[teaser] est optionnel)")
    print()


def main():
    args = parse_args()

    dossier = Path(args.dossier).expanduser().resolve()
    print(f"Dossier source : {dossier}")

    if not dossier.exists():
        print(f"Erreur : le dossier '{dossier}' n'existe pas.")
        sys.exit(1)
    if not dossier.is_dir():
        print(f"Erreur : '{dossier}' n'est pas un dossier.")
        sys.exit(1)

    # 1. Collecte
    correspondances = []  # (numero, tag, extension, path)
    for f in dossier.iterdir():
        if not f.is_file():
            continue
        res = extraire_infos(f.name, args.nom)
        if res is None:
            continue
        numero, tag, extension = res

        # Filtre optionnel par tag
        if args.tag is not None and tag != args.tag.lower():
            continue

        correspondances.append((numero, tag, extension, f))

    if not correspondances:
        print(f"\nAucun fichier trouvé pour le comics '{args.nom}' dans '{dossier}'.")
        diagnostic(dossier, args.nom)
        sys.exit(0)

    # 2. Tri par numéro de page
    correspondances.sort(key=lambda x: x[0])

    print(f"Comics détecté : {args.nom}")
    print(f"Nombre de pages : {len(correspondances)}")
    print("-" * 60)

    # 3. Renommage
    nom_utilisable = args.nom.replace(" ","_")
    for numero, tag, extension, chemin in correspondances:
        nouveau_nom = f"{nom_utilisable}-{numero:04d}{extension}"
        nouveau_chemin = chemin.parent / nouveau_nom
        tag_affiche = f"[{tag}]" if tag else "[-]"

        if chemin.name == nouveau_nom:
            print(f"[=] {chemin.name}  (déjà OK)")
            continue

        if nouveau_chemin.exists():
            print(f"[!] {chemin.name} -> {nouveau_nom}  (cible existe, ignoré)")
            continue

        if args.dry_run:
            print(f"[dry] {tag_affiche} {chemin.name} -> {nouveau_nom}")
        else:
            chemin.rename(nouveau_chemin)
            print(f"[+] {tag_affiche} {chemin.name} -> {nouveau_nom}")


if __name__ == "__main__":
    main()