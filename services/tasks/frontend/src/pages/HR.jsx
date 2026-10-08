import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, apiBlobUrl, apiUpload, errorText } from '../api'
import { useAuth } from '../auth'
import { MySalary, PayrollAdmin } from './Payroll'
import FaceCapture from './FaceCapture'

const fmtT = (iso) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'
const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const hrs = (m) => m ? `${Math.floor(m / 60)}h ${m % 60}m` : '—'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS_LABEL = {
  present: 'Present', absent: 'Absent', half_day: 'Half Day', late: 'Late',
  leave: 'Leave', holiday: 'Holiday', week_off: 'Week Off', not_checked_in: 'Not checked in',
}

export default function HR() {
  const { can, module } = useAuth()
  const [params] = useSearchParams()
  const payroll = module('payroll')
  // Under the "manager approves" rule a manager without hr.approve still approves their team's leave.
  const [hrCfg, setHrCfg] = useState(null)
  useEffect(() => { api('/api/hr/config/').then(setHrCfg).catch(() => {}) }, [])
  const approves = can('hr.approve') || !!hrCfg?.can_approve
  const tabs = [
    ['today', 'Today'], ['history', 'My Attendance'], ['leave', 'My Leave'],
    ...(payroll ? [['salary', 'My Salary']] : []), ['holidays', 'Holidays'],
    ...(can('hr.approve') ? [['team', 'Team']] : []),
    ...(approves ? [['approvals', 'Approvals']] : []),
    ...(can('hr.manage') ? [...(payroll ? [['payroll', 'Payroll']] : []), ['settings', 'HR Settings']] : []),
  ]
  // ?tab=settings opens a tab directly (the FreeFounders Settings page links here).
  const [tab, setTab] = useState(() => (tabs.some(([v]) => v === params.get('tab')) ? params.get('tab') : 'today'))
  return (
    <div>
      <div className="page-head"><h1>Leave &amp; Attendance</h1></div>
      <div className="area-tabs">
        {tabs.map(([v, l]) => (
          <button key={v} className={'tab' + (tab === v ? ' on' : '')} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>
      {tab === 'today' && <Today />}
      {tab === 'history' && <MyAttendance />}
      {tab === 'leave' && <MyLeave />}
      {tab === 'salary' && <MySalary />}
      {tab === 'holidays' && <Holidays />}
      {tab === 'payroll' && <PayrollAdmin />}
      {tab === 'team' && <TeamToday />}
      {tab === 'approvals' && <Approvals />}
      {tab === 'settings' && <HRSettings />}
    </div>
  )
}

/* ---------------- Holidays (moved here from Tasks — reviewer ask) ------- */

function Holidays() {
  const { can } = useAuth()
  const canManage = can('settings.manage')
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [f, setF] = useState({ name: '', date: '' })

  const load = () => api('/api/holidays/').then(setRows).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  const add = async () => {
    setErr('')
    try { await api('/api/holidays/', { method: 'POST', body: f }); setF({ name: '', date: '' }); load() }
    catch (e) { setErr(errorText(e.data) || e.message) }
  }
  const remove = async (h) => {
    try { await api(`/api/holidays/${h.id}/`, { method: 'DELETE' }); load() }
    catch (e) { setErr(errorText(e.data) || e.message) }
  }

  return (
    <div>
      {canManage && (
        <div className="filters">
          <input placeholder="Holiday name" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} />
          <input type="date" value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} />
          <button className="btn btn-primary" disabled={!f.name.trim() || !f.date} onClick={add}>Add holiday</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
      {rows.length === 0 && <p className="muted">No holidays configured.</p>}
      <table className="table" style={{ maxWidth: 480 }}>
        <thead><tr><th>Holiday</th><th>Date</th>{canManage && <th />}</tr></thead>
        <tbody>
          {rows.map(h => (
            <tr key={h.id}>
              <td><strong>{h.name}</strong></td>
              <td>{new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</td>
              {canManage && <td className="row-actions"><button className="btn btn-sm" onClick={() => remove(h)}>Delete</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- Today: check in / out ---------------- */

function Today() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [faceFor, setFaceFor] = useState(null)   // 'check_in' | 'check_out' while the camera is open

  const load = useCallback(() => {
    api('/api/attendance/today/').then(setData).catch(e => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const getPosition = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({})
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve({}),               // permission denied / unavailable -> server decides
      { timeout: 8000, enableHighAccuracy: true },
    )
  })

  const send = async (which, faceDescriptor, photo) => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const pos = await getPosition()
      const body = { ...pos, ...(faceDescriptor ? { face_descriptor: faceDescriptor } : {}), ...(photo ? { photo } : {}) }
      await api(`/api/attendance/${which}/`, { method: 'POST', body })
      setMsg(which === 'check_in' ? 'Checked in ✅' : 'Checked out ✅')
      load()
    } catch (e) {
      setErr(errorText(e.data) || e.message)
    } finally { setBusy(false) }
  }

  // With face attendance or punch photos switched on, the camera step comes first.
  const usesCamera = data?.face_enabled || (data?.photo && data.photo !== 'off')
  const mark = (which) => (usesCamera ? setFaceFor(which) : send(which))

  if (err && !data) return <div className="err">{err}</div>
  if (!data) return <div className="center-note">Loading…</div>
  const a = data.attendance

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="stats">
        <div className="stat"><div className="label">Check in</div><div className="value">{fmtT(a?.check_in)}</div></div>
        <div className="stat"><div className="label">Check out</div><div className="value">{fmtT(a?.check_out)}</div></div>
        <div className="stat"><div className="label">Worked</div><div className="value">{hrs(a?.working_minutes)}</div></div>
        <div className={'stat' + (a?.is_late ? ' alert' : '')}>
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: 17 }}>{a ? STATUS_LABEL[a.status] : '—'}</div>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="placeholder-card" style={{ marginTop: 0 }}><h3>{msg}</h3></div>}
      <div className="dash-card">
        <h3>Mark attendance</h3>
        <p className="muted small" style={{ marginBottom: 10 }}>
          Office hours {data.work_start}–{data.work_end}.
          {data.geofence_enabled
            ? ' Location check is ON — allow GPS access.'
            : ' Location check is off.'}
          {data.face_enabled && (data.face_enrolled
            ? ' Face verification is ON.'
            : data.face_self_enroll
              ? ' Face verification is ON — first time? Your face will be saved on your first check-in, just like setting up a phone face lock.'
              : ' Face verification is ON but you are not enrolled — ask an admin.')}
          {data.photo === 'required' && ' A photo is taken at every check-in and check-out.'}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || !data.can_check_in}
            onClick={() => mark('check_in')}>
            {busy ? 'Working…' : usesCamera ? '📷 Check in' : 'Check in'}
          </button>
          <button className="btn" disabled={busy || !data.can_check_out}
            onClick={() => mark('check_out')}>
            {usesCamera ? '📷 Check out' : 'Check out'}
          </button>
        </div>
      </div>

      {faceFor && (
        <FaceCapture
          face={!!data.face_enabled}
          photo={data.photo && data.photo !== 'off'}
          title={data.face_enabled
            ? (faceFor === 'check_in' ? 'Check in with your face' : 'Check out with your face')
            : (faceFor === 'check_in' ? 'Check in' : 'Check out')}
          action={faceFor === 'check_in' ? 'Check in' : 'Check out'}
          hint={data.face_enrolled ? undefined
            : data.face_self_enroll
              ? 'First time: this capture becomes your face profile. Look straight at the camera in good light, without a mask.'
              : 'Your face is not enrolled yet — ask an admin to enrol you first.'}
          onClose={() => setFaceFor(null)}
          onCapture={(descriptor, photo) => { const w = faceFor; setFaceFor(null); send(w, descriptor, photo) }}
        />
      )}
    </div>
  )
}

/* ---------------- My attendance: month view ---------------- */

function MyAttendance({ userId, userName }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [showCorrection, setShowCorrection] = useState(null)
  const [selected, setSelected] = useState(null)   // the day opened from the calendar

  const load = useCallback(() => {
    const p = new URLSearchParams({ year, month })
    if (userId) p.set('user', userId)
    api(`/api/attendance/monthly/?${p}`).then(setData).catch(e => setErr(e.message))
  }, [year, month, userId])
  useEffect(() => { load() }, [load])

  const shift = (delta) => {
    let m = month + delta, y = year
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setMonth(m); setYear(y); setSelected(null)
  }

  if (err) return <div className="err">{err}</div>
  if (!data) return <div className="center-note">Loading…</div>
  const t = data.totals

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="filters">
        <button className="btn btn-sm" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <select value={month} onChange={e => { setMonth(Number(e.target.value)); setSelected(null) }}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => { setYear(Number(e.target.value)); setSelected(null) }}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn btn-sm" onClick={() => shift(1)} aria-label="Next month">›</button>
        {userName && <span className="muted">· {userName}</span>}
        <span className="muted small" style={{ marginLeft: 'auto' }}>Total {data.total_hours} h</span>
      </div>
      <div className="stats">
        {[['Present', t.present], ['Late', t.late], ['Half Day', t.half_day],
          ['Leave', t.leave], ['Absent', t.absent, t.absent > 0], ['Week Off', t.week_off]]
          .map(([l, v, alert]) => (
            <div key={l} className={'stat' + (alert ? ' alert' : '')}>
              <div className="label">{l}</div><div className="value">{v || 0}</div>
            </div>
          ))}
      </div>
      <AttendanceCalendar
        days={data.days} year={year} month={month}
        selected={selected} onSelect={d => setSelected(selected?.date === d.date ? null : d)}
      />
      {selected && (
        <div className="dash-card" style={{ marginTop: 12 }}>
          <h3>{new Date(selected.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' '}<span className={`q-pill q-${selected.status}`}>{STATUS_LABEL[selected.status]}{selected.holiday ? `: ${selected.holiday}` : ''}</span>
          </h3>
          <div className="doc-row"><span>Check in</span><strong>{fmtT(selected.check_in)} {selected.has_check_in_photo && <PunchPhoto key={`${selected.attendance_id}-in`} id={selected.attendance_id} which="in" label="Check-in photo" />}</strong></div>
          <div className="doc-row"><span>Check out</span><strong>{fmtT(selected.check_out)} {selected.has_check_out_photo && <PunchPhoto key={`${selected.attendance_id}-out`} id={selected.attendance_id} which="out" label="Check-out photo" />}</strong></div>
          <div className="doc-row"><span>Worked</span><strong>{hrs(selected.working_minutes)}</strong></div>
          {(selected.is_late || selected.is_early_checkout || selected.missing_checkout) && (
            <div className="doc-row"><span>Flags</span>
              <span>
                {selected.is_late && <span className="prio prio-high">late</span>}{' '}
                {selected.is_early_checkout && <span className="ai-chip">early out</span>}{' '}
                {selected.missing_checkout && <span className="prio prio-urgent">no checkout</span>}
              </span>
            </div>
          )}
          {!userId && ['present', 'late', 'half_day', 'absent'].includes(selected.status) && (
            <button className="btn" style={{ marginTop: 10 }} onClick={() => setShowCorrection(selected)}>
              Request a correction for this day
            </button>
          )}
        </div>
      )}
      {showCorrection && (
        <CorrectionModal day={showCorrection} onClose={() => setShowCorrection(null)}
          onSaved={() => { setShowCorrection(null); load() }} />
      )}
    </div>
  )
}

function CorrectionModal({ day, onClose, onSaved }) {
  const [f, setF] = useState({ in: '', out: '', reason: '' })
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    const body = { date: day.date, reason: f.reason }
    if (f.in) body.requested_check_in = new Date(`${day.date}T${f.in}`).toISOString()
    if (f.out) body.requested_check_out = new Date(`${day.date}T${f.out}`).toISOString()
    try { await api('/api/attendance-corrections/', { method: 'POST', body }); onSaved() }
    catch (ex) { setErr(errorText(ex.data) || ex.message) }
  }
  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal-card" onSubmit={submit}>
        <h2>Correction request — {fmtD(day.date)}</h2>
        <div className="form-grid">
          <div><label>Correct check-in</label><input type="time" value={f.in} onChange={e => setF(p => ({ ...p, in: e.target.value }))} /></div>
          <div><label>Correct check-out</label><input type="time" value={f.out} onChange={e => setF(p => ({ ...p, out: e.target.value }))} /></div>
          <div className="wide"><label>Reason *</label><input value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. Forgot to check out" /></div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.reason.trim() || (!f.in && !f.out)}>Send request</button>
        </div>
      </form>
    </div>
  )
}

