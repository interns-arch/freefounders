/** /new-company (account menu → New company, PLAN.md §21.1): the company step of sign-up, then the setup screen, then Home of the new company. */
import { errorMessage } from '@freefounders/core';
import { type CompanyInput, useCreateCompany } from '@freefounders/core/account';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CompanyForm, EMPTY_COMPANY, SetupScreen } from './company-form';
import { AuthFrame, BackButton, StepTitle } from './parts';

export function NewCompanyPage() {
  const navigate = useNavigate();
  const create = useCreateCompany();
  const [company, setCompany] = useState<CompanyInput>(EMPTY_COMPANY);
  const [setup, setSetup] = useState(false);

  const submit = async (c: CompanyInput) => {
    setCompany(c);
    setSetup(true);
    create.reset();
    try {
      await create.mutateAsync(c);
      navigate('/?home=1&welcome=1', { replace: true });
    } catch {
      /* shown on the setup screen */
    }
  };

  if (setup) return <SetupScreen companyName={company.name} error={create.isError ? errorMessage(create.error) : null} onRetry={() => setSetup(false)} />;
  return (
    <AuthFrame>
      <BackButton onClick={() => navigate(-1)} />
      <StepTitle title="New company">A separate workspace with its own people, data and plan. You stay signed in with the same account.</StepTitle>
      <CompanyForm value={company} onChange={setCompany} onSubmit={(c) => void submit(c)} />
    </AuthFrame>
  );
}
