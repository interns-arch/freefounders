/**
 * Punch in / punch out on the phone: (face check on → stop with a clear message) → GPS when the company has an office
 * geofence → selfie when the company keeps punch photos → POST check_in / check_out. The server decides every rule;
 * its refusal (e.g. "You are 840 m from Head Office…") is shown as-is.
 */
import { errorMessage } from '@freefounders/core';
import { useAttendanceToday, useMarkAttendance } from '@freefounders/core/hr';
import { useState } from 'react';
import { currentPosition } from '@/lib/location';
import { buildPunchBody, punchPlan, type Which } from '@/lib/punch';
import type { Selfie } from './selfie-camera';

type Step = 'idle' | 'locating' | 'camera' | 'sending';
type Position = { latitude: number; longitude: number } | null;

export interface PunchProblem {
  text: string;
  /** Show an "Open settings" button (a permission was blocked for good). */
  openSettings?: boolean;
}

export function usePunch() {
  const today = useAttendanceToday();
  const mark = useMarkAttendance();
  const [step, setStep] = useState<Step>('idle');
  const [pending, setPending] = useState<{ which: Which; position: Position } | null>(null);
  const [done, setDone] = useState('');
  const [problem, setProblem] = useState<PunchProblem | null>(null);

  const data = today.data;
  const plan = data ? punchPlan(data) : null;

  const send = (which: Which, position: Position, selfie: Selfie | null) => {
    setStep('sending');
    mark.mutate(
      { which, ...buildPunchBody({ position, photoBase64: selfie?.base64 }) },
      {
        onSuccess: () => setDone(which === 'check_in' ? 'You are punched in.' : 'You are punched out. See you tomorrow!'),
        onError: (e) => setProblem({ text: errorMessage(e) }),
        onSettled: () => setStep('idle'),
      },
    );
  };

  const start = async (which: Which) => {
    if (!plan || step !== 'idle') return;
    setDone('');
    setProblem(null);
    if (plan.blocked) {
      setProblem({ text: plan.blocked });
      return;
    }
    let position: Position = null;
    if (plan.needsLocation) {
      setStep('locating');
      const r = await currentPosition();
      if (!r.ok) {
        setStep('idle');
        setProblem({ text: r.message, openSettings: r.openSettings });
        return;
      }
      position = { latitude: r.latitude, longitude: r.longitude };
    }
    if (plan.photo !== 'off') {
      setPending({ which, position });
      setStep('camera');
      return;
    }
    send(which, position, null);
  };

  return {
    today,
    plan,
    step,
    busy: step !== 'idle',
    done,
    problem,
    start: (which: Which) => void start(which),
    camera: {
      visible: step === 'camera' && !!pending,
      which: pending?.which ?? 'check_in',
      optional: plan?.photo === 'optional',
      cancel: () => {
        setPending(null);
        setStep('idle');
      },
      done: (selfie: Selfie | null) => {
        const p = pending;
        setPending(null);
        if (p) send(p.which, p.position, selfie);
        else setStep('idle');
      },
    },
  };
}
