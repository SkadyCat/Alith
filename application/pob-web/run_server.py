"""
Launcher: imports 'server' module (uses pyc cache) then starts uvicorn.
This bypasses direct-script-compilation and uses the cached __pycache__/server.cpython-311.pyc.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# This import will check __pycache__/server.cpython-311.pyc
# If mtime+size of server.py match pyc header, the pyc is used directly.
import server  # noqa: F401 (side effects: creates FastAPI app + registers all routes)

import uvicorn
uvicorn.run(server.app, host="0.0.0.0", port=7893, reload=False)
