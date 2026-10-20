# ローカルAI (CPU向け)

Ollama + 量子化LLMで動く、完全ローカルのチャット環境です。外部にデータは送信されません。

## 使い方
```bash
./setup.sh            # Ollama導入 + モデル取得 (初回のみ)
python3 chat.py       # CLIチャット
python3 server.py     # ブラウザUI -> http://127.0.0.1:8765
python3 test_local_ai.py   # モックでの疎通テスト
```

## 性能の目安と調整
- 既定モデルは `qwen2.5:7b` (4bit量子化、約5GB、RAM 8GB以上推奨)。
- 遅い/メモリが少ない場合: `LOCAL_AI_MODEL=qwen2.5:3b ./setup.sh`
- 速度設定は `config.py` と環境変数 (`LOCAL_AI_THREADS`, `LOCAL_AI_CTX`, `LOCAL_AI_TEMP`) で変更できます。
  スレッド数は物理コア数が最速です。コンテキスト長を小さくすると速くなります。
- `keep_alive` と `OLLAMA_NUM_PARALLEL=1` でモデルを常駐させ、初回以外の待ち時間を減らしています。
