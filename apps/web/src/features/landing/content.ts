/**
 * The landing page's words and pictures (PLAN.md §24.2). Screenshots are real screens of the demo company, made by
 * scripts/landing-screenshots.mjs into apps/web/public/landing/ (refresh them with that script, never from the live
 * server).
 */
import {
  Building2,
  ClipboardList,
  FileSpreadsheet,
  IndianRupee,
  ListChecks,
  MapPin,
  Package,
  QrCode,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Users,
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
    a: 'Indian businesses with 5 to 500 people: offices, showrooms, workshops, clinics, schools and field teams. Anyone who wants attendance, tasks, assets and visitors in one place instead of registers and WhatsApp groups.',
  },
  {
    q: 'How does the free trial work?',
    a: 'Sign up and use every module free for the trial period with a small team. No card is needed. When you are ready, choose your modules and number of users in Billing.',
  },
  {
    q: 'Can I pay only for the modules I use?',
    a: 'Yes. Pick Tasks, Attendance or Assets one by one at a price per user per month, or take Complete for everything, including Visitors and Payroll. Prices are before GST.',
  },
  {
    q: 'Does attendance work without a smartphone for everyone?',
    a: 'People punch in from the Android app or any phone browser with a selfie and location. Admins can also mark attendance and approve corrections, so nobody is left out.',
  },
  {
    q: 'What does the AI option do?',
    a: 'The AI option adds a helper inside the app that answers your team’s questions about using Kaampilot. It is chosen for the whole subscription: all your modules with AI, or none.',
  },
  {
    q: 'Is our data safe?',
    a: 'Each company’s data is kept separate, on servers in India, with photos behind signed links. Only the people you give access to can see it, and you can download your records any time.',
  },
  {
    q: 'Can we move from Excel or another app?',
    a: 'Yes. Import your people from Excel in one go. Book a demo and we will help you set up offices, shifts, leave rules and roles.',
  },
];

export const APP_APK = '/download/kaampilot.apk';