/* ---------------- My leave ---------------- */

function MyLeave() {
  const [balances, setBalances] = useState([])
  const [rows, setRows] = useState(null)
  const [types, setTypes] = useState([])
  const [showApply, setShowApply] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    Promise.all([
      api('/api/leaves/balances/'),
      api('/api/leaves/?page_size=100'),
      api('/api/leave-types/'),
    ]).then(([b, l, t]) => { setBalances(b); setRows(l.results || l); setTypes(t) })
      .catch(e => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const cancel = async (l) => {
    setErr('')
    try { await api(`/api/leaves/${l.id}/cancel/`, { method: 'POST' }); load() }
    catch (e) { setErr(errorText(e.data) || e.message) }
  }

  if (err && !rows) return <div className="err">{err}</div>
  if (!rows) return <div className="center-note">Loading…</div>

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="filters">
        <button className="btn btn-primary" onClick={() => setShowApply(true)}>+ Apply for leave</button>
      </div>
      {balances.length === 0 && <p className="muted">No leave types configured yet — an admin can add them in HR Settings.</p>}
      <div className="stats">
        {balances.map(b => (
          <div key={b.leave_type} className="stat">
            <div className="label">{b.name}{b.paid ? '' : ' (unpaid)'}</div>
            <div className="value">{b.balance}<span style={{ fontSize: 13, color: 'var(--muted)' }}> / {b.quota}</span></div>
            {b.pending > 0 && <div className="small muted">{b.pending} pending</div>}
          </div>
        ))}
      </div>
      {err && <div className="err">{err}</div>}
      {rows.length === 0 && <p className="muted">No leave requests yet.</p>}
      <table className="table">
        <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Remarks</th><th /></tr></thead>
        <tbody>
          {rows.map(l => (
            <tr key={l.id}>
              <td><strong>{l.leave_type_name}</strong><div className="muted small">{l.reason}</div></td>
              <td>{fmtD(l.start_date)} – {fmtD(l.end_date)}</td>
              <td>{l.days}</td>
              <td><span className={`q-pill q-${l.status}`}>{l.status_display}</span></td>
              <td className="small">{l.remarks || '—'}{l.reviewed_by_detail && <div className="muted">by {l.reviewed_by_detail.name}</div>}</td>
              <td className="row-actions">
                {['pending', 'approved'].includes(l.status) && (
                  <button className="btn btn-sm" onClick={() => cancel(l)}>Cancel</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showApply && (
        <ApplyModal types={types} onClose={() => setShowApply(false)}
          onSaved={() => { setShowApply(false); load() }} />
      )}
    </div>
  )
}

function ApplyModal({ types, onClose, onSaved }) {
  const [f, setF] = useState({ leave_type: types[0]?.id || '', start_date: '', end_date: '', reason: '' })
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  const selected = types.find(t => String(t.id) === String(f.leave_type))

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    try {
      if (doc) {
        const fd = new FormData()
        Object.entries(f).forEach(([k, v]) => fd.append(k, v))
        fd.append('document', doc)
        await apiUpload('/api/leaves/', fd)
      } else {
        await api('/api/leaves/', { method: 'POST', body: f })
      }
      onSaved()
    } catch (ex) { setErr(errorText(ex.data) || ex.message) }
  }

  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal-card" onSubmit={submit}>
        <h2>Apply for leave</h2>
        <div className="form-grid">
          <div className="wide">
            <label>Leave type *</label>
            <select value={f.leave_type} onChange={set('leave_type')}>
              {types.map(t => <option key={t.id} value={t.id}>{t.name} ({t.annual_quota}/yr)</option>)}
            </select>
          </div>
          <div><label>From *</label><input type="date" value={f.start_date} onChange={set('start_date')} /></div>
          <div><label>To *</label><input type="date" value={f.end_date} onChange={set('end_date')} /></div>
          <div className="wide"><label>Reason *</label><input value={f.reason} onChange={set('reason')} /></div>
          {selected?.requires_document && (
            <div className="wide">
              <label>Supporting document * ({selected.name})</label>
              <input type="file" onChange={e => setDoc(e.target.files[0] || null)} />
            </div>
          )}
        </div>
        {err && <div className="err">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.leave_type || !f.start_date || !f.end_date || !f.reason.trim()}>
            Submit request
          </button>
        </div>
      </form>
    </div>
  )
}

/* ---------------- Team today ---------------- */

function TeamToday() {
  const { can } = useAuth()
  const canManage = can('hr.manage')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [viewUser, setViewUser] = useState(null)
  const load = useCallback(() => {
    api('/api/attendance/team_today/').then(setData).catch(e => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const markPresent = async (row) => {
    setErr(''); setMsg('')
    const reason = window.prompt(`Mark ${row.name} present — reason? (e.g. face lock not working)`, 'face lock not working')
    if (reason === null) return
    try {
      await api('/api/attendance/manual_mark/', {
        method: 'POST',
        body: { user: row.user_id, status: 'present', reason },
      })
      setMsg(`${row.name} marked present ✅`)
      load()
    } catch (e) { setErr(errorText(e.data) || e.message) }
  }
  if (err && !data) return <div className="err">{err}</div>
  if (!data) return <div className="center-note">Loading…</div>
  if (viewUser) return (
    <div>
      <button className="btn btn-sm" onClick={() => setViewUser(null)}>← Back to team</button>
      <div style={{ height: 12 }} />
      <MyAttendance userId={viewUser.user_id} userName={viewUser.name} />
    </div>
  )
  const c = data.counts
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="stats">
        {[['Present', c.present], ['Late', c.late, c.late > 0], ['Half Day', c.half_day],
          ['On Leave', c.leave], ['Not checked in', c.not_checked_in, c.not_checked_in > 0]]
          .map(([l, v, alert]) => (
            <div key={l} className={'stat' + (alert ? ' alert' : '')}>
              <div className="label">{l}</div><div className="value">{v || 0}</div>
            </div>
          ))}
      </div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="placeholder-card" style={{ marginTop: 0, marginBottom: 10 }}><h3>{msg}</h3></div>}
      <table className="table">
        <thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th><th /></tr></thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.user_id}>
              <td><strong>{r.name}</strong></td>
              <td>{r.department}</td>
              <td><span className={`q-pill q-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
              <td>{fmtT(r.check_in)} {r.has_check_in_photo && <PunchPhoto id={r.attendance_id} which="in" label={`${r.name} check-in photo`} />}</td>
              <td>{fmtT(r.check_out)} {r.has_check_out_photo && <PunchPhoto id={r.attendance_id} which="out" label={`${r.name} check-out photo`} />}</td>
              <td>{hrs(r.working_minutes)}</td>
              <td className="row-actions">
                <button className="btn btn-sm" onClick={() => setViewUser(r)}>History</button>
                {canManage && r.status !== 'present' && r.status !== 'late' && (
                  <button className="btn btn-sm btn-primary" onClick={() => markPresent(r)}>Mark present</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* A punch photo: a small thumbnail that opens large. Loaded with the sign-in token. */
function PunchPhoto({ id, which, label }) {
  const [url, setUrl] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    let made = null
    apiBlobUrl(`/api/attendance/${id}/photo/${which}/`).then(u => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u) }).catch(() => {})
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [id, which])
  if (!url) return null
  return (
    <>
      <button className="punch-thumb" onClick={() => setOpen(true)} aria-label={label}>
        <img src={url} alt="" />
      </button>
      {open && (
        <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <h2>{label}</h2>
            <img src={url} alt={label} style={{ width: '100%', borderRadius: 10 }} />
            <div className="modal-actions"><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------------- Approvals ---------------- */

function Approvals() {
  const [leaves, setLeaves] = useState([])
  const [corrections, setCorrections] = useState([])
  const [err, setErr] = useState('')
  const [remarks, setRemarks] = useState({})

  const load = useCallback(() => {
    Promise.all([
      api('/api/leaves/?scope=team&status=pending&page_size=100'),
      api('/api/attendance-corrections/?scope=team&page_size=100'),
    ]).then(([l, c]) => {
      setLeaves(l.results || l)
      setCorrections((c.results || c).filter(x => x.status === 'pending'))
    }).catch(e => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const review = async (kind, id, decision) => {
    setErr('')
    const path = kind === 'leave' ? `/api/leaves/${id}/review/` : `/api/attendance-corrections/${id}/review/`
    try {
      await api(path, { method: 'POST', body: { decision, remarks: remarks[`${kind}${id}`] || '' } })
      load()
    } catch (e) { setErr(errorText(e.data) || e.message) }
  }

  const Row = ({ kind, id, title, sub, meta }) => (
    <div className="task-row">
      <div className="task-main">
        <div className="task-title">{title}</div>
        <div className="small muted">{sub}</div>
        <div className="when">{meta}</div>
      </div>
      <input placeholder="Remarks…" style={{ width: 150 }}
        value={remarks[`${kind}${id}`] || ''}
        onChange={e => setRemarks(p => ({ ...p, [`${kind}${id}`]: e.target.value }))} />
      <button className="btn btn-sm btn-primary" onClick={() => review(kind, id, 'approved')}>Approve</button>
      <button className="btn btn-sm" onClick={() => review(kind, id, 'rejected')}>Reject</button>
    </div>
  )

  return (
    <div style={{ maxWidth: 820 }}>
      {err && <div className="err">{err}</div>}
      <h3 className="tpl-cat">Leave requests ({leaves.length})</h3>
      {leaves.length === 0 && <p className="muted">Nothing pending.</p>}
      <div className="task-list" style={{ marginBottom: 20 }}>
        {leaves.map(l => (
          <Row key={l.id} kind="leave" id={l.id}
            title={`${l.user_detail?.name} — ${l.leave_type_name} (${l.days} day${l.days > 1 ? 's' : ''})`}
            sub={l.reason}
            meta={`${fmtD(l.start_date)} – ${fmtD(l.end_date)}`} />
        ))}
      </div>
      <h3 className="tpl-cat">Attendance corrections ({corrections.length})</h3>
      {corrections.length === 0 && <p className="muted">Nothing pending.</p>}
      <div className="task-list">
        {corrections.map(c => (
          <Row key={c.id} kind="correction" id={c.id}
            title={`${c.user_detail?.name} — ${fmtD(c.date)}`}
            sub={c.reason}
            meta={`in ${fmtT(c.requested_check_in)} · out ${fmtT(c.requested_check_out)}`} />
        ))}
      </div>
    </div>
  )
}

/* ---------------- HR settings (admin) ---------------- */

function HRSettings() {
  const [config, setConfig] = useState(null)
  const [offices, setOffices] = useState([])
  const [types, setTypes] = useState([])
  const [team, setTeam] = useState([])
  const [office, setOffice] = useState({ name: '', latitude: '', longitude: '', radius_m: 200 })
  const [type, setType] = useState({ name: '', annual_quota: 12, paid: true, requires_document: false })
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    Promise.all([api('/api/hr/config/'), api('/api/office-locations/'), api('/api/leave-types/')])
      .then(([c, o, t]) => { setConfig(c); setOffices(o); setTypes(t) })
      .catch(e => setErr(e.message))
    api('/api/team/').then(setTeam).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const addOffice = async () => {
    setErr('')
    try {
      await api('/api/office-locations/', { method: 'POST', body: {
        ...office, latitude: Number(office.latitude), longitude: Number(office.longitude),
        radius_m: Number(office.radius_m) } })
      setOffice({ name: '', latitude: '', longitude: '', radius_m: 200 }); load()
    } catch (e) { setErr(errorText(e.data) || e.message) }
  }
  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(p => setOffice(o => ({
      ...o, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6),
    })))
  }
  const delOffice = async (o) => {
    try { await api(`/api/office-locations/${o.id}/`, { method: 'DELETE' }); load() }
    catch (e) { setErr(errorText(e.data) || e.message) }
  }
  const addType = async () => {
    setErr('')
    try {
      await api('/api/leave-types/', { method: 'POST', body: { ...type, annual_quota: Number(type.annual_quota) } })
      setType({ name: '', annual_quota: 12, paid: true, requires_document: false }); load()
    } catch (e) { setErr(errorText(e.data) || e.message) }
  }

  if (err && !config) return <div className="err">{err}</div>
  if (!config) return <div className="center-note">Loading…</div>

  return (
    <div style={{ maxWidth: 720 }}>
      {err && <div className="err">{err}</div>}
      <HRPolicy onSaved={load} />

      <div className="dash-card" style={{ marginBottom: 14 }}>
        <h3>Office locations (geo-fence)</h3>
        {offices.length === 0 && <p className="muted small">No office added. Geo-fencing cannot be enforced until one exists.</p>}
        {offices.map(o => (
          <div className="doc-row" key={o.id}>
            <div><strong>{o.name}</strong><div className="small muted">{o.latitude}, {o.longitude} · {o.radius_m} m</div></div>
            <button className="btn btn-sm" onClick={() => delOffice(o)}>✕</button>
          </div>
        ))}
        <div className="form-grid" style={{ marginTop: 10 }}>
          <div><label>Name</label><input value={office.name} onChange={e => setOffice(o => ({ ...o, name: e.target.value }))} /></div>
          <div><label>Radius (m)</label><input type="number" value={office.radius_m} onChange={e => setOffice(o => ({ ...o, radius_m: e.target.value }))} /></div>
          <div><label>Latitude</label><input value={office.latitude} onChange={e => setOffice(o => ({ ...o, latitude: e.target.value }))} /></div>
          <div><label>Longitude</label><input value={office.longitude} onChange={e => setOffice(o => ({ ...o, longitude: e.target.value }))} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn" onClick={useMyLocation}>Use my current location</button>
          <button className="btn btn-primary" disabled={!office.name || !office.latitude} onClick={addOffice}>Add office</button>
        </div>
      </div>

      <FaceEnrolment config={config} team={team} />

      <div className="dash-card">
        <h3>Leave types</h3>
        {types.map(t => (
          <div className="doc-row" key={t.id}>
            <div><strong>{t.name}</strong><div className="small muted">{t.annual_quota}/yr · {t.paid ? 'paid' : 'unpaid'}{t.requires_document ? ' · document required' : ''}</div></div>
          </div>
        ))}
        <div className="form-grid" style={{ marginTop: 10 }}>
          <div><label>Name</label><input value={type.name} onChange={e => setType(t => ({ ...t, name: e.target.value }))} placeholder="e.g. Casual" /></div>
          <div><label>Annual quota</label><input type="number" value={type.annual_quota} onChange={e => setType(t => ({ ...t, annual_quota: e.target.value }))} /></div>
          <div><label className="switch" style={{ marginTop: 20 }}><input type="checkbox" checked={type.paid} onChange={e => setType(t => ({ ...t, paid: e.target.checked }))} /><span>Paid</span></label></div>
          <div><label className="switch" style={{ marginTop: 20 }}><input type="checkbox" checked={type.requires_document} onChange={e => setType(t => ({ ...t, requires_document: e.target.checked }))} /><span>Document required</span></label></div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={!type.name.trim()} onClick={addType}>Add leave type</button>
      </div>
    </div>
  )
}

/* ---------------- Face enrolment (admin) ---------------- */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PHOTO_LABELS = { off: 'Off', optional: 'Optional', required: 'Required at every punch' }

/* Working hours and attendance rules, saved for this company (PLAN.md §16.1). */
function HRPolicy({ onSaved }) {
  const [s, setS] = useState(null)
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = useCallback(() => {
    api('/api/hr/settings/').then(d => {
      setS(d)
      setForm(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value])))
    }).catch(e => setErrors({ _: e.message }))
  }, [])
  useEffect(() => { load() }, [load])
  if (!s) return errors._ ? <div className="err">{errors._}</div> : null

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const toggleDay = (d) => setForm(f => ({ ...f, week_offs: f.week_offs.includes(d) ? f.week_offs.filter(x => x !== d) : [...f.week_offs, d] }))
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setMsg('')
    try {
      await api('/api/hr/settings/', { method: 'PUT', body: form })
      setMsg('Saved'); load(); onSaved?.()
    } catch (ex) { setErrors(ex.data || { _: ex.message }) } finally { setBusy(false) }
  }
  const fieldErr = (k) => errors[k] && <div className="small" style={{ color: 'var(--red)' }}>{errors[k]}</div>

  return (
    <form className="dash-card" style={{ marginBottom: 14 }} onSubmit={save} aria-label="Attendance rules">
      <h3>Attendance rules</h3>
      <div className="form-grid">
        <div><label htmlFor="hr-start">Work starts</label><input id="hr-start" type="time" value={form.work_start} onChange={set('work_start')} />{fieldErr('work_start')}</div>
        <div><label htmlFor="hr-end">Work ends</label><input id="hr-end" type="time" value={form.work_end} onChange={set('work_end')} />{fieldErr('work_end')}</div>
        <div><label htmlFor="hr-grace">Late after (minutes of grace)</label><input id="hr-grace" type="number" min="0" max="240" value={form.grace_minutes} onChange={set('grace_minutes')} />{fieldErr('grace_minutes')}</div>
        <div><label htmlFor="hr-half">Half day below (hours)</label><input id="hr-half" type="number" step="0.5" min="0.5" max="24" value={form.half_day_hours} onChange={set('half_day_hours')} />{fieldErr('half_day_hours')}</div>
        <div><label htmlFor="hr-full">Full day (hours)</label><input id="hr-full" type="number" step="0.5" min="1" max="24" value={form.full_day_hours} onChange={set('full_day_hours')} />{fieldErr('full_day_hours')}</div>
        <div>
          <label htmlFor="hr-photo">Photo at check-in / check-out</label>
          <select id="hr-photo" value={form.photo} onChange={set('photo')}>
            {s.photo.choices.map(c => <option key={c} value={c}>{PHOTO_LABELS[c] || c}</option>)}
          </select>{fieldErr('photo')}
        </div>
        <div>
          <label htmlFor="hr-approval">Leave and corrections are approved by</label>
          <select id="hr-approval" value={form.leave_approval} onChange={set('leave_approval')}>
            <option value="department">Approvers in the person’s department</option>
            <option value="manager">The person’s manager (reports to) first</option>
          </select>{fieldErr('leave_approval')}
        </div>
        <div><label htmlFor="hr-remind">Remind approvers after (hours; 0 = never)</label><input id="hr-remind" type="number" min="0" max="720" value={form.approval_remind_hours} onChange={set('approval_remind_hours')} />{fieldErr('approval_remind_hours')}</div>
        <div><label htmlFor="hr-keep">Keep photos for (days)</label><input id="hr-keep" type="number" min="1" max="3650" value={form.photo_retention_days} onChange={set('photo_retention_days')} />{fieldErr('photo_retention_days')}</div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Weekly off</label>
        <div className="day-picks" role="group" aria-label="Weekly off days">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className={'day-pick' + (form.week_offs.includes(i) ? ' on' : '')}>
              <input type="checkbox" checked={form.week_offs.includes(i)} onChange={() => toggleDay(i)} /> {d}
            </label>
          ))}
        </div>
        {fieldErr('week_offs')}
      </div>
      <div className="check-list" style={{ marginTop: 10 }}>
        <label><input type="checkbox" checked={!!form.geofence_enabled} onChange={set('geofence_enabled')} /> Check location at check-in (needs an office below)</label>
        <label><input type="checkbox" checked={!!form.face_enabled} onChange={set('face_enabled')} /> Face check at check-in and check-out</label>
        <label><input type="checkbox" checked={!!form.face_self_enroll} onChange={set('face_self_enroll')} disabled={!form.face_enabled} /> First face capture becomes the person’s face profile</label>
      </div>
      {errors._ && <div className="err">{errors._}</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</button>
        {msg && <span className="muted small" role="status">{msg}</span>}
      </div>
    </form>
  )
}

function FaceEnrolment({ config, team }) {
  const [target, setTarget] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const enrol = async (descriptor) => {
    setErr(''); setMsg('')
    try {
      await api(`/api/hr/face/${target}/`, { method: 'POST', body: { descriptor } })
      const name = team.find(t => String(t.id) === String(target))?.name || 'Employee'
      setMsg(`${name} enrolled ✅ — they can now mark attendance with their face.`)
      setTarget('')
    } catch (e) { setErr(errorText(e.data) || e.message) }
  }

  const remove = async () => {
    setErr(''); setMsg('')
    try {
      await api(`/api/hr/face/${target}/`, { method: 'DELETE' })
      const name = team.find(t => String(t.id) === String(target))?.name || 'Employee'
      setMsg(`${name}'s face profile removed.`)
      setTarget('')
    } catch (e) { setErr(errorText(e.data) || e.message) }
  }

  return (
    <div className="dash-card" style={{ marginBottom: 14 }}>
      <h3>Face attendance</h3>
      <p className="muted small">
        {config.face_enabled
          ? 'Face verification is ON — employees must pass a face check to mark attendance.'
          : 'Face verification is currently OFF. Enrol faces here, then set FACE_RECOGNITION_ENABLED=true in backend/.env and restart the API.'}
      </p>
      <p className="muted small">
        Only a numeric signature of the face is stored — never a photo. You can remove
        an employee&apos;s profile at any time.
      </p>
      {err && <div className="err">{err}</div>}
      {msg && <div className="placeholder-card" style={{ marginTop: 0, marginBottom: 10 }}><h3>{msg}</h3></div>}
      <div className="filters">
        <select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Choose an employee…</option>
          {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!target} onClick={() => setCapturing(true)}>
          📷 Enrol face
        </button>
        <button className="btn" disabled={!target} onClick={remove}>Remove profile</button>
      </div>
      {capturing && (
        <FaceCapture
          title="Enrol employee face"
          action="Save face"
          hint="Ask the employee to look straight at the camera in good light."
          onClose={() => setCapturing(false)}
          onCapture={(d) => { setCapturing(false); enrol(d) }}
        />
      )}
    </div>
  )
}

/* ---------------- Calendar grid for My Attendance ---------------- */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function AttendanceCalendar({ days, year, month, selected, onSelect }) {
  // Monday-first offset for the 1st of the month
  const first = new Date(year, month - 1, 1)
  const lead = (first.getDay() + 6) % 7          // JS: Sun=0 -> Mon-first index
  const todayIso = (() => {
    const d = new Date()
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()

  return (
    <div className="cal">
      <div className="cal-head">
        {DOW.map(d => <div key={d} className="cal-dow">{d}</div>)}
      </div>
      <div className="cal-grid">
        {Array.from({ length: lead }, (_, i) => <div key={'x' + i} className="cal-cell empty" />)}
        {days.map(d => {
          const num = Number(d.date.slice(-2))
          const clickable = !!d.status
          return (
            <button
              key={d.date}
              className={
                'cal-cell st-' + (d.status || 'future')
                + (selected?.date === d.date ? ' on' : '')
                + (d.date === todayIso ? ' today' : '')
              }
              disabled={!clickable}
              onClick={() => onSelect(d)}
              title={d.status ? STATUS_LABEL[d.status] : ''}
            >
              <span className="cal-num">{num}</span>
              {d.status && <span className="cal-tag">{
                { present: '✓', late: 'L', half_day: '½', absent: '✗',
                  leave: 'Lv', holiday: 'H', week_off: 'off' }[d.status]
              }</span>}
              {(d.is_late || d.missing_checkout) && <span className="cal-flag" />}
            </button>
          )
        })}
      </div>
      <div className="cal-legend">
        <span><i className="lg st-present" /> Present</span>
        <span><i className="lg st-late" /> Late</span>
        <span><i className="lg st-half_day" /> Half day</span>
        <span><i className="lg st-absent" /> Absent</span>
        <span><i className="lg st-leave" /> Leave</span>
        <span><i className="lg st-week_off" /> Off/Holiday</span>
      </div>
    </div>
  )
}
