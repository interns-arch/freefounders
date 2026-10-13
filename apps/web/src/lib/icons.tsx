import {
  AirVent,
  Archive,
  Armchair,
  BadgeCheck,
  BatteryCharging,
  Bike,
  Box,
  Boxes,
  Briefcase,
  Building2,
  Bus,
  Camera,
  Car,
  CardSim,
  Cctv,
  Cloud,
  Cog,
  Computer,
  ContactRound,
  CreditCard,
  FileBadge,
  FileSignature,
  FireExtinguisher,
  Footprints,
  Forklift,
  Fuel,
  Gauge,
  Globe,
  Hammer,
  Hand,
  HardHat,
  Headphones,
  House,
  IdCard,
  Keyboard,
  KeyRound,
  Landmark,
  Laptop,
  type IconComponent,
  Microwave,
  Monitor,
  Mouse,
  Package,
  PencilRuler,
  PlugZap,
  Printer,
  Projector,
  Repeat,
  Router,
  ScanLine,
  Server,
  ShieldCheck,
  Smartphone,
  Sofa,
  Table,
  Tablet,
  Truck,
  Tv,
  Wrench,
  Zap,
} from '@/components/icons';
import { cn } from './utils';

/** Icons an admin can pick for categories and asset types. */
const ICONS: Record<string, IconComponent> = {
  box: Box,
  package: Package,
  laptop: Laptop,
  computer: Computer,
  monitor: Monitor,
  smartphone: Smartphone,
  tablet: Tablet,
  server: Server,
  printer: Printer,
  router: Router,
  keyboard: Keyboard,
  mouse: Mouse,
  'plug-zap': PlugZap,
  headphones: Headphones,
  'battery-charging': BatteryCharging,
  'card-sim': CardSim,
  briefcase: Briefcase,
  armchair: Armchair,
  table: Table,
  archive: Archive,
  'key-round': KeyRound,
  'id-card': IdCard,
  'contact-round': ContactRound,
  'pencil-ruler': PencilRuler,
  car: Car,
  bike: Bike,
  bus: Bus,
  truck: Truck,
  forklift: Forklift,
  wrench: Wrench,
  cog: Cog,
  hammer: Hammer,
  gauge: Gauge,
  zap: Zap,
  'hard-hat': HardHat,
  footprints: Footprints,
  hand: Hand,
  'fire-extinguisher': FireExtinguisher,
  'shield-check': ShieldCheck,
  camera: Camera,
  projector: Projector,
  tv: Tv,
  'scan-line': ScanLine,
  'credit-card': CreditCard,
  'badge-check': BadgeCheck,
  repeat: Repeat,
  globe: Globe,
  cloud: Cloud,
  'file-badge': FileBadge,
  'building-2': Building2,
  'air-vent': AirVent,
  fuel: Fuel,
  sofa: Sofa,
  cctv: Cctv,
  microwave: Microwave,
  landmark: Landmark,
  house: House,
  'file-signature': FileSignature,
  boxes: Boxes,
};

export const ICON_NAMES = Object.keys(ICONS);

/**
 * Classes per category colour. The NAMES are what admins pick and what is saved on categories, so they stay; the
 * colours come from the theme tokens (PLAN.md §19.1), so the brand colour and dark mode reach every tile.
 */
export const COLORS: Record<string, { bg: string; text: string; bar: string; ring: string }> = {
  blue: { bg: 'bg-info/10 dark:bg-info/18', text: 'text-info', bar: 'bg-info', ring: 'ring-info/30' },
  indigo: { bg: 'bg-app-tasks/10 dark:bg-app-tasks/18', text: 'text-app-tasks', bar: 'bg-app-tasks', ring: 'ring-app-tasks/30' },
  violet: { bg: 'bg-app-attendance/10 dark:bg-app-attendance/18', text: 'text-app-attendance', bar: 'bg-app-attendance', ring: 'ring-app-attendance/30' },
  emerald: { bg: 'bg-success/10 dark:bg-success/18', text: 'text-success', bar: 'bg-success', ring: 'ring-success/30' },
  teal: { bg: 'bg-app-assets/10 dark:bg-app-assets/18', text: 'text-app-assets', bar: 'bg-app-assets', ring: 'ring-app-assets/30' },
  cyan: { bg: 'bg-brand-2/10 dark:bg-brand-2/18', text: 'text-info', bar: 'bg-brand-2', ring: 'ring-brand-2/30' },
  amber: { bg: 'bg-warning/10 dark:bg-warning/18', text: 'text-warning', bar: 'bg-warning', ring: 'ring-warning/30' },
  orange: { bg: 'bg-cta/10 dark:bg-cta/18', text: 'text-cta', bar: 'bg-cta', ring: 'ring-cta/30' },
  red: { bg: 'bg-destructive/10 dark:bg-destructive/18', text: 'text-destructive', bar: 'bg-destructive', ring: 'ring-destructive/30' },
  rose: { bg: 'bg-destructive/6 dark:bg-destructive/14', text: 'text-destructive', bar: 'bg-destructive/70', ring: 'ring-destructive/25' },
  slate: { bg: 'bg-muted', text: 'text-muted-foreground', bar: 'bg-muted-foreground', ring: 'ring-border' },
  stone: { bg: 'bg-secondary', text: 'text-secondary-foreground', bar: 'bg-secondary-foreground/60', ring: 'ring-border' },
};
export const COLOR_NAMES = Object.keys(COLORS);

export function DynamicIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = (name && ICONS[name]) || Box;
  return <Icon className={className} />;
}

/** Rounded tile with the category colour and the type / category icon. */
export function AssetIcon({ icon, color, className, size = 'md' }: { icon: string | null | undefined; color: string | null | undefined; className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const c = COLORS[color ?? ''] ?? COLORS.slate;
  const dims = {
    sm: 'size-7 rounded-md [&_svg]:size-3.5',
    md: 'size-9 rounded-lg [&_svg]:size-4.5',
    lg: 'size-12 rounded-xl [&_svg]:size-6',
    xl: 'size-16 rounded-2xl [&_svg]:size-8 ring-1 ring-inset',
  }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', dims, c.bg, c.text, size === 'xl' && c.ring, className)}>
      <DynamicIcon name={icon} />
    </span>
  );
}
