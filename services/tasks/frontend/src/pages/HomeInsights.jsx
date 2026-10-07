/* The working parts of the dashboard: what is waiting on me, my deadlines,
   my score, my open mistakes, and -- for anyone with a team -- where the
   overdue work sits, how late it is, who is doing best and who needs a look.
   Numbers come from /api/tasks/home/, which uses the same scoring as the
   Team Performance page, so the two never disagree. */
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useDepartments } from '../useDepartments'
import Icon, { Avatar } from '../icons'
import { relDue } from './Tasks'
import Linkify from '../Linkify'

const fmtD = (iso) => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  : ''

export const RANGES = [
  ['this_week', 'This week'], ['last_week', 'Last week'],
  ['this_month', 'This month'], ['last_month', 'Last month'],
  ['custom', 'Custom dates'],
]

/* ---------- data ---------- */
export function useHome(filters) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const { range, start, end, department } = filters
  useEffect(() => {
    if (range === 'custom' && (!start || !end)) return
    const q = new URLSearchParams({ range })
    if (range === 'custom') { q.set('start', start); q.set('end', end) }
    if (department) q.set('department', department)
    setErr('')
    api(`/api/tasks/home/?${q}`).then(setData).catch(e => setErr(e.message))
  }, [range, start, end, department])
  return [data, err]
}

/* ---------- 15: filters ---------- */
export function Filters({ filters, setFilters, home }) {
  const depts = useDepartments()
  const name = Object.fromEntries(depts)
  const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }))
  const teamDepts = home?.team?.departments || []
  const r = home?.range
  return (
    <div className="dash-filters">
      <select className="range-select" value={filters.range} onChange={set('range')} aria-label="Date range">
        {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {filters.range === 'custom' && (
        <span className="date-pair">
          <input type="date" value={filters.start} onChange={set('start')} aria-label="From" />
          <span className="muted">to</span>
          <input type="date" value={filters.end} onChange={set('end')} aria-label="To" />
        </span>
      )}
      {teamDepts.length > 1 && (
        <select className="range-select" value={filters.department} onChange={set('department')} aria-label="Department">
          <option value="">All departments</option>
          {teamDepts.map(d => <option key={d} value={d}>{name[d] || d}</option>)}
        </select>
      )}
      {r?.start && <span className="range-applied">Scores for {fmtD(r.start)} – {fmtD(r.end)}</span>}
    </div>
  )
}

