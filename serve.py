"""Local dev server: static files, never cached, so edits show up on a plain refresh."""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


# threaded, with a long queue: a page made of many small module files asks for them all at once, and a one-at-a-time server drops some of them
socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.daemon_threads = True
socketserver.ThreadingTCPServer.request_queue_size = 128
with socketserver.ThreadingTCPServer(("", PORT), NoCache) as srv:
    print(f"http://localhost:{PORT}")
    srv.serve_forever()
