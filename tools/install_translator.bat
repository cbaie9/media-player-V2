@echo off
if not exist %cd%/translator mkdir translator
cd translator
git clone https://github.com/meangrinch/MangaTranslator.git
cd MangaTranslator
python -m venv venv
.\venv\Scripts\activate # or source venv/bin/activate (Linux/macOS)
pip install torch==2.11.0+cu130 torchvision==0.26.0+cu130 --extra-index-url https://download.pytorch.org/whl/cu130 # or pip install torch==2.11.0 torchvision==0.26.0 (macOS)
pip install -r requirements.txt