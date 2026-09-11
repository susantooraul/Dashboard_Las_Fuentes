from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime
from pathlib import Path

from app.config import get_settings


def main() -> int:
    parser = argparse.ArgumentParser(description='Respalda la SQLite local de autenticacion de Las Fuentes.')
    parser.add_argument('--output', help='Archivo destino .sqlite3. Si se omite se crea en backend/data/backups/.')
    args = parser.parse_args()

    settings = get_settings()
    source = settings.auth_database_file
    if not source.exists():
        print(f'No existe la base de autenticacion: {source}')
        return 2

    if args.output:
        target = Path(args.output).expanduser().resolve()
    else:
        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        target = (source.parent / 'backups' / f'auth_{stamp}.sqlite3').resolve()
    target.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    print(f'Respaldo creado: {target}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
