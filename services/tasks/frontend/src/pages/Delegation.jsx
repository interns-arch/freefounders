/* Tasks given and received -- day / week / month / overall, plain counts.
   Admins and super admins see everyone (dashboard and Team Performance);
   everybody else sees only their own numbers on their dashboard. */
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { Avatar } from '../icons'

const WINDOWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['all', 'Overall']]
const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const todayISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

function useDelegation(date, department) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const q = new URLSearchParams({ date })
    if (department) q.set('department', department)
    setErr('')
    api(`/api/tasks/delegation/?${q}`).then(setData).catch(e => setErr(e.message))
  }, [date, department])
  return [data, err]
}

function DateBox({ date, setDate }) {
  return (
    <input type="date" value={date} max={todayISO()} aria-label="Day" className="deleg-date"
      onChange={e => setDate(e.target.value || todayISO())} />
  )
}

/* Admins: everyone's numbers */
export default function Delegation({ department = '', className = 'span-12' }) {
  const [date, setDate] = useState(todayISO())
  const [win, setWin] = useState('month')
  const [sortBy, setSortBy] = useState('given')
  const [open, setOpen] = useState(null)        // person whose breakdown is shown
  const [data, err] = useDelegation(date, department)

  const rows = useMemo(() => (data ? [...data.people] : [])
    .sort((a, b) => (b[sortBy][win] - a[sortBy][win]) || a.name.localeCompare(b.name)),
  [data, win, sortBy])

  if (err) return <div className={'dash-card ' + className}><div className="err">{err}</div></div>
  if (!data) return <div className={'dash-card ' + className}><p className="muted small">Loading…</p></div>
  if (!data.everyone) return null

  const maxG = Math.max(1, ...data.people.map(p => p.given[win]))
  const maxR = Math.max(1, ...data.people.map(p => p.received[win]))
  const span = win === 'day' ? fmt(data.date)
    : win === 'week' ? `${fmt(data.week[0])} – ${fmt(data.week[1])}`
      : win === 'month' ? new Date(data.month[0] + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : 'all time'

  return (
    <div className={'dash-card deleg ' + className}>
      <div className="card-head">
        <h3>Tasks given &amp; received</h3>
        <div className="deleg-controls">
          <DateBox date={date} setDate={setDate} />
          <div className="seg">
            {WINDOWS.map(([k, l]) => (
              <button key={k} className={'seg-btn' + (win === k ? ' on' : '')} onClick={() => setWin(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Showing <strong>{span}</strong> · {data.totals[win].given} tasks given to others
        {data.totals[win].self > 0 && <>, {data.totals[win].self} self-assigned</>}
      </p>

      <div className="table-scroll d-only">
        <table className="mini-table deleg-table">
          <thead>
            <tr>
              <th rowSpan={2}>Person</th>
              <th colSpan={4} className="grp given">
                <button className={'th-sort' + (sortBy === 'given' ? ' on' : '')} onClick={() => setSortBy('given')}>Tasks given ↓</button>
              </th>
              <th colSpan={4} className="grp recv">
                <button className={'th-sort' + (sortBy === 'received' ? ' on' : '')} onClick={() => setSortBy('received')}>Tasks received ↓</button>
              </th>
              <th rowSpan={2} className="num">Self</th>
            </tr>
            <tr>
              {['given', 'received'].map(k => WINDOWS.map(([w, l]) => (
                <th key={k + w} className={'num sub' + (w === win ? ' cur' : '')}>{l}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className="row-click" onClick={() => setOpen(p)}
                title={`See who ${p.name} gives tasks to, and who gives tasks to ${p.name}`}>
                <td>
                  <span className="person">
                    <Avatar name={p.name} />
                    <span><span className="person-name">{p.name}</span><div className="person-role">{p.role}</div></span>
                  </span>
                </td>
                {['given', 'received'].map(k => WINDOWS.map(([w]) => (
                  <td key={k + w} className={'num' + (w === win ? ' cur' : '') + (p[k][w] === 0 ? ' zero' : '')}>
                    {w === win
                      ? <span className="bar-num"><i className={k} style={{ width: `${(p[k][w] / (k === 'given' ? maxG : maxR)) * 100}%` }} /><b>{p[k][w]}</b></span>
                      : p[k][w]}
                  </td>
                )))}
                <td className="num">{p.self[win]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* phone: one card per person */}
      <div className="m-cards">
        {rows.map(p => (
          <div className="m-card row-click" key={p.id} onClick={() => setOpen(p)}>
            <span className="person"><Avatar name={p.name} size={28} /><span className="person-name">{p.name}</span></span>
            <div className="deleg-two">
              <div><span className="muted small">Given</span><strong>{p.given[win]}</strong></div>
              <div><span className="muted small">Received</span><strong>{p.received[win]}</strong></div>
              <div><span className="muted small">Overall</span><strong>{p.given.all} / {p.received.all}</strong></div>
            </div>
          </div>
        ))}
      </div>

      {data.pairs.length > 0 && (
        <div className="deleg-pairs">
          <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>Who gives to whom most — this month</div>
          <div className="pair-list">
            {data.pairs.map((x, i) => (
              <span className="pair" key={i}><strong>{x.from}</strong> → {x.to} <b>{x.count}</b></span>
            ))}
          </div>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Click a person to see who they give tasks to and who gives tasks to them.
        Counted on the day a task was given. Self-assigned tasks are shown apart; automatic repeats of
        recurring tasks and form-created tasks are not counted.
      </p>
      {open && <PersonBreakdown userId={open.id} date={date} startWin={win} onClose={() => setOpen(null)} />}
    </div>
  )
}

/* Everyone else: just my own numbers */
export function MyDelegation({ className = 'span-12' }) {
  const [date, setDate] = useState(todayISO())
  const [data, err] = useDelegation(date, '')
  const [open, setOpen] = useState(false)
  const me = data?.people?.[0]
  return (
    <div className={'dash-card ' + className}>
      <div className="card-head">
        <h3>My tasks given &amp; received</h3>
        <div className="deleg-controls">
          {me && <button className="btn btn-sm" onClick={() => setOpen(true)}>Who? →</button>}
          <DateBox date={date} setDate={setDate} />
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {!me && !err && <p className="muted small">Loading…</p>}
      {me && (
        <div className="my-deleg">
          {[['given', 'Given to others'], ['received', 'Received from others']].map(([k, label]) => (
            <div className={'my-deleg-row ' + k} key={k}>
              <div className="my-deleg-label">{label}</div>
              {WINDOWS.map(([w, l]) => (
                <div className="my-deleg-cell" key={w}>
                  <strong>{me[k][w]}</strong>
                  <span>{w === 'day' ? fmt(data.date) : l}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {open && me && <PersonBreakdown userId={me.id} date={date} startWin="month" onClose={() => setOpen(false)} />}
    </div>
  )
}

/* Popup: who this person gives tasks to, and who gives tasks to them. */
function PersonBreakdown({ userId, date, startWin = 'month', onClose }) {
  const [win, setWin] = useState(startWin)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api(`/api/tasks/delegation/person/?user=${userId}&date=${date}`).then(setData).catch(e => setErr(e.message))
  }, [userId, date])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const span = !data ? '' : win === 'day' ? fmt(data.date)
    : win === 'week' ? `${fmt(data.week[0])} – ${fmt(data.week[1])}`
      : win === 'month' ? new Date(data.month[0] + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : 'all time'

  const list = (rows, kind) => {
    const shown = rows.filter(r => r[win] > 0).sort((a, b) => b[win] - a[win] || a.name.localeCompare(b.name))
    const total = shown.reduce((n, r) => n + r[win], 0)
    const max = Math.max(1, ...shown.map(r => r[win]))
    return (
      <div className={'bd-col ' + kind}>
        <div className="bd-head">
          {kind === 'given' ? 'Gave tasks to' : 'Received tasks from'}
          <span className="count-pill">{total}</span>
        </div>
        {shown.length === 0 && <p className="muted small" style={{ padding: '10px 0' }}>Nobody in this period.</p>}
        {shown.map((r, i) => (
          <div className="bd-row" key={r.id}>
            <span className="bd-rank">{i + 1}</span>
            <Avatar name={r.name} size={28} />
            <div className="bd-who">
              <div className="person-name">{r.name}{!r.active && <span className="muted small"> (inactive)</span>}</div>
              <div className="bd-bar"><i style={{ width: `${(r[win] / max) * 100}%` }} /></div>
            </div>
            <strong className="bd-n">{r[win]}</strong>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card bd-card">
        {err && <div className="err">{err}</div>}
        {!data && !err && <p className="muted">Loading…</p>}
        {data && (
          <>
            <div className="bd-top">
              <span className="person">
                <Avatar name={data.person.name} size={40} />
                <span>
                  <span className="person-name" style={{ fontSize: 17 }}>{data.person.name}</span>
                  <div className="person-role">{data.person.role}</div>
                </span>
              </span>
              <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
            </div>
            <div className="bd-bar-row">
              <div className="seg">
                {WINDOWS.map(([k, l]) => (
                  <button key={k} className={'seg-btn' + (win === k ? ' on' : '')} onClick={() => setWin(k)}>{l}</button>
                ))}
              </div>
              <span className="muted small">{span}</span>
            </div>
            <div className="bd-grid">
              {list(data.gave_to, 'given')}
              {list(data.received_from, 'received')}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
