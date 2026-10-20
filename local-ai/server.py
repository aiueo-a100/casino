#!/usr/bin/env python3
"""ブラウザUI用のローカルサーバー。ui.html を配信し、/api/* を Ollama へ中継する。"""
import http.server
import os
import sys
import urllib.error
import urllib.request

import config

HERE = os.path.dirname(os.path.abspath(__file__))
ALLOWED = {"/api/chat", "/api/tags"}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            with open(os.path.join(HERE, "ui.html"), "rb") as f:
                self._send(200, "text/html; charset=utf-8", f.read())
        elif self.path == "/api/config":
            body = ('{"model":"%s"}' % config.MODEL).encode()
            self._send(200, "application/json", body)
        elif self.path in ALLOWED:
            self._proxy(None)
        else:
            self._send(404, "text/plain", b"not found")

    def do_POST(self):
        if self.path not in ALLOWED:
            return self._send(404, "text/plain", b"not found")
        length = int(self.headers.get("Content-Length", 0))
        self._proxy(self.rfile.read(length))

    def _proxy(self, body):
        req = urllib.request.Request(config.OLLAMA_HOST + self.path, body,
                                     {"Content-Type": "application/json"})
        try:
            res = urllib.request.urlopen(req, timeout=600)
        except urllib.error.URLError as e:
            return self._send(502, "text/plain; charset=utf-8", f"Ollamaに接続できません: {e}".encode())
        self.send_response(res.status)
        self.send_header("Content-Type", res.headers.get("Content-Type", "application/x-ndjson"))
        self.send_header("Connection", "close")
        self.end_headers()
        while chunk := res.readline():  # 行単位で即時転送しストリーミングを維持
            self.wfile.write(chunk)
            self.wfile.flush()

    def log_message(self, *args):
        pass


def main(port=8765):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"http://127.0.0.1:{port} でUIを公開中 (Ctrl+Cで終了)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8765)
