#!/usr/bin/env bash
# Lance media-player-v2
# Usage :  ./scripts/start.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo "=== media-player-v2 ==="
echo ""

# Vérifie Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node introuvable. Installez Node 20+ : https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌ Node $NODE_VERSION détecté. Node 20+ requis."
  exit 1
fi

echo "✅ Node $NODE_VERSION"

# Vérifie les dépendances
if [ ! -d "node_modules" ]; then
  echo "📦 Installation des dépendances..."
  npm install
fi

# Doctor
echo ""
node scripts/doctor.js || {
  echo "❌ Corrigez les erreurs ci-dessus avant de démarrer."
  exit 1
}

# Démarre
echo ""
npm start