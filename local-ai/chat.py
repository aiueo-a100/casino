#!/usr/bin/env python3
"""Ollama を使うストリーミング対応のCLIチャット (標準ライブラリのみ)。"""
import json
import sys
import urllib.request

import config


def stream_chat(messages, model=config.MODEL, host=config.OLLAMA_HOST, options=None):
    """応答テキストを断片ごとに yield する。"""
    body = json.dumps({
        "model": model,
        "messages": messages,
        "stream": True,
        "keep_alive": "30m",
        "options": options or config.OPTIONS,
    }).encode()
    req = urllib.request.Request(host + "/api/chat", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as res:
        for line in res:
            if not line.strip():
                continue
            data = json.loads(line)
            if "error" in data:
                raise RuntimeError(data["error"])
            yield data.get("message", {}).get("content", "")
            if data.get("done"):
                return


def main():
    model = config.MODEL
    history = [{"role": "system", "content": config.SYSTEM_PROMPT}]
    print(f"モデル: {model} / スレッド: {config.NUM_THREAD}  (/reset 履歴消去, /model 名前 切替, /exit 終了)")
    while True:
        try:
            text = input("\nあなた> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not text:
            continue
        if text == "/exit":
            return
        if text == "/reset":
            history = history[:1]
            print("履歴を消去しました。")
            continue
        if text.startswith("/model "):
            model = text.split(None, 1)[1]
            print(f"モデルを {model} に切り替えました。")
            continue
        history.append({"role": "user", "content": text})
        reply = ""
        print("AI> ", end="", flush=True)
        try:
            for part in stream_chat(history, model):
                reply += part
                print(part, end="", flush=True)
        except Exception as e:
            history.pop()
            print(f"\n[エラー] {e}\nOllamaが起動しているか、setup.sh を実行済みか確認してください。", file=sys.stderr)
            continue
        print()
        history.append({"role": "assistant", "content": reply})


if __name__ == "__main__":
    main()
