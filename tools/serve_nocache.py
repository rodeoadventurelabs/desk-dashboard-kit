"""Local preview server for site/ that tells the browser never to cache.

Python's built-in http.server sends no Cache-Control, so browsers (and the frame's WebView)
keep using old CSS/JS after edits. Usage (from the Dashboard folder):

    python tools/serve_nocache.py 8787 site
"""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    root = sys.argv[2] if len(sys.argv) > 2 else 'site'
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'Serving {root} on http://127.0.0.1:{port} (no-store)', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
