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

Utilisation :
    # Le script déduit dossier + nom depuis la première image
    py format_renamer.py "B:\\chemin\\vers\\123456789_p01-[img] Anby.webp" --dry-run
    py format_renamer.py "B:\\chemin\\vers\\123456789_p01-[img] Anby.webp"

    # Filtre optionnel sur un tag
    py format_renamer.py "B:\\chemin\\...\\123456789_p01-[img] Anby.webp" --tag img
"""

import re
import sys
import argparse
from pathlib import Path


EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'}

# Tags reconnus entre crochets
TAGS = {"img", "anim", "sfw", "teaser"}

# Regex d'analyse du format d'entrée
MOTIF = re.compile(
    r"^\d{9}_p(\d{1,4})-"
    r"(?:\[(img|anim|sfw|teaser)\])?"
    r"\s*(.+?)\s*$",
    flags=re.IGNORECASE,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Renomme les pages d'un comics à partir du chemin de sa PREMIÈRE image.\n"
            "Le dossier et le nom du comics sont déduits automatiquement.\n"
            "Format d'entrée : <id_9chiffres>_p<page>-[<tag>] <nom>.<ext>\n"
            "Format de sortie : <nom>-<page_4chiffres>.<ext>"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "premiere_image",
        help=(
            "Chemin complet (ou relatif) de la première image du comics. "
            "Ex : 'B:\\comics\\123456789_p01-[img] Anby.webp'"
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


def analyser_nom(nom_fichier: str):
    """
    Analyse un nom de fichier au format :
        <id_9chiffres>_p<page>-[<tag>] <nom>.<ext>
    Retourne (numero_page:int, tag:str|None, nom_comics:str, extension:str)
    ou None si le format ne correspond pas.
    """
    chemin = Path(nom_fichier)
    extension = chemin.suffix
    if extension.lower() not in EXTENSIONS:
        return None

    stem = chemin.stem
    m = MOTIF.match(stem)
    if not m:
        return None

    page_str, tag, nom_comics = m.group(1), m.group(2), m.group(3)

    return (
        int(page_str),
        tag.lower() if tag else None,
        nom_comics.strip(),
        extension,
    )


def diagnostic(dossier: Path, nom_comics: str):
    """Affiche des infos utiles quand rien n'a été trouvé."""
    print()
    print("=" * 60)
    print("DIAGNOSTIC")
    print("=" * 60)
    print(f"Dossier déduit : {dossier}")
    print(f"Existe         : {dossier.exists()}")
    print(f"Est un dossier : {dossier.is_dir()}")
    print(f"Nom déduit     : {nom_comics!r}")
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
        print("Premiers fichiers (noms exacts) :")
        for f in sorted(fichiers, key=lambda p: p.name)[:30]:
            print(f"  {f.name!r}")
        if len(fichiers) > 30:
            print(f"  ... et {len(fichiers) - 30} autres")
        print()

    print("Format attendu :")
    print("  <id_9chiffres>_p<page>-[<tag>] <nom>.<ext>")
    print("Ex : 123456789_p01-[img] Anby.webp")
    print()


def main():
    args = parse_args()

    chemin_premiere = Path(args.premiere_image).expanduser().resolve()
    print(f"Première image : {chemin_premiere}")

    if not chemin_premiere.exists():
        print(f"Erreur : le fichier '{chemin_premiere}' n'existe pas.")
        sys.exit(1)
    if not chemin_premiere.is_file():
        print(f"Erreur : '{chemin_premiere}' n'est pas un fichier.")
        sys.exit(1)

    # --- Déduction du dossier et du nom à partir de la première image ---
    dossier = chemin_premiere.parent

    infos = analyser_nom(chemin_premiere.name)
    if infos is None:
        print(
            "Erreur : la première image ne respecte pas le format attendu :\n"
            "  <id_9chiffres>_p<page>-[<tag>] <nom>.<ext>"
        )
        print(f"Nom fourni : {chemin_premiere.name!r}")
        sys.exit(1)

    _, _, nom_comics, _ = infos

    print(f"Dossier déduit : {dossier}")
    print(f"Nom déduit     : {nom_comics!r}")
    print()

    # --- 1. Collecte de toutes les images du comics dans ce dossier ---
    correspondances = []  # (numero, tag, extension, path)
    for f in dossier.iterdir():
        if not f.is_file():
            continue
        res = analyser_nom(f.name)
        if res is None:
            continue
        numero, tag, nom_dans_fichier, extension = res

        # Même comics ?
        if nom_dans_fichier.lower() != nom_comics.lower():
            continue

        # Filtre optionnel sur le tag
        if args.tag is not None and tag != args.tag.lower():
            continue

        correspondances.append((numero, tag, extension, f))

    if not correspondances:
        print(f"\nAucun fichier trouvé pour le comics '{nom_comics}' dans '{dossier}'.")
        diagnostic(dossier, nom_comics)
        sys.exit(0)

    # --- 2. Tri par numéro de page ---
    correspondances.sort(key=lambda x: x[0])

    print(f"Comics détecté : {nom_comics}")
    print(f"Nombre de pages : {len(correspondances)}")
    print("-" * 60)

    # --- 3. Renommage ---
    for numero, tag, extension, chemin in correspondances:
        nouveau_nom = f"{nom_comics}-{numero:04d}{extension}"
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