import { useEffect, useState } from 'react'
import {
  BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon, { Avatar } from '../icons'
import { fmtINR } from './Leads'
import { relDue } from './Tasks'
import Delegation, { MyDelegation } from './Delegation'
import {
  Deadlines, Filters, MistakesCard, NoticesCard, ScoreCard, TeamInsights, WaitingOnMe, useHome,
} from './HomeInsights'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const fmtDT = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Home() {
  const { user, can } = useAuth()
  // The pipeline half of this page only means something to people who
  // actually work leads. Warehouse/IT/Accounts have dashboard rights but no
  // pipeline, so showing them "Total Leads 0 / Conversion 0%" was noise.
  const worksLeads = can('leads.view_all') || can('leads.view_department')
    || can('leads.view_own')
  return <Dashboard user={user} showLeads={worksLeads && can('dashboard.view')} />
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function Hello({ user, scope }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="hello">
      <div>
        <h1>{greeting()}, {user.first_name || user.username}</h1>
        <div className="date">{today}</div>
      </div>
      <span className="scope-pill">{scope}</span>
    </div>
  )
}

/* Everyone has tasks, whatever their role — this is the part of the
   dashboard that is never empty for anybody. */
function MyTiles() {
  const [tiles, setTiles] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api('/api/tasks/dashboard/?scope=my&range=all')
      .then(d => setTiles(d.tiles)).catch(e => setErr(e.message))
  }, [])

  const v = (k) => (tiles ? tiles[k] : '—')
  return (
    <>
      <h3 className="dash-band">My work</h3>
      <div className="stats">
        <Tile icon="tasks" label="My open tasks" href="/tasks?tab=my&status=open" value={tiles ? tiles.pending + tiles.in_progress : '—'} />
        <Tile icon="flame" tone="red" label="Overdue" href="/tasks?tab=my&status=open&overdue=1" value={v('overdue')} alert={tiles?.overdue > 0} />
        <Tile icon="play" tone="amber" label="In progress" href="/tasks?tab=my&status=in_progress" value={v('in_progress')} />
        <Tile icon="check" label="Completed" href="/tasks?tab=my&status=done" value={v('completed')} />
        <Tile icon="trophy" tone="blue" label="Finished on time" href="/tasks?tab=my&status=done&done=on_time" value={v('in_time')} />
        <Tile icon="hourglass" tone="violet" label="Delayed" href="/tasks?tab=my&status=done&done=late" value={v('delayed')} alert={tiles?.delayed > 0} />
      </div>
      {err && <div className="err">{err}</div>}
    </>
  )
}

/* My deadlines, my score and my open mistakes -- the same block for every
   role, admins included. */
function Mine({ home, isAdmin }) {
  return (
    <div className="dash-grid dash-12">
      <NoticesCard className="span-12" />
      <Deadlines className="span-7" />
      <ScoreCard home={home} className="span-5" />
      {!isAdmin && <MyDelegation className="span-12" />}
      <MistakesCard home={home} className="span-12" />
    </div>
  )
}

/* Work this person handed to someone else, still open. Admins see every
   task under Tasks → All Tasks already; for everyone else this is the only
   place that answers "what did I give out, to whom, and where is it?". */
