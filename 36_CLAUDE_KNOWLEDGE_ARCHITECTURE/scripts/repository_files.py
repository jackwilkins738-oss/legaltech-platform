"""Shared repository inventory; Git ignores local state while retaining tracked files."""
from pathlib import Path
import os
import re
import subprocess

IGNORE_PARTS={'.git','node_modules','.venv','venv','__pycache__','.pytest_cache','.mypy_cache','.next','dist','coverage','.dev-data'}

def repository_files(root: Path) -> list[Path]:
    root=root.resolve()
    try:
        top=subprocess.run(['git','-C',str(root),'rev-parse','--show-toplevel'],capture_output=True,text=True,check=True)
        if Path(top.stdout.strip()).resolve()!=root:
            raise ValueError('not the repository root')
        result=subprocess.run(['git','-C',str(root),'ls-files','--cached','--others','--exclude-standard','-z'],capture_output=True,check=True)
        candidates=[root/os.fsdecode(name) for name in result.stdout.split(b'\0') if name]
    except (OSError,subprocess.CalledProcessError,ValueError):
        # Exported archives lack Git metadata. Exclude known local-only artifacts.
        candidates=[]
        for p in root.rglob('*'):
            name=p.name
            if ((name=='.env' or name.startswith('.env.')) and name!='.env.example') or p.suffix.lower() in {'.sqlite','.db','.log','.zip','.pem','.key','.pfx','.p12'}:
                continue
            if len(p.relative_to(root).parts)==1 and re.fullmatch(r'APPLY_.*_V\d+.*\.ps1',name,re.I):
                continue
            candidates.append(p)
    files=[]
    for p in candidates:
        relative=p.relative_to(root)
        if any(part in IGNORE_PARTS for part in relative.parts):
            continue
        if p.is_file() and p.resolve().is_relative_to(root):
            files.append(p)
    return sorted(set(files),key=lambda p:(p.relative_to(root).as_posix().lower(),p.relative_to(root).as_posix()))
