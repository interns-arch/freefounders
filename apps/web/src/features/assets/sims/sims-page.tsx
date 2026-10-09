import { CardSim } from 'lucide-react';
import { Navigate } from 'react-router';
import { EmptyState, PageLoader } from '@/components/common/page';
import { useAssetTypes } from '@freefounders/core/assets';
import { useModules } from '@/features/assets/lib/auth';

/**
 * SIM cards: the asset register filtered to the SIM Card type, which shows the SIM columns (connection number,
 * billable account, circle, plan, SIM number). Same as the old /sims shortcut.
 */
export default function SimsPage() {
  const module = useModules();
  const types = useAssetTypes();
  if (!module('sims')) return <EmptyState icon={CardSim} title="SIM cards are switched off" description="An admin can switch the SIM cards module on in the company settings." />;
  if (types.isLoading) return <PageLoader />;
  const sim = types.data?.find((t) => t.code === 'SIM');
  if (!sim) return <EmptyState icon={CardSim} title="No SIM Card type" description="Add an asset type with the code SIM in the asset catalogue." />;
  return <Navigate to={`/assets/assets?assetTypeId=${sim.id}`} replace />;
}
