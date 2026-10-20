#!/usr/bin/env bash
# Ollama の導入、CPU向けチューニング、モデル取得を行う。
set -euo pipefail
cd "$(dirname "$0")"
MODEL="${LOCAL_AI_MODEL:-$(python3 -c 'import config;print(config.MODEL)')}"

if ! command -v ollama >/dev/null; then
  echo "Ollama をインストールします..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

# CPU推論の高速化: 並列数を絞り、モデルをメモリに常駐、Flash Attention有効化
export OLLAMA_NUM_PARALLEL=1 OLLAMA_KEEP_ALIVE=30m OLLAMA_FLASH_ATTENTION=1
if ! curl -fs http://127.0.0.1:11434/api/tags >/dev/null; then
  nohup ollama serve >/tmp/ollama.log 2>&1 &
  for _ in $(seq 30); do curl -fs http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1; done
fi

ollama pull "$MODEL"
echo "完了。 'python3 chat.py' でCLI、'python3 server.py' でブラウザUIを使えます。"
