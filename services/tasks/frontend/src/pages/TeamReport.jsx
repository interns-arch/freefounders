/* Team performance — the founder's page. Every employee over a date range,
   ranked by the same score the Employees report uses, with each person's full
   breakdown one click away: how much was done, pending, overdue, how long it
   took, and how they moved since the period before. Read-only. */
import { Fragment, useEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { api, errorText } from '../api'
import PersonProfile from './PersonProfile'
import Delegation from './Delegation'
import { RangePicker, ScoreRing, downloadCSV, fmtEffort, rangeParams } from './Tasks'

const ACCENT = '#0d7a5f'

/* ▲ 6.4 / ▼ 12 / — , coloured by direction. Null when there is no period
   before this one to compare against (an "All time" range). */
function Delta({ value, suffix = '' }) {
  if (value == null) return <span className="muted">—</span>
  if (Math.abs(value) < 0.05) return <span className="muted">no change</span>
  const up = value > 0
  return (
    <span style={{ color: up ? 'var(--accent)' : 'var(--red)', fontWeight: 600 }}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(value)}${suffix} since the previous period`}>
      {up ? '▲' : '▼'} {Math.abs(value)}{suffix}
    </span>
  )
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className={'stat' + (tone ? ` ${tone}` : '')}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub != null && <div className="muted small">{sub}</div>}
    </div>
  )
}

/* One employee's full numbers, shown in place when their row is opened —
   nothing here needs a second page to read. */
function PersonDetail({ r, onProfile }) {
  const pct = (v) => (v == null ? '—' : `${v}%`)
  const block = (title, items) => (
    <div style={{ minWidth: 190, flex: '1 1 190px' }}>
      <div className="dash-band">{title}</div>
      {items.map(([k, v, hint]) => (
        <div key={k} className="small" title={hint}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0' }}>
          <span className="muted">{k}</span><strong>{v}</strong>
        </div>
      ))}
    </div>
  )
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 18, padding: '10px 12px 14px',
      background: 'var(--bg)', borderRadius: 8, margin: '2px 0 8px',
    }}>
      {block('Tasks', [
        ['Total in range', r.total],
        ['Completed', r.completed],
        ['— on time', r.in_time],
        ['— delayed', r.delayed],
        ['Pending', r.pending],
        ['In progress', r.in_progress],
        ['Overdue', r.overdue],
      ])}
      {block('Time', [
        ['Assigned', fmtEffort(r.time_assigned_minutes) || '—'],
        ['Earned (completed)', fmtEffort(r.time_earned_minutes) || '—'],
        ['Actually spent', fmtEffort(r.time_spent_minutes) || '—'],
        ['Effort ratio', pct(r.effort_ratio), 'Time earned ÷ time assigned'],
      ])}
      {block('Quality', [
        ['On-time rate', pct(r.on_time_rate)],
        ['Sent back for redo', r.rework_rejected, 'Completions an approver rejected'],
        ['Rework rate', pct(r.rework_rate)],
        ['Mistakes logged', r.mistakes],
        ['Repeat mistakes', r.repeat_mistakes],
        ['Score penalty', r.mistake_penalty ? `−${r.mistake_penalty}` : '0'],
      ])}
      {block('Pressure & load', [
        ['Deadline extensions asked', r.extension_requests],
        ['Cancellations asked', r.cancel_requests],
        ['Open right now', r.open_tasks],
        ['— already overdue', r.open_overdue],
        ['Pending effort', fmtEffort(r.pending_effort_minutes) || '—'],
        ['Self-assigned (unscored)', r.self_assigned],
      ])}
      <div style={{ flexBasis: '100%' }}>
        {r.review && <p className="small" style={{ margin: '6px 0 0' }}>💡 {r.review}</p>}
        {r.flags?.map(f => (
          <p key={f} className="small" style={{ margin: '4px 0 0', color: 'var(--red)' }}>⚠ {f}</p>
        ))}
        <button className="btn btn-sm" style={{ marginTop: 8 }}
          onClick={() => onProfile({ user: r.user, name: r.name })}>
          Open full profile →
        </button>
      </div>
    </div>
  )
}

export default function TeamReport() {
  const [range, setRange] = useState('this_month')
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)      // user id whose row is expanded
  const [person, setPerson] = useState(null)  // full profile slide-over
  const [err, setErr] = useState('')

  useEffect(() => {
    if (range === 'custom' && (!custom.start || !custom.end)) return
    setData(null); setErr('')
    api(`/api/tasks/team_report/?${rangeParams(range, custom)}`)
      .then(setData).catch(e => setErr(errorText(e.data) || e.message))
  }, [range, custom])

  const rows = data?.rows || []
  const t = data?.team
  const ranked = rows.filter(r => r.score != null)

  const [mailing, setMailing] = useState(false)
  const sendOverdueEmail = async () => {
    if (!confirm('Email everyone their overdue tasks (or "pipeline is clear") and their performance now?')) return
    setMailing(true)
    try {
      const res = await api('/api/tasks/send_overdue_email/', { method: 'POST' })
      alert(`Weekly email sent to ${res.sent} person(s).`)
    } catch (e) {
      alert(errorText(e.data) || e.message)
    } finally { setMailing(false) }
  }

  const exportCSV = () => downloadCSV(
    `team-performance-${range}.csv`,
    ['Rank', 'Name', 'Role', 'Department', 'Score', 'Change', 'On-time %',
     'Total', 'Completed', 'On time', 'Delayed', 'Pending', 'In progress',
     'Overdue', 'Time assigned', 'Time earned', 'Time spent', 'Sent back',
     'Extensions asked', 'Mistakes', 'Open now', 'Overdue now'],
    rows.map((r, i) => [
      r.score == null ? '' : i + 1, r.name, r.role, r.department,
      r.score ?? '', r.score_delta ?? '', r.on_time_rate ?? '',
      r.total, r.completed, r.in_time, r.delayed, r.pending, r.in_progress,
      r.overdue, r.time_assigned_minutes, r.time_earned_minutes,
      r.time_spent_minutes, r.rework_rejected, r.extension_requests,
      r.mistakes, r.open_tasks, r.open_overdue]))

  const chart = {
    labels: ranked.map(r => r.name),
    datasets: [{
      label: 'Score',
      data: ranked.map(r => r.score),
      backgroundColor: ranked.map(r =>
        r.score >= 75 ? ACCENT : r.score >= 45 ? '#b45309' : '#b3372f'),
      borderRadius: 4,
    }],
  }

  return (
    <div>
      <div className="page-head">
        <h1>Team Performance</h1>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={sendOverdueEmail} disabled={mailing}
          title="Also goes out automatically every Monday at 10 AM">
          {mailing ? 'Sending…' : '✉ Email weekly update'}
        </button>
        {rows.length > 0 && (
          <button className="btn btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
        )}
      </div>
      <RangePicker range={range} setRange={setRange} custom={custom}
        setCustom={setCustom} countedBy="due date" />

      {err && <div className="err">{err}</div>}
      {!data && !err && <p className="muted">Loading…</p>}

      {t && (
        <>
          <div className="stats">
            <Tile label="Team score" value={t.team_score ?? '—'}
              sub={<Delta value={t.team_score_delta} />}
              tone={t.team_score == null ? '' : t.team_score >= 75 ? 'good' : t.team_score < 45 ? 'alert' : ''} />
            <Tile label="On time" value={t.on_time_rate == null ? '—' : `${t.on_time_rate}%`}
              sub={`${t.in_time} of ${t.completed} completed`} />
            <Tile label="Completed" value={t.completed} sub={`${t.total} tasks in range`} />
            <Tile label="Overdue" value={t.overdue} tone={t.overdue ? 'alert' : ''}
              sub={`${t.open_overdue} late right now`} />
            <Tile label="Time earned" value={fmtEffort(t.time_earned_minutes) || '—'}
              sub={`${fmtEffort(t.time_spent_minutes) || '0m'} spent`} />
            <Tile label="Need a look" value={t.at_risk} tone={t.at_risk ? 'alert' : ''}
              sub={`${t.scored_people} of ${t.people} scored`} />
          </div>

          {ranked.length > 1 && (
            <div className="dash-card" style={{ marginTop: 12 }}>
              <h3>Score by person</h3>
              <div className="chart-box">
                <Bar data={chart} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        afterLabel: (c) => {
                          const r = ranked[c.dataIndex]
                          return `${r.completed} done · ${r.overdue} overdue · `
                            + `${r.on_time_rate ?? '—'}% on time`
                        },
                      },
                    },
                  },
                  scales: { y: { beginAtZero: true, max: 100 } },
                }} />
              </div>
            </div>
          )}

          <h3 style={{ margin: '16px 0 6px' }}>
            Every employee <span className="muted small">
              {rows.length} people · click a row for the full breakdown</span>
          </h3>
          <div className="tablewrap">
            <table className="table report-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th>Employee</th>
                  <th>Score</th>
                  <th>vs prev</th>
                  <th>On time</th>
                  <th>Done</th>
                  <th>Pending</th>
                  <th>Overdue</th>
                  <th>Time spent</th>
                  <th>Open now</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Fragment key={r.user}>
                    <tr onClick={() => setOpen(open === r.user ? null : r.user)}
                      style={{ cursor: 'pointer' }}
                      title="Click for this person's full breakdown">
                      <td className="muted">{r.score == null ? '—' : i + 1}</td>
                      <td>
                        <strong>{open === r.user ? '▾ ' : '▸ '}{r.name}</strong>
                        {r.flags?.length > 0 && (
                          <span className="ai-chip" style={{ color: 'var(--red)' }}
                            title={r.flags.join(' · ')}>⚠ {r.flags.length}</span>
                        )}
                        <div className="muted small">{r.role}{r.department ? ` · ${r.department}` : ''}</div>
                      </td>
                      <td><ScoreRing value={r.score} /></td>
                      <td><Delta value={r.score_delta} /></td>
                      <td>{r.on_time_rate == null ? '—' : `${r.on_time_rate}%`}</td>
                      <td>{r.completed}</td>
                      <td>{r.pending + r.in_progress}</td>
                      <td className={r.overdue ? 'late' : ''}>{r.overdue}</td>
                      <td>{fmtEffort(r.time_spent_minutes) || '—'}</td>
                      <td>{r.open_tasks}{r.open_overdue ? ` (${r.open_overdue} late)` : ''}</td>
                    </tr>
                    {open === r.user && (
                      <tr>
                        <td colSpan={10} style={{ padding: 0 }}>
                          <PersonDetail r={r} onProfile={setPerson} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {data.formula && (
            <p className="muted small" style={{ marginTop: 10 }}>
              Formula (open, not a black box): <strong>{data.formula}</strong>.
              {data.previous?.start
                ? ` Change is measured against ${data.previous.start} – ${data.previous.end}.`
                : ' No earlier period to compare against in this range.'}
            </p>
          )}
        </>
      )}

      {/* tasks given / received per person -- shows only for admins */}
      <div style={{ marginTop: 18 }}><Delegation className="" /></div>

      {person && (
        <PersonProfile userId={person.user} name={person.name}
          onClose={() => setPerson(null)} />
      )}
    </div>
  )
}
