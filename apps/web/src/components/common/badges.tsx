import {
  ASSET_STATUS_LABELS,
  type AssetStatus,
  type Condition,
  EMPLOYEE_STATUS_LABELS,
  type EmployeeStatus,
  type HolderType,
  humanize,
} from '@eam/shared';
import { Briefcase, Building, Building2, MapPin, Store, Truck, User } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { ASSET_STATUS_TONE, CONDITION_TONE, EMPLOYEE_STATUS_TONE } from '@/lib/status';
import { cn } from '@/lib/utils';

export function AssetStatusBadge({ status, className }: { status: AssetStatus; className?: string }) {
  return (
    <Badge tone={ASSET_STATUS_TONE[status]} dot className={className}>
      {ASSET_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ConditionBadge({ condition }: { condition: Condition }) {
  return <Badge tone={CONDITION_TONE[condition]}>{humanize(condition)}</Badge>;
}

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return (
    <Badge tone={EMPLOYEE_STATUS_TONE[status]} dot>
      {EMPLOYEE_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Any enum value with a tone map. */
export function EnumBadge<T extends string>({ value, tones, dot = true, labels }: { value: T; tones: Record<T, BadgeTone>; dot?: boolean; labels?: Record<T, string> }) {
  return (
    <Badge tone={tones[value]} dot={dot}>
      {labels?.[value] ?? humanize(value)}
    </Badge>
  );
}

export const HOLDER_ICONS: Record<HolderType, React.ComponentType<{ className?: string }>> = {
  EMPLOYEE: User,
  DEPARTMENT: Briefcase,
  LOCATION: MapPin,
  COMPANY: Building2,
  VENDOR: Truck,
  INVENTORY: Store,
};

export function HolderLabel({ type, name, className }: { type: HolderType | null; name: string | null; className?: string }) {
  if (!type || !name) return <span className={cn('text-muted-foreground', className)}>—</span>;
  const Icon = HOLDER_ICONS[type] ?? Building;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </span>
  );
}
