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
