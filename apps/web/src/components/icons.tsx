/**
 * Every icon of the web app, drawn with Hugeicons (free set, `@hugeicons/core-free-icons`).
 *
 * Screens import icons from here by their old lucide-react names (`import { Plus } from '@/components/icons'`), so a
 * call site stays `<Plus className="size-4" />`. Each export renders `<HugeiconsIcon>` in currentColor, 24 px by
 * default (sized with Tailwind `size-*` as before), stroke 1.75 (Hugeicons' own 1.5 looks thin next to our text),
 * and aria-hidden unless it has an aria-label / aria-labelledby / role="img". Icons are imported by name, so the build
 * keeps only these. To add one: pick it on hugeicons.com (free set), check that @hugeicons/core-free-icons exports it,
 * add it to the import and the list below.
 *
 * Name used in the app (was lucide-react)  ->  Hugeicons icon
 *   Activity              Activity01Icon
 *   AirVent               AirVentIcon
 *   AlarmClock            AlarmClockIcon
 *   AlertCircle           AlertCircleIcon
 *   AlertTriangle         Alert02Icon
 *   Archive               Archive02Icon
 *   Armchair              Chair01Icon
 *   ArrowDown             ArrowDown02Icon
 *   ArrowLeft             ArrowLeft02Icon
 *   ArrowLeftRight        ArrowLeftRightIcon
 *   ArrowRight            ArrowRight02Icon
 *   ArrowRightLeft        ArrowDataTransferHorizontalIcon
 *   ArrowUp               ArrowUp02Icon
 *   ArrowUpRight          ArrowUpRight01Icon
 *   BadgeCheck            CheckmarkBadge01Icon
 *   Banknote              Money03Icon
 *   BarChart3             ChartHistogramIcon
 *   BatteryCharging       BatteryCharging01Icon
 *   Bell                  Notification01Icon
 *   BellOff               NotificationOff01Icon
 *   Bike                  BicycleIcon
 *   BookOpen              BookOpen01Icon
 *   Bot                   RoboticIcon
 *   Box                   PackageIcon
 *   Boxes                 PackageMovingIcon
 *   Briefcase             Briefcase01Icon
 *   Building              Building01Icon
 *   Building2             Building03Icon
 *   Bus                   Bus01Icon
 *   CalendarCheck         CalendarCheckIn01Icon
 *   CalendarClock         TimeScheduleIcon
 *   CalendarDays          Calendar03Icon
 *   CalendarHeart         CalendarLove01Icon
 *   CalendarOff           CalendarBlock01Icon
 *   CalendarRange         Calendar02Icon
 *   CalendarX             CalendarRemove01Icon
 *   Camera                Camera01Icon
 *   CameraOff             CameraOff01Icon
 *   Car                   Car01Icon
 *   CardSim               Simcard01Icon
 *   Cctv                  CctvCameraIcon
 *   Check                 Tick02Icon
 *   CheckCheck            TickDouble02Icon
 *   CheckCircle2          CheckmarkCircle02Icon
 *   CheckSquare           CheckmarkSquare02Icon
 *   ChevronDown           ArrowDown01Icon
 *   ChevronLeft           ArrowLeft01Icon
 *   ChevronRight          ArrowRight01Icon
 *   ChevronsUpDown        UnfoldMoreIcon
 *   Circle                CircleIcon
 *   CircleDashed          DashedLineCircleIcon
 *   CircleDot             RecordIcon
 *   CirclePlus            AddCircleIcon
 *   ClipboardCheck        TaskDone01Icon
 *   ClipboardList         Task01Icon
 *   Clock                 Clock01Icon
 *   Clock3                Clock03Icon
 *   Cloud                 CloudIcon
 *   Coffee                Coffee01Icon
 *   Cog                   Settings01Icon
 *   Computer              ComputerIcon
 *   ContactRound          Contact01Icon
 *   Copy                  Copy01Icon
 *   CornerLeftUp          ArrowTurnBackwardIcon
 *   CreditCard            CreditCardIcon
 *   Download              Download04Icon
 *   ExternalLink          LinkSquare02Icon
 *   Eye                   ViewIcon
 *   EyeOff                ViewOffSlashIcon
 *   FileBadge             Certificate01Icon
 *   FileSignature         ContractsIcon
 *   FileSpreadsheet       Xls01Icon
 *   FileText              File02Icon
 *   FileCsv / FilePdf / FileZip   Csv01Icon / Pdf01Icon / Zip01Icon
 *   FileUp                FileUploadIcon
 *   Fingerprint           FingerPrintIcon
 *   FireExtinguisher      FireExtinguisherIcon
 *   Flag                  Flag01Icon
 *   Flame                 FireIcon
 *   FolderPlus            FolderAddIcon
 *   Footprints            RunningShoesIcon
 *   Forklift              ForkliftIcon
 *   Fuel                  FuelStationIcon
 *   Gauge                 DashboardSpeed01Icon
 *   Gift                  GiftIcon
 *   GitCompareArrows      GitCompareIcon
 *   Globe                 Globe02Icon
 *   GripVertical          DragDropVerticalIcon
 *   Hammer                HammerIcon
 *   Hand                  WavingHand01Icon
 *   HardHat               HardHatIcon
 *   Hash                  HashtagIcon
 *   Headphones            HeadphonesIcon
 *   HelpCircle            HelpCircleIcon
 *   History               WorkHistoryIcon
 *   Home                  Home01Icon
 *   Hourglass             HourglassIcon
 *   House                 Home01Icon
 *   IdCard                IdentityCardIcon
 *   ImageIcon             Image01Icon
 *   ImagePlus             ImageAdd01Icon
 *   Inbox                 InboxIcon
 *   IndianRupee           RupeeIcon
 *   Info                  InformationCircleIcon
 *   KeyRound              Key01Icon
 *   Keyboard              KeyboardIcon
 *   Landmark              BankIcon
 *   Laptop                LaptopIcon
 *   LayoutDashboard       DashboardSquare01Icon
 *   LayoutGrid            GridViewIcon
 *   LayoutTemplate        Layout01Icon
 *   LifeBuoy              CustomerSupportIcon
 *   Lightbulb             BulbIcon
 *   LineChart             ChartLineData01Icon
 *   Link2                 Link01Icon
 *   List                  ListViewIcon
 *   ListChecks            CheckListIcon
 *   ListOrdered           LeftToRightListNumberIcon
 *   ListTodo              TaskDaily01Icon
 *   Loader                Loading03Icon
 *   Loader2               Loading03Icon
 *   LocateFixed           Gps01Icon
 *   Lock                  SquareLock02Icon
 *   LogIn                 Login03Icon
 *   LogOut                Logout03Icon
 *   Mail                  Mail01Icon
 *   MapPin                Location01Icon
 *   Megaphone             Megaphone01Icon
 *   MessageCircle         BubbleChatIcon
 *   MessageSquare         Message01Icon
 *   MessageSquareWarning  MessageNotification01Icon
 *   Mic                   Mic01Icon
 *   Microwave             MicrowaveIcon
 *   Minus                 MinusSignIcon
 *   Monitor               ComputerIcon
 *   Moon                  Moon02Icon
 *   MoreHorizontal        MoreHorizontalIcon
 *   Mouse                 Mouse01Icon
 *   MoveHorizontal        ArrowHorizontalIcon
 *   Network               HierarchyIcon
 *   Package               PackageIcon
 *   PackageCheck          PackageDeliveredIcon
 *   PackageSearch         PackageSearchIcon
 *   Palette               PaintBoardIcon
 *   Palmtree              BeachIcon
 *   Paperclip             Attachment01Icon
 *   PartyPopper           PartyIcon
 *   Pencil                PencilEdit02Icon
 *   PencilRuler           RulerIcon
 *   Percent               PercentIcon
 *   Phone                 CallIcon
 *   Pin                   PinIcon
 *   Play                  PlayIcon
 *   PlugZap               ElectricPlugsIcon
 *   Plus                  Add01Icon
 *   Printer               PrinterIcon
 *   Projector             ProjectorIcon
 *   QrCode                QrCodeIcon
 *   Radio                 LiveStreaming01Icon
 *   RefreshCw             RefreshIcon
 *   Repeat                RepeatIcon
 *   RotateCcw             Undo03Icon
 *   Router                RouterIcon
 *   Save                  FloppyDiskIcon
 *   Scale                 BalanceScaleIcon
 *   ScanLine              BarcodeScanIcon
 *   Search                Search01Icon
 *   SearchX               SearchRemoveIcon
 *   Send                  SentIcon
 *   Server                ServerStack01Icon
 *   Settings2             Settings02Icon
 *   Shapes                ShapesIcon
 *   Share2                Share08Icon
 *   ShieldAlert           SecurityWarningIcon
 *   ShieldCheck           SecurityCheckIcon
 *   ShieldOff             SecurityBlockIcon
 *   Shirt                 TShirtIcon (uniform reminder at punch-in)
 *   SlidersHorizontal     FilterHorizontalIcon
 *   Smartphone            SmartPhone01Icon
 *   Sofa                  Sofa01Icon
 *   Sparkles              SparklesIcon
 *   SpellCheck            TextCheckIcon
 *   Square                SquareIcon
 *   Star                  StarIcon
 *   Store                 Store01Icon
 *   Sun                   Sun03Icon
 *   Table                 Table01Icon
 *   Tablet                Tablet01Icon
 *   Tag                   Tag01Icon
 *   Tags                  Tag02Icon
 *   Target                Target02Icon
 *   ThumbsUp              ThumbsUpIcon
 *   Timer                 Timer02Icon
 *   Trash2                Delete02Icon
 *   TriangleAlert         Alert02Icon
 *   Trophy                ChampionIcon
 *   Truck                 TruckDeliveryIcon
 *   Tv                    Tv01Icon
 *   Undo                  UndoIcon
 *   Undo2                 Undo02Icon
 *   Upload                Upload04Icon
 *   User                  UserIcon
 *   UserCheck             UserCheck01Icon
 *   UserCog               UserSettings01Icon
 *   UserPlus              UserAdd01Icon
 *   UserRound             UserCircleIcon
 *   UserRoundSearch       UserSearch01Icon
 *   UserRoundX            UserRemove01Icon
 *   Users                 UserMultipleIcon
 *   UsersRound            UserGroupIcon
 *   Wallet                Wallet01Icon
 *   Wrench                Wrench01Icon
 *   X                     Cancel01Icon
 *   XCircle               CancelCircleIcon
 *   Zap                   FlashIcon
 */
