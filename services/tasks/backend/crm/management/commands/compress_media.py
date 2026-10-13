"""Shrinks the photos stored before uploads were compressed (PLAN.md §19.20).

    python manage.py compress_media            # dry run: what would be saved
    python manage.py compress_media --apply    # replace each photo that gets smaller

Goes through every stored file (task attachments, lead documents, leave documents, notice attachments, punch
photos; every company in multi-company mode) and re-encodes the photos exactly like a new upload: punch photos to
720 px, the rest to 2000 px, upright, without metadata. PDFs, spreadsheets and other files are never touched. With
--apply the smaller copy is saved first, the row is pointed at it, then the old file is deleted, so a row never points
at a missing file.
"""
import os

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from config.images import DOCUMENT, SELFIE, compress_image


def _targets():
    from crm.models import LeadDocument, TaskAttachment
    from hr.models import Attendance, LeaveRequest
    from workspace.models import Notice

    return [
        (TaskAttachment, "file", DOCUMENT),
        (LeadDocument, "file", DOCUMENT),
        (LeaveRequest, "document", DOCUMENT),
        (Notice, "attachment", DOCUMENT),
        (Attendance, "check_in_photo", SELFIE),
        (Attendance, "check_out_photo", SELFIE),
    ]


def _size(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB" if n >= 1024 * 1024 else f"{round(n / 1024)} KB"


class Command(BaseCommand):
    help = "Shrinks stored photos (dry run unless --apply). PLAN.md §19.20."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Replace the photos (default: only report).")

    def handle(self, apply=False, **opts):
        from tenancy import schemas

        totals = {"files": 0, "photos": 0, "before": 0, "after": 0, "missing": 0}
        if schemas.enabled():
            for company in schemas.companies():
                with schemas.use(company["schema"]):
                    self._run(company["schema"], apply, totals)
        else:
            self._run("", apply, totals)

        saved = totals["before"] - totals["after"]
        pct = round(saved * 100 / totals["before"]) if totals["before"] else 0
        self.stdout.write(
            f"\n{'Done' if apply else 'Dry run'}: {totals['files']} file(s) checked, {totals['photos']} photo(s) "
            f"{'shrunk' if apply else 'would shrink'} | {_size(totals['before'])} -> {_size(totals['after'])} | "
            f"{'saved' if apply else 'would save'} {_size(saved)} ({pct}%)"
            + (f" | {totals['missing']} file(s) missing (left as they are)" if totals["missing"] else ""))
        if not apply and totals["photos"]:
            self.stdout.write("Run again with --apply to replace them.")

    def _run(self, schema, apply, totals):
        for model, field_name, preset in _targets():
            field = model._meta.get_field(field_name)
            storage = field.storage
            rows = model.objects.exclude(**{field_name: ""}).exclude(**{f"{field_name}__isnull": True})
            n = before = after = photos = 0
            for pk, name in rows.values_list("pk", field_name).iterator():
                try:
                    with storage.open(name, "rb") as fh:
                        raw = fh.read()
                except (FileNotFoundError, OSError):
                    totals["missing"] += 1
                    continue
                n += 1
                data, ext = compress_image(raw, *preset)
                before += len(raw)
                after += len(data)
                if not ext:
                    continue
                photos += 1
                if apply:
                    self._replace(model, pk, field_name, storage, name, data, ext)
            if n:
                where = f"{schema} | " if schema else ""
                self.stdout.write(
                    f"{where}{model.__name__}.{field_name}: {n} file(s), {photos} photo(s) can shrink | "
                    f"{_size(before)} -> {_size(after)}")
            totals["files"] += n
            totals["photos"] += photos
            totals["before"] += before
            totals["after"] += after

    @staticmethod
    def _replace(model, pk, field_name, storage, old_name, data, ext):
        # New file first (the storage picks a free name), then the row, then the old file goes.
        new_name = storage.save(f"{os.path.splitext(old_name)[0]}.{ext}", ContentFile(data))
        changes = {field_name: new_name}
        if any(f.name == "filename" for f in model._meta.concrete_fields):
            row = model.objects.filter(pk=pk).values("filename").first()
            if row and row["filename"]:
                changes["filename"] = (os.path.splitext(row["filename"])[0] + f".{ext}")[:255]
        model.objects.filter(pk=pk).update(**changes)
        if new_name != old_name:
            storage.delete(old_name)
