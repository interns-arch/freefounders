"""E3: AI layer for tasks — any provider behind AI_ENABLED, deterministic
fallback ALWAYS works (the app never blocks on AI).

  draft_from_speech(words)    -> the task form from a spoken note (Voice draft); without an AI key
                                 speech_rules() reads who / by when / how long
  draft_task(prompt)          -> {"title", "description", "checklist", "provider"} (the voice fallback)
  summarize_task(task, feed)  -> {"summary", "provider"}
  review_sentence(stats)      -> str  (pure rules — Sir's categories, so the
                                 no-API-key install says the same things)
"""
import logging
import re
from datetime import timedelta

from config import llm

log = logging.getLogger(__name__)

DRAFT_SYSTEM = """You draft internal CRM tasks for an Indian auto-parts trading business.
From the user's request, reply with ONLY a JSON object:
{"title": "<max 12 words, imperative>",
 "description": "<2-4 sentences: what exactly to do and what done looks like>",
 "checklist": ["<3-6 short tickable steps>"]}"""

SUMMARY_SYSTEM = """You summarize one CRM task's state for a busy manager.
Reply with ONLY a JSON object: {"summary": "<3-5 short sentences: what the task is,
where it stands, what happened recently, what should happen next>"}"""

# Deliberately narrow. People here write in Indian-English business register
# and often mix in Hindi words -- "rewrite" would flatten that into something
# they did not say, and they would stop trusting the button.
PROOFREAD_SYSTEM = """You proofread short internal notes written by staff at an
Indian auto-parts business. Fix ONLY spelling, grammar, capitalisation and
punctuation.

Rules you must not break:
- Never reword, shorten, expand or reorder anything.
- Keep every line break exactly where it is.
- Keep Hindi/Hinglish words, names, part numbers, codes and abbreviations as-is.
- Indian English is correct English. Do not Americanise it.
- If the text is already correct, return it unchanged.

Reply with ONLY the corrected text. No quotes, no explanation, no preamble."""




# ---------------------------------------------------------------------------

VOICE_SYSTEM = """You turn a spoken note into an internal task for an Indian
auto-parts business. The speaker mixes Hindi and English; understand both.

Reply with ONLY a JSON object:
{"title": "<max 12 words, imperative>",
 "description": "<what exactly to do and what done looks like>",
 "checklist": ["<0-6 short tickable steps, only if the speaker listed steps>"],
 "assignee": "<the person's name EXACTLY as spoken, or null if none was named>",
 "due_at": "<ISO 8601 local datetime, or null if no time was mentioned>",
 "effort_minutes": <number, or null if not mentioned>}

Rules:
- Never invent a person. If no name was spoken, assignee is null.
- Never invent a deadline. If no time was spoken, due_at is null.
- "kal" = tomorrow, "parso" = day after, "shaam" = evening (17:00),
  "subah" = morning (10:00), "raat" = night (20:00).
- A bare hour with no am/pm during working talk means the afternoon:
  "5 baje" is 17:00, not 05:00."""


def draft_from_speech(transcript: str, now, known_names=()) -> dict:
    """Spoken words -> the fields of a task form. Everything is a SUGGESTION;
    the caller resolves the name and re-checks the date."""
    text = (transcript or "").strip()
    if not text:
        return {"provider": "rules"}
    system = VOICE_SYSTEM + (
        f"\n\nRight now it is {now:%A %d %B %Y, %H:%M}."
        + (f"\nPeople who may be named: {', '.join(known_names)}." if known_names else "")
    )
    # somebody is standing there having just spoken -- wait longer than a
    # background call would, and fall back to rules rather than fail
    data = llm.chat_json(system, text, max_tokens=900, timeout=75) or {}
    if not data.get("title"):
        base = draft_task(text)          # the deterministic fallback still applies
        rules = speech_rules(text, now, known_names)
        title = rules.pop("title", "")
        return {**base, **rules, **({"title": title} if title else {})}
    effort = data.get("effort_minutes")
    try:
        effort = int(effort) if effort not in (None, "") else None
    except (TypeError, ValueError):
        effort = None
    return {
        "title": str(data["title"])[:200],
        "description": str(data.get("description", ""))[:2000],
        "checklist": [str(s)[:200] for s in (data.get("checklist") or [])][:8],
        "assignee": (str(data["assignee"])[:80] if data.get("assignee") else None),
        "due_at": (str(data["due_at"])[:40] if data.get("due_at") else None),
        "effort_minutes": effort if (effort and 0 < effort <= 60 * 24 * 30) else None,
        "provider": llm.provider(),
    }