import { forwardRef, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react';
import {
  Activity01Icon,
  Add01Icon,
  AddCircleIcon,
  AirVentIcon,
  AlarmClockIcon,
  Alert02Icon,
  AlertCircleIcon,
  Archive02Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowHorizontalIcon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowLeftRightIcon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowTurnBackwardIcon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  BalanceScaleIcon,
  BankIcon,
  BarcodeScanIcon,
  BatteryCharging01Icon,
  BeachIcon,
  BicycleIcon,
  BookOpen01Icon,
  Briefcase01Icon,
  BubbleChatIcon,
  Building01Icon,
  Building03Icon,
  BulbIcon,
  Bus01Icon,
  Calendar02Icon,
  Calendar03Icon,
  CalendarBlock01Icon,
  CalendarCheckIn01Icon,
  CalendarLove01Icon,
  CalendarRemove01Icon,
  CallIcon,
  Camera01Icon,
  CameraOff01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  Car01Icon,
  CctvCameraIcon,
  Certificate01Icon,
  Chair01Icon,
  ChampionIcon,
  ChartHistogramIcon,
  ChartLineData01Icon,
  CheckListIcon,
  CheckmarkBadge01Icon,
  CheckmarkCircle02Icon,
  CheckmarkSquare02Icon,
  CircleIcon,
  Clock01Icon,
  Clock03Icon,
  CloudIcon,
  Coffee01Icon,
  ComputerIcon,
  Contact01Icon,
  ContractsIcon,
  Copy01Icon,
  CreditCardIcon,
  CustomerSupportIcon,
  DashboardSpeed01Icon,
  DashboardSquare01Icon,
  DashedLineCircleIcon,
  Delete02Icon,
  Download04Icon,
  Csv01Icon,
  Pdf01Icon,
  Zip01Icon,
  DragDropVerticalIcon,
  ElectricPlugsIcon,
  File02Icon,
  FileUploadIcon,
  FilterHorizontalIcon,
  FingerPrintIcon,
  FireExtinguisherIcon,
  FireIcon,
  Flag01Icon,
  FlashIcon,
  FloppyDiskIcon,
  FolderAddIcon,
  ForkliftIcon,
  FuelStationIcon,
  GiftIcon,
  GitCompareIcon,
  Globe02Icon,
  Gps01Icon,
  GridViewIcon,
  HammerIcon,
  HardHatIcon,
  HierarchyIcon,
  HashtagIcon,
  HeadphonesIcon,
  HelpCircleIcon,
  Home01Icon,
  HourglassIcon,
  IdentityCardIcon,
  Image01Icon,
  ImageAdd01Icon,
  InboxIcon,
  InformationCircleIcon,
  Key01Icon,
  KeyboardIcon,
  LaptopIcon,
  Layout01Icon,
  LeftToRightListNumberIcon,
  Link01Icon,
  LinkSquare02Icon,
  ListViewIcon,
  LiveStreaming01Icon,
  Loading03Icon,
  Location01Icon,
  Login03Icon,
  Logout03Icon,
  Mail01Icon,
  Megaphone01Icon,
  Message01Icon,
  MessageNotification01Icon,
  Mic01Icon,
  MicrowaveIcon,
  MinusSignIcon,
  Money03Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  Mouse01Icon,
  Notification01Icon,
  NotificationOff01Icon,
  PackageDeliveredIcon,
  PackageIcon,
  PackageMovingIcon,
  PackageSearchIcon,
  PaintBoardIcon,
  PartyIcon,
  PencilEdit02Icon,
  PercentIcon,
  PinIcon,
  PlayIcon,
  PrinterIcon,
  ProjectorIcon,
  QrCodeIcon,
  RecordIcon,
  RefreshIcon,
  RepeatIcon,
  RoboticIcon,
  RouterIcon,
  RulerIcon,
  RunningShoesIcon,
  RupeeIcon,
  Search01Icon,
  SearchRemoveIcon,
  SecurityBlockIcon,
  SecurityCheckIcon,
  SecurityWarningIcon,
  SentIcon,
  ServerStack01Icon,
  Settings01Icon,
  Settings02Icon,
  ShapesIcon,
  Share08Icon,
  Simcard01Icon,
  SmartPhone01Icon,
  Sofa01Icon,
  SparklesIcon,
  SquareIcon,
  SquareLock02Icon,
  StarIcon,
  Store01Icon,
  Sun03Icon,
  Table01Icon,
  Tablet01Icon,
  Tag01Icon,
  Tag02Icon,
  Target02Icon,
  Task01Icon,
  TaskDaily01Icon,
  TaskDone01Icon,
  TShirtIcon,
  TextCheckIcon,
  ThumbsUpIcon,
  Tick02Icon,
  TickDouble02Icon,
  TimeScheduleIcon,
  Timer02Icon,
  TruckDeliveryIcon,
  Tv01Icon,
  Undo02Icon,
  Undo03Icon,
  UndoIcon,
  UnfoldMoreIcon,
  Upload04Icon,
  UserAdd01Icon,
  UserCheck01Icon,
  UserCircleIcon,
  UserGroupIcon,
  UserIcon,
  UserMultipleIcon,
  UserRemove01Icon,
  UserSearch01Icon,
  UserSettings01Icon,
  ViewIcon,
  ViewOffSlashIcon,
  Wallet01Icon,
  WavingHand01Icon,
  WorkHistoryIcon,
  Wrench01Icon,
  Xls01Icon,
} from '@hugeicons/core-free-icons';

/** Props every icon takes: any SVG attribute plus `size` and `strokeWidth` (as with lucide-react). */
export type IconProps = Omit<HugeiconsIconProps, 'icon' | 'altIcon' | 'showAlt'>;
/** Type of any icon component exported here (replaces lucide-react's `LucideIcon`). */
export type IconComponent = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

/** Stroke width icons are drawn with unless a call site passes its own. */
export const ICON_STROKE = 1.75;

function icon(svg: IconSvgElement, name: string): IconComponent {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon({ strokeWidth = ICON_STROKE, ...props }, ref) {
    const labelled = props['aria-label'] != null || props['aria-labelledby'] != null || props.role === 'img';
    return <HugeiconsIcon ref={ref} icon={svg} strokeWidth={strokeWidth} aria-hidden={labelled ? undefined : true} {...props} />;
  });
  Icon.displayName = name;
  return Icon;
}

