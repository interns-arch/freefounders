/**
 * The public landing page (PLAN.md §24.2): `/` for signed-out visitors on the web (signed-in people get Home; inside
 * the phone app signed-out people go straight to sign-in, see app/session-guard.tsx), and `/pricing` (the pricing
 * section alone). Sections: hero, highlights, feature tour with real screenshots, how it works, the phone app, the
 * pricing calculator, book a demo, FAQ, footer. Theme tokens only, flat (no gradients, glows or blur); motion is a
 * short fade/rise when a section comes into view and is off for people who ask for less motion.
 */
import { usePublicPricing } from '@kaampilot/core';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Download, Moon, Smartphone, Sun } from '@/components/icons';
import { BrandLockup, BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { LEGAL_LINKS } from '@/features/account/legal-links';
import { AiHelper } from '@/features/ai-helper';
import { cn } from '@/lib/utils';
import { BookDemoButton } from './book-demo';
import { APP_APK, FAQ, HIGHLIGHTS, STEPS, TRUST } from './content';
import { FeatureTour, ShotFrame } from './feature-tour';
import { PricingCalculator } from './pricing-calculator';
import { usePageMeta } from './page-meta';

const WRAP = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
const EYEBROW = 'font-mono text-[11px] font-semibold tracking-widest text-primary uppercase';
const H2 = 'text-[1.85rem] leading-tight font-extrabold tracking-tight text-balance sm:text-[2.25rem]';

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

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <TopBar />
      <AiHelper aboveBottomBar={false} />
      <main id="main">
        {only === 'pricing' ? (
          <PricingSection pricing={pricing} standalone />
        ) : (
          <>
            <Hero trialDays={pricing.trial.days} trialUsers={pricing.trial.maxUsers} />
            <Highlights />
            <section id="features" aria-labelledby="features-title" className="scroll-mt-20 border-t bg-card py-16 sm:py-24">
              <div className={WRAP}>
                <Reveal className="mx-auto mb-10 max-w-2xl text-center">
                  <p className={EYEBROW}>Everything in one app</p>
                  <h2 id="features-title" className={cn(H2, 'mt-3')}>
                    See what your team gets
                  </h2>
                  <p className="mt-3 text-[17px] text-muted-foreground">Real screens from the app. Pick a module.</p>
                </Reveal>
                <FeatureTour />
              </div>
            </section>
            <HowItWorks />
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

/** Fades and lifts its children in once, when they scroll into view (only with motion allowed). */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn('motion-safe:transition-[opacity,translate] motion-safe:duration-500 motion-safe:ease-out', !shown && 'motion-safe:translate-y-3 motion-safe:opacity-0', className)}
    >
      {children}
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

function TopBar() {
  const theme = useDark();
  const [scrolled, setScrolled] = useState(false);
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
          {[
            ['/#features', 'Features'],
            ['/#pricing', 'Pricing'],
            ['/#faq', 'FAQ'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Button variant="ghost" size="icon" onClick={theme.toggle} aria-label={theme.dark ? 'Light mode' : 'Dark mode'} title={theme.dark ? 'Light mode' : 'Dark mode'}>
            {theme.dark ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
          <Button variant="cta" asChild className="max-[360px]:hidden">
            <Link to="/signup">Start free trial</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero({ trialDays, trialUsers }: { trialDays: number; trialUsers: number }) {
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden pt-10 pb-14 sm:pt-16 sm:pb-20">
      <div className={cn(WRAP, 'grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]')}>
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
          <p className="inline-flex items-center gap-2 rounded-sm border border-primary/25 bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold tracking-widest text-accent-foreground uppercase">
            For Indian SMEs · 5 to 500 people
          </p>
          <h1 id="hero-title" className="mt-5 text-[2.5rem] leading-[1.06] font-extrabold tracking-tight text-balance sm:text-[3.4rem]">
            Your team’s <span className="text-primary">kaam</span>, on autopilot.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground sm:text-lg">
            Attendance with a selfie and GPS punch, leave and payroll, tasks with approvals, assets and a visitor gate register. One app
            and one login for everyone, on the web and Android.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button variant="cta" size="lg" asChild>
              <Link to="/signup">
                Start free trial <ArrowRight className="size-4" />
              </Link>
            </Button>
            <BookDemoButton />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Free for {trialDays} days with up to {trialUsers} users. No card needed.
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
            {TRUST.map((t) => (
              <li key={t.text} className="inline-flex items-center gap-1.5">
                <t.icon className="size-4 text-primary" /> {t.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:delay-150 motion-safe:fill-mode-both motion-safe:duration-700">
          <ShotFrame eager shot={{ src: '/landing/home.webp', alt: 'Kaampilot Home: today’s attendance, tasks and assets at a glance', label: 'Home' }} className="lg:mr-16" />
          <div className="absolute -right-1 -bottom-10 hidden w-[170px] lg:block">
            <ShotFrame shot={{ kind: 'phone', src: '/landing/phone-attendance.webp', alt: 'Punch in on the phone', label: 'Phone' }} className="border-[5px]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Highlights() {
  return (
    <section aria-label="Highlights" className="pb-14 sm:pb-20">
      <ul className={cn(WRAP, 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4')}>
        {HIGHLIGHTS.map((h, i) => (
          <li key={h.title}>
            <Reveal delay={i * 70} className="flex h-full items-start gap-3 rounded-xl border bg-card p-4 shadow-card">
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

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="py-16 sm:py-24">
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
              <Reveal delay={i * 90} className="h-full rounded-xl border bg-card p-6 shadow-card">
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
            <li>Punch in with a selfie and location in two taps.</li>
            <li>A reminder at shift time, so nobody forgets to punch.</li>
            <li>Tasks, approvals, leave and visitors on the go; downloads and printing work too.</li>
            <li>Same account as the web: sign in once, everything is there.</li>
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
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
          <ShotFrame shot={{ kind: 'phone', src: '/landing/phone-home.webp', alt: 'Kaampilot on an Android phone', label: 'Phone' }} />
        </Reveal>
      </div>
    </section>
  );
}

function PricingSection({ pricing, standalone = false }: { pricing: ReturnType<typeof usePublicPricing>['pricing']; standalone?: boolean }) {
  const Title = standalone ? 'h1' : 'h2';
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className={WRAP}>
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className={EYEBROW}>Pricing</p>
          <Title id="pricing-title" className={cn(H2, 'mt-3')}>
            Pay only for what you use
          </Title>
          <p className="mt-3 text-[17px] text-muted-foreground">
            ₹{Math.min(...pricing.modules.map((m) => m.price))} per user per month for each module, or Complete for everything. Change any time.
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
          <BookDemoButton variant="default" />
        </Reveal>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <h2 id="faq-title" className={cn(H2, 'mb-8 text-center')}>
          Questions, answered
        </h2>
        <div className="divide-y rounded-xl border bg-card shadow-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-semibold outline-none focus-visible:text-primary">
                {f.q}
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-sm border text-muted-foreground transition-transform group-open:rotate-45 motion-reduce:transition-none">
                  +
                </span>
              </summary>
              <p className="pb-5 text-[15px] leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
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
          <Button variant="cta" size="lg" asChild>
            <Link to="/signup">
              Start free trial <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
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
