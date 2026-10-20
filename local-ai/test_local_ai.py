"""モックOllamaを使った疎通テスト: python3 test_local_ai.py"""
import http.server
import json
import threading
import urllib.request

import config
import server


class Mock(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert req["options"]["num_thread"] >= 1 and req["stream"] is True
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        for w in ["こん", "にちは"]:
            self.wfile.write((json.dumps({"message": {"content": w}, "done": False}) + "\n").encode())
        self.wfile.write(b'{"message":{"content":""},"done":true}\n')

    def log_message(self, *a):
        pass


def serve(handler, port):
    s = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


serve(Mock, 18434)
config.OLLAMA_HOST = "http://127.0.0.1:18434"
import chat

assert "".join(chat.stream_chat([{"role": "user", "content": "hi"}])) == "こんにちは"

serve(server.Handler, 18765)
body = json.dumps({"model": "m", "messages": [], "stream": True, "options": {"num_thread": 1}}).encode()
res = urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:18765/api/chat", body))
assert "こん" in "".join(json.loads(l)["message"]["content"] for l in res.read().splitlines())
assert b"<title>" in urllib.request.urlopen("http://127.0.0.1:18765/").read()
print("OK")
