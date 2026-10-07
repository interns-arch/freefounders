import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, errorText } from '../api'
import ProofreadText from '../ProofreadText'

const fmtDT = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '—'

const mins = (m) => (!m ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 || ''}`.trim() + 'm' : `${m}m`)

const IMAGE = /\.(jpe?g|png|gif|webp|heic|bmp)$/i

/* The photos and files sent with the work -- the reviewer judges from these,
   so photos show as thumbnails rather than names to click through. */
function ProofFiles({ files }) {
  const images = files.filter(f => IMAGE.test(f.filename))
  const others = files.filter(f => !IMAGE.test(f.filename))
  return (
    <div className="proof">
      <div className="proof-label">Proof attached · {files.length}</div>
      {images.length > 0 && (
        <div className="proof-thumbs">
          {images.map(f => (
            <a key={f.id} href={f.url} target="_blank" rel="noreferrer" title={f.filename}>
              <img src={f.url} alt={f.filename} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="proof-chips">
          {others.map(f => (
            <a key={f.id} className="proof-chip" href={f.url} target="_blank" rel="noreferrer">
              📎 {f.filename}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/* Work submitted as done, waiting for the person who gave it to accept.
 *
 * Accepting is one click. Sending it back needs a reason -- being told "redo
 * it" with no explanation wastes the second attempt as well as the first.
 *
 * In "To accept" a reviewer can also tick rows, or narrow to one person, and
 * accept them in one go. Only the rows on screen are sent, so anything
 * submitted after the page loaded is never accepted unseen.
 */
export default function CompletionReviews({ isAdmin, onChanged }) {
  const [scope, setScope] = useState('inbox')
  const [rows, setRows] = useState(null)
  const [rejecting, setRejecting] = useState(null)   // id being sent back
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [total, setTotal] = useState(0)            // server count; may exceed one page
  const [person, setPerson] = useState('')         // submitter filter, inbox only
  const [picked, setPicked] = useState(() => new Set())

  const load = useCallback(() => {
    api(`/api/task-completions/?scope=${scope}&page_size=300`)
      .then(d => {
        const list = d.results || d
        setRows(list); setTotal(d.count ?? list.length)
        // drop ticks on rows that are gone (accepted elsewhere, sent back...)
        setPicked(prev => new Set(list.filter(r => prev.has(r.id)).map(r => r.id)))
      })
      .catch(e => setErr(errorText(e.data) || e.message))
  }, [scope])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPerson(''); setPicked(new Set()) }, [scope])

  const inbox = scope === 'inbox'
  const people = useMemo(() => {
    const m = new Map()
    ;(rows || []).forEach(r => {
      const p = r.submitted_by
      if (!p) return
      const cur = m.get(p.id) || { id: p.id, name: p.name, n: 0 }
      cur.n += 1; m.set(p.id, cur)
    })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])
  // everyone from the picked person accepted -> back to the full list
  useEffect(() => {
    if (person && !people.some(p => String(p.id) === person)) setPerson('')
  }, [person, people])
  const shown = useMemo(() => (rows || []).filter(
    r => !inbox || !person || String(r.submitted_by?.id) === person), [rows, inbox, person])
  const pendingShown = shown.filter(r => r.status === 'pending')
  const allTicked = pendingShown.length > 0 && pendingShown.every(r => picked.has(r.id))
  const personName = people.find(p => String(p.id) === person)?.name

  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const toggleAll = () => setPicked(prev => {
    const next = new Set(prev)
    pendingShown.forEach(r => (allTicked ? next.delete(r.id) : next.add(r.id)))
    return next
  })

  const acceptMany = async (list, what) => {
    if (!list.length) return
    if (!confirm(`Accept ${list.length} task(s) ${what}?\n\n`
      + 'Each person gets one notification listing what you accepted.')) return
    setErr(''); setBusy(true)
    try {
      const res = await api('/api/task-completions/bulk_accept/',
        { method: 'POST', body: { ids: list.map(r => r.id) } })
      setPicked(new Set())
      if (res.skipped) {
        alert(`Accepted ${res.accepted}. ${res.skipped} were already decided and were left as they were.`)
      }
      load(); onChanged?.()
    } catch (e) { setErr(errorText(e.data) || e.message) }
    finally { setBusy(false) }
  }
  const tickedRows = pendingShown.filter(r => picked.has(r.id))

  const decide = async (row, decision, remarks = '') => {
    setErr(''); setBusy(true)
    try {
      await api(`/api/task-completions/${row.id}/review/`,
        { method: 'POST', body: { decision, remarks } })
      setRejecting(null); setWhy('')
      load(); onChanged?.()
    } catch (e) { setErr(errorText(e.data) || e.message) }
    finally { setBusy(false) }
  }

  if (err && !rows) return <div className="err">{err}</div>
  if (!rows) return <div className="center-note">Loading…</div>

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="filters">
        <div className="seg">
          <button className={'seg-btn' + (scope === 'inbox' ? ' on' : '')}
            onClick={() => setScope('inbox')}>To accept</button>
          <button className={'seg-btn' + (scope === 'mine' ? ' on' : '')}
            onClick={() => setScope('mine')}>My submissions</button>
          {isAdmin && (
            <button className={'seg-btn' + (scope === 'all' ? ' on' : '')}
              onClick={() => setScope('all')}>All (log)</button>
          )}
        </div>
      </div>
      {inbox && rows.length > 0 && (
        <div className="filters">
          <select value={person} onChange={e => setPerson(e.target.value)}
            title="Show one person's submissions">
            <option value="">All people ({rows.length})</option>
            {people.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.n})</option>
            ))}
          </select>
          <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={allTicked}
              onChange={toggleAll} disabled={busy || pendingShown.length === 0} />
            Select all shown
          </label>
          <span style={{ flex: 1 }} />
          {tickedRows.length > 0 && (
            <button className="btn" disabled={busy}
              onClick={() => acceptMany(tickedRows, 'that you ticked')}>
              Accept selected ({tickedRows.length})
            </button>
          )}
          <button className="btn btn-primary" disabled={busy || pendingShown.length === 0}
            onClick={() => acceptMany(pendingShown,
              personName ? `from ${personName}` : 'from everyone')}>
            {busy ? 'Accepting…'
              : personName ? `Accept all from ${personName} (${pendingShown.length})`
                : `Accept all (${pendingShown.length})`}
          </button>
        </div>
      )}
      {inbox && total > rows.length && (
        <p className="small muted">
          Showing the latest {rows.length} of {total}. Accept these and the rest will load.
        </p>
      )}
      {err && <div className="err">{err}</div>}
      {rows.length === 0 && (
        <p className="muted">
          {scope === 'inbox'
            ? 'Nothing waiting for you to accept.'
            : 'Nothing here yet.'}
        </p>
      )}

      <div className="task-list">
        {shown.map(r => {
          const late = r.task_due_at && r.created_at
            && new Date(r.created_at) > new Date(r.task_due_at)
          const over = r.task_actual_minutes && r.task_effort_minutes
            && r.task_actual_minutes > r.task_effort_minutes
          return (
            <div className="task-row" key={r.id} style={{ flexWrap: 'wrap' }}>
              {inbox && r.status === 'pending' && (
                <input type="checkbox" aria-label={`Select ${r.task_code}`}
                  style={{ width: 'auto', alignSelf: 'flex-start', marginTop: 6 }}
                  checked={picked.has(r.id)} onChange={() => toggle(r.id)} disabled={busy} />
              )}
              <div className="task-main">
                <div className="task-title">
                  <span className="t-code">{r.task_code}</span>{r.task_title}
                  {r.status !== 'pending' && (
                    <span className={'ai-chip' + (r.status === 'rejected' ? ' prio prio-high' : '')}>
                      {r.status_display}
                    </span>
                  )}
                  {late && <span className="prio prio-high">finished late</span>}
                </div>
                <div className="when">
                  {r.submitted_by?.name} · submitted {fmtDT(r.created_at)} ·{' '}
                  took <strong>{mins(r.task_actual_minutes)}</strong> against{' '}
                  {mins(r.task_effort_minutes)}
                  {over && <span className="late"> · over estimate</span>}
                </div>
                {r.note && <div className="small muted prose" style={{ marginTop: 4 }}>{r.note}</div>}
                {r.files?.length > 0 && <ProofFiles files={r.files} />}
                {r.remarks && (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    <strong>{r.status === 'rejected' ? 'Sent back' : 'Note'}:</strong> {r.remarks}
                  </div>
                )}

                {rejecting === r.id && (
                  <div style={{ marginTop: 8 }}>
                    <ProofreadText label="What is wrong? *" value={why} onChange={setWhy}
                      rows={2}
                      placeholder="e.g. The invoice copy is missing — attach it and complete again." />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button className="btn btn-danger" disabled={busy || why.trim().length < 10}
                        onClick={() => decide(r, 'rejected', why.trim())}>
                        {busy ? 'Sending…' : 'Send it back'}
                      </button>
                      <button className="btn" onClick={() => { setRejecting(null); setWhy('') }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {r.status === 'pending' && rejecting !== r.id && (
                <div className="row-actions">
                  <button className="btn btn-primary" disabled={busy}
                    onClick={() => decide(r, 'approved')}>Accept</button>
                  <button className="btn" disabled={busy}
                    onClick={() => { setRejecting(r.id); setWhy('') }}>Send back</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
