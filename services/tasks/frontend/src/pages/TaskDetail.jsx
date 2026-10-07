/* E1: Task detail slide-over — everything about ONE task in one panel:
   header chips, checklist, sub-tasks, comments, updates feed, attachments,
   plus the action row and the per-task AI summary (E3). */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiUpload, errorText } from '../api'
import { CompleteModal, DayLogModal, ProgressModal, RequestChangeModal } from './TaskExtras'
import { fmtEffort, relDue } from './Tasks'
import ProofreadText from '../ProofreadText'
import FilePick from '../FilePick'

const fmtDT = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : null

export default function TaskDetailPanel({ taskId, user, team, settings,
                                          focusComment = false, review = null,
                                          onClose, onChanged }) {
  const [t, setT] = useState(null)
  const [feed, setFeed] = useState([])
  const [files, setFiles] = useState([])
  const [comment, setComment] = useState('')
  const [newCheck, setNewCheck] = useState('')
  const [newCheckDue, setNewCheckDue] = useState('')
  const [summary, setSummary] = useState(null)
  const [modal, setModal] = useState(null)       // progress | complete | request
  const [logDay, setLogDay] = useState(null)    // the day being written in the daily log
  const [ticking, setTicking] = useState(null)  // the step being ticked
  const [stepNote, setStepNote] = useState('')  // "what did you do" for that step
  const focusedOnce = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  // a completion waiting for ME to accept on this task, if there is one
  const [pending, setPending] = useState(null)
  const [sendingBack, setSendingBack] = useState(review === 'reject')
  const [why, setWhy] = useState('')
  const [deciding, setDeciding] = useState(false)
  const reviewRef = useRef(null)

  const load = useCallback(() => {
    api(`/api/task-completions/?scope=inbox&task=${taskId}`)
      .then(d => setPending((d.results || d)[0] || null)).catch(() => setPending(null))
    api(`/api/tasks/${taskId}/`).then(setT).catch(e => setErr(e.message))
    api(`/api/tasks/${taskId}/activity/`).then(setFeed).catch(() => {})
    api(`/api/tasks/${taskId}/files/`).then(setFiles).catch(() => {})
  }, [taskId])
  useEffect(() => { load() }, [load])

  // arriving from the email: bring the review into view
  useEffect(() => {
    if (review && pending && reviewRef.current) {
      reviewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [review, pending])

  const decide = async (decision, remarks = '') => {
    setErr(''); setDeciding(true)
    try {
      await api(`/api/task-completions/${pending.id}/review/`,
        { method: 'POST', body: { decision, remarks } })
      setSendingBack(false); setWhy('')
      load(); onChanged?.()
    } catch (ex) { setErr(errorText(ex.data) || ex.message) }
    finally { setDeciding(false) }
  }

  const post = async (path, body, method = 'POST') => {
    setErr('')
    try {
      const res = await api(`/api/tasks/${taskId}/${path}`, { method, body })
      load(); onChanged?.()
      return res
    } catch (e) { setErr(errorText(e.data) || e.message) }
  }

  const dl = t?.day_log
  const isAssignee = t?.assigned_to === user.id
  const canAct = t && t.status !== 'done'
  const doneChecks = t?.checklist?.filter(c => c.done).length ?? 0
  const openSteps = (t?.checklist?.length ?? 0) - doneChecks

  return (
    <div className="modal side"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card side-panel narrow">
        {!t && <p className="muted">Loading…</p>}
        {t && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span className="t-code" style={{ fontSize: 13 }}>{t.code}</span>
              <h2 style={{ margin: 0, flex: 1 }}>{t.title}</h2>
              <button className="btn btn-sm" onClick={onClose}>✕</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
              <span className={`q-pill q-${t.status === 'done' ? 'approved' : 'under_review'}`}>{t.status_display}</span>
              {t.category && <span className="ai-chip">{t.category}</span>}
              {t.priority !== 'normal' && <span className={`prio prio-${t.priority}`}>{t.priority_display}</span>}
              {t.effort_minutes && <span className="ai-chip">⏱ {fmtEffort(t.effort_minutes)}</span>}
              {t.actual_minutes && <span className="ai-chip">⏲ {fmtEffort(t.actual_minutes)} spent</span>}
              {t.progress_percent != null && t.status !== 'done' && <span className="ai-chip">▰ {t.progress_percent}%</span>}
              {t.parent_code && <span className="ai-chip">↑ sub-task of {t.parent_code}</span>}
            </div>
            {t.description && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>}
            <p className="small muted">
              Assigned to <strong>{t.assigned_to_detail?.name}</strong>
              {t.created_by_detail && <> by <strong>{t.created_by_detail.name}</strong></>}
              {t.due_at && <> · due {fmtDT(t.due_at)} ({relDue(t.due_at)})</>}
              {t.completed_at && <> · completed {fmtDT(t.completed_at)}</>}
              {t.lead_name && <> · lead: {t.lead_name}</>}
            </p>

            {/* action row */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
              {canAct && isAssignee && (
                <>
                  <button className="btn btn-sm" onClick={() => setModal('progress')}>+ Status update</button>
                  {dl?.days?.some(d => d.is_today) && (
                    <button className="btn btn-sm" title="Write what you did today"
                      onClick={() => setLogDay(dl.days.find(d => d.is_today))}>
                      📓 Today&rsquo;s log
                    </button>
                  )}
                  <button className="btn btn-sm btn-primary" disabled={openSteps > 0}
                    title={openSteps > 0
                      ? `Finish the ${openSteps} open step(s) first`
                      : 'Complete this task'}
                    onClick={() => setModal('complete')}>Complete</button>
                </>
              )}
              {canAct && <button className="btn btn-sm" onClick={() => setModal('request')}>
                {user.capabilities?.includes('tasks.view_all') ? 'Edit' : 'Request change'}</button>}
              {t.can_delete && (
                <button className="btn btn-sm btn-danger"
                  title="Move this task to the Deleted bin"
                  onClick={async () => {
                    if (!window.confirm(
                      `Delete ${t.code}?\n\n"${t.title}"\n\n`
                      + 'It moves to the Deleted bin and can be restored by an admin.')) return
                    const res = await api(`/api/tasks/${t.id}/`, { method: 'DELETE' })
                      .then(() => true).catch(e => { setErr(errorText(e.data) || e.message); return false })
                    if (res) { onChanged?.(); onClose?.() }
                  }}>Delete</button>
              )}
              <button className="btn btn-sm" title="AI summary (works without AI too)"
                onClick={async () => {
                  const r = await post('summarize/', {})
                  if (r) setSummary(r)
                }}>✨ Summarize</button>
            </div>
            {summary && (
              <div className="small" style={{ padding: 10, background: 'var(--bg)', borderRadius: 8 }}>
                {summary.summary} <span className="muted">({summary.provider})</span>
              </div>
            )}
            {err && <div className="err">{err}</div>}

            {pending && (
              <div className="review-box" ref={reviewRef}>
                <div className="review-head">Waiting for you to accept</div>
                <div className="small">
                  <strong>{pending.submitted_by?.name}</strong> marked this done
                  {pending.task_actual_minutes ? <> · took {pending.task_actual_minutes}m</> : null}
                  {pending.task_effort_minutes ? <> against {pending.task_effort_minutes}m</> : null}
                </div>
                {pending.note && <div className="small prose" style={{ marginTop: 4 }}>“{pending.note}”</div>}
                {!sendingBack ? (
                  <div className="review-actions">
                    <button className="btn btn-primary" disabled={deciding}
                      onClick={() => decide('approved')}>
                      {deciding ? 'Saving…' : 'Accept'}
                    </button>
                    <button className="btn" disabled={deciding}
                      onClick={() => setSendingBack(true)}>Send back</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <ProofreadText label="What is wrong? *" value={why} onChange={setWhy} rows={2}
                      autoFocus placeholder="e.g. The bank letter is missing — attach it and complete again." />
                    <div className="review-actions">
                      <button className="btn btn-danger" disabled={deciding || why.trim().length < 10}
                        onClick={() => decide('rejected', why.trim())}>
                        {deciding ? 'Sending…' : 'Send it back'}
                      </button>
                      <button className="btn" onClick={() => { setSendingBack(false); setWhy('') }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* checklist */}
            <h3 style={{ margin: '14px 0 6px' }}>
              Checklist {t.checklist.length > 0 && <span className="muted small">{doneChecks}/{t.checklist.length}</span>}
            </h3>
            {openSteps > 0 && (
              <div className="step-gate" style={{ marginBottom: 8 }}>
                {openSteps} step{openSteps === 1 ? '' : 's'} left — the task can only be
                completed once every step is ticked.
              </div>
            )}
            {t.checklist.map(c => (
              <div key={c.id} className={'step-row' + (c.done ? ' done' : '')}>
                {/* the row is the target, not the box inside it -- 48px tall,
                    tick anywhere on the text */}
                <button type="button" className="step-hit"
                  title={c.done ? 'Re-open this step' : 'Tick and say what you did'}
                  onClick={() => (c.done ? post(`check/${c.id}/`, {}) : setTicking(c))}>
                  <input type="checkbox" checked={c.done} readOnly tabIndex={-1} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="small step-label">{c.text}
                      {c.due_at && <span className="muted" style={{ marginLeft: 6 }}>· Due: {fmtDT(c.due_at)}</span>}
                    </span>
                    {c.done && c.note && (
                      <span className="step-note" style={{ display: 'block' }}>
                        ✓ {c.note}
                        {c.done_by_name && <> — {c.done_by_name}</>}
                        {c.done_at && <>, {fmtDT(c.done_at)}</>}
                      </span>
                    )}
                  </span>
                </button>
                {!c.done && (
                  /* Deleting used to be the bigger, easier target of the two.
                     It now confirms, and sits clear of the tick area. */
                  <button className="btn btn-sm step-del" title="Remove this step"
                    onClick={() => {
                      if (confirm(`Remove this step?\n\n"${c.text}"`)) {
                        post(`check/${c.id}/?delete=true`, {})
                      }
                    }}>✕</button>
                )}
              </div>
            ))}
            {ticking && (
              <div className="modal" onMouseDown={e => {
                if (e.target === e.currentTarget) { setTicking(null); setStepNote('') }
              }}>
                <div className="modal-card" style={{ width: 460 }}>
                  <h2 style={{ fontSize: 18 }}>Step done</h2>
                  <p className="muted small" style={{ margin: '4px 0 10px' }}>{ticking.text}</p>
                  <ProofreadText label="What did you do? *" value={stepNote} rows={3} autoFocus
                    onChange={setStepNote}
                    placeholder="e.g. Collected the invoice copy and filed it under Aug" />
                  <div className="modal-actions">
                    <button className="btn" onClick={() => { setTicking(null); setStepNote('') }}>Cancel</button>
                    <button className="btn btn-primary" disabled={stepNote.trim().length < 5}
                      onClick={async () => {
                        await post(`check/${ticking.id}/`, { note: stepNote.trim() })
                        setTicking(null); setStepNote('')
                      }}>Mark done</button>
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input placeholder="Add a step…" value={newCheck} style={{ flex: 1 }}
                onChange={e => setNewCheck(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newCheck.trim()) {
                    e.preventDefault()
                    await post('add_check/', { text: newCheck.trim(), due_at: newCheckDue || undefined }); setNewCheck(''); setNewCheckDue('')
                  }
                }} />
              <input type="datetime-local" value={newCheckDue} onChange={e => setNewCheckDue(e.target.value)} title="Optional due time for this step" style={{ width: '180px' }} />
              <button className="btn btn-sm btn-primary" disabled={!newCheck.trim()}
                onClick={async () => { await post('add_check/', { text: newCheck.trim(), due_at: newCheckDue || undefined }); setNewCheck(''); setNewCheckDue('') }}>
                + Add step
              </button>
            </div>

            {/* sub-tasks */}
            {t.subtasks.length > 0 && (
              <>
                <h3 style={{ margin: '14px 0 6px' }}>Sub-tasks</h3>
                {t.subtasks.map(s => (
                  <div key={s.id} className="small" style={{ padding: '3px 0' }}>
                    <span className="t-code">{s.code}</span> {s.title}
                    <span className="muted"> — {s.assignee} · {s.status}</span>
                  </div>
                ))}
              </>
            )}

            {/* daily progress log — one row per calendar day, blanks included */}
            {dl && dl.days.length > 1 && (
              <>
                <h3 style={{ margin: '14px 0 6px' }}>
                  Daily progress log{' '}
                  <span className="muted small">{dl.logged_days}/{dl.days.length} days</span>
                </h3>
                {dl.missed_days > 0 && (
                  <p className="muted small" style={{ margin: '0 0 6px' }}>
                    {dl.missed_days} day{dl.missed_days === 1 ? '' : 's'} with nothing written.
                  </p>
                )}
                {dl.logged_minutes > 0 && (
                  <p className="muted small" style={{ margin: '0 0 6px' }}>
                    Logged day by day: {fmtEffort(dl.logged_minutes)}
                    {t.actual_minutes ? <> · recorded total on the task: {fmtEffort(t.actual_minutes)}</> : null}
                  </p>
                )}
                {dl.days.map(d => {
                  const daysAgo = Math.round((new Date(dl.today) - new Date(d.date)) / 864e5)
                  const canWriteDay = dl.can_write && !d.is_future && daysAgo <= dl.backfill_days
                  return (
                    <div key={d.date} className="small" style={{
                      display: 'flex', gap: 8, alignItems: 'flex-start',
                      padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                      background: d.entry ? 'rgba(13,122,95,.08)' : 'transparent',
                      borderLeft: `3px solid ${d.entry ? 'var(--accent)' : 'var(--line)'}`,
                      opacity: d.entry || d.is_today ? 1 : .65,
                    }}>
                      <div style={{ width: 88, flexShrink: 0 }}>
                        <strong>{d.label}</strong>
                        {d.is_today && <span className="muted"> · today</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {d.entry ? (
                          <>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{d.entry.did}</div>
                            {d.entry.plan_tomorrow && (
                              <div className="muted">→ Next: {d.entry.plan_tomorrow}</div>
                            )}
                            <div className="muted">
                              {d.entry.percent_done != null && <>▰ {d.entry.percent_done}% · </>}
                              {d.entry.minutes_spent ? <>⏲ {fmtEffort(d.entry.minutes_spent)} · </> : null}
                              {d.entry.author_name}
                            </div>
                          </>
                        ) : (
                          <span className="muted">
                            {d.is_future ? 'Not yet' : 'Nothing written'}
                          </span>
                        )}
                      </div>
                      {canWriteDay && (
                        <button className="btn btn-sm" onClick={() => setLogDay(d)}>
                          {d.entry ? 'Edit' : 'Add'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* attachments — reference files, addable at any time */}
            <h3 style={{ margin: '14px 0 6px' }}>
              Attachments {files.length > 0 && <span className="muted small">{files.length}</span>}
            </h3>
            {files.map(f => (
              <div key={f.id} className="small" style={{ padding: '2px 0' }}>
                📎 <a href={f.url} target="_blank" rel="noreferrer">{f.filename}</a>
                <span className="muted"> · {f.uploaded_by?.name}</span>
              </div>
            ))}
            {files.length === 0 && <p className="muted small">No files yet.</p>}
            <div style={{ marginTop: 6 }}>
              <FilePick busy={uploading} onPick={async all => {
                const picked = all.slice(0, 5)
                setErr(''); setUploading(true)
                try {
                  const fd = new FormData()
                  picked.forEach(f => fd.append('file', f))
                  await apiUpload(`/api/tasks/${taskId}/upload/`, fd)
                  load(); onChanged?.()
                } catch (ex) { setErr(errorText(ex.data) || ex.message) }
                finally { setUploading(false) }
              }} />
              <div className="muted small">
                {uploading ? 'Uploading…' : 'Up to 5 files, 10 MB each.'}
              </div>
            </div>

            {/* comments + updates feed */}
            <h3 style={{ margin: '14px 0 6px' }}>Comments &amp; updates</h3>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input placeholder="Write a comment…" value={comment} style={{ flex: 1 }}
                ref={el => { if (el && focusComment && !focusedOnce.current) {
                  focusedOnce.current = true
                  el.scrollIntoView({ block: 'center' }); el.focus()
                } }}
                onChange={e => setComment(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && comment.trim()) {
                    e.preventDefault()
                    await post('comment/', { text: comment.trim() }); setComment('')
                  }
                }} />
              <button className="btn btn-sm btn-primary" disabled={!comment.trim()}
                onClick={async () => { await post('comment/', { text: comment.trim() }); setComment('') }}>Send</button>
            </div>
            {feed.map(a => (
              <div key={a.id} className="small" style={{
                padding: '5px 8px', marginBottom: 4, borderRadius: 6,
                background: a.kind === 'comment' ? 'rgba(13,122,95,.08)' : 'transparent',
                borderLeft: a.kind === 'comment' ? '3px solid var(--accent)' : '3px solid var(--line)',
              }}>
                {a.kind === 'comment' && '💬 '}<strong>{a.actor?.name || 'System'}</strong>
                <span className="muted"> · {fmtDT(a.created_at)}</span>
                <div>{a.text}</div>
              </div>
            ))}
          </>
        )}
      </div>

      {modal === 'progress' && t && (
        <ProgressModal task={t} onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); onChanged?.() }} />
      )}
      {logDay && t && (
        <DayLogModal task={t} day={logDay} onClose={() => setLogDay(null)}
          onDone={() => { setLogDay(null); load(); onChanged?.() }} />
      )}
      {modal === 'complete' && t && (
        <CompleteModal task={t} settings={settings} onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); onChanged?.() }} />
      )}
      {modal === 'request' && t && (
        <RequestChangeModal task={t} team={team} user={user}
          isAdmin={user.capabilities?.includes('tasks.view_all')}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); onChanged?.() }} />
      )}
    </div>
  )
}
