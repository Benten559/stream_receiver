import sys
import os

# venv_path = '/home/administrator/venvs/stream_server_env'

# site_packages = os.path.join(venv_path, 'lib', 'python3.12', 'site-packages')  # Replace python3.x with your version
# sys.path.insert(0, site_packages)
sys.path.insert(0,'/var/www/wedidit.com')
#os.environ['PATH'] = os.path.join(venv_path, 'bin') + ':' + os.environ['PATH']

from stream_server import app as application
