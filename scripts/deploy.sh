#!/usr/bin/env bash
# Build and upload, then print the separate server activation command.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${DEPLOY_HOST:-tencent}"
[[ "$host" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo 'Invalid SSH alias.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit source changes before staging a release.' >&2; exit 1; }
commit="$(git rev-parse HEAD)"
release_id="$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}"
export VITE_BASE_PATH='/ImagePreprocessTools/'
export VITE_SOURCE_REF="$commit"
npm run build -- --outDir dist-deploy
mkdir -p artifacts/deploy
stage="artifacts/deploy/$release_id"
mkdir "$stage"
export DEPLOY_RELEASE_ID="$release_id"
node --input-type=module <<'JS'
import {writeFile} from 'node:fs/promises';
await writeFile('dist-deploy/release.json',JSON.stringify({name:'ImagePreprocessTools',commit:process.env.VITE_SOURCE_REF,releaseId:process.env.DEPLOY_RELEASE_ID,basePath:process.env.VITE_BASE_PATH,source:`https://github.com/Zydr114/ImagePreprocessTools/tree/${process.env.VITE_SOURCE_REF}`},null,2)+'\n');
JS
tar -czf "$stage/site.tar.gz" -C dist-deploy .
cp scripts/activate-deployment.py "$stage/activate.py"
cp scripts/image-preprocess-tools.caddy "$stage/route.caddy"
caddy_sha="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" 'sha256sum /etc/caddy/Caddyfile' | cut -d' ' -f1)"
export DEPLOY_STAGE="$stage" DEPLOY_CADDY_SHA="$caddy_sha"
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
p=Path(os.environ['DEPLOY_STAGE'])
data={'releaseId':os.environ['DEPLOY_RELEASE_ID'],'commit':os.environ['VITE_SOURCE_REF'],'caddySha256':os.environ['DEPLOY_CADDY_SHA']}
for key,name in [('sha256','site.tar.gz'),('routeSha256','route.caddy')]:data[key]=hashlib.sha256((p/name).read_bytes()).hexdigest()
(p/'plan.json').write_text(json.dumps(data,indent=2)+'\n')
PY
remote_stage="/home/ubuntu/.local/share/image-preprocess-tools/$release_id"
ssh -o BatchMode=yes "$host" "mkdir -p '$remote_stage'"
scp "$stage/site.tar.gz" "$stage/activate.py" "$stage/route.caddy" "$stage/plan.json" "$host:$remote_stage/"
printf '\nStaged release: %s\nServer activation command:\n' "$release_id"
printf "ssh %s 'sudo -n python3 %s/activate.py'\n" "$host" "$remote_stage"