# ---- no-AI reading of a spoken task: who, by when, how long ---------------
_NUM = {w: n for n, ws in enumerate([
    (), ("one", "ek", "एक"), ("two", "do", "दो"), ("three", "teen", "तीन"),
    ("four", "char", "chaar", "चार"), ("five", "paanch", "panch", "पांच", "पाँच"),
    ("six", "chhe", "chah", "छह"), ("seven", "saat", "सात"), ("eight", "aath", "आठ"),
    ("nine", "nau", "नौ"), ("ten", "das", "दस"), ("eleven", "gyarah", "ग्यारह"),
    ("twelve", "barah", "बारह")]) for w in ws}
_N = r"(\d{1,3}(?:\.\d)?|" + "|".join(sorted(map(re.escape, _NUM), key=len, reverse=True)) + r")"
_WEEKDAYS = [("monday", "somvar", "सोमवार"), ("tuesday", "mangalvar", "मंगलवार"),
             ("wednesday", "budhvar", "बुधवार"), ("thursday", "guruvar", "गुरुवार"),
             ("friday", "shukravar", "शुक्रवार"), ("saturday", "shanivar", "शनिवार"),
             ("sunday", "ravivar", "रविवार")]
_PARTS = [(("subah", "morning", "सुबह"), 10), (("dopahar", "afternoon", "दोपहर"), 14),
          (("shaam", "sham", "evening", "शाम", "end of (?:the )?day", "eod"), 18),
          (("raat", "night", "रात"), 20)]


def _num(s):
    s = s.lower()
    return float(s) if re.match(r"\d", s) else float(_NUM.get(s, 0))


def _has(text, *words):
    return any(re.search(rf"(?<!\w){w}(?!\w)", text) for w in words)


