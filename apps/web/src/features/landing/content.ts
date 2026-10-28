/**
 * The landing page's words and pictures (PLAN.md §24.2). Screenshots are real screens of the demo company, made by
 * scripts/landing-screenshots.mjs into apps/web/public/landing/ (refresh them with that script, never from the live
 * server).
 */
import {
  AlarmClock,
  Bell,
  Building,
  Building2,
  CalendarCheck,
  Car,
  ClipboardList,
  Cloud,
  Download,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  KeyRound,
  LayoutGrid,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  Network,
  Package,
  QrCode,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Timer,
  Trophy,
  UserCog,
  UserPlus,
  Users,
  Wrench,
} from '@/components/icons';

export interface Shot {
  src: string;
  alt: string;
  /** 'phone' pictures are drawn narrow, in a phone frame. */
  kind?: 'desktop' | 'phone';
  label: string;
}

export interface TourModule {
  key: string;
  name: string;
  icon: typeof MapPin;
  /** Tailwind classes for the module's colour (theme tokens). */
  tone: string;
  headline: string;
  points: string[];
  shots: Shot[];
}

const D = { kind: 'desktop' as const };
const P = { kind: 'phone' as const };

export const TOUR: TourModule[] = [
  {
    key: 'attendance',
    name: 'Attendance & HR',
    icon: MapPin,
    tone: 'text-app-attendance bg-app-attendance/10',
    headline: 'Punch in with a selfie at the office, and payroll that counts itself.',
    points: [
      'Selfie + GPS punch: only inside your office radius, with the photo on record',
      'Leave, half-days and holidays with approvals by the reporting manager',
      'Regularization: forgot to punch? Ask once, the manager approves, the day is corrected',
      'Payroll and payslips straight from attendance; Excel reports for HR',
      'Punch-in reminders on the phone, so nobody forgets',
    ],
    shots: [
      { ...D, src: '/landing/attendance.webp', alt: 'Live team attendance: who is in, who is late and who has not checked in', label: 'Live team' },
      { ...P, src: '/landing/phone-attendance.webp', alt: 'Punch in on an Android phone', label: 'Phone punch' },
    ],
  },
  {
    key: 'tasks',
    name: 'Tasks',
    icon: ListChecks,
    tone: 'text-app-tasks bg-app-tasks/10',
    headline: 'Give work, track it, and know who finishes on time.',
    points: [
      'Tasks with due dates, checklists, repeats and sign-off by the person who gave it',
      'Task chains: give a part of a task to someone else, up to 5 levels deep',
      'Excel report per person and a ranking of who asks most to move dates',
      'Count badges and one notification bell, so nothing waits unseen',
      'Templates, a team dashboard and performance reports',
    ],
    shots: [
      { ...D, src: '/landing/tasks.webp', alt: 'Tasks list with due dates and people', label: 'Task list' },
      { ...D, src: '/landing/task-chain.webp', alt: 'A task chain: parts of a task given to other people', label: 'Task chain' },
    ],
  },
  {
    key: 'assets',
    name: 'Assets',
    icon: Package,
    tone: 'text-app-assets bg-app-assets/10',
    headline: 'Every laptop, phone and SIM: who has it and what it needs.',
    points: [
      'Asset register with photos, QR scan and the full history of each item',
      'Handover to new joiners and return on exit, with a checklist',
      'Tickets for repairs and requests, linked to Tasks',
      'Maintenance reminders, vendors and reconciliation',
    ],
    shots: [{ ...D, src: '/landing/assets.webp', alt: 'Assets register with categories and holders', label: 'Assets' }],
  },
  {
    key: 'visitors',
    name: 'Visitors',
    icon: Building2,
    tone: 'text-app-visitors bg-app-visitors/10',
    headline: 'A digital gate register that replaces the paper book.',
    points: [
      'Guard login at the gate: check visitors in and out with a photo',
      'Vehicle in/out with the number plate photo, deliveries and contractors',
      'QR self check-in: visitors scan, fill in and wait for the host to allow',
      'Who is inside right now, for evacuation and reports',
    ],
    shots: [{ ...D, src: '/landing/visitors.webp', alt: 'Visitors gate screen with today’s visits', label: 'Gate' }],
  },
  {
    key: 'admin',
    name: 'Admin',
    icon: ShieldCheck,
    tone: 'text-app-admin bg-app-admin/10',
    headline: 'One login per person, the right access for every role.',
    points: [
      'Roles with exactly the duties each person needs',
      'Import people from Excel, invite links, departments and reporting managers',
      'Company settings, modules on or off, and your own brand colour',
      'Billing with GST invoices; pay by UPI, card or net banking',
    ],
    shots: [
      { ...D, src: '/landing/admin.webp', alt: 'People and access screen', label: 'People' },
      { ...D, src: '/landing/billing.webp', alt: 'Billing screen with plan and invoices', label: 'Billing' },
    ],
  },
];

