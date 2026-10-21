/** /new-company (account menu → New company, PLAN.md §21.1): the company step of sign-up, then the setup screen, then Home of the new company. */
import { errorMessage } from '@freefounders/core';
import { companyNameErrorOf, type CompanyInput, useCreateCompany } from '@freefounders/core/account';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CompanyForm, EMPTY_COMPANY, SetupScreen } from './company-form';
import { AuthFrame, BackButton, StepTitle } from './parts';

export function NewCompanyPage() {
  const navigate = useNavigate();
  const create = useCreateCompany();
  const [company, setCompany] = useState<CompanyInput>(EMPTY_COMPANY);
  const [setup, setSetup] = useState(false);
  /** 409 at submit: another company has this name (PLAN.md §21.6); back to the form with the message on the field. */
  const [nameError, setNameError] = useState<string | null>(null);

  const submit = async (c: CompanyInput) => {
    setCompany(c);
    setSetup(true);
    create.reset();
    try {
      const res = await create.mutateAsync(c);
      if (res.setupIncomplete) {
        toast.warning('Your company is created, but part of the app set-up has not finished. It finishes by itself in a few minutes; if an app does not open, sign out and in again later.', { duration: 15_000 });
      }
      navigate('/?home=1&welcome=1', { replace: true });
    } catch (err) {
      const taken = companyNameErrorOf(err);
      if (taken) {
        setNameError(taken);
        setSetup(false);
      }
      /* anything else is shown on the setup screen */
    }
  };

  if (setup) return <SetupScreen companyName={company.name} apps={company.apps} error={create.isError ? errorMessage(create.error) : null} onRetry={() => setSetup(false)} />;
  return (
    <AuthFrame>
      <BackButton onClick={() => navigate(-1)} />
      <StepTitle title="New company">A separate workspace with its own people, data and plan. You stay signed in with the same account.</StepTitle>
      <CompanyForm
        value={company}
        onChange={(c) => {
          if (c.name !== company.name) setNameError(null);
          setCompany(c);
        }}
        onSubmit={(c) => void submit(c)}
        nameError={nameError}
      />
    </AuthFrame>
  );
}
