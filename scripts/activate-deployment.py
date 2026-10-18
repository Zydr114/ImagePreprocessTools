#!/usr/bin/env python3
"""Install one staged release and its Caddy route using sudo on the server."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile

SITE = Path('/var/www/tool.talium.site/ImageProprocessTools')
CADDY = Path('/etc/caddy/Caddyfile')
ROUTE = Path('/etc/caddy/image-preprocess-tools.caddy')
IMPORT = '\timport /etc/caddy/image-preprocess-tools.caddy\n'


def with_route(config):
    if IMPORT.strip() in config:
        if config.count(IMPORT.strip()) != 1:
            raise ValueError('Duplicate application import')
        return config
    marker = 'tool.talium.site {\n'
    if config.count(marker) != 1:
        raise ValueError('Expected exactly one tool.talium.site site block')
    return config.replace(marker, marker + IMPORT, 1)


def extract_release(archive, destination):
    # The bundle contains regular files and directories only, never symlinks.
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe archive member: ' + member.name)
        for member in members:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                target.chmod(0o755)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o644)


def replace_link(link, target):
    temporary = link.with_name('.current-new')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(link)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Root is required. Run this activation command with sudo on the deployment server.')
    stage = Path(__file__).resolve().parent
    plan = json.loads((stage / 'plan.json').read_text())
    release_id, commit = plan['releaseId'], plan['commit']
    if not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}', release_id) or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid release metadata')
    archive = stage / 'site.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != plan['sha256']:
        raise ValueError('Archive checksum mismatch')
    route = (stage / 'route.caddy').read_bytes()
    if hashlib.sha256(route).hexdigest() != plan['routeSha256']:
        raise ValueError('Route checksum mismatch')
    previous_config = CADDY.read_bytes()
    if hashlib.sha256(previous_config).hexdigest() != plan['caddySha256']:
        raise ValueError('Caddyfile changed after staging; restage before activation')
    next_config = with_route(previous_config.decode()).encode()
    current = SITE / 'current'
    if current.exists() and not current.is_symlink():
        raise ValueError('Application current path is not a managed symlink')
    previous_link = os.readlink(current) if current.is_symlink() else None
    previous_route = ROUTE.read_bytes() if ROUTE.exists() else None
    release = SITE / 'releases' / release_id
    if release.exists():
        raise ValueError('Release already exists; inspect current release before retrying')
    release.mkdir(parents=True)
    extract_release(archive, release)
    metadata = json.loads((release / 'release.json').read_text())
    if metadata['commit'] != commit or metadata['basePath'] != '/ImageProprocessTools/':
        raise ValueError('Release identity mismatch')
    backup = Path('/var/backups/image-preprocess-tools') / release_id
    backup.mkdir(parents=True, mode=0o700)
    (backup / 'Caddyfile').write_bytes(previous_config)
    if previous_route is not None:
        (backup / 'route.caddy').write_bytes(previous_route)
    (backup / 'state.json').write_text(json.dumps({'current': previous_link, 'routeExisted': previous_route is not None}, indent=2) + '\n')
    candidate = CADDY.with_name('.image-preprocess-tools-candidate')
    replaced_config = False
    activated_link = False
    try:
        ROUTE.write_bytes(route)
        ROUTE.chmod(0o644)
        candidate.write_bytes(next_config)
        candidate.chmod(0o644)
        subprocess.run(['caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile'], check=True)
        replace_link(current, release)
        activated_link = True
        candidate.replace(CADDY)
        replaced_config = True
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
        response = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--max-time', '20', '--resolve', 'tool.talium.site:443:127.0.0.1', 'https://tool.talium.site/ImageProprocessTools/release.json'])
        if json.loads(response)['commit'] != commit:
            raise ValueError('Online release does not match the staged commit')
    except BaseException:
        if replaced_config:
            CADDY.write_bytes(previous_config)
        if previous_route is None:
            ROUTE.unlink(missing_ok=True)
        else:
            ROUTE.write_bytes(previous_route)
        if activated_link:
            if previous_link is None:
                current.unlink(missing_ok=True)
            else:
                replace_link(current, previous_link)
        if replaced_config:
            subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
        raise
    finally:
        candidate.unlink(missing_ok=True)
    print('Deployed: https://tool.talium.site/ImageProprocessTools/')
    print('Commit:', commit)
    print('Backup:', backup)


if __name__ == '__main__':
    main()