function Delegated() {
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    api('/api/tasks/?scope=delegated&status=open,in_progress&page_size=10')
      .then(d => { setRows(d.results || d); setTotal(d.count ?? (d.results || d).length) })
      .catch(() => setRows([]))
  }, [])

  return (
    <div className="dash-card span-12">
      <div className="card-head">
        <h3>Tasks I've delegated {rows && total > 0 && <span className="count-pill">{total} open</span>}</h3>
        <a className="btn btn-sm" href="/tasks?tab=delegated">All delegated →</a>
      </div>
      {!rows && <p className="muted small">Loading…</p>}
      {rows?.length === 0 && (
        <div className="empty-state"><Icon name="send" size={26} />You haven't handed out any open tasks.</div>
      )}
      {/* phone: one card per task, nothing to scroll sideways */}
      {rows?.length > 0 && (
        <div className="m-cards">
          {rows.map(t => (
            <a className="m-card" key={t.id} href={`/tasks/${t.id}`}>
              <div className="m-card-top">
                <span className="t-code">{t.code}</span>
                <span className={`pill-s s-${t.status}`}>{t.status_display}</span>
                {t.priority !== 'normal' && <span className={`pill-s p-${t.priority}`}>{t.priority_display}</span>}
              </div>
              <div className="m-card-title">{t.title}</div>
              {t.description && <div className="small muted">{t.description.slice(0, 110)}</div>}
              <div className="m-card-foot">
                {t.assigned_to_detail && (
                  <span className="person"><Avatar name={t.assigned_to_detail.name} size={24} /><span className="person-name">{t.assigned_to_detail.name}</span></span>
                )}
                <span className={t.is_overdue ? 'late' : 'muted'}>{t.due_at ? relDue(t.due_at) : 'No due date'}</span>
              </div>
              <div className="prog-cell">
                <div className="progress" style={{ flex: 1 }}><i style={{ width: `${t.progress_percent ?? 0}%` }} /></div>
                {t.progress_percent ?? 0}%
              </div>
            </a>
          ))}
        </div>
      )}
      {rows?.length > 0 && (
        <div className="table-scroll d-only">
          <table className="mini-table">
            <thead>
              <tr><th>Task</th><th>Assigned to</th><th>Status</th><th>Priority</th><th>Due</th><th>Progress</th></tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id}>
                  <td style={{ minWidth: 260 }}>
                    <a href={`/tasks/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <span className="t-code">{t.code}</span> <strong>{t.title}</strong>
                    </a>
                    {t.description && <div className="small muted" style={{ marginTop: 3 }}>{t.description.slice(0, 140)}</div>}
                    <div className="when">
                      Given {fmtDT(t.created_at)}
                      {t.category && <> · {t.category}</>}
                      {t.effort_minutes && <> · {t.effort_minutes}m effort</>}
                      {t.pending_change_requests > 0 && <> · <span className="late">change requested</span></>}
                    </div>
                  </td>
                  <td>
                    {t.assigned_to_detail
                      ? <span className="person"><Avatar name={t.assigned_to_detail.name} size={28} /><span className="person-name">{t.assigned_to_detail.name}</span></span>
                      : '—'}
                  </td>
                  <td><span className={`pill-s s-${t.status}`}>{t.status_display}</span></td>
                  <td><span className={`pill-s p-${t.priority}`}>{t.priority_display}</span></td>
                  <td className={t.is_overdue ? 'late' : ''} style={{ whiteSpace: 'nowrap' }}>{t.due_at ? relDue(t.due_at) : '—'}</td>
                  <td>
                    <div className="prog-cell">
                      <div className="progress"><i style={{ width: `${t.progress_percent ?? 0}%` }} /></div>
                      {t.progress_percent ?? 0}%
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Dashboard({ user, showLeads }) {
  const { can } = useAuth()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [filters, setFilters] = useState({ range: 'this_month', start: '', end: '', department: '' })
  const [home, homeErr] = useHome(filters)
  const isAdmin = ['admin', 'super_admin'].includes(user.role)
  // admins already see every task under Tasks → All Tasks
  const delegated = !isAdmin && <div className="dash-grid dash-12"><Delegated /></div>

  useEffect(() => {
    if (!showLeads) return          // no pipeline for this role: skip the call
    api('/api/dashboard/').then(setData).catch(e => setErr(e.message))
  }, [showLeads])

  const head = (
    <>
      <Hello user={user} scope={isAdmin ? 'All departments' : `${user.department_display} department`} />
      <Filters filters={filters} setFilters={setFilters} home={home} />
      {homeErr && <div className="err">{homeErr}</div>}
      <WaitingOnMe home={home} />
    </>
  )
  const mine = (
    <>
      <Mine home={home} isAdmin={isAdmin} />
      <TeamInsights home={home} />
      {/* everyone's given / received: admins and super admins only */}
      {isAdmin && <div className="dash-grid dash-12"><Delegation department={filters.department} /></div>}
    </>
  )

  // Task-only roles (warehouse, accounts, IT, developers…) stop here — their
  // dashboard is their work, not a sales pipeline.
  if (!showLeads) {
    return <div>{head}<MyTiles />{mine}{delegated}</div>
  }

  if (err) return <div>{head}<div className="err">{err}</div><MyTiles />{mine}{delegated}</div>
  if (!data) return <div className="center-note">Loading dashboard…</div>

  const { tiles, status_dist, per_day, employees, sources, recent_inbound, recent_events } = data
  const maxStatus = Math.max(1, ...status_dist.map(s => s.count))
  // No leads at all yet: one note instead of seven zero tiles and empty charts
  const hasLeads = tiles.total > 0
  const teamTasks = `/tasks?tab=${isAdmin || can('tasks.view_department') ? 'all' : 'my'}&status=`
  const overduePct = tiles.open_tasks ? Math.round(100 * tiles.overdue_tasks / tiles.open_tasks) : 0
  const people = employees

  return (
    <div>
      {head}

      <h3 className="dash-band">Tasks</h3>
      <div className="stats">
        <Tile icon="tasks" label="Open tasks" href={`${teamTasks}open`} value={tiles.open_tasks} sub="assigned and not done" />
        <Tile icon="flame" tone="red" label="Overdue tasks" href={`${teamTasks}open&overdue=1`} value={tiles.overdue_tasks}
          alert={tiles.overdue_tasks > 0} sub={tiles.open_tasks ? `${overduePct}% of open tasks` : null} />
        <Tile icon="phone" tone="blue" label="Pending follow-ups" href="/leads" value={tiles.pending_followups} />
        <Tile icon="clock" tone="amber" label="Overdue follow-ups" href="/leads" value={tiles.overdue} alert={tiles.overdue > 0} />
      </div>

      {mine}
      {delegated}

      <h3 className="dash-band">Leads</h3>
      {hasLeads ? (
        <div className="stats">
          <Tile icon="target" label="Total leads" href="/leads" value={tiles.total} />
          <Tile icon="sparkle" tone="blue" label="New" href="/leads" value={tiles.new} />
          <Tile icon="play" tone="amber" label="Active" href="/leads" value={tiles.active} />
          <Tile icon="trophy" label="Won" href="/leads" value={tiles.won} />
          <Tile icon="x" tone="red" label="Lost" href="/leads" value={tiles.lost} />
          <Tile icon="rupee" tone="violet" label="Pipeline value" href="/leads" value={fmtINR(tiles.pipeline_value) || '₹0'} />
          <Tile icon="percent" tone="blue" label="Conversion" href="/leads" value={tiles.conversion_pct + '%'} />
        </div>
      ) : (
        <div className="dash-card">
          <div className="empty-state" style={{ padding: '14px 10px' }}>
            <Icon name="target" size={26} />
            No leads yet. Pipeline, conversion and sources show up here once leads come in.
          </div>
        </div>
      )}

      <div className="dash-grid dash-12">
        {hasLeads && (
          <div className="dash-card span-8">
            <h3>Leads created — last 14 days</h3>
            <div className="chart-box">
              <Bar
                data={{
                  labels: per_day.map(d => new Date(d.date + 'T00:00:00')
                    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })),
                  datasets: [{
                    data: per_day.map(d => d.count),
                    backgroundColor: '#14b789',
                    hoverBackgroundColor: '#0d7a5f',
                    borderRadius: 6,
                    maxBarThickness: 26,
                  }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { tooltip: { displayColors: false, padding: 10, cornerRadius: 8 } },
                  scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { color: '#64716c', maxRotation: 0, autoSkip: true, font: { size: 11 } } },
                    y: { beginAtZero: true, ticks: { color: '#64716c', precision: 0, font: { size: 11 } }, grid: { color: '#eef2f0' }, border: { display: false } },
                  },
                }}
              />
            </div>
          </div>
        )}

        {hasLeads && (
          <div className="dash-card span-4">
            <h3>Pipeline by stage</h3>
            <div className="hbars">
              {status_dist.map(s => (
                <div className="hbar-row" key={s.status} title={`${s.label}: ${s.count}`}>
                  <span className="hbar-label">{s.label}</span>
                  <div className="hbar-track">
                    <div className="hbar-fill" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                  </div>
                  <span className="hbar-count">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasLeads && people.length > 0 && (
          <div className="dash-card span-12">
            <h3>Lead performance by employee</h3>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Employee</th><th className="num">Leads</th><th className="num">Open</th>
                    <th className="num">Won</th><th className="num">Lost</th>
                    <th className="num">Overdue follow-ups</th><th className="num">Open tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(e => (
                    <tr key={e.id}>
                      <td>
                        <span className="person">
                          <Avatar name={e.name} />
                          <span>
                            <span className="person-name">{e.name}</span>
                            <div className="person-role">{e.role}</div>
                          </span>
                        </span>
                      </td>
                      <td className="num">{e.total}</td>
                      <td className="num">{e.open}</td>
                      <td className="num ok">{e.won}</td>
                      <td className="num">{e.lost}</td>
                      <td className={'num' + (e.overdue ? ' late' : '')}>{e.overdue}</td>
                      <td className="num">{e.open_tasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hasLeads && (
          <div className="dash-card span-4">
            <h3>Lead sources</h3>
            <div className="table-scroll">
              <table className="mini-table">
                <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Won</th><th className="num">Conv.</th></tr></thead>
                <tbody>
                  {sources.map(s => (
                    <tr key={s.source}>
                      <td><strong>{s.label}</strong></td>
                      <td className="num">{s.total}</td><td className="num ok">{s.won}</td><td className="num">{s.conversion_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className={'dash-card ' + (hasLeads ? 'span-4' : 'span-6')}>
          <h3>WhatsApp / Gmail activity</h3>
          {recent_inbound.length === 0
            ? <div className="empty-state"><Icon name="inbox" size={24} />No inbound messages yet.</div>
            : recent_inbound.map((m, i) => (
              <div className="feed-row" key={i}>
                <span>{m.channel === 'whatsapp' ? '💬' : '✉'}</span>
                <div style={{ minWidth: 0 }}>
                  <strong>{m.sender}</strong> <span className="muted small">→ {m.lead_name || m.status}</span>
                  <div className="small muted">{m.body}</div>
                  <div className="when">{fmtDT(m.created_at)}</div>
                </div>
              </div>
            ))}
        </div>

        <div className={'dash-card ' + (hasLeads ? 'span-4' : 'span-6')}>
          <h3>Recent lead activity</h3>
          {recent_events.length === 0
            ? <div className="empty-state"><Icon name="chart" size={24} />No lead activity yet.</div>
            : recent_events.map((e, i) => (
              <div className="feed-row" key={i}>
                <span className="dot" style={{ marginTop: 6 }} />
                <div style={{ minWidth: 0 }}>
                  <strong>{e.lead_name}</strong> <span className="small muted">{e.body}</span>
                  <div className="when">{e.actor} · {fmtDT(e.created_at)}</div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

function Tile({ icon, tone, label, value, sub, alert, href }) {
  const Tag = href ? 'a' : 'div'      // a tile with a link opens that list
  return (
    <Tag href={href} className={'stat has-ic' + (tone ? ` t-${tone}` : '') + (alert ? ' alert' : '') + (href ? ' stat-link' : '')}>
      <span className="stat-ic"><Icon name={icon} /></span>
      <div className="stat-body">
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </Tag>
  )
}
