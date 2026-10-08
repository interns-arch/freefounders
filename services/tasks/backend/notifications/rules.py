"""Notification rules: which kinds of event also go out by email or WhatsApp (PLAN.md §16.5).

In-app notifications always happen. A company switches the email or WhatsApp
copy off per group of events. Nothing saved = today's behaviour (both on), so a
standalone install and the existing tests are unchanged.
"""
import json

from tenancy.company_settings import company_env, set_value

SETTING = "NOTIFY_RULES"
CHANNELS = ("email", "whatsapp")

# key, label, notification types in the group
GROUPS = [
    ("task_given", "A task is given to someone, or someone is added to it",
     ("task_assigned", "task_inloop")),
    ("task_done", "Work completed, sent for review, accepted or sent back",
     ("task_completed", "task_completed_alert", "task_completion_review", "task_completion_accepted",
      "task_completion_rejected", "done_today")),
    ("task_changes", "Change requests and new category requests",
     ("task_change_request", "task_change_reviewed", "task_change_log", "category_request")),
    ("task_updates", "Comments and progress updates", ("task_comment", "task_progress")),
    ("task_due", "Due and overdue reminders", ("task_due", "task_overdue_weekly")),
    ("digests", "Daily and day-end summaries", ("task_daily", "task_day_end")),
    ("hr", "Leave and attendance", ("leave_reviewed", "face_enrolled", "leave_request", "correction_request")),
    ("approvals", "Reminders about requests waiting for approval", ("approval_reminder", "approval_escalated")),
    ("mistakes", "Mistake register", ("mistake_logged", "mistake_update", "mistake_repeat", "mistake_escalated",
                                      "mistake_digest")),
    ("leads", "Leads and customer messages", ("lead_assigned", "status_change", "follow_up_due", "customer_message")),
]
_GROUP_OF = {t: key for key, _label, types in GROUPS for t in types}


def saved() -> dict:
    try:
        data = json.loads(company_env(SETTING, "") or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def allows(type_: str, channel: str) -> bool:
    """May this kind of notification also go out on this channel?"""
    group = _GROUP_OF.get(type_)
    if group is None:
        return True
    return (saved().get(group) or {}).get(channel, True) is not False


def table() -> list[dict]:
    rules = saved()
    return [
        {"key": key, "label": label, **{c: (rules.get(key) or {}).get(c, True) is not False for c in CHANNELS}}
        for key, label, _types in GROUPS
    ]


def update(changes: dict) -> list[dict]:
    """changes: {group: {email: bool, whatsapp: bool}}. Unknown groups or channels raise ValueError."""
    known = {key for key, *_ in GROUPS}
    rules = saved()
    for group, channels in (changes or {}).items():
        if group not in known or not isinstance(channels, dict):
            raise ValueError(f"Unknown kind of notification: {group}")
        for channel, on in channels.items():
            if channel not in CHANNELS or not isinstance(on, bool):
                raise ValueError(f"{group}: {channel} must be email or whatsapp, on or off")
            rules.setdefault(group, {})[channel] = on
    set_value(SETTING, json.dumps(rules))
    return table()
