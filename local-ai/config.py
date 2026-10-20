"""ローカルAI共通設定。環境変数で上書きできます。"""
import os

OLLAMA_HOST = os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434")
# CPUのみで実用的な速度が出るモデル。メモリが少ない場合は qwen2.5:3b に変更してください。
MODEL = os.environ.get("LOCAL_AI_MODEL", "qwen2.5:7b")
SYSTEM_PROMPT = os.environ.get(
    "LOCAL_AI_SYSTEM",
    "あなたは優秀なアシスタントです。日本語で、簡潔かつ正確に答えてください。",
)
# CPU推論は物理コア数に合わせるのが最速。SMTの論理コアは使わない。
NUM_THREAD = int(os.environ.get("LOCAL_AI_THREADS", max(1, (os.cpu_count() or 2) // 2)))
OPTIONS = {
    "num_thread": NUM_THREAD,
    "num_ctx": int(os.environ.get("LOCAL_AI_CTX", 4096)),
    "temperature": float(os.environ.get("LOCAL_AI_TEMP", 0.7)),
}
