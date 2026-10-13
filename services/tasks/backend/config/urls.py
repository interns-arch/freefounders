from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve as _serve


def media(request, path):
    """Uploaded files, only by the signed, expiring link the API handed out (config/media.py). Anything under
    private/ (punch photos) is only served by its own permission-checked endpoint, never here."""
    from config import media as media_links

    clean = path.replace("\\", "/")
    if "private/" in clean or not media_links.valid(clean, request.GET.get("s")):
        raise Http404("Not found")
    res = _serve(request, path, document_root=settings.MEDIA_ROOT)
    return media_links.harden(res, res.get("Content-Type"))


def health(_request):
    return JsonResponse({"status": "ok", "app": "cartrends-crm"})


def spa(request, *_args, **_kwargs):
    """Catch-all for the React app's client-side routes (/tasks, /leads…) —
    a hard refresh on any of them must still load index.html."""
    index = settings.FRONTEND_DIST / "index.html"
    if index.exists():
        res = FileResponse(open(index, "rb"), content_type="text/html")
        # never cached: a phone must pick up a new deploy on its next load
        res["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return res
    raise Http404("Frontend build not found — run `npm run build` in frontend/.")


urlpatterns = [
    path("health", health),
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("crm.urls")),
    path("api/", include("notifications.urls")),
    path("api/", include("intake.urls")),
    path("api/", include("workspace.urls")),
    path("api/", include("hr.urls")),
    path("api/", include("directory.urls")),
    path("api/", include("payroll.urls")),
    path("api/", include("mistakes.urls")),
    # uploaded files (works in dev and on Render; Render's disk is ephemeral)
    re_path(r"^media/(?P<path>.*)$", media),
    # everything else that isn't API/admin/static -> the React app
    re_path(r"^(?!api/|admin/|static/|media/|health).*$", spa),
]