def speech_rules(text: str, now, known_names=()) -> dict:
    """Without an AI key: pick out the person, the deadline and the effort
    from what was said, in English or Hinglish. Only what was actually said
    -- no name, no date means none is filled in."""
    t = " " + (text or "").lower() + " "

    # who: the longest known name that was said (full name beats first name)
    assignee = None
    for name in sorted(known_names, key=len, reverse=True):
        n = name.lower().strip()
        if n and _has(t, re.escape(n)):
            assignee = name
            break
    if not assignee:
        for name in known_names:
            first = name.lower().split()[0] if name.strip() else ""
            if len(first) >= 3 and _has(t, re.escape(first)):
                assignee = first                  # the caller sorts out who that is
                break

    # when: "in 2 hours" / "2 ghante mein" first, then a day and a time
    due = None
    rel = re.search(rf"(?:in|within)\s+{_N}\s*(hours?|hrs?|minutes?|mins?)(?!\w)"
                    rf"|{_N}\s*(ghante|ghanta|घंटे|minute|minat|मिनट)\s*(?:mein|me|में)", t)
    if rel:
        n = _num(rel.group(1) or rel.group(3))
        unit = rel.group(2) or rel.group(4)
        due = now + (timedelta(minutes=n) if unit.startswith(("min", "मि")) else timedelta(hours=n))
        t = t.replace(rel.group(0), " ")
    else:
        day = None
        if _has(t, "day after tomorrow", "parso", "parson", "परसों"):
            day = 2
        elif _has(t, "tomorrow", "kal", "कल"):
            day = 1
        elif _has(t, "today", "aaj", "आज", "abhi"):
            day = 0
        else:
            for i, names in enumerate(_WEEKDAYS):
                if _has(t, *names):
                    day = (i - now.weekday()) % 7 or 7
                    break
        hour = minute = None
        tm = re.search(r"(?<!\d)(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|baje|बजे|o.?clock)", t)
        if tm:
            hour, minute = int(tm.group(1)), int(tm.group(2) or 0)
            ap = tm.group(3).replace(".", "")
            if ap == "pm" and hour < 12:
                hour += 12
            elif ap == "am" and hour == 12:
                hour = 0
            elif ap not in ("am", "pm") and 1 <= hour <= 7 \
                    and not _has(t, "subah", "morning", "सुबह"):
                hour += 12                        # "5 baje" at work is 5 PM
        else:
            for words, h in _PARTS:
                if _has(t, *words):
                    hour, minute = h, 0
                    break
        if day is not None or hour is not None:
            base = now + timedelta(days=day or 0)
            if hour is None:
                hour, minute = 18, 0              # a day with no time: end of that day
            if 0 <= hour <= 23 and 0 <= (minute or 0) <= 59:
                due = base.replace(hour=hour, minute=minute or 0, second=0, microsecond=0)
                if day is None and due <= now:
                    due += timedelta(days=1)      # "5 baje" said at 6 PM: tomorrow

    # how long: "30 minutes" / "2 hours" / "1 ghanta" left over after the deadline
    effort = None
    ef = re.search(rf"{_N}\s*(hours?|hrs?|ghante|ghanta|घंटे|minutes?|mins?|minute|मिनट)(?!\w)", t)
    if ef:
        n = _num(ef.group(1))
        effort = int(n * 60) if ef.group(2).startswith(("h", "g", "घ")) else int(n)
        effort = effort if 0 < effort <= 60 * 24 * 30 else None

    return {"assignee": assignee,
            "due_at": due.replace(tzinfo=None).isoformat(timespec="minutes") if due else None,
            "effort_minutes": effort,
            "title": _speech_title(text, assignee)}


_FILLER = (r"(?:\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|baje|बजे|o.?clock)"
           r"|(?:in|within)\s+\S+\s*(?:hours?|hrs?|minutes?|mins?)"
           r"|\S+\s*(?:ghante|ghanta|घंटे|minute|minat|मिनट|minutes?|mins?|hours?|hrs?)"
           r"(?:\s*(?:mein|me|में|ka kaam|ka|lagega|lagenge))?"
           r"|day after tomorrow|tomorrow|today|parso|parson|kal|aaj|abhi|tak|by"
           r"|subah|morning|dopahar|afternoon|shaam|sham|evening|raat|night|eod"
           r"|monday|tuesday|wednesday|thursday|friday|saturday|sunday"
           r"|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar"
           r"|please|plz|karna hai|karni hai|karna|hai)")


def _speech_title(text, assignee):
    """The spoken sentence minus who / when / how long: what is left is the
    work itself, e.g. "Rahul ko kal 5 baje tak quotation bhejna hai" ->
    "Quotation bhejna"."""
    t = " " + (text or "") + " "
    if assignee:
        t = re.sub(rf"(?i)(?<!\w)(?:ask\s+|tell\s+)?{re.escape(assignee)}\w*"
                   rf"(?:\s+(?:ko|se|to|ne))?(?!\w)", " ", t)
    t = re.sub(rf"(?i)(?<!\w){_FILLER}(?!\w)", " ", t)
    words = t.split()
    title = " ".join(words[:12])
    return title[:1].upper() + title[1:] if len(words) >= 2 else ""