export const HIGHLIGHTS = [
  { icon: MapPin, title: 'Selfie + GPS punch', text: 'Only at the office, with a photo on record' },
  { icon: ClipboardList, title: 'Tasks that get done', text: 'Approvals, chains, reminders, reports' },
  { icon: Package, title: 'Assets and tickets', text: 'Who has which laptop, always' },
  { icon: QrCode, title: 'Visitors at the gate', text: 'Photo, vehicle, QR self check-in' },
];

export const STEPS = [
  { icon: UserPlus, title: 'Create your company', text: 'Sign up with your email, name your company and pick the modules you need. Two minutes.' },
  { icon: Users, title: 'Add your team', text: 'Import people from Excel or send an invite link. Set offices, shifts and who approves what.' },
  { icon: Smartphone, title: 'Everyone uses one app', text: 'Your team punches in and gets tasks on Android or any browser. You see it all live.' },
];

export const TRUST = [
  { icon: IndianRupee, text: 'Prices in ₹, GST invoices' },
  { icon: ShieldCheck, text: 'Data stays in India' },
  { icon: Smartphone, text: 'Works on low-end Android' },
  { icon: FileSpreadsheet, text: 'Excel in, Excel out' },
];

export const FAQ = [
  {
    q: 'Who is Kaampilot for?',
    a: 'Indian businesses with 5 to 500 people: offices, showrooms, workshops, factories, clinics, schools and field teams. Anyone who wants attendance, tasks, assets and visitors in one place instead of registers, Excel sheets and WhatsApp groups.',
  },
  {
    q: 'How does the free trial work?',
    a: 'Sign up with your work email and use every module free for the trial period with a small team. No card is needed. When you are ready, choose your modules and number of users in Billing.',
  },
  {
    q: 'Can I buy straight away, without the trial?',
    a: 'Yes. Pick your plan in the price calculator and press Buy now. You sign up, pay online (UPI, card or net banking) and your plan starts at once.',
  },
  {
    q: 'Can I pay only for the modules I use?',
    a: 'Yes. Pick Tasks, Attendance or Assets one by one at a price per user per month, or take Complete for everything, including Visitors and Payroll. Prices are before GST. Change your plan any time.',
  },
  {
    q: 'Do we get a GST invoice?',
    a: 'Yes. After every payment a GST invoice is made with your company’s GST details, emailed as a PDF to the owner and your billing email, and kept in Billing to download again.',
  },
  {
    q: 'Does attendance work without a smartphone for everyone?',
    a: 'People punch in from the Android app or any phone browser with a selfie and location. HR can also mark a day by hand, so nobody is left out.',
  },
  {
    q: 'Someone forgot to punch in. What now?',
    a: 'They ask for a regularization with a reason. Their reporting manager approves it and the day is corrected, payroll included. Your company sets how many requests a person may make each month.',
  },
  {
    q: 'Can a manager see only their own team?',
    a: 'Yes. Owners and HR see everyone. A manager sees the people who report to them. Members see only their own records. Roles decide the rest.',
  },
  {
    q: 'How do visitors check in?',
    a: 'The guard checks them in at the gate with a photo, or the visitor scans your company QR poster and fills in the form on their own phone. The person they came to meet is told at once.',
  },
  {
    q: 'Do all employees need an email address?',
    a: 'No. The admin can create a login with a username or employee ID and a password. Email is needed for the owner and for people who sign in with a code.',
  },
  {
    q: 'We run more than one company. Is that a problem?',
    a: 'No. One login can belong to several companies: you choose one after signing in and switch from the account menu. Each company’s data stays fully separate.',
  },
  {
    q: 'What does the AI option do?',
    a: 'It adds “Ask Kaampilot”, a helper inside the app that answers your team’s questions about using Kaampilot, in English or Hindi. It is chosen for the whole subscription: all your modules with AI, or none.',
  },
  {
    q: 'Is our data safe?',
    a: 'Each company’s data is kept separate, on servers in India, with photos behind short-lived signed links and passwords stored only as a hash. Only the people you give access to can see it, and you can download your records any time.',
  },
  {
    q: 'Can we move from Excel or another app?',
    a: 'Yes. Import your people from Excel in one go. Book a demo and we will help you set up offices, shifts, leave rules and roles.',
  },
];

/** A working day with Kaampilot (the "day in the life" story): one real screen per moment. */
export interface StoryStep {
  time: string;
  who: string;
  title: string;
  text: string;
  points: string[];
  shot: Shot;
}