export const Activity = icon(Activity01Icon, 'Activity');
export const AirVent = icon(AirVentIcon, 'AirVent');
export const AlarmClock = icon(AlarmClockIcon, 'AlarmClock');
export const AlertCircle = icon(AlertCircleIcon, 'AlertCircle');
export const AlertTriangle = icon(Alert02Icon, 'AlertTriangle');
export const Archive = icon(Archive02Icon, 'Archive');
export const Armchair = icon(Chair01Icon, 'Armchair');
export const ArrowDown = icon(ArrowDown02Icon, 'ArrowDown');
export const ArrowLeft = icon(ArrowLeft02Icon, 'ArrowLeft');
export const ArrowLeftRight = icon(ArrowLeftRightIcon, 'ArrowLeftRight');
export const ArrowRight = icon(ArrowRight02Icon, 'ArrowRight');
export const ArrowRightLeft = icon(ArrowDataTransferHorizontalIcon, 'ArrowRightLeft');
export const ArrowUp = icon(ArrowUp02Icon, 'ArrowUp');
export const ArrowUpRight = icon(ArrowUpRight01Icon, 'ArrowUpRight');
export const BadgeCheck = icon(CheckmarkBadge01Icon, 'BadgeCheck');
export const Banknote = icon(Money03Icon, 'Banknote');
export const BarChart3 = icon(ChartHistogramIcon, 'BarChart3');
export const BatteryCharging = icon(BatteryCharging01Icon, 'BatteryCharging');
export const Bell = icon(Notification01Icon, 'Bell');
export const BellOff = icon(NotificationOff01Icon, 'BellOff');
export const Bike = icon(BicycleIcon, 'Bike');
export const BookOpen = icon(BookOpen01Icon, 'BookOpen');
export const Bot = icon(RoboticIcon, 'Bot');
export const Box = icon(PackageIcon, 'Box');
export const Boxes = icon(PackageMovingIcon, 'Boxes');
export const Briefcase = icon(Briefcase01Icon, 'Briefcase');
export const Building = icon(Building01Icon, 'Building');
export const Building2 = icon(Building03Icon, 'Building2');
export const Bus = icon(Bus01Icon, 'Bus');
export const CalendarCheck = icon(CalendarCheckIn01Icon, 'CalendarCheck');
export const CalendarClock = icon(TimeScheduleIcon, 'CalendarClock');
export const CalendarDays = icon(Calendar03Icon, 'CalendarDays');
export const CalendarHeart = icon(CalendarLove01Icon, 'CalendarHeart');
export const CalendarOff = icon(CalendarBlock01Icon, 'CalendarOff');
export const CalendarRange = icon(Calendar02Icon, 'CalendarRange');
export const CalendarX = icon(CalendarRemove01Icon, 'CalendarX');
export const Camera = icon(Camera01Icon, 'Camera');
export const CameraOff = icon(CameraOff01Icon, 'CameraOff');
export const Car = icon(Car01Icon, 'Car');
export const CardSim = icon(Simcard01Icon, 'CardSim');
export const Cctv = icon(CctvCameraIcon, 'Cctv');
export const Check = icon(Tick02Icon, 'Check');
export const CheckCheck = icon(TickDouble02Icon, 'CheckCheck');
export const CheckCircle2 = icon(CheckmarkCircle02Icon, 'CheckCircle2');
export const CheckSquare = icon(CheckmarkSquare02Icon, 'CheckSquare');
export const ChevronDown = icon(ArrowDown01Icon, 'ChevronDown');
export const ChevronLeft = icon(ArrowLeft01Icon, 'ChevronLeft');
export const ChevronRight = icon(ArrowRight01Icon, 'ChevronRight');
export const ChevronsUpDown = icon(UnfoldMoreIcon, 'ChevronsUpDown');
export const Circle = icon(CircleIcon, 'Circle');
export const CircleDashed = icon(DashedLineCircleIcon, 'CircleDashed');
export const CircleDot = icon(RecordIcon, 'CircleDot');
export const CirclePlus = icon(AddCircleIcon, 'CirclePlus');
export const ClipboardCheck = icon(TaskDone01Icon, 'ClipboardCheck');
export const ClipboardList = icon(Task01Icon, 'ClipboardList');
export const Clock = icon(Clock01Icon, 'Clock');
export const Clock3 = icon(Clock03Icon, 'Clock3');
export const Cloud = icon(CloudIcon, 'Cloud');
export const Coffee = icon(Coffee01Icon, 'Coffee');
export const Cog = icon(Settings01Icon, 'Cog');
export const Computer = icon(ComputerIcon, 'Computer');
export const ContactRound = icon(Contact01Icon, 'ContactRound');
export const Copy = icon(Copy01Icon, 'Copy');
export const CornerLeftUp = icon(ArrowTurnBackwardIcon, 'CornerLeftUp');
export const CreditCard = icon(CreditCardIcon, 'CreditCard');
export const Download = icon(Download04Icon, 'Download');
export const ExternalLink = icon(LinkSquare02Icon, 'ExternalLink');
export const Eye = icon(ViewIcon, 'Eye');
export const EyeOff = icon(ViewOffSlashIcon, 'EyeOff');
export const FileBadge = icon(Certificate01Icon, 'FileBadge');
export const FileSignature = icon(ContractsIcon, 'FileSignature');
export const FileSpreadsheet = icon(Xls01Icon, 'FileSpreadsheet');
export const FileCsv = icon(Csv01Icon, 'FileCsv');
export const FilePdf = icon(Pdf01Icon, 'FilePdf');
export const FileZip = icon(Zip01Icon, 'FileZip');
export const FileText = icon(File02Icon, 'FileText');
export const FileUp = icon(FileUploadIcon, 'FileUp');
export const Fingerprint = icon(FingerPrintIcon, 'Fingerprint');
export const FireExtinguisher = icon(FireExtinguisherIcon, 'FireExtinguisher');
export const Flag = icon(Flag01Icon, 'Flag');
export const Flame = icon(FireIcon, 'Flame');
export const FolderPlus = icon(FolderAddIcon, 'FolderPlus');
export const Footprints = icon(RunningShoesIcon, 'Footprints');
export const Forklift = icon(ForkliftIcon, 'Forklift');
export const Fuel = icon(FuelStationIcon, 'Fuel');
export const Gauge = icon(DashboardSpeed01Icon, 'Gauge');
export const Gift = icon(GiftIcon, 'Gift');
export const GitCompareArrows = icon(GitCompareIcon, 'GitCompareArrows');
export const Globe = icon(Globe02Icon, 'Globe');
export const GripVertical = icon(DragDropVerticalIcon, 'GripVertical');
export const Hammer = icon(HammerIcon, 'Hammer');
export const Hand = icon(WavingHand01Icon, 'Hand');
export const HardHat = icon(HardHatIcon, 'HardHat');
export const Hash = icon(HashtagIcon, 'Hash');
export const Headphones = icon(HeadphonesIcon, 'Headphones');
export const HelpCircle = icon(HelpCircleIcon, 'HelpCircle');
export const History = icon(WorkHistoryIcon, 'History');
export const Home = icon(Home01Icon, 'Home');
export const Hourglass = icon(HourglassIcon, 'Hourglass');
export const House = icon(Home01Icon, 'House');
export const IdCard = icon(IdentityCardIcon, 'IdCard');
export const ImageIcon = icon(Image01Icon, 'ImageIcon');
export const ImagePlus = icon(ImageAdd01Icon, 'ImagePlus');
export const Inbox = icon(InboxIcon, 'Inbox');
export const IndianRupee = icon(RupeeIcon, 'IndianRupee');
export const Info = icon(InformationCircleIcon, 'Info');
export const KeyRound = icon(Key01Icon, 'KeyRound');
export const Keyboard = icon(KeyboardIcon, 'Keyboard');
export const Landmark = icon(BankIcon, 'Landmark');
export const Laptop = icon(LaptopIcon, 'Laptop');
export const LayoutDashboard = icon(DashboardSquare01Icon, 'LayoutDashboard');
export const LayoutGrid = icon(GridViewIcon, 'LayoutGrid');
export const LayoutTemplate = icon(Layout01Icon, 'LayoutTemplate');
export const LifeBuoy = icon(CustomerSupportIcon, 'LifeBuoy');
export const Lightbulb = icon(BulbIcon, 'Lightbulb');
export const LineChart = icon(ChartLineData01Icon, 'LineChart');
export const Link2 = icon(Link01Icon, 'Link2');
export const List = icon(ListViewIcon, 'List');
export const ListChecks = icon(CheckListIcon, 'ListChecks');
export const ListOrdered = icon(LeftToRightListNumberIcon, 'ListOrdered');
export const ListTodo = icon(TaskDaily01Icon, 'ListTodo');
export const Loader = icon(Loading03Icon, 'Loader');
export const Loader2 = icon(Loading03Icon, 'Loader2');
export const LocateFixed = icon(Gps01Icon, 'LocateFixed');
export const Lock = icon(SquareLock02Icon, 'Lock');
export const LogIn = icon(Login03Icon, 'LogIn');
export const LogOut = icon(Logout03Icon, 'LogOut');
export const Mail = icon(Mail01Icon, 'Mail');
export const MapPin = icon(Location01Icon, 'MapPin');
export const Megaphone = icon(Megaphone01Icon, 'Megaphone');
export const MessageCircle = icon(BubbleChatIcon, 'MessageCircle');
export const MessageSquare = icon(Message01Icon, 'MessageSquare');
export const MessageSquareWarning = icon(MessageNotification01Icon, 'MessageSquareWarning');
export const Mic = icon(Mic01Icon, 'Mic');
export const Microwave = icon(MicrowaveIcon, 'Microwave');
export const Minus = icon(MinusSignIcon, 'Minus');
export const Monitor = icon(ComputerIcon, 'Monitor');
export const Moon = icon(Moon02Icon, 'Moon');
export const MoreHorizontal = icon(MoreHorizontalIcon, 'MoreHorizontal');
export const Mouse = icon(Mouse01Icon, 'Mouse');
export const MoveHorizontal = icon(ArrowHorizontalIcon, 'MoveHorizontal');
export const Network = icon(HierarchyIcon, 'Network');
export const Package = icon(PackageIcon, 'Package');
export const PackageCheck = icon(PackageDeliveredIcon, 'PackageCheck');
export const PackageSearch = icon(PackageSearchIcon, 'PackageSearch');
export const Palette = icon(PaintBoardIcon, 'Palette');
export const Palmtree = icon(BeachIcon, 'Palmtree');
export const Paperclip = icon(Attachment01Icon, 'Paperclip');
export const PartyPopper = icon(PartyIcon, 'PartyPopper');
export const Pencil = icon(PencilEdit02Icon, 'Pencil');
export const PencilRuler = icon(RulerIcon, 'PencilRuler');
export const Percent = icon(PercentIcon, 'Percent');
export const Phone = icon(CallIcon, 'Phone');
export const Pin = icon(PinIcon, 'Pin');
export const Play = icon(PlayIcon, 'Play');
export const PlugZap = icon(ElectricPlugsIcon, 'PlugZap');
export const Plus = icon(Add01Icon, 'Plus');
export const Printer = icon(PrinterIcon, 'Printer');
export const Projector = icon(ProjectorIcon, 'Projector');
export const QrCode = icon(QrCodeIcon, 'QrCode');
export const Radio = icon(LiveStreaming01Icon, 'Radio');
export const RefreshCw = icon(RefreshIcon, 'RefreshCw');
export const Repeat = icon(RepeatIcon, 'Repeat');
export const RotateCcw = icon(Undo03Icon, 'RotateCcw');
export const Router = icon(RouterIcon, 'Router');
export const Save = icon(FloppyDiskIcon, 'Save');
export const Scale = icon(BalanceScaleIcon, 'Scale');
export const ScanLine = icon(BarcodeScanIcon, 'ScanLine');
export const Search = icon(Search01Icon, 'Search');
export const SearchX = icon(SearchRemoveIcon, 'SearchX');
export const Send = icon(SentIcon, 'Send');
export const Server = icon(ServerStack01Icon, 'Server');
export const Settings2 = icon(Settings02Icon, 'Settings2');
export const Shapes = icon(ShapesIcon, 'Shapes');
export const Share2 = icon(Share08Icon, 'Share2');
export const ShieldAlert = icon(SecurityWarningIcon, 'ShieldAlert');
export const ShieldCheck = icon(SecurityCheckIcon, 'ShieldCheck');
export const ShieldOff = icon(SecurityBlockIcon, 'ShieldOff');
export const Shirt = icon(TShirtIcon, 'Shirt');
export const SlidersHorizontal = icon(FilterHorizontalIcon, 'SlidersHorizontal');
export const Smartphone = icon(SmartPhone01Icon, 'Smartphone');
export const Sofa = icon(Sofa01Icon, 'Sofa');
export const Sparkles = icon(SparklesIcon, 'Sparkles');
export const SpellCheck = icon(TextCheckIcon, 'SpellCheck');
export const Square = icon(SquareIcon, 'Square');
export const Star = icon(StarIcon, 'Star');
export const Store = icon(Store01Icon, 'Store');
export const Sun = icon(Sun03Icon, 'Sun');
export const Table = icon(Table01Icon, 'Table');
export const Tablet = icon(Tablet01Icon, 'Tablet');
export const Tag = icon(Tag01Icon, 'Tag');
export const Tags = icon(Tag02Icon, 'Tags');
export const Target = icon(Target02Icon, 'Target');
export const ThumbsUp = icon(ThumbsUpIcon, 'ThumbsUp');
export const Timer = icon(Timer02Icon, 'Timer');
export const Trash2 = icon(Delete02Icon, 'Trash2');
export const TriangleAlert = icon(Alert02Icon, 'TriangleAlert');
export const Trophy = icon(ChampionIcon, 'Trophy');
export const Truck = icon(TruckDeliveryIcon, 'Truck');
export const Tv = icon(Tv01Icon, 'Tv');
export const Undo = icon(UndoIcon, 'Undo');
export const Undo2 = icon(Undo02Icon, 'Undo2');
export const Upload = icon(Upload04Icon, 'Upload');
export const User = icon(UserIcon, 'User');
export const UserCheck = icon(UserCheck01Icon, 'UserCheck');
export const UserCog = icon(UserSettings01Icon, 'UserCog');
export const UserPlus = icon(UserAdd01Icon, 'UserPlus');
export const UserRound = icon(UserCircleIcon, 'UserRound');
export const UserRoundSearch = icon(UserSearch01Icon, 'UserRoundSearch');
export const UserRoundX = icon(UserRemove01Icon, 'UserRoundX');
export const Users = icon(UserMultipleIcon, 'Users');
export const UsersRound = icon(UserGroupIcon, 'UsersRound');
export const Wallet = icon(Wallet01Icon, 'Wallet');
export const Wrench = icon(Wrench01Icon, 'Wrench');
export const X = icon(Cancel01Icon, 'X');
export const XCircle = icon(CancelCircleIcon, 'XCircle');
export const Zap = icon(FlashIcon, 'Zap');
