/**
 * The public landing page (PLAN.md §24.2): `/` for signed-out visitors on the web (signed-in people get Home; inside
 * the phone app signed-out people go straight to sign-in, see app/session-guard.tsx), and `/pricing` (the pricing
 * section alone).
 * Sections (v3, 2026-10-28): hero, numbers strip, highlights, "A day with Kaampilot" (sticky scroll story), feature tour
 * with real screenshots, Team 360, everything else (feature grid), why Kaampilot (vs registers / WhatsApp / Excel),
 * how it works, security & data, the phone app, the pricing calculator, book a demo, FAQ, footer.
 * Theme tokens only, flat (no gradients, glows or blur). Motion (motion.tsx + landing.css): reveal on scroll with a
 * stagger, a reading-progress bar, counters, the story's sticky picture, tab and picture crossfades, hover tilt on
 * desktop, a little hero parallax, a counting price total. Transform/opacity only, all of it off with less motion,
 * and nothing waits for it: content is there without JavaScript animation.
 */
import { usePublicPricing } from '@kaampilot/core';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, Download, Minus, Moon, Smartphone, Sun, X } from '@/components/icons';
import { BrandLockup, BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { LEGAL_LINKS } from '@/features/account/legal-links';
import { AskAi } from '@/features/ai-helper';
import { cn } from '@/lib/utils';
import { BookDemoButton } from './book-demo';
import { AI_FEATURE, APP_APK, COMPARE, COMPARE_TOOLS, FAQ, HIGHLIGHTS, type Mark, MORE, SECURITY, STEPS, TEAM360, TRUST } from './content';
import { DayStory } from './day-story';
import { FeatureTour, ShotButtons, ShotFrame, ShotStage } from './feature-tour';
import { CountUp, Parallax, Reveal, ScrollProgress, Tilt, useMotionRoot } from './motion';
import { PricingCalculator } from './pricing-calculator';
import { usePageMeta } from './page-meta';
import './landing.css';

const WRAP = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 2xl:max-w-7xl';
/** Touch screens (phones, tablets) get buttons at least 44 px tall; mouse screens keep the compact size. */
const TAP = 'pointer-coarse:min-h-[44px]';
const EYEBROW = 'font-mono text-[11px] font-semibold tracking-widest text-primary uppercase';
const H2 = 'text-[clamp(1.6rem,1.1rem+2.2vw,1.85rem)] leading-tight font-extrabold tracking-tight text-balance sm:text-[2.25rem] lg:text-[clamp(2.25rem,1.3rem+1.1vw,2.6rem)]';
const LEAD = 'mt-3 text-[17px] leading-relaxed text-muted-foreground';
type Pricing = ReturnType<typeof usePublicPricing>['pricing'];

export function LandingPage({ only }: { only?: 'pricing' }) {
  usePageMeta(
    only === 'pricing'
      ? { title: 'Pricing · Kaampilot', description: 'Kaampilot prices per user per month: pick Tasks, Attendance or Assets, or Complete with Visitors and Payroll. Add AI. GST extra. Free trial.', path: '/pricing' }
      : {
          title: 'Kaampilot · Attendance, tasks, assets and visitors for Indian SMEs',
          description:
            'Selfie + GPS attendance, leave and payroll, tasks with approvals, assets and a visitor gate register. One app on the web and Android for Indian businesses. Free trial.',
          path: '/',
        },
  );
  const { pricing } = usePublicPricing();
  // From 1024 px the website's root size grows with the screen (index.css, `html[data-site]`), so laptops and big
  // screens get a wider column and larger text instead of a small strip in the middle. The app frame never has it.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.site = '';
    return () => {
      delete html.dataset.site;
    };
  }, []);
  useMotionRoot();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <TopBar />
      <main id="main">
        {only === 'pricing' ? (
          <PricingSection pricing={pricing} standalone />
        ) : (
          <>
            <Hero trialDays={pricing.trial.days} trialUsers={pricing.trial.maxUsers} />
            <Numbers pricing={pricing} />
            <Highlights />
            <Story />
            <section id="features" aria-labelledby="features-title" className="scroll-mt-20 border-t bg-card py-16 sm:py-24">
              <div className={WRAP}>
                <Reveal className="mx-auto mb-10 max-w-2xl text-center">
                  <p className={EYEBROW}>Everything in one app</p>
                  <h2 id="features-title" className={cn(H2, 'mt-3')}>
                    See what your team gets
                  </h2>
                  <p className={LEAD}>Real screens from the app. Pick a module.</p>
                </Reveal>
                <FeatureTour />
              </div>
            </section>
            <Team360 />
            <MoreFeatures aiOn={pricing.aiHelper} />
            <WhyKaampilot />
            <HowItWorks />
            <Security />
            <PhoneApp />
            <PricingSection pricing={pricing} />
          </>
        )}
        <DemoBand />
        <Faq />
        <FinalCta trialDays={pricing.trial.days} />
      </main>
      <Footer />
    </div>
  );
}

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('ff-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode */
    }
  };
  return { dark, toggle };
}

