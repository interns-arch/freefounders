/**
 * The pricing calculator (PLAN.md §24): pick modules one by one or Complete, AI on or off (for the whole subscription),
 * the number of users → the monthly total before GST, with the GST shown separately. Prices come from
 * GET /api/platform/public/pricing (usePublicPricing), else the §24 prices built into @kaampilot/core.
 * Touch screens get 44 px controls; on phones and tablets a small total bar sticks to the bottom of the screen while the
 * choices are on screen, so the price is visible while changing them with one thumb.
 */
import { type PricedModuleKey, type PublicPricing, quotePrice } from '@kaampilot/core';
import { useAiStatus } from '@kaampilot/core/ai';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Check, ListChecks, MapPin, Minus, Package, Plus, Sparkles } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const MODULE_ICON: Record<PricedModuleKey, typeof MapPin> = { tasks: ListChecks, attendance: MapPin, assets: Package };
const MAX_USERS = 1000;

export function PricingCalculator({ pricing }: { pricing: PublicPricing }) {
  const [complete, setComplete] = useState(false);
  const [modules, setModules] = useState<PricedModuleKey[]>(['tasks', 'attendance']);
  const [ai, setAi] = useState(false);
  const [users, setUsers] = useState(10);
  const usersId = useId();
  const aiId = useId();
  const quote = quotePrice(pricing, { complete, modules, ai, users });
  const toggle = (k: PricedModuleKey) => {
    setComplete(false);
    setModules((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));
  };
  const setUserCount = (n: number) => setUsers(Math.min(MAX_USERS, Math.max(1, Math.round(n) || 1)));
  const nothing = !complete && modules.length === 0;
  // The "Ask Kaampilot" button sits bottom-right when the AI helper is on: the sticky total bar stops short of it.
  const helperShown = !!useAiStatus().data?.enabled;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      {/* Choices */}
      <div className="relative space-y-5 rounded-xl border bg-card p-4 shadow-card sm:p-6">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">1. Choose modules</legend>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {pricing.modules.map((m) => {
              const Icon = MODULE_ICON[m.key] ?? Package;
              const on = !complete && modules.includes(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(m.key)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    on ? 'border-primary bg-accent' : 'bg-card hover:border-primary/40',
                  )}
                >
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded-sm border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                    {on && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <Icon className="size-4 text-muted-foreground" /> {m.name}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{rupees(ai ? m.aiPrice : m.price)} / user</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or everything <span className="h-px flex-1 bg-border" />
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={complete}
            onClick={() => setComplete((c) => !c)}
            className={cn(
              'flex w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              complete ? 'border-primary bg-accent' : 'bg-card hover:border-primary/40',
            )}
          >
            <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border', complete ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
              {complete && <Check className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1 leading-snug">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-semibold">Complete</span>
                <span className="text-xs text-muted-foreground tabular-nums">{rupees(ai ? pricing.complete.aiPrice : pricing.complete.price)} / user</span>
              </span>
              <span className="block text-xs text-muted-foreground">Every module: {pricing.complete.includes.join(', ')} and everything we add next.</span>
            </span>
          </button>
        </fieldset>

        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <label htmlFor={aiId} className="min-w-0 cursor-pointer leading-tight">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" /> 2. Add AI
            </span>
            <span className="text-xs text-muted-foreground">For all your modules together</span>
          </label>
          <Switch id={aiId} checked={ai} onCheckedChange={setAi} aria-label="Add AI" />
        </div>

        <div>
          <label htmlFor={usersId} className="mb-2 block text-sm font-semibold">
            3. Number of users
          </label>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" className="pointer-coarse:size-[44px]" aria-label="One user less" onClick={() => setUserCount(users - 1)} disabled={users <= 1}>
              <Minus />
            </Button>
            <input
              id={usersId}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_USERS}
              value={users}
              onChange={(e) => setUserCount(Number(e.target.value))}
              className="h-9 w-20 rounded-md border border-input bg-card px-2 text-center text-base font-semibold tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 max-sm:h-[2.75rem] pointer-coarse:h-[44px]"
            />
            <Button type="button" variant="outline" size="icon" className="pointer-coarse:size-[44px]" aria-label="One user more" onClick={() => setUserCount(users + 1)}>
              <Plus />
            </Button>
          </div>
          <input
            type="range"
            min={1}
            max={200}
            value={Math.min(users, 200)}
            onChange={(e) => setUserCount(Number(e.target.value))}
            aria-label="Number of users (slider)"
            className="mt-2 h-11 w-full cursor-pointer accent-primary"
          />
        </div>

        {/* Phones and tablets: the price stays in sight while the choices are on screen (the full card is below). */}
        <div
          aria-hidden
          className={cn(
            'sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 -mx-1 flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-2.5 shadow-card-lg lg:hidden',
            helperShown && 'mr-12',
          )}
        >
          <span className="min-w-0 text-sm leading-tight text-muted-foreground">
            {nothing ? 'Pick a module' : `${users} ${users === 1 ? 'user' : 'users'}, per month`}
            <span className="block text-xs">before GST</span>
          </span>
          <span className="text-xl font-extrabold tracking-tight tabular-nums">{rupees(quote.monthly)}</span>
        </div>
      </div>

      {/* Total */}
      <div className="flex flex-col rounded-xl border bg-card p-5 shadow-card sm:p-6" aria-live="polite">
        <p className="text-sm font-semibold text-muted-foreground">Your monthly price</p>
        <p className="mt-2 text-[2.6rem] leading-none font-extrabold tracking-tight tabular-nums" data-testid="pricing-total">
          {rupees(quote.monthly)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {nothing ? 'Pick at least one module.' : `${rupees(quote.perUser)} per user × ${users} ${users === 1 ? 'user' : 'users'}, per month`}
        </p>
        <dl className="mt-5 space-y-2 border-t pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Price before GST</dt>
            <dd className="tabular-nums">{rupees(quote.monthly)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">GST {pricing.gstPercent}%</dt>
            <dd className="tabular-nums">{rupees(quote.gst)}</dd>
          </div>
          <div className="flex justify-between gap-3 font-semibold">
            <dt>Total with GST</dt>
            <dd className="tabular-nums">{rupees(quote.total)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Prices are per user per month; GST is added on the invoice. Free for {pricing.trial.days} days with up to {pricing.trial.maxUsers} users, no card needed.
        </p>
        <div className="mt-auto pt-5">
          <Button variant="cta" size="lg" className="w-full pointer-coarse:min-h-[44px]" asChild>
            <Link to="/signup">Start free trial</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
