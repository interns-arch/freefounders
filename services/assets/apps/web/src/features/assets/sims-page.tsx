import { Navigate } from 'react-router';
import { EmptyState, PageLoader } from '@/components/common/page';
import { useAssetTypes } from '@/lib/queries';

/** Shortcut to the asset register filtered to SIM cards, which shows the SIM columns. */
export default function SimsPage() {
  const types = useAssetTypes();
  if (types.isLoading) return <PageLoader />;
  const sim = types.data?.find((t) => t.code === 'SIM');
  if (!sim) return <EmptyState title="No SIM Card type" description="Add an asset type with the code SIM in the asset catalog." />;
  return <Navigate to={`/assets?assetTypeId=${sim.id}`} replace />;
}
