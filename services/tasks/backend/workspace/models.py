"""Workspace productivity modules: Groups, Notices, Links.

These sit BESIDE the CRM: Groups scope tasks/links to a team,
Notices are company announcements (deliberately separate from the
per-user Notification system) and Links is a shared bookmark manager.
(The Idea Board was removed on 2026-10-13, PLAN.md §19.23.)
"""
from django.conf import settings
from django.db import models
from django.utils import timezone


class Group(models.Model):
    """A department/team mini-workspace. Tasks and links can be
    scoped to a group; members see the group's content."""
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True, default="")
    category = models.CharField(max_length=60, blank=True, default="")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL,
                              related_name="owned_groups")
    members = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="workspace_groups")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class NoticePriority(models.TextChoices):
    NORMAL = "normal", "Normal"
    IMPORTANT = "important", "Important"
    URGENT = "urgent", "Urgent"


class NoticeStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class NoticeAudience(models.TextChoices):
    EVERYONE = "everyone", "Everyone"
    ROLE = "role", "Specific role"
    DEPARTMENT = "department", "Specific department"
    GROUP = "group", "Specific group"
    USERS = "users", "Specific users"


class Notice(models.Model):
    """Company announcement. Separate concept from Notification (which is a
    per-user delivery record); a Notice is content with an audience."""
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True, default="")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    category = models.CharField(max_length=60, blank=True, default="")
    priority = models.CharField(max_length=10, choices=NoticePriority.choices, default=NoticePriority.NORMAL)
    status = models.CharField(max_length=10, choices=NoticeStatus.choices, default=NoticeStatus.DRAFT)
    publish_at = models.DateTimeField(null=True, blank=True)
    expire_at = models.DateTimeField(null=True, blank=True)
    attachment = models.FileField(upload_to="notices/", null=True, blank=True)
    # audience_value examples: {"role": "sales_executive"} | {"department": "sales"}
    # | {"group": 3} | {"users": [1, 4, 9]}
    audience_type = models.CharField(max_length=12, choices=NoticeAudience.choices,
                                     default=NoticeAudience.EVERYONE)
    audience_value = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_expired(self) -> bool:
        return bool(self.expire_at and self.expire_at <= timezone.now())

    @property
    def is_live(self) -> bool:
        if self.status != NoticeStatus.PUBLISHED or self.is_expired:
            return False
        return not self.publish_at or self.publish_at <= timezone.now()

    def __str__(self):
        return self.title


class NoticeRead(models.Model):
    notice = models.ForeignKey(Notice, on_delete=models.CASCADE, related_name="reads")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["notice", "user"], name="uniq_notice_read")]


class LinkCollection(models.Model):
    """A named collection of bookmarks, e.g. 'Important Tools'."""
    name = models.CharField(max_length=120, unique=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Link(models.Model):
    collection = models.ForeignKey(LinkCollection, on_delete=models.CASCADE, related_name="links")
    title = models.CharField(max_length=200)
    url = models.URLField(max_length=500)
    description = models.CharField(max_length=300, blank=True, default="")
    # group-scoped links are visible only to that group's members
    group = models.ForeignKey(Group, null=True, blank=True, on_delete=models.CASCADE, related_name="links")
    added_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    favorites = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="favorite_links")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title

