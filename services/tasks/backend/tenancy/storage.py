"""Uploads in multi-company mode go under c/<schema>/, so two companies'
files never share a path (local disk or S3)."""
from django.core.files.storage import FileSystemStorage

from . import schemas


class CompanyPathMixin:
    def generate_filename(self, filename):
        name = super().generate_filename(filename)
        schema = schemas.current()
        if schema:
            name = name.replace("\\", "/")
            if not name.startswith(f"c/{schema}/"):
                name = f"c/{schema}/{name}"
        return name


class CompanyFileSystemStorage(CompanyPathMixin, FileSystemStorage):
    pass


try:
    from storages.backends.s3 import S3Storage

    class CompanyS3Storage(CompanyPathMixin, S3Storage):
        pass
except ImportError:  # django-storages not installed
    pass


# --- a deleted company's files (`company -- delete`, PLAN.md §14) ---------------------------------------------------

def _company_dir(schema: str):
    """MEDIA_ROOT/c/<schema>, checked: a company schema name, and inside MEDIA_ROOT/c (no symlinked `c`)."""
    import os
    from pathlib import Path

    from django.conf import settings

    if not schemas.deletable(schema):
        raise ValueError(f"Not a company schema: {schema!r}")
    root = Path(settings.MEDIA_ROOT).resolve()
    parent = root / "c"
    if parent.is_symlink():
        raise ValueError(f"{parent} is a symlink: refusing to touch files through it")
    target = parent / schema
    if not target.is_symlink() and target.exists():
        real = target.resolve()
        if real.parent != parent.resolve() or not str(real).startswith(str(root) + os.sep):
            raise ValueError(f"{target} is outside MEDIA_ROOT/c")
    return root, target


def _use_s3() -> bool:
    from django.conf import settings

    return bool(getattr(settings, "USE_S3", False))


def _s3_walk(storage, prefix: str):
    dirs, files = storage.listdir(prefix)
    for f in files:
        yield f"{prefix}/{f}"
    for d in dirs:
        yield from _s3_walk(storage, f"{prefix}/{d}")


def company_files(schema: str) -> dict:
    """Where the company's uploads are and how many (`c/<schema>/`)."""
    import os

    if _use_s3():
        from django.core.files.storage import default_storage

        if not schemas.deletable(schema):
            raise ValueError(f"Not a company schema: {schema!r}")
        names = list(_s3_walk(default_storage, f"c/{schema}"))
        return {"path": f"s3:c/{schema}/", "count": len(names)}
    root, target = _company_dir(schema)
    count = size = 0
    if target.is_symlink():
        return {"path": str(target), "count": 0, "bytes": 0}
    if target.is_dir():
        for base, _dirs, files in os.walk(target, followlinks=False):
            for f in files:
                p = os.path.join(base, f)
                count += 1
                size += os.lstat(p).st_size
    return {"path": str(target), "count": count, "bytes": size}


def remove_company_files(schema: str) -> dict:
    """Deletes MEDIA_ROOT/c/<schema> (or the S3 prefix). Never follows a symlink: a symlinked folder loses only the
    link, and links inside it are removed as links. Idempotent."""
    import shutil

    info = company_files(schema)
    if _use_s3():
        from django.core.files.storage import default_storage

        for name in _s3_walk(default_storage, f"c/{schema}"):
            default_storage.delete(name)
        return info
    _root, target = _company_dir(schema)
    if target.is_symlink():
        target.unlink()
    elif target.is_dir():
        shutil.rmtree(target)
    return info