export const STORY: StoryStep[] = [
  {
    time: '09:28',
    who: 'Priya, HR executive',
    title: 'Punch in with a selfie, at the office',
    text: 'Priya opens the app at the gate and punches in. The selfie and GPS point are saved with the time, so nobody can mark attendance for a friend.',
    points: ['Works only inside your office radius', 'Late after the grace time? Marked on its own'],
    shot: { kind: 'phone', src: '/landing/phone-attendance.webp', alt: 'Punching in with a selfie on an Android phone', label: 'Punch in' },
  },
  {
    time: '10:00',
    who: 'Rohit, sales manager',
    title: 'The manager sees the whole team, live',
    text: 'Who is in, who is late and who has not come yet: one screen, no phone calls. People who forget to punch get a reminder every 30 minutes.',
    points: ['Reminders stop the moment they punch in', 'Forgot to punch? Regularize, the manager approves'],
    shot: { kind: 'desktop', src: '/landing/attendance.webp', alt: 'Live team attendance: who is in, who is late and who has not checked in', label: 'Live team' },
  },
  {
    time: '11:30',
    who: 'Anita, owner',
    title: 'Work is given, split and tracked',
    text: 'Anita gives the clutch-plate launch to Rohit. He gives parts of it to his team. Everyone sees what is due, and Anita sees the whole chain.',
    points: ['Due dates, checklists and sign-off by the giver', 'Count badges show what is waiting for you'],
    shot: { kind: 'desktop', src: '/landing/task-chain.webp', alt: 'A task chain: parts of a task given to other people', label: 'Task chain' },
  },
  {
    time: '15:10',
    who: 'Vikram, security guard',
    title: 'A visitor at the gate, without the paper book',
    text: 'A dealer arrives. Vikram takes a photo, notes the vehicle number and Rohit is told at once. Or the dealer scans the QR poster and fills in the form himself.',
    points: ['Pass number and QR for a one-tap check-out', 'Who is inside right now, for safety'],
    shot: { kind: 'desktop', src: '/landing/visitors.webp', alt: 'Visitors gate screen with today’s visits', label: 'Gate' },
  },
  {
    time: '18:30',
    who: 'Anita, owner',
    title: 'Every person, one tile',
    text: 'Before leaving, Anita opens Team. Each person’s day and month in one tile: attendance, tasks done, anything overdue. One tap opens their full picture.',
    points: ['Managers see only their own team', 'Attendance %, on-time %, late days, score'],
    shot: { kind: 'desktop', src: '/landing/team.webp', alt: 'Team: one tile per employee with today’s status, attendance and tasks', label: 'Team' },
  },
  {
    time: 'Month end',
    who: 'Priya, HR executive',
    title: 'Payroll and reports, already counted',
    text: 'Attendance, leave and corrected days flow into payroll and payslips. Muster roll, late arrivals and leave reports download as Excel in one click.',
    points: ['No copying from registers into Excel', 'Your GST invoice arrives by email'],
    shot: { kind: 'desktop', src: '/landing/hr-reports.webp', alt: 'Attendance reports: download daily, monthly and leave reports as Excel', label: 'Reports' },
  },
];

/** Team 360 (PLAN.md §25). */
export const TEAM360 = {
  points: [
    { icon: LayoutGrid, title: 'A tile per person', text: 'Today’s status, check-in time, month attendance, tasks done and overdue. Filter by department or status.' },
    { icon: Users, title: 'One-person view', text: 'Attendance calendar, punches, leave, regularizations, tasks, chains, assets held and visitors hosted.' },
    { icon: Trophy, title: 'Fair, simple numbers', text: 'Attendance %, on-time %, average hours, a task score and who asks most to move due dates.' },
    { icon: ShieldCheck, title: 'Only the right people', text: 'Owner and HR see everyone, a manager sees their own team, members do not see it at all.' },
  ],
  shots: [
    { kind: 'desktop', src: '/landing/team.webp', alt: 'Team: tiles for every employee', label: 'All tiles' },
    { kind: 'desktop', src: '/landing/team-person.webp', alt: 'One person: attendance, tasks and score for the month', label: 'One person' },
  ] satisfies Shot[],
};

export interface MoreFeature {
  icon: typeof MapPin;
  area: string;
  title: string;
  text: string;
}

