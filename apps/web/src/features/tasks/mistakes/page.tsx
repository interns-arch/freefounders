/**
 * /tasks/mistakes — the Mistake / Error Register (old pages/Mistakes.jsx): three-level accountability.
 * The employee owns the mistake → the manager owns the correction → the department head owns repeats → the founder
 * sees only what matters. Two tabs: the register, and the written processes (SOPs) a mistake is judged against.
 */
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/common/page';
import { Segmented } from '../general/parts';
import { MistakeRegister } from './register';
import { SopRegister } from './sops';

type Tab = 'register' | 'sops';

export function MistakesPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'sops' ? 'sops' : 'register';
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'register') next.delete('tab');
    else next.set('tab', t);
    next.delete('open');
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="Mistakes"
        description={tab === 'register' ? 'Record → explain → correct → prevent. Nobody gets blamed automatically.' : 'The written processes a mistake is judged against.'}
        actions={
          <Segmented
            label="Mistakes view"
            value={tab}
            onChange={setTab}
            options={[
              ['register', 'Register'],
              ['sops', 'Processes (SOP)'],
            ]}
          />
        }
      />
      {tab === 'register' ? <MistakeRegister /> : <SopRegister />}
    </div>
  );
}