def draft_task(prompt: str) -> dict:
    prompt = (prompt or "").strip()
    if llm.enabled():
        data = llm.chat_json(DRAFT_SYSTEM, prompt)
        if data and data.get("title"):
            return {
                "title": str(data["title"])[:200],
                "description": str(data.get("description", ""))[:2000],
                "checklist": [str(s)[:200] for s in (data.get("checklist") or [])][:8],
                "provider": llm.provider(),
            }
    # deterministic fallback: first sentence -> title, steps split on
    # newlines / "then" / commas / "aur"
    first = re.split(r"[.\n!?]", prompt, 1)[0].strip()
    title = " ".join(first.split()[:12]).capitalize() or "New task"
    steps = [s.strip(" -•\t") for s in
             re.split(r"\n|,| then | and then | aur | phir ", prompt) if s.strip(" -•\t")]
    checklist = [" ".join(s.split()[:10]).capitalize() for s in steps[1:6]] \
        if len(steps) > 1 else []
    return {"title": title, "description": prompt[:2000],
            "checklist": checklist, "provider": "rules"}


def summarize_task(task, feed) -> dict:
    lines = [f"{a.created_at:%d %b}: {a.text}" for a in feed[:15]]
    if llm.enabled():
        data = llm.chat_json(SUMMARY_SYSTEM, (
            f"Task {task.code}: {task.title}\nStatus: {task.status} · "
            f"Priority: {task.priority} · Due: {task.due_at or '—'}\n"
            f"Assigned to: {task.assigned_to}\nDescription: {task.description[:500]}\n"
            f"Progress: {task.progress_percent or 0}% · effort {task.effort_minutes or '?'}m "
            f"assigned, {task.actual_minutes or 0}m spent\nRecent history:\n" + "\n".join(lines)))
        if data and data.get("summary"):
            return {"summary": str(data["summary"])[:1500], "provider": llm.provider()}
    parts = [f"{task.code} “{task.title}” is {task.get_status_display().lower()}"
             + (f", {task.progress_percent}% done" if task.progress_percent else "") + "."]
    if task.due_at:
        parts.append(f"Due {task.due_at:%d %b %H:%M}.")
    if task.effort_minutes:
        parts.append(f"Assigned effort {task.effort_minutes}m"
                     + (f", {task.actual_minutes}m spent so far" if task.actual_minutes else "") + ".")
    if lines:
        parts.append("Latest: " + lines[0].split(": ", 1)[-1] + ".")
    return {"summary": " ".join(parts), "provider": "rules"}


def review_sentence(r: dict) -> str:
    """Sir's review categories, computed from the D1–D4 stats. Pure rules —
    identical output with or without an API key."""
    completed, on_time = r["completed"], r["on_time_rate"]
    if completed == 0:
        return "No completions in this period — check the pipeline before judging."
    if on_time is None:
        # everything they finished was self-assigned, so nothing is scored
        return ("Only self-assigned work finished here — nothing to score. "
                "Delegate them real tasks to judge performance.")
    if on_time is not None and on_time >= 90 and (r["score"] or 0) >= 85:
        return ("Next level — on time every time. Make them a trainer/lead; "
                "consider promotion.")
    if r["multitask_days"] >= 3 and (on_time or 0) < 70:
        return ("Multitasker but below expected speed — train them, or reduce "
                "parallel load.")
    if (on_time or 0) < 50 or r["overdue"] > r["total"] / 2:
        return "Slow — give one task at a time and review daily."
    return "Steady — keep the current load, review effort values."


def proofread(text: str) -> dict:
    """Spelling/grammar pass over a description a person typed.

    Returns {"text", "changed", "provider"}. When AI is off or the call fails
    the original text comes back with changed=False -- a proofreader that
    cannot reach the model must hand back what it was given, never an error
    and never an empty box.
    """
    original = (text or "").strip()
    if not original:
        return {"text": "", "changed": False, "provider": "rules"}

    fixed = llm.chat(PROOFREAD_SYSTEM, original, max_tokens=900)
    if not fixed:
        return {"text": original, "changed": False, "provider": "rules"}

    fixed = fixed.strip()
    # A model that "helpfully" rewrites or truncates is worse than no model.
    # Length is the cheap tell: a proofread never changes size much.
    if not fixed or not (0.5 <= len(fixed) / len(original) <= 1.8):
        log.warning("proofread rejected: %d chars in, %d out", len(original), len(fixed))
        return {"text": original, "changed": False, "provider": "rules"}

    return {"text": fixed, "changed": fixed != original, "provider": llm.provider()}