/** The smaller features in one grid ("And everything else"). The AI helper card is added by the page (on, or coming soon). */
export const MORE: MoreFeature[] = [
  { icon: CalendarCheck, area: 'Attendance', title: 'Regularization with approval', text: 'Forgot to punch? Ask once with a reason. The manager approves, and the day and payroll are corrected. You set a monthly limit.' },
  { icon: AlarmClock, area: 'Attendance', title: 'Punch-in reminders', text: 'Not punched in by start time? Up to 3 reminders in the app and on WhatsApp. None on leave, holidays or week-offs.' },
  { icon: Network, area: 'Tasks', title: 'Task chains', text: 'Give a part of a task to someone else, up to 5 levels deep. Everyone sees their part; the giver sees it all.' },
  { icon: Trophy, area: 'Tasks', title: 'Change-request ranking', text: 'See who asks most to move due dates, plus an Excel report per person with every task and score.' },
  { icon: FileSpreadsheet, area: 'Reports', title: 'Excel in, Excel out', text: 'Import people from Excel. Download muster roll, leave, task and asset reports as Excel or CSV.' },
  { icon: Bell, area: 'Everywhere', title: 'Badges and one bell', text: 'Counts on the menu show what waits for you. One notification bell, grouped by area, every item one tap away.' },
  { icon: Wrench, area: 'Assets', title: 'Asset tickets', text: 'A broken laptop or a new SIM? Raise a ticket. It becomes a task for the right person and closes when solved.' },
  { icon: QrCode, area: 'Visitors', title: 'QR self check-in', text: 'Print one QR poster. Visitors scan it, fill in the form and wait while their host allows them in.' },
  { icon: Car, area: 'Visitors', title: 'Vehicle and parcel log', text: 'Vehicles in and out with a number-plate photo, parcels received and handed over, contractors with passes.' },
  { icon: UserCog, area: 'Admin', title: 'Roles and permissions', text: 'Make roles with exactly the duties each person needs: guard, HR, store keeper, manager. One login per person.' },
  { icon: Building, area: 'Admin', title: 'More than one company', text: 'Run several companies from one login and switch in two taps. Each company’s data stays separate.' },
  { icon: FileText, area: 'Billing', title: 'GST invoices by email', text: 'Every payment gives a GST invoice PDF, emailed to the owner and your billing email, and kept in Billing.' },
  { icon: Timer, area: 'Billing', title: 'Free trial or buy now', text: 'Try everything free with a small team, or buy your plan at once and start without the trial.' },
  { icon: Smartphone, area: 'Phone', title: 'Android app', text: 'The full app in your pocket, light enough for low-cost phones: selfie punch, reminders, downloads and printing.' },
  { icon: Mail, area: 'Sign-in', title: 'Sign in with an email code', text: 'No password to remember? Get a 6-digit code by email instead. Passwords are stored only as a hash.' },
];

export const AI_FEATURE = {
  icon: Sparkles,
  area: 'AI',
  title: 'Ask Kaampilot',
  on: 'An AI helper that answers how-to questions about the app, in English or Hindi. Try it now: the button at the bottom right.',
  off: 'Coming soon: an AI helper that answers how-to questions about the app, in English or Hindi.',
};

/** "Why Kaampilot": the usual tools of a small Indian business next to Kaampilot (yes / part / no). */
export type Mark = 'yes' | 'part' | 'no';
export const COMPARE_TOOLS = ['Paper register', 'WhatsApp groups', 'Excel sheets'] as const;
export const COMPARE: { need: string; tools: [Mark, Mark, Mark]; us: string }[] = [
  { need: 'Proof the person was at the office', tools: ['no', 'part', 'no'], us: 'Selfie + GPS on every punch' },
  { need: 'Who is in today, right now', tools: ['no', 'part', 'no'], us: 'Live team screen, any time' },
  { need: 'Leave and corrections with approval', tools: ['part', 'part', 'no'], us: 'Manager approves in one tap' },
  { need: 'Payroll from attendance', tools: ['no', 'no', 'part'], us: 'Counted for you, payslips too' },
  { need: 'Tasks that do not get lost in chat', tools: ['no', 'no', 'part'], us: 'Due dates, reminders, sign-off' },
  { need: 'Who has which laptop or SIM', tools: ['part', 'no', 'part'], us: 'Register with QR and history' },
  { need: 'Visitor and vehicle log', tools: ['yes', 'no', 'no'], us: 'Photo, vehicle, QR self check-in' },
  { need: 'Reports at month end', tools: ['no', 'no', 'part'], us: 'Excel in one click' },
];

export const SECURITY = [
  { icon: Cloud, title: 'Data stays in India', text: 'Your records and photos are stored on servers in India.' },
  { icon: Server, title: 'Each company kept apart', text: 'Every company has its own separate data space. One company can never see another’s.' },
  { icon: Lock, title: 'Photos behind signed links', text: 'Punch and visitor photos open only through short-lived links, for people allowed to see them.' },
  { icon: KeyRound, title: 'Passwords never stored', text: 'Only a hash is kept. Nobody, admins included, can read a password.' },
  { icon: UserCog, title: 'Access by role', text: 'People see only what their role allows. Managers see their team, members their own records.' },
  { icon: Download, title: 'Backups and your own copy', text: 'Records and files are backed up, and you can download your data as Excel any time.' },
];

export const APP_APK = '/download/kaampilot.apk';