/* ---------- 1: waiting on me ---------- */
export function WaitingOnMe({ home }) {
  const [counts, setCounts] = useState({ accept: null, requests: null })
  useEffect(() => {
    api('/api/task-completions/?scope=inbox&page_size=1')
      .then(d => setCounts(c => ({ ...c, accept: d.count ?? (d.results || d).length }))).catch(() => {})
    api('/api/task-change-requests/?scope=inbox&page_size=1')
      .then(d => setCounts(c => ({ ...c, requests: d.count ?? (d.results || d).length }))).catch(() => {})
  }, [])
  const mistakes = home?.me?.mistakes_open ?? null
  const items = [
    { href: '/tasks?tab=reviews', icon: 'check', label: 'Work to accept', n: counts.accept },
    { href: '/tasks?tab=requests', icon: 'inbox', label: 'Requests to decide', n: counts.requests },
    { href: '/mistakes', icon: 'alert', label: 'My open mistakes', n: mistakes },
  ]
  const loaded = items.every(i => i.n !== null)
  const total = items.reduce((s, i) => s + (i.n || 0), 0)
  return (
    <div className="waiting">
      <div className="waiting-head">
        <Icon name="bell" />
        <strong>Waiting on you</strong>
        {loaded && total === 0 && <span className="muted small">Nothing — all clear ✓</span>}
      </div>
      <div className="waiting-items">
        {items.map(i => (
          <a key={i.href} href={i.href} className={'waiting-item' + (i.n > 0 ? ' hot' : '')}>
            <Icon name={i.icon} />
            <span className="wi-label">{i.label}</span>
            <span className="wi-n">{i.n ?? '…'}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

/* ---------- 2: my deadlines ---------- */
export function Deadlines({ className = '' }) {
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState(null)
  useEffect(() => {
    api('/api/tasks/?scope=my&status=open,in_progress&page_size=200')
      .then(d => setRows(d.results || d)).catch(() => setRows([]))
  }, [])

  const groups = useMemo(() => {
    const g = { overdue: [], today: [], week: [] }
    if (!rows) return g
    const now = new Date()
    const endToday = new Date(now); endToday.setHours(23, 59, 59, 999)
    const endWeek = new Date(endToday)
    endWeek.setDate(endWeek.getDate() + ((7 - endWeek.getDay()) % 7))   // through Sunday
    for (const t of rows) {
      if (!t.due_at) continue
      const due = new Date(t.due_at)
      if (due < now) g.overdue.push(t)
      else if (due <= endToday) g.today.push(t)
      else if (due <= endWeek) g.week.push(t)
    }
    for (const k in g) g[k].sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    return g
  }, [rows])

  const tabs = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week']]
  const current = tab || tabs.find(([k]) => groups[k].length)?.[0] || 'today'
  const list = groups[current]

  return (
    <div className={'dash-card ' + className}>
      <div className="card-head">
        <h3>My deadlines</h3>
        <a className="btn btn-sm" href="/tasks">All my tasks →</a>
      </div>
      <div className="seg seg-full">
        {tabs.map(([k, l]) => (
          <button key={k} className={'seg-btn' + (current === k ? ' on' : '')} onClick={() => setTab(k)}>
            {l} <span className={'seg-n' + (k === 'overdue' && groups.overdue.length ? ' red' : '')}>{groups[k].length}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        {!rows && <p className="muted small">Loading…</p>}
        {rows && list.length === 0 && (
          <div className="empty-state">
            <span className="big">{current === 'overdue' ? '🎉' : '☕'}</span>
            {current === 'overdue' ? 'Nothing overdue.' : current === 'today' ? 'Nothing due today.' : 'Nothing else due this week.'}
          </div>
        )}
        {list.slice(0, 8).map(t => (
          <a className="next-row" key={t.id} href={`/tasks/${t.id}`}>
            <span className={'next-dot' + (t.is_overdue ? ' late' : '')} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="next-title"><span className="t-code">{t.code}</span> {t.title}</div>
              <div className="when">
                {t.status_display}
                {t.created_by_detail && <> · from {t.created_by_detail.name}</>}
                <span className={t.is_overdue ? ' late' : ''}> · {relDue(t.due_at)}</span>
              </div>
            </div>
            {t.priority !== 'normal' && <span className={`pill-s p-${t.priority}`}>{t.priority_display}</span>}
          </a>
        ))}
        {list.length > 8 && <p className="small muted" style={{ marginTop: 6 }}>+{list.length - 8} more in Tasks</p>}
      </div>
    </div>
  )
}

/* ---------- 3: my score ---------- */
function Ring({ value, size = 112 }) {
  const r = 46, c = 2 * Math.PI * r
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))
  const color = value == null ? '#cfd8d4' : value >= 75 ? '#0d7a5f' : value >= 45 ? '#b45309' : '#c0392b'
  return (
    <svg width={size} height={size} viewBox="0 0 112 112" className="ring">
      <circle cx="56" cy="56" r={r} fill="none" stroke="#edf1ef" strokeWidth="10" />
      <circle cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 56 56)" />
      <text x="56" y="54" textAnchor="middle" className="ring-val" fill={color}>{value == null ? '—' : Math.round(value)}</text>
      <text x="56" y="72" textAnchor="middle" className="ring-cap">score</text>
    </svg>
  )
}

export function ScoreCard({ home, className = '' }) {
  const me = home?.me
  const d = me?.score_delta
  return (
    <div className={'dash-card ' + className}>
      <h3>My score</h3>
      {!me ? <p className="muted small">Loading…</p> : (
        <div className="score-wrap">
          <Ring value={me.score} />
          <div className="score-facts">
            {d != null && (
              <div className={'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '')}>
                {d > 0 ? '▲' : d < 0 ? '▼' : '•'} {Math.abs(d)} vs previous period
              </div>
            )}
            {me.score == null && <div className="muted small">Nothing scored yet in this range — finish work others gave you to earn a score.</div>}
            <div className="fact"><span>On time</span><strong>{me.on_time_rate == null ? '—' : `${Math.round(me.on_time_rate)}%`}</strong></div>
            <div className="fact"><span>Completed</span><strong>{me.completed}</strong></div>
            <div className="fact"><span>Finished late</span><strong className={me.delayed ? 'late' : ''}>{me.delayed}</strong></div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- 6: my open mistakes ---------- */
export function MistakesCard({ home, className = '' }) {
  const me = home?.me
  if (!me || me.mistakes_open === 0) return null
  return (
    <div className={'dash-card ' + className}>
      <div className="card-head">
        <h3>My open mistakes <span className="count-pill red">{me.mistakes_open}</span></h3>
        <a className="btn btn-sm" href="/mistakes">Open register →</a>
      </div>
      {me.mistakes.map(m => (
        <a className="next-row" key={m.id} href="/mistakes">
          <span className={'next-dot' + (m.is_overdue ? ' late' : '')} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="next-title"><span className="t-code">{m.code}</span> {m.category}</div>
            <div className="small muted">{m.description}</div>
            <div className="when">
              {m.status_display}
              {m.sla_due_at && <span className={m.is_overdue ? ' late' : ''}> · reply {relDue(m.sla_due_at)}</span>}
            </div>
          </div>
          <span className={`pill-s sev-${m.severity}`}>{m.severity_display}</span>
        </a>
      ))}
    </div>
  )
}

/* ---------- 7, 8, 12: the team ---------- */
export function TeamInsights({ home }) {
  const team = home?.team
  const [all, setAll] = useState(false)
  if (!team) return null
  const people = all ? team.overdue_by_person : team.overdue_by_person.slice(0, 8)
  const maxP = Math.max(1, ...team.overdue_by_person.map(p => p.overdue))
  const maxA = Math.max(1, ...team.ageing.map(a => a.count))
  const pct = team.open ? Math.round(100 * team.overdue / team.open) : 0
  const medals = ['🥇', '🥈', '🥉']

  return (
    <>
      <h3 className="dash-band">Team</h3>
      <div className="dash-grid dash-12" style={{ marginTop: 0 }}>
        <div className="dash-card span-7">
          <div className="card-head">
            <h3>Overdue by person <span className="count-pill red">{team.overdue} overdue</span></h3>
            <span className="muted small">{pct}% of {team.open} open tasks</span>
          </div>
          {team.overdue_by_person.length === 0
            ? <div className="empty-state"><span className="big">🎉</span>Nobody has overdue work.</div>
            : (
              <div className="pbars">
                {people.map(p => (
                  <div className="pbar" key={p.id} title={`${p.name}: ${p.overdue} overdue of ${p.open} open`}>
                    <span className="person pbar-who"><Avatar name={p.name} size={26} /><span className="person-name">{p.name}</span></span>
                    <div className="hbar-track"><div className="hbar-fill red" style={{ width: `${(p.overdue / maxP) * 100}%` }} /></div>
                    <span className="pbar-n"><strong>{p.overdue}</strong><span className="muted">/{p.open}</span></span>
                  </div>
                ))}
              </div>
            )}
          {team.overdue_by_person.length > 8 && (
            <button className="linkish" style={{ marginTop: 10 }} onClick={() => setAll(v => !v)}>
              {all ? 'Show fewer' : `Show all ${team.overdue_by_person.length} people`}
            </button>
          )}
        </div>

        <div className="dash-card span-5">
          <h3>How late is overdue work?</h3>
          <div className="ageing">
            {team.ageing.map((a, i) => (
              <div className="age-col" key={a.label}>
                <div className="age-n">{a.count}</div>
                <div className="age-bar"><i className={`age-${i}`} style={{ height: `${Math.max(a.count ? 8 : 0, (a.count / maxA) * 100)}%` }} /></div>
                <div className="age-l">{a.label}</div>
              </div>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Days past the due date, for every open task that is overdue right now.</p>
        </div>

        <div className="dash-card span-5">
          <h3>Top performers</h3>
          {team.top.length === 0
            ? <div className="empty-state">No scored work in this range yet.</div>
            : team.top.map((t, i) => (
              <div className="perf-row" key={t.id}>
                <span className="medal">{medals[i]}</span>
                <Avatar name={t.name} size={34} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="person-name">{t.name}</div>
                  <div className="person-role">
                    {t.on_time_rate != null && `${Math.round(t.on_time_rate)}% on time · `}{t.completed} done
                  </div>
                </div>
                <div className="perf-score">
                  <strong>{t.score}</strong>
                  {t.score_delta != null && (
                    <span className={'delta ' + (t.score_delta > 0 ? 'up' : t.score_delta < 0 ? 'down' : '')}>
                      {t.score_delta > 0 ? '▲' : t.score_delta < 0 ? '▼' : ''}{Math.abs(t.score_delta)}
                    </span>
                  )}
                </div>
              </div>
            ))}
        </div>

        <div className="dash-card span-7">
          <div className="card-head">
            <h3>Needs attention {team.attention.length > 0 && <span className="count-pill amber">{team.attention.length}</span>}</h3>
            <a className="btn btn-sm" href="/team">Team Performance →</a>
          </div>
          {team.attention.length === 0
            ? <div className="empty-state"><span className="big">👍</span>Everyone is active and on track.</div>
            : (
              <div className="attn-list">
                {team.attention.slice(0, 8).map(a => (
                  <div className="attn" key={a.id}>
                    <Avatar name={a.name} size={34} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="person-name">{a.name} <span className="person-role" style={{ display: 'inline' }}>· {a.role}</span></div>
                      <div className="attn-why">{a.reasons.map(r => <span key={r} className="why">{r}</span>)}</div>
                    </div>
                  </div>
                ))}
                {team.attention.length > 8 && <p className="small muted">+{team.attention.length - 8} more on Team Performance</p>}
              </div>
            )}
        </div>
      </div>
    </>
  )
}

/* ---------- notices ---------- */
const fmtShort = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  : ''

export function NoticesCard({ className = '' }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    api('/api/notices/').then(d => setRows(d.results || d)).catch(() => setRows([]))
  }, [])
  if (!rows || rows.length === 0) return null      // nothing live: no empty card
  const unread = rows.filter(n => n.read === false).length
  return (
    <div className={'dash-card notices-card ' + className}>
      <div className="card-head">
        <h3><Icon name="megaphone" size={18} /> Notices {unread > 0 && <span className="count-pill amber">{unread} new</span>}</h3>
        <a className="btn btn-sm" href="/notices">All notices →</a>
      </div>
      <div className="notice-list">
        {rows.slice(0, 3).map(n => (
          <div key={n.id} role="link" tabIndex={0} onClick={() => { location.href = '/notices' }}
            className={'notice-item' + (n.read === false ? ' unread' : '') + ` np-${n.priority}`}>
            <div className="notice-top">
              {n.read === false && <span className="notice-dot" />}
              <strong>{n.title}</strong>
              {n.priority !== 'normal' && <span className={`pill-s ${n.priority === 'urgent' ? 'p-urgent' : 'p-high'}`}>{n.priority_display}</span>}
            </div>
            {n.content && <div className="notice-body"><Linkify text={n.content.length > 220 ? n.content.slice(0, 220) + '…' : n.content} /></div>}
            <div className="when">{n.author_detail?.name || 'Admin'} · {fmtShort(n.publish_at || n.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