const NAV: [string, string, string][] = [
  ['story', 'A day with us', 'hidden lg:inline-flex'],
  ['features', 'Features', ''],
  ['why', 'Why us', 'hidden lg:inline-flex'],
  ['pricing', 'Pricing', ''],
  ['faq', 'FAQ', ''],
];

/** The section in the middle of the screen, for the top bar's "you are here" (scroll-spy). */
function useCurrentSection(ids: string[]) {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) seen.add(e.target.id);
          else seen.delete(e.target.id);
        }
        setCurrent(ids.find((id) => seen.has(id)) ?? null);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()]);
  return current;
}

function TopBar() {
  const theme = useDark();
  const [scrolled, setScrolled] = useState(false);
  const current = useCurrentSection(NAV.map((n) => n[0]));
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={cn('sticky top-0 z-40 border-b bg-background transition-colors', scrolled ? 'border-border' : 'border-transparent')}>
      <div className={cn(WRAP, 'flex h-16 items-center gap-3')}>
        <Link to="/" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" aria-label="Kaampilot home">
          <BrandLockup size={28} className="max-sm:hidden" />
          <BrandMark size={32} className="sm:hidden" />
        </Link>
        <nav aria-label="Sections" className="ml-6 hidden items-center gap-1 text-sm font-medium md:flex">
          {NAV.map(([id, label, cls]) => (
            <a
              key={id}
              href={`/#${id}`}
              aria-current={current === id ? 'location' : undefined}
              className={cn('relative rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-foreground', current === id ? 'text-foreground' : 'text-muted-foreground', cls)}
            >
              {label}
              <span aria-hidden className={cn('kp-seg absolute inset-x-3 -bottom-0.5 h-0.5 origin-left rounded-sm bg-primary', current === id ? 'scale-x-100' : 'scale-x-0')} />
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <AskAi site />
          <Button variant="ghost" size="icon" onClick={theme.toggle} aria-label={theme.dark ? 'Light mode' : 'Dark mode'} title={theme.dark ? 'Light mode' : 'Dark mode'}>
            {theme.dark ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" asChild className={TAP}>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button variant="cta" asChild className={cn('kp-press max-[359px]:hidden', TAP)}>
            <Link to="/signup">Start free trial</Link>
          </Button>
        </div>
      </div>
      <ScrollProgress />
    </header>
  );
}

/** True on phone-width screens (under 640 px, Tailwind `sm`); follows rotation and window resizes. */
function usePhoneWidth() {
  const query = '(max-width: 639px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** "Start free trial" with an arrow that nudges on hover (the page's one `cta`). */
function TrialButton({ className }: { className?: string }) {
  return (
    <Button variant="cta" size="lg" asChild className={cn('group kp-press', TAP, className)}>
      <Link to="/signup">
        Start free trial <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </Button>
  );
}

function Hero({ trialDays, trialUsers }: { trialDays: number; trialUsers: number }) {
  const phone = usePhoneWidth();
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden pt-8 pb-14 sm:pt-16 sm:pb-20 2xl:pt-20">
      <div className={cn(WRAP, 'grid items-center gap-10 sm:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10 xl:gap-14')}>
        <div className="kp-hero-in">
          <p className="inline-flex items-center gap-2 rounded-sm border border-primary/25 bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold tracking-widest text-accent-foreground uppercase">
            For Indian SMEs · 5 to 500 people
          </p>
          <h1 id="hero-title" className="mt-5 text-[clamp(2.1rem,1.2rem+4.2vw,2.6rem)] leading-[1.06] font-extrabold tracking-tight text-balance sm:text-[3.25rem] lg:text-[clamp(2.6rem,1.2rem+2.4vw,3.75rem)]">
            Your team’s <span className="text-primary">kaam</span>, on autopilot.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground sm:text-lg">
            Attendance with a selfie and GPS punch, leave and payroll, tasks with approvals, assets and a visitor gate register. One app
            and one login for everyone, on the web and Android.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3 max-[399px]:[&>*]:flex-1">
            <TrialButton />
            <BookDemoButton className={cn('kp-press', TAP)} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Free for {trialDays} days with up to {trialUsers} users. No card needed. Or{' '}
            <a href="#pricing" className="font-medium text-primary underline-offset-4 hover:underline">
              buy now
            </a>
            .
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
            {TRUST.map((t) => (
              <li key={t.text} className="inline-flex items-center gap-1.5">
                <t.icon className="size-4 text-primary" /> {t.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="kp-hero-in-late relative">
          {phone ? (
            // A desktop screenshot is unreadable at phone width: phones see the phone app in a phone frame instead.
            <ShotFrame eager still shot={{ kind: 'phone', src: '/landing/phone-attendance.webp', alt: 'Kaampilot on an Android phone: punch in with a selfie', label: 'Phone' }} className="max-w-[250px]" />
          ) : (
            <>
              <Tilt className="xl:mr-20">
                <ShotFrame eager still shot={{ src: '/landing/home.webp', alt: 'Kaampilot Home: today’s attendance, tasks and assets at a glance', label: 'Home' }} />
              </Tilt>
              {/* The phone beside the desktop shot only where there is room for both (from 1280 px); it drifts a little
                  slower than the page (parallax). */}
              <Parallax className="absolute -right-1 -bottom-10 hidden w-[24%] max-w-[200px] xl:block" speed={0.08}>
                <ShotFrame still shot={{ kind: 'phone', src: '/landing/phone-attendance.webp', alt: 'Punch in on the phone', label: 'Phone' }} className="border-[5px]" />
              </Parallax>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Facts only (no invented customer counts): modules, set-up time, trial, the lowest price, one login. */
function Numbers({ pricing }: { pricing: Pricing }) {
  const from = Math.min(...pricing.modules.map((m) => m.price));
  const items = [
    { n: 5, label: 'modules in one app', sub: 'Attendance, Tasks, Assets, Visitors, Payroll' },
    { n: 2, suffix: ' min', label: 'to create your company', sub: 'Then import your people from Excel' },
    { n: pricing.trial.days, suffix: ' days', label: 'free trial', sub: 'No card needed' },
    { n: from, prefix: '₹', label: 'per user per month', sub: 'Pay only for the modules you use' },
  ];
  return (
    <section aria-label="Kaampilot in numbers" className="pb-10 sm:pb-14">
      <div className={WRAP}>
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-card lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal key={it.label} delay={i * 80} className={cn('p-4 sm:p-6', i % 2 === 1 && 'border-l', i >= 2 && 'max-lg:border-t', i === 2 && 'lg:border-l')}>
              <dt className="sr-only">{it.label}</dt>
              <dd>
                <CountUp to={it.n} prefix={it.prefix} suffix={it.suffix} className="block text-[1.9rem] leading-none font-extrabold tracking-tight text-primary sm:text-[2.4rem]" />
                <span className="mt-2 block text-sm font-semibold">{it.label}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{it.sub}</span>
              </dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Highlights() {
  return (
    <section aria-label="Highlights" className="pb-14 sm:pb-20">
      <ul className={cn(WRAP, 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4')}>
        {HIGHLIGHTS.map((h, i) => (
          <li key={h.title}>
            <Reveal delay={i * 70} className="kp-lift flex h-full items-start gap-3 rounded-xl border bg-card p-4 shadow-card hover:border-primary/40">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                <h.icon className="size-5" />
              </span>
              <span className="leading-snug">
                <span className="block font-semibold">{h.title}</span>
                <span className="block text-sm text-muted-foreground">{h.text}</span>
              </span>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Story() {
  return (
    <section id="story" aria-labelledby="story-title" className="scroll-mt-20 border-t py-16 sm:py-24">
      <div className={WRAP}>
        <Reveal className="mx-auto mb-10 max-w-2xl text-center lg:mb-16">
          <p className={EYEBROW}>A day with Kaampilot</p>
          <h2 id="story-title" className={cn(H2, 'mt-3')}>
            From the first punch to the month-end payroll
          </h2>
          <p className={LEAD}>Follow one working day at Sharma Auto Components, a 9-person workshop. Every picture is a real screen.</p>
        </Reveal>
        <DayStory />
      </div>
    </section>
  );
}

function Team360() {
  const [shot, setShot] = useState(0);
  return (
    <section id="team" aria-labelledby="team-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className={cn(WRAP, 'grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-12')}>
        <div>
          <Reveal>
            <p className={EYEBROW}>New · Team 360</p>
            <h2 id="team-title" className={cn(H2, 'mt-3')}>
              Every employee, one tile. Every detail, one tap.
            </h2>
            <p className={LEAD}>Owners and managers see the whole team at a glance, then open anyone for their full month: attendance, tasks, assets and visitors.</p>
          </Reveal>
          <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {TEAM360.points.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 80} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                  <p.icon className="size-[18px]" />
                </span>
                <span className="leading-snug">
                  <span className="block font-semibold">{p.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{p.text}</span>
                </span>
              </Reveal>
            ))}
          </ul>
          <ShotButtons shots={TEAM360.shots} active={shot} onPick={setShot} className="mt-7" />
        </div>
        <Reveal delay={120}>
          <Tilt>
            <ShotStage shots={TEAM360.shots} active={shot} />
          </Tilt>
        </Reveal>
      </div>
    </section>
  );
}

function MoreFeatures({ aiOn }: { aiOn: boolean }) {
  const all = [...MORE, { icon: AI_FEATURE.icon, area: AI_FEATURE.area, title: AI_FEATURE.title, text: aiOn ? AI_FEATURE.on : AI_FEATURE.off, soon: !aiOn }];
  return (
    <section id="more" aria-labelledby="more-title" className="scroll-mt-20 border-y bg-card py-16 sm:py-24">
      <div className={WRAP}>
        <Reveal className="mx-auto mb-10 max-w-2xl text-center">
          <p className={EYEBROW}>And everything else</p>
          <h2 id="more-title" className={cn(H2, 'mt-3')}>
            The small things that save hours
          </h2>
          <p className={LEAD}>Built with Indian offices, workshops and showrooms. Each one is in the app today.</p>
        </Reveal>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {all.map((f, i) => (
            <li key={f.title}>
              <Reveal delay={(i % 4) * 60} className="kp-lift h-full rounded-xl border bg-background p-5 hover:border-primary/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground">
                    <f.icon className="size-5" />
                  </span>
                  <span className={cn('rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider uppercase', 'soon' in f && f.soon ? 'bg-warning/12 text-warning' : 'bg-secondary text-muted-foreground')}>
                    {'soon' in f && f.soon ? 'Coming soon' : f.area}
                  </span>
                </div>
                <h3 className="mt-4 text-[17px] font-bold tracking-tight">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const MARK: Record<Mark, { icon: typeof Check; label: string; cls: string }> = {
  yes: { icon: Check, label: 'Yes', cls: 'bg-success/12 text-success' },
  part: { icon: Minus, label: 'Partly', cls: 'bg-warning/12 text-warning' },
  no: { icon: X, label: 'No', cls: 'bg-destructive/10 text-destructive' },
};
function MarkCell({ m, compact = false }: { m: Mark; compact?: boolean }) {
  const k = MARK[m];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', compact && 'text-[13px]')}>
      <span className={cn('grid size-5 shrink-0 place-items-center rounded-sm', k.cls)}>
        <k.icon className="size-3.5" />
      </span>
      <span className="text-muted-foreground">{k.label}</span>
    </span>
  );
}

function WhyKaampilot() {
  return (
    <section id="why" aria-labelledby="why-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className={WRAP}>
        <Reveal className="mx-auto mb-10 max-w-2xl text-center">
          <p className={EYEBROW}>Why Kaampilot</p>
          <h2 id="why-title" className={cn(H2, 'mt-3')}>
            Registers, WhatsApp and Excel were never built for this
          </h2>
          <p className={LEAD}>Most teams run on all three at once. Kaampilot puts the same work in one place, with proof and approvals.</p>
        </Reveal>
        {/* Wide screens: a table. */}
        <Reveal className="hidden overflow-hidden rounded-xl border bg-card shadow-card md:block">
          <table className="w-full text-left">
            <caption className="sr-only">Kaampilot compared with a paper register, WhatsApp groups and Excel sheets</caption>
            <thead>
              <tr className="border-b bg-secondary text-sm">
                <th scope="col" className="px-5 py-3.5 font-semibold">
                  What you need
                </th>
                {COMPARE_TOOLS.map((t) => (
                  <th key={t} scope="col" className="px-4 py-3.5 font-semibold text-muted-foreground">
                    {t}
                  </th>
                ))}
                <th scope="col" className="bg-primary px-5 py-3.5 font-semibold text-primary-foreground">
                  Kaampilot
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.need} className="border-b transition-colors last:border-b-0 hover:bg-accent/40">
                  <th scope="row" className="px-5 py-3.5 text-[15px] font-medium">
                    {r.need}
                  </th>
                  {r.tools.map((m, i) => (
                    <td key={COMPARE_TOOLS[i]} className="px-4 py-3.5">
                      <MarkCell m={m} />
                    </td>
                  ))}
                  <td className="bg-accent/50 px-5 py-3.5">
                    <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
                      <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-success text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                      {r.us}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
        {/* Phones: one card per need. */}
        <ul className="space-y-3 md:hidden">
          {COMPARE.map((r, i) => (
            <Reveal as="li" key={r.need} delay={(i % 3) * 60} className="rounded-xl border bg-card p-4 shadow-card">
              <p className="font-semibold">{r.need}</p>
              <p className="mt-2 flex items-start gap-2 rounded-md bg-accent px-3 py-2 text-[15px] font-semibold text-accent-foreground">
                <Check className="mt-0.5 size-4 shrink-0" /> Kaampilot: {r.us}
              </p>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {r.tools.map((m, j) => (
                  <div key={COMPARE_TOOLS[j]}>
                    <dt className="text-[11px] leading-tight text-muted-foreground">{COMPARE_TOOLS[j]}</dt>
                    <dd className="mt-1">
                      <MarkCell m={m} compact />
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="border-t bg-card py-16 sm:py-24">
      <div className={WRAP}>
        <Reveal className="mx-auto mb-12 max-w-2xl text-center">
          <p className={EYEBROW}>How it works</p>
          <h2 id="how-title" className={cn(H2, 'mt-3')}>
            Running in an afternoon
          </h2>
        </Reveal>
        <ol className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 90} className="kp-lift h-full rounded-xl border bg-background p-6 hover:border-primary/40">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground tabular-nums">{i + 1}</span>
                  <s.icon className="size-5 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{s.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Security() {
  return (
    <section id="security" aria-labelledby="security-title" className="scroll-mt-20 border-t py-16 sm:py-24">
      <div className={cn(WRAP, 'grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-14')}>
        <Reveal>
          <p className={EYEBROW}>Security & data</p>
          <h2 id="security-title" className={cn(H2, 'mt-3')}>
            Your company’s data stays yours
          </h2>
          <p className={LEAD}>Attendance photos, salaries and visitor records are sensitive. Kaampilot is built so that only the right people ever see them.</p>
        </Reveal>
        <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {SECURITY.map((s, i) => (
            <Reveal as="li" key={s.title} delay={(i % 2) * 80} className="flex gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-card text-primary">
                <s.icon className="size-5" />
              </span>
              <span className="leading-snug">
                <span className="block font-semibold">{s.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{s.text}</span>
              </span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PhoneApp() {
  return (
    <section aria-labelledby="app-title" className="border-y bg-card py-16 sm:py-24">
      <div className={cn(WRAP, 'grid items-center gap-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]')}>
        <Reveal>
          <p className={EYEBROW}>Android app</p>
          <h2 id="app-title" className={cn(H2, 'mt-3')}>
            In every pocket, even on a low-cost phone
          </h2>
          <ul className="mt-5 space-y-2.5 text-[15px] text-muted-foreground">
            {[
              'Punch in with a selfie and location in two taps.',
              'A reminder at shift time, so nobody forgets to punch.',
              'Tasks, approvals, leave and visitors on the go; downloads and printing work too.',
              'Same account as the web: sign in once, everything is there.',
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild className={cn('kp-press', TAP)}>
              <a href={APP_APK} download>
                <Download className="size-4" /> Download for Android
              </a>
            </Button>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Smartphone className="size-4" /> Or use any phone browser
            </span>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <Tilt max={6}>
            <ShotFrame still shot={{ kind: 'phone', src: '/landing/phone-home.webp', alt: 'Kaampilot on an Android phone', label: 'Phone' }} />
          </Tilt>
        </Reveal>
      </div>
    </section>
  );
}

function PricingSection({ pricing, standalone = false }: { pricing: Pricing; standalone?: boolean }) {
  const Title = standalone ? 'h1' : 'h2';
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className={WRAP}>
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className={EYEBROW}>Pricing</p>
          <Title id="pricing-title" className={cn(H2, 'mt-3')}>
            Pay only for what you use
          </Title>
          <p className={LEAD}>
            ₹{Math.min(...pricing.modules.map((m) => m.price))} per user per month for each module, or Complete for everything. Start with a free
            trial, or buy now and start at once.
          </p>
        </div>
        <PricingCalculator pricing={pricing} />
      </div>
    </section>
  );
}

function DemoBand() {
  return (
    <section aria-labelledby="demo-title" className="py-6 sm:py-10">
      <div className={WRAP}>
        <Reveal className="flex flex-col items-start gap-5 rounded-xl border bg-card p-6 shadow-card sm:p-8 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <h2 id="demo-title" className="text-xl font-bold tracking-tight sm:text-2xl">
              Want to see it with your own setup?
            </h2>
            <p className="mt-1.5 text-[15px] text-muted-foreground">Book a short call. We show Kaampilot for your kind of team and help you move from registers or Excel.</p>
          </div>
          <BookDemoButton variant="default" className={cn('kp-press', TAP, 'max-md:w-full')} />
        </Reveal>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center">
          <p className={EYEBROW}>FAQ</p>
          <h2 id="faq-title" className={cn(H2, 'mt-3')}>
            Questions, answered
          </h2>
        </Reveal>
        <div className="divide-y rounded-xl border bg-card shadow-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-semibold outline-none transition-colors hover:text-primary focus-visible:text-primary">
                {f.q}
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-sm border text-muted-foreground transition-transform duration-300 group-open:rotate-45 group-open:border-primary group-open:text-primary">
                  +
                </span>
              </summary>
              <p className="kp-answer pb-5 text-[15px] leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Still unsure? Write to{' '}
          <a href="mailto:support@kaampilot.com" className="font-medium text-primary underline-offset-4 hover:underline">
            support@kaampilot.com
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function FinalCta({ trialDays }: { trialDays: number }) {
  return (
    <section aria-labelledby="cta-title" className="border-t bg-card py-16 sm:py-20">
      <Reveal className={cn(WRAP, 'text-center')}>
        <h2 id="cta-title" className={H2}>
          Start today. Your team will thank you tomorrow.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[17px] text-muted-foreground">{trialDays} days free, no card. Set up your company in a few minutes.</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <TrialButton />
          <Button variant="outline" size="lg" asChild className={cn('kp-press', TAP)}>
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t py-10">
      <div className={cn(WRAP, 'flex flex-col gap-6 md:flex-row md:items-center md:justify-between')}>
        <div className="space-y-2">
          <BrandLockup size={24} domain />
          <p className="text-sm text-muted-foreground">Made in India for Indian businesses. © {new Date().getFullYear()} Kaampilot</p>
        </div>
        <nav aria-label="Policies">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/pricing" className="hover:text-foreground hover:underline">
                Pricing
              </Link>
            </li>
            {LEGAL_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="hover:text-foreground hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

/** /pricing: the pricing section with the page's top bar, demo, FAQ and footer. */
export function PricingPage() {
  return <LandingPage only="pricing" />;
}

