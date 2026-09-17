"""Verify the official checkout and install a loopback-only override; no secrets fetched/generated here."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent
upstream = root / 'upstream'
compose = upstream / 'docker/docker-compose.yml'
if not compose.is_file():
    sys.exit('Clone the official supabase repository into deploy/china/upstream first.')
text = compose.read_text(encoding='utf-8')
if '\n  api-gw:' not in text or '\n  supavisor:' not in text or 'name: supabase' not in text:
    sys.exit('Upstream compose changed: stop and review gateway, network name and port mappings before deploying.')
shutil.copyfile(root / 'supabase.override.yml', compose.parent / 'docker-compose.override.yml')
revision = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
(root / 'upstream-revision.txt').write_text(revision + '\n', encoding='utf-8')
print('Loopback override installed. Upstream revision recorded:', revision)
print('Configure upstream/docker/.env via the official secret-generation guide, then validate ports with docker compose config.')
