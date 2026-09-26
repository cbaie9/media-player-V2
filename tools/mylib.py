from contextlib import chdir
from pathlib import Path
import subprocess
import os
import sys
script_dir = os.path.dirname(os.path.abspath(__file__))
scrappers_path = os.path.join(script_dir, "scrappers")
if scrappers_path not in sys.path:
    sys.path.insert(0, scrappers_path)

from scrappers import universal_scrapper
PathPosion = os.getcwd()
# CONFIG 
# folder
FOLDER_TRANSLATION = os.path.join(PathPosion,"scrappers")
INPUT_TRANSLATION = os.path.join(FOLDER_TRANSLATION,"output")
OUTPUT_TRANSLATION = os.path.join(PathPosion,"output_translation")
MAIN_TRANSLATOR = os.path.join(PathPosion,"translator","MangaTranslator")
TARGET_LANGUAGE = "English"
# ia
IA_URL = "http://localhost:11434/v1" #
IA_PASSWORD = "abc" # fake api key : local AI
IA_MODEL_NAME = "llama3-uncensored"
IA_SYSPROMPT = "Translation requirements: Translate every input segment from %1 into natural %2. Preserve meaning, character voice, emotional tone, relationship nuance, emphasis, and sound effects. Localize idioms and sound effects naturally. Use surrounding segments only for disambiguation and continuity; never merge or split segments. Write every translated `text` value only in %2; do not include source text, notes, explanations, or alternatives.Never preserve or repeat original-language text; translate names, terms, and sound effects using natural %2 conventions."

def lunch(link:str="None")->bool:
    os.chdir(FOLDER_TRANSLATION)
    if not link == "None":
        scrapping_result = universal_scrapper.lunch(link)
    else:
        scrapping_result = (True,"Japanese")
    return translate(scrapping_result)
def translate(scrapping_result:tuple[bool,str])->bool:
    os.chdir(PathPosion)
    if isinstance(scrapping_result,tuple):
        if scrapping_result[0]:
            language:str = str(scrapping_result[1].lower())
            if not language == "english":
                print(language)
                modified_sysPrompt = IA_SYSPROMPT.replace("%1",language)
                modified_sysPrompt = modified_sysPrompt.replace("%2",TARGET_LANGUAGE)
                with chdir(Path(MAIN_TRANSLATOR)):
                    command = f"""py {os.path.join(MAIN_TRANSLATOR,"main.py")} --batch --input "{INPUT_TRANSLATION}" --output "{OUTPUT_TRANSLATION}" --input-language {language} --output-language {TARGET_LANGUAGE}  --provider OpenAI-Compatible --openai-compatible-url {IA_URL} --model-name {IA_MODEL_NAME} --openai-compatible-api-key {IA_PASSWORD} --ocr-method manga-ocr --translation-mode two-step --reasoning-effort none --special-instructions "{modified_sysPrompt}" """
                    print(f"---------\ncommande->{command}\n-----------")
                    subprocess.run(command)

            else:
                print("[Info]: [success] -> The Comic/Manga/Manhwa you've downloaded is already in English")
                return True
    else:
        print("[Error]: Unknown output value detected")
    return False
if __name__ =="__main__":
    print("[Tip]: Mettez 'None' pour lançer la traduction directement")
    output = lunch(str(input("Please Give the link to comics/manhwa/doujin you want to download : ")))
    if output:
        print("The translation was succesful")
    else:
        print("The translation has encountred an error")