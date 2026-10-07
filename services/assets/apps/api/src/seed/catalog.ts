import type { FieldType, TrackingMode } from '@eam/shared';

/** Starter catalog. This is plain data — admins can change all of it in the UI. */
export interface SeedField {
  label: string;
  type: FieldType;
  required?: boolean;
  isUnique?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  showInTable?: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface SeedType {
  name: string;
  code: string;
  icon: string;
  trackingMode?: TrackingMode;
  consumable?: boolean;
  description?: string;
  fields?: SeedField[];
}

export interface SeedCategory {
  name: string;
  code: string;
  icon: string;
  color: string;
  description: string;
  fields?: SeedField[];
  types: SeedType[];
}

const OS = ['Windows 11', 'Windows 10', 'macOS', 'Ubuntu', 'ChromeOS'];

export const CATALOG: SeedCategory[] = [
  {
    name: 'IT',
    code: 'IT',
    icon: 'monitor',
    color: 'blue',
    description: 'Computers, peripherals, networking and telecom',
    types: [
      {
        name: 'Laptop',
        code: 'LAP',
        icon: 'laptop',
        fields: [
          { label: 'Processor', type: 'text', required: true, showInTable: true, placeholder: 'Intel Core i7-1365U' },
          { label: 'RAM (GB)', type: 'number', required: true, min: 1, max: 1024, showInTable: true },
          { label: 'Storage (GB)', type: 'number', min: 1, showInTable: true },
          { label: 'Storage Type', type: 'select', options: ['NVMe SSD', 'SSD', 'HDD'] },
          { label: 'Operating System', type: 'select', options: OS, showInTable: true },
          { label: 'Screen Size (inch)', type: 'number', min: 7, max: 21 },
          { label: 'Device Name', type: 'text', placeholder: 'LAPTOP-AB12CD3', helpText: 'Windows: Settings → System → About' },
          { label: 'Device ID', type: 'text', isUnique: true, placeholder: 'A1B2C3D4-1111-4222-8333-444455556666' },
        ],
      },
      {
        name: 'Desktop',
        code: 'DTP',
        icon: 'computer',
        fields: [
          { label: 'Processor', type: 'text', required: true, showInTable: true },
          { label: 'RAM (GB)', type: 'number', required: true, min: 1, showInTable: true },
          { label: 'Storage (GB)', type: 'number' },
          { label: 'Operating System', type: 'select', options: OS },
        ],
      },
      {
        name: 'Monitor',
        code: 'MON',
        icon: 'monitor',
        fields: [
          { label: 'Screen Size (inch)', type: 'number', required: true, min: 10, max: 60, showInTable: true },
          { label: 'Resolution', type: 'select', options: ['1920x1080', '2560x1440', '3840x2160'] },
          { label: 'Panel', type: 'select', options: ['IPS', 'VA', 'TN', 'OLED'] },
        ],
      },
      {
        name: 'Mobile Phone',
        code: 'MOB',
        icon: 'smartphone',
        fields: [
          { label: 'IMEI', type: 'text', required: true, isUnique: true, showInTable: true, helpText: 'Dial *#06# to see it' },
          { label: 'Storage (GB)', type: 'select', options: ['64', '128', '256', '512'] },
          { label: 'Operating System', type: 'select', options: ['Android', 'iOS'], showInTable: true },
        ],
      },
      {
        name: 'Tablet',
        code: 'TAB',
        icon: 'tablet',
        fields: [
          { label: 'Storage (GB)', type: 'select', options: ['64', '128', '256'] },
          { label: 'Cellular', type: 'boolean' },
        ],
      },
      {
        name: 'Server',
        code: 'SRV',
        icon: 'server',
        fields: [
          { label: 'CPU Cores', type: 'number', min: 1, showInTable: true },
          { label: 'RAM (GB)', type: 'number', min: 1, showInTable: true },
          { label: 'Rack Position', type: 'text', placeholder: 'Rack A · U12' },
          { label: 'IP Address', type: 'text' },
        ],
      },
      {
        name: 'Printer',
        code: 'PRN',
        icon: 'printer',
        fields: [
          { label: 'Printer Type', type: 'select', options: ['Laser', 'Inkjet', 'Thermal', 'Multifunction'], showInTable: true },
          { label: 'Colour', type: 'boolean' },
          { label: 'IP Address', type: 'text' },
        ],
      },
      {
        name: 'Router',
        code: 'RTR',
        icon: 'router',
        fields: [
          { label: 'Ports', type: 'number', min: 1 },
          { label: 'IP Address', type: 'text', showInTable: true },
          { label: 'Firmware', type: 'text' },
        ],
      },
      { name: 'Keyboard', code: 'KBD', icon: 'keyboard', fields: [{ label: 'Wireless', type: 'boolean' }, { label: 'Layout', type: 'select', options: ['US', 'UK', 'Hindi'] }] },
      { name: 'Mouse', code: 'MSE', icon: 'mouse', fields: [{ label: 'Wireless', type: 'boolean' }] },
      {
        name: 'Charger',
        code: 'CHG',
        icon: 'plug-zap',
        fields: [
          { label: 'Wattage (W)', type: 'number', min: 1, showInTable: true },
          { label: 'Connector', type: 'select', options: ['USB-C', 'MagSafe', 'Barrel', 'Lightning'], showInTable: true },
        ],
      },
      { name: 'Headset', code: 'HDS', icon: 'headphones', fields: [{ label: 'Wireless', type: 'boolean' }, { label: 'Noise Cancelling', type: 'boolean' }] },
      {
        name: 'UPS',
        code: 'UPS',
        icon: 'battery-charging',
        fields: [
          { label: 'Capacity (VA)', type: 'number', min: 1, showInTable: true },
          { label: 'Battery Replaced On', type: 'date' },
        ],
      },
      {
        name: 'SIM Card',
        code: 'SIM',
        icon: 'card-sim',
        fields: [
          { label: 'Connection Number', type: 'phone', required: true, isUnique: true, showInTable: true },
          { label: 'Billable Account', type: 'text', showInTable: true, placeholder: '1-0000000000000' },
          { label: 'Circle', type: 'text', showInTable: true, placeholder: 'DL' },
          { label: 'Plan', type: 'text', showInTable: true },
          { label: 'SIM Number', type: 'text', isUnique: true, showInTable: true, placeholder: '89910000000000000000U' },
          { label: 'Carrier', type: 'select', options: ['Airtel', 'Jio', 'Vi', 'BSNL'], required: true },
          { label: 'Monthly Data (GB)', type: 'number', min: 0 },
        ],
      },
    ],
  },
  {
    name: 'Office',
    code: 'OFF',
    icon: 'briefcase',
    color: 'amber',
    description: 'Furniture, keys, cards and office supplies',
    types: [
      { name: 'Chair', code: 'CHR', icon: 'armchair', fields: [{ label: 'Material', type: 'select', options: ['Mesh', 'Leather', 'Fabric'] }, { label: 'Ergonomic', type: 'boolean' }] },
      { name: 'Desk', code: 'DSK', icon: 'table', fields: [{ label: 'Width (cm)', type: 'number' }, { label: 'Height Adjustable', type: 'boolean' }] },
      { name: 'Cabinet', code: 'CAB', icon: 'archive', fields: [{ label: 'Drawers', type: 'number', min: 1 }, { label: 'Lockable', type: 'boolean' }] },
      {
        name: 'Keys',
        code: 'KEY',
        icon: 'key-round',
        fields: [
          { label: 'Key Number', type: 'text', required: true, isUnique: true, showInTable: true },
          { label: 'Opens', type: 'text', required: true, showInTable: true, placeholder: 'Cabin 3, 4th floor' },
          { label: 'Copies Issued', type: 'number', min: 1 },
        ],
      },
      {
        name: 'Access Card',
        code: 'ACC',
        icon: 'id-card',
        fields: [
          { label: 'Card Number', type: 'text', required: true, isUnique: true, showInTable: true },
          { label: 'Access Zones', type: 'multiselect', options: ['Main Entrance', 'Office Floor', 'Server Room', 'Warehouse', 'Parking'], showInTable: true },
        ],
      },
      {
        name: 'ID Card',
        code: 'IDC',
        icon: 'contact-round',
        fields: [
          { label: 'Card Number', type: 'text', required: true, isUnique: true, showInTable: true },
          { label: 'Valid Until', type: 'date' },
        ],
      },
      { name: 'Stationery', code: 'STN', icon: 'pencil-ruler', trackingMode: 'QUANTITY', consumable: true, description: 'Given away — no return', fields: [{ label: 'Unit', type: 'select', options: ['Piece', 'Pack', 'Box', 'Kit'] }] },
      { name: 'Joining Kit', code: 'JKT', icon: 'gift', trackingMode: 'QUANTITY', consumable: true, description: 'Welcome kit for new joiners — given once, no return', fields: [{ label: 'Contents', type: 'text', placeholder: 'Bag, T-shirt, diary, pen, lanyard' }] },
    ],
  },
  {
    name: 'Vehicles',
    code: 'VEH',
    icon: 'car',
    color: 'emerald',
    description: 'Company cars, two-wheelers and commercial vehicles',
    fields: [
      { label: 'Registration No.', type: 'text', isUnique: true, showInTable: true, placeholder: 'MH-02-AB-1234' },
      { label: 'Engine No.', type: 'text' },
      { label: 'Chassis No.', type: 'text' },
      { label: 'Fuel Type', type: 'select', options: ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'], showInTable: true },
      { label: 'Insurance Policy No.', type: 'text' },
      { label: 'Insurance Expiry', type: 'date', showInTable: true },
      { label: 'PUC Expiry', type: 'date' },
    ],
    types: [
      { name: 'Car', code: 'CAR', icon: 'car', fields: [{ label: 'Seating Capacity', type: 'number', min: 1, max: 20 }] },
      { name: 'Bike', code: 'BIK', icon: 'bike', fields: [{ label: 'Engine (cc)', type: 'number', min: 50 }] },
      { name: 'Scooty', code: 'SCT', icon: 'bike', fields: [{ label: 'Engine (cc)', type: 'number', min: 50 }] },
      { name: 'Van', code: 'VAN', icon: 'bus', fields: [{ label: 'Seating Capacity', type: 'number', min: 1 }] },
      { name: 'Truck', code: 'TRK', icon: 'truck', fields: [{ label: 'Load Capacity (t)', type: 'number', min: 0 }] },
      { name: 'Forklift', code: 'FLT', icon: 'forklift', fields: [{ label: 'Lift Capacity (kg)', type: 'number', min: 0, showInTable: true }] },
    ],
  },
  {
    name: 'Tools & Equipment',
    code: 'TLS',
    icon: 'wrench',
    color: 'orange',
    description: 'Machines, tools, test and electrical equipment',
    types: [
      { name: 'Machine', code: 'MCH', icon: 'cog', fields: [{ label: 'Power (kW)', type: 'number', min: 0 }, { label: 'Next Service', type: 'date', showInTable: true }] },
      { name: 'Tool', code: 'TOL', icon: 'hammer', fields: [{ label: 'Tool Kind', type: 'select', options: ['Hand tool', 'Power tool', 'Measuring'] }] },
      {
        name: 'Testing Equipment',
        code: 'TST',
        icon: 'gauge',
        fields: [
          { label: 'Calibration Due', type: 'date', showInTable: true },
          { label: 'Accuracy', type: 'text' },
        ],
      },
      { name: 'Electrical Equipment', code: 'ELE', icon: 'zap', fields: [{ label: 'Voltage (V)', type: 'number' }, { label: 'Power (W)', type: 'number' }] },
    ],
  },
  {
    name: 'Safety',
    code: 'SAF',
    icon: 'hard-hat',
    color: 'red',
    description: 'PPE and safety equipment',
    types: [
      { name: 'Helmet', code: 'HLM', icon: 'hard-hat', fields: [{ label: 'Size', type: 'select', options: ['S', 'M', 'L', 'XL'], showInTable: true }, { label: 'ISI Certified', type: 'boolean' }] },
      { name: 'Safety Shoes', code: 'SHO', icon: 'footprints', fields: [{ label: 'Size (UK)', type: 'number', min: 3, max: 14, showInTable: true }] },
      { name: 'Gloves', code: 'GLV', icon: 'hand', trackingMode: 'QUANTITY', description: 'Tracked by quantity', fields: [{ label: 'Glove Type', type: 'select', options: ['Nitrile', 'Cut-resistant', 'Leather', 'Electrical'] }] },
      {
        name: 'Fire Extinguisher',
        code: 'FEX',
        icon: 'fire-extinguisher',
        fields: [
          { label: 'Extinguisher Type', type: 'select', options: ['ABC', 'CO2', 'Water', 'Foam'], required: true, showInTable: true },
          { label: 'Capacity (kg)', type: 'number', min: 1 },
          { label: 'Refill Due', type: 'date', showInTable: true },
        ],
      },
      { name: 'Safety Equipment', code: 'SEQ', icon: 'shield-check', fields: [{ label: 'Equipment Kind', type: 'text' }] },
    ],
  },
  {
    name: 'Electronics',
    code: 'ELC',
    icon: 'camera',
    color: 'violet',
    description: 'Cameras, projectors, TVs, scanners and POS',
    types: [
      {
        name: 'Camera',
        code: 'CAM',
        icon: 'camera',
        fields: [
          { label: 'Lens', type: 'text', showInTable: true, placeholder: '24-70mm f/2.8' },
          { label: 'Megapixels', type: 'number', min: 1, showInTable: true },
          { label: 'Memory Card', type: 'text', placeholder: '128GB SD' },
        ],
      },
      { name: 'Projector', code: 'PRJ', icon: 'projector', fields: [{ label: 'Lumens', type: 'number' }, { label: 'Resolution', type: 'select', options: ['1080p', '4K', 'WXGA'] }] },
      { name: 'TV', code: 'TV', icon: 'tv', fields: [{ label: 'Screen Size (inch)', type: 'number', showInTable: true }, { label: 'Smart TV', type: 'boolean' }] },
      { name: 'Scanner', code: 'SCN', icon: 'scan-line', fields: [{ label: 'Scanner Type', type: 'select', options: ['Flatbed', 'Document feeder', 'Handheld barcode'] }] },
      {
        name: 'POS Machine',
        code: 'POS',
        icon: 'credit-card',
        fields: [
          { label: 'Terminal ID', type: 'text', required: true, isUnique: true, showInTable: true },
          { label: 'Acquiring Bank', type: 'text' },
        ],
      },
    ],
  },
  {
    name: 'Software & Digital',
    code: 'SFT',
    icon: 'key-round',
    color: 'cyan',
    description: 'Licenses, subscriptions, domains and cloud accounts',
    types: [
      {
        name: 'Software License',
        code: 'LIC',
        icon: 'badge-check',
        trackingMode: 'QUANTITY',
        description: 'Seats are assigned to people',
        fields: [
          { label: 'Product Version', type: 'text' },
          { label: 'License Key', type: 'text' },
          { label: 'License Expiry', type: 'date', showInTable: true },
        ],
      },
      {
        name: 'Subscription',
        code: 'SUB',
        icon: 'repeat',
        fields: [
          { label: 'Plan', type: 'text', showInTable: true },
          { label: 'Billing Cycle', type: 'select', options: ['Monthly', 'Quarterly', 'Yearly'] },
          { label: 'Renewal Date', type: 'date', showInTable: true },
          { label: 'Seats', type: 'number', min: 1 },
        ],
      },
      {
        name: 'Domain',
        code: 'DOM',
        icon: 'globe',
        fields: [
          { label: 'Domain Name', type: 'text', required: true, isUnique: true, showInTable: true },
          { label: 'Registrar', type: 'text' },
          { label: 'Domain Expiry', type: 'date', required: true, showInTable: true },
          { label: 'Auto Renew', type: 'boolean' },
        ],
      },
      {
        name: 'Cloud Account',
        code: 'CLD',
        icon: 'cloud',
        fields: [
          { label: 'Provider', type: 'select', options: ['AWS', 'Azure', 'Google Cloud', 'Other'], required: true, showInTable: true },
          { label: 'Account ID', type: 'text', required: true, isUnique: true, showInTable: true },
          { label: 'Owner Email', type: 'email' },
          { label: 'Console URL', type: 'url' },
        ],
      },
      { name: 'Digital License', code: 'DLC', icon: 'file-badge', fields: [{ label: 'License Number', type: 'text', isUnique: true }, { label: 'Valid Until', type: 'date' }] },
    ],
  },
  {
    name: 'Facilities',
    code: 'FAC',
    icon: 'building-2',
    color: 'slate',
    description: 'Building equipment, furniture and appliances',
    types: [
      { name: 'Air Conditioner', code: 'AC', icon: 'air-vent', fields: [{ label: 'Tonnage', type: 'number', min: 0.5, showInTable: true }, { label: 'Star Rating', type: 'select', options: ['2', '3', '4', '5'] }] },
      { name: 'Generator', code: 'GEN', icon: 'fuel', fields: [{ label: 'Capacity (kVA)', type: 'number', showInTable: true }, { label: 'Fuel', type: 'select', options: ['Diesel', 'Gas'] }] },
      { name: 'Furniture', code: 'FUR', icon: 'sofa', fields: [{ label: 'Furniture Kind', type: 'text' }] },
      { name: 'CCTV Camera', code: 'CCTV', icon: 'cctv', fields: [{ label: 'Resolution', type: 'select', options: ['2MP', '4MP', '8MP'] }, { label: 'NVR Channel', type: 'number' }] },
      { name: 'Appliance', code: 'APL', icon: 'microwave', fields: [{ label: 'Appliance Kind', type: 'text', showInTable: true }] },
    ],
  },
  {
    name: 'Financial / Other',
    code: 'FIN',
    icon: 'landmark',
    color: 'stone',
    description: 'Property, leased assets, inventory and anything else',
    types: [
      {
        name: 'Corporate Card',
        code: 'CRD',
        icon: 'credit-card',
        fields: [
          { label: 'Card Last 4 Digits', type: 'text', required: true, min: 4, max: 4, showInTable: true, helpText: 'Never store the full card number' },
          { label: 'Issuing Bank', type: 'text', showInTable: true },
          { label: 'Monthly Limit', type: 'currency' },
        ],
      },
      { name: 'Company Property', code: 'PRP', icon: 'house', fields: [{ label: 'Address', type: 'textarea', required: true }, { label: 'Area (sq ft)', type: 'number' }] },
      {
        name: 'Leased Asset',
        code: 'LSE',
        icon: 'file-signature',
        fields: [
          { label: 'Lease Start', type: 'date' },
          { label: 'Lease End', type: 'date', showInTable: true },
          { label: 'Monthly Rent', type: 'currency' },
        ],
      },
      { name: 'Inventory Item', code: 'INV', icon: 'boxes', trackingMode: 'QUANTITY', description: 'Tracked by quantity', fields: [{ label: 'SKU', type: 'text', showInTable: true }] },
      { name: 'Custom Asset', code: 'CUS', icon: 'box', description: 'Anything else — add your own fields' },
    ],
  },
];
