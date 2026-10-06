#!/usr/bin/env python3
"""
Renomme les pages d'un comics au format :
    <id_9chiffres>-[<tag>] <nom> [<page>[/<total>]].<ext>
vers :
    <nom>-<page_4chiffres>.<ext>

Le tag entre crochets est optionnel : [anim], [Animation].
Le numéro de page est optionnel et peut être :
  - absent
  - simple       : "3"
  - fractionnaire: "1/3" (on ne garde que le numérateur)
Le séparateur de fraction accepte '/' et '／' (slash pleine largeur unicode).

Par défaut, les fichiers du comics SANS numéro de page sont renumérotés
séquentiellement (1, 2, 3, ...) après tri alphabétique.
Utiliser --no-renumber pour désactiver ce comportement.

Exemples d'entrée :
    123456789-[anim] Anby 1/3.webp
    123456789-[Animation] Anby 22/30.webp
    123456789-[anim] Anby 5.png
    123456789-[anim] Anby.webp
    110500553-[Anim] Xiangling.webm

Utilisation :
    py video_renamer.py "B:\\chemin\\vers\\123456789-[anim] Anby 1/3.webp" --dry-run
    py video_renamer.py "B:\\chemin\\vers\\123456789-[anim] Anby 1/3.webp"
    py video_renamer.py "..." --no-renumber
"""

import re
import sys
import argparse
from pathlib import Path


# Extensions reconnues : images + vidéo + audio
EXTENSIONS = {
    # Images
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif',
    # Vidéo
    '.webm', '.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ts', '.ogv',
    # Audio
    '.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac', '.opus',
}

# Tags reconnus (insensible à la casse)
TAGS = {"anim", "animation"}

# Regex d'analyse du format d'entrée
# ^\d{9}                            : id sur 9 chiffres
# -                                 : tiret obligatoire
# (?:\[(anim|animation)\])?         : tag optionnel entre crochets
# \s*                               : espaces optionnels
# (.+?)                             : nom du comics (non-greedy)
# (?:\s+(\d{1,4})(?:[/／]\d{1,4})?)? : page optionnelle, éventuellement "x/y"
# \s*$                              : fin
MOTIF = re.compile(
    r"^\d{9}-"
    r"(?:\[(anim|animation)\])?"
    r"\s*"
    r"(.+?)"
    r"(?:\s+(\d{1,4})(?:[/／]\d{1,4})?)?"
    r"\s*$",
    flags=re.IGNORECASE,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Renomme les pages d'un comics à partir du chemin de sa PREMIÈRE image.\n"
            "Le dossier et le nom du comics sont déduits automatiquement.\n\n"
            "Format d'entrée : <id_9chiffres>-[<tag>] <nom> [<page>[/<total>]].<ext>\n"
            "Format de sortie : <nom>-<page_4chiffres>.<ext>"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "premiere_image",
        help=(
            "Chemin complet (ou relatif) de la première image du comics. "
            "Ex : 'B:\\comics\\123456789-[anim] Anby 1/3.webp'"
        ),
    )

    parser.add_argument(
        "--tag",
        default=None,
        help=(
            "Filtrer sur un tag précis (anim, animation). "
            "Par défaut, tous les tags sont acceptés (y compris l'absence de tag)."
        ),
    )

    parser.add_argument(
        "--renumber",
        dest="renumber",
        action="store_true",
        default=True,
        help=(
            "Renumérote séquentiellement (1, 2, 3, ...) les fichiers du comics "
            "sans numéro de page, après tri alphabétique. "
            "(activé par défaut)"
        ),
    )
    parser.add_argument(
        "--no-renumber",
        dest="renumber",
        action="store_false",
        help="Désactive la renumérotation automatique des fichiers sans numéro.",
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
        <id_9chiffres>-[<tag>] <nom> [<page>[/<total>]].<ext>
    Retourne (numero_page:int|None, tag:str|None, nom_comics:str, extension:str)
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

    tag = m.group(1)
    nom_comics = m.group(2).strip()
    page_str = m.group(3)  # peut être None

    numero = int(page_str) if page_str is not None else None
    tag = tag.lower() if tag else None

    return numero, tag, nom_comics, extension


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
    print(f"Fichiers présents : {len(fichiers)}")
    print()

    if fichiers:
        print("Premiers fichiers (noms exacts) :")
        for f in sorted(fichiers, key=lambda p: p.name)[:30]:
            print(f"  {f.name!r}")
        if len(fichiers) > 30:
            print(f"  ... et {len(fichiers) - 30} autres")
        print()

    print("Format attendu :")
    print("  <id_9chiffres>-[<tag>] <nom> [<page>[/<total>]].<ext>")
    print("Ex : 123456789-[anim] Anby 1/3.webp")
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

    # --- Déduction dossier + nom ---
    dossier = chemin_premiere.parent

    infos = analyser_nom(chemin_premiere.name)
    if infos is None:
        print(
            "Erreur : la première image ne respecte pas le format attendu :\n"
            "  <id_9chiffres>-[<tag>] <nom> [<page>[/<total>]].<ext>"
        )
        print(f"Nom fourni : {chemin_premiere.name!r}")
        sys.exit(1)

    _, _, nom_comics, _ = infos

    print(f"Dossier déduit : {dossier}")
    print(f"Nom déduit     : {nom_comics!r}")
    print()

    # --- 1. Collecte ---
    numerotes = []     # (numero, tag, extension, path)
    sans_numero = []   # (tag, extension, path)

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

        if numero is None:
            sans_numero.append((tag, extension, f))
        else:
            numerotes.append((numero, tag, extension, f))

    if not numerotes and not sans_numero:
        print(f"\nAucun fichier trouvé pour le comics '{nom_comics}' dans '{dossier}'.")
        diagnostic(dossier, nom_comics)
        sys.exit(0)

    # --- 2. Tri ---
    numerotes.sort(key=lambda x: x[0])

    # Fichiers sans numéro : tri alphabétique par nom de fichier
    sans_numero.sort(key=lambda x: x[2].name.lower())

    # --- 3. Attribution des numéros manquants ---
    if sans_numero:
        if args.renumber:
            # On attribue des numéros à la suite du max déjà présent
            prochain = (numerotes[-1][0] + 1) if numerotes else 1
            for tag, extension, f in sans_numero:
                numerotes.append((prochain, tag, extension, f))
                prochain += 1
            # Retri global (au cas où)
            numerotes.sort(key=lambda x: x[0])

    # --- 4. Renommage ---
    print(f"Comics détecté   : {nom_comics}")
    print(f"Pages numérotées : {sum(1 for _ in numerotes)}")
    if sans_numero:
        if args.renumber:
            print(f"Sans numéro      : {len(sans_numero)}  (renumérotées à la suite)")
        else:
            print(f"Sans numéro      : {len(sans_numero)}  (ignorées, --no-renumber)")
            for tag, extension, f in sans_numero:
                print(f"    - {f.name!r}")
    print("-" * 60)

    for numero, tag, extension, chemin in numerotes:
        nouveau_nom = f"{nom_comics}_anim-{numero:04d}{extension}"
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