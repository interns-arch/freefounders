/**
 * Public policy pages (signed out or in): /contact, /terms, /privacy, /refunds. Payment gateways (Cashfree, PLAN.md
 * §21.10) whitelist a website only when these exist. Plain static text; facts only from what the product does.
 * Founder to confirm: the support address, the registered office line and the refund rules (PLAN.md §21.11).
 */
import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-router';
import { LegalLinks } from './legal-links';
import { BrandLockup } from '@/components/brand';

export const SUPPORT_EMAIL = 'support@kaampilot.com';
const OPERATOR = 'CarTrends';
const UPDATED = '24 October 2026';

function Mail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">
      {SUPPORT_EMAIL}
    </a>
  );
}

function LegalFrame({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `Kaampilot · ${title}`;
  }, [title]);
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b px-4 sm:px-8">
        <Link to="/login" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" aria-label="Kaampilot: sign in">
          <BrandLockup size={30} domain />
        </Link>
        <Link to="/login" className="text-sm font-medium text-primary hover:underline">
          Sign in
        </Link>
      </header>
      <main id="content" className="flex flex-1 justify-center px-4 py-8 sm:py-12">
        <article className="w-full max-w-[720px] min-w-0 space-y-6 text-[15px] leading-relaxed">
          <header className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
          </header>
          {children}
        </article>
      </main>
      <footer className="space-y-2 border-t px-4 py-6 text-center">
        <LegalLinks />
        <p className="text-xs text-muted-foreground">Kaampilot is operated by {OPERATOR}.</p>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function ContactPage() {
  return (
    <LegalFrame title="Contact us">
      <p>
        Kaampilot (kaampilot.com) is an attendance, tasks, assets and payroll app for teams, operated by {OPERATOR}. We are happy
        to help with your account, billing, payments or anything else.
      </p>
      <dl className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-[180px_1fr]">
        <dt className="font-semibold">Email</dt>
        <dd>
          <Mail />
        </dd>
        <dt className="font-semibold">Website</dt>
        <dd>kaampilot.com</dd>
        <dt className="font-semibold">Operated by</dt>
        <dd>{OPERATOR}</dd>
        <dt className="font-semibold">Registered office</dt>
        <dd>
          Available on request at <Mail />
        </dd>
      </dl>
      <p>
        We aim to reply within 2 working days. For a payment problem, please include
        your company name and the payment or invoice number shown in Billing.
      </p>
      <p>
        Already using Kaampilot at work? Questions about your attendance, leave, salary or tasks are best answered by your
        company's admin.
      </p>
    </LegalFrame>
  );
}

export function TermsPage() {
  return (
    <LegalFrame title="Terms & Conditions">
      <p>
        These terms apply to the Kaampilot website, web app and Android app ("Kaampilot", "the service"), operated by {OPERATOR}
        ("we", "us"). By creating an account or using the service you agree to them. If you use Kaampilot for a company, you
        confirm you may accept these terms for that company.
      </p>
      <Section title="The service">
        <p>
          Kaampilot lets a company record attendance (including selfie and GPS punch-in), manage tasks and approvals, keep track
          of assets, people and payroll. Features available to a company depend on its plan and on the modules its admins switch
          on.
        </p>
      </Section>
      <Section title="Accounts">
        <List
          items={[
            'Keep your password and sign-in codes to yourself. You are responsible for what is done with your login.',
            "A company's owner and admins decide who can use the company's workspace and what each person can see and do.",
            'Give correct information when you sign up and keep it up to date.',
          ]}
        />
      </Section>
      <Section title="Plans and payments">
        <List
          items={[
            'Some features are free; paid plans are charged per user for a month or a year, paid in advance. Prices, taxes (GST) and the total are shown in Billing before you pay.',
            'Payments are processed by our payment partner Cashfree Payments. We do not see or store your card, UPI or bank details.',
            'Nothing is charged automatically: at the end of a paid period you pay for the next one in Billing, or the plan stops.',
            <>
              Cancellations and refunds are described in our <Link to="/refunds" className="font-medium text-primary hover:underline">Refund & Cancellation Policy</Link>.
            </>,
          ]}
        />
      </Section>
      <Section title="Your data">
        <p>
          The data a company puts into Kaampilot belongs to that company. We process it only to run the service, as described in
          our <Link to="/privacy" className="font-medium text-primary hover:underline">Privacy Policy</Link>. A company is
          responsible for having the right to record its people's attendance, photos and locations, and for telling them about it.
        </p>
      </Section>
      <Section title="Fair use">
        <List
          items={[
            'Do not use Kaampilot for anything unlawful, to harm others, or to send spam.',
            'Do not try to break into, overload or copy the service, or reach data of another company.',
            'We may suspend an account that breaks these rules, after notice where we reasonably can.',
          ]}
        />
      </Section>
      <Section title="Availability and liability">
        <p>
          We work to keep Kaampilot available and your data safe, but the service is provided as it is, without a guarantee
          that it will never be interrupted or free of errors. To the extent the law allows, our total liability for any claim is
          limited to the amount the company paid us for the service in the 12 months before the claim, and we are not liable for
          indirect losses such as lost profits.
        </p>
      </Section>
      <Section title="Changes and ending">
        <p>
          We may update these terms; the date above shows the latest version, and we tell companies about important changes before they apply. A
          company can stop using Kaampilot at any time. These terms are governed by the laws of India.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Questions about these terms: <Mail />.
        </p>
      </Section>
    </LegalFrame>
  );
}

export function PrivacyPage() {
  return (
    <LegalFrame title="Privacy Policy">
      <p>
        This policy explains what personal data Kaampilot, operated by {OPERATOR}, collects, why, and what choices you have. When
        a company uses Kaampilot for its people, the company decides what is recorded; we process that data on the company's
        behalf.
      </p>
      <Section title="What we collect">
        <List
          items={[
            'Account details: name, email address and/or mobile number, username, password (stored only as a one-way hash).',
            'Company details: company name, logo, departments, roles, and billing details such as legal name, GSTIN and address.',
            'Work data your company records: attendance punches with a selfie and GPS location at punch-in/out, leave, tasks, assets, payroll and documents.',
            'Payment records: plan, amount, invoice and the status returned by our payment partner. We never receive card, UPI or bank details.',
            'Technical data: sign-in times, device and browser type, and logs needed to keep the service secure and working.',
          ]}
        />
      </Section>
      <Section title="Why we use it">
        <List
          items={[
            'To run the service: sign-in, attendance, tasks, assets, payroll and notifications.',
            'To send sign-in and verification codes, and messages your company has switched on.',
            'To bill paid plans and issue GST invoices.',
            'To keep the service secure, prevent abuse and fix problems.',
          ]}
        />
        <p>We do not sell personal data and do not use it for advertising.</p>
      </Section>
      <Section title="Who we share it with">
        <p>Only with service providers that help run Kaampilot, and only what they need:</p>
        <List
          items={[
            'Cashfree Payments, to process payments.',
            'MSG91, to deliver sign-in codes by email or SMS.',
            'Our cloud hosting provider, on servers in India.',
            'Messaging or email services your company connects itself (for example WhatsApp), for the messages it switches on.',
          ]}
        />
        <p>We may also disclose data when required by law.</p>
      </Section>
      <Section title="Where and how long">
        <p>
          Data is stored on servers in India and protected with encryption in transit, access controls and regular backups. Each
          company's data is kept separate from other companies'. We keep data while the company uses Kaampilot; after a company
          leaves, its data is deleted on request or after a reasonable period, except records we must keep by law (such as
          invoices).
        </p>
      </Section>
      <Section title="Your choices">
        <p>
          You can see and correct your account details in the app. For data your employer recorded (attendance, payroll, tasks),
          please contact your company's admin first. To access, correct or delete your personal data, or for any privacy
          question, write to <Mail />.
        </p>
      </Section>
    </LegalFrame>
  );
}

export function RefundsPage() {
  return (
    <LegalFrame title="Refund & Cancellation Policy">
      <Section title="How paid plans work">
        <List
          items={[
            'Paid plans are prepaid for one period (a month or a year). The price, GST and total are shown in Billing before you pay.',
            'Nothing is charged automatically. At the end of a paid period you can pay for the next one in Billing.',
            'New companies can try Kaampilot free before choosing a paid plan; no payment is taken during the trial.',
          ]}
        />
      </Section>
      <Section title="Cancelling">
        <p>
          A company owner can cancel a paid plan at any time in Billing. The plan keeps working until the end of the period
          already paid for, and nothing is charged for the next period. You can resume before the period ends.
        </p>
      </Section>
      <Section title="Refunds">
        <List
          items={[
            'Payments for a period that has started are not refunded, in full or in part.',
            'If you were charged twice for the same payment, or money left your account but the payment failed on our side, we refund that amount in full.',
            'Such refunds are started within 7 working days of us confirming the problem and go back to the original payment method. Your bank may take a few more days to show it.',
          ]}
        />
      </Section>
      <Section title="Need help?">
        <p>
          Write to <Mail /> with your company name and the payment or invoice number shown in Billing.
        </p>
      </Section>
    </LegalFrame>
  );
}
