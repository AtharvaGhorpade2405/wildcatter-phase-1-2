// Shapes returned by the PharmaChain REST API (/api/v1).

export type Signal = 'green' | 'amber' | 'red';
export type Schedule = 'OTC' | 'H' | 'H1' | 'X';
export type EntityType = 'API_MANUFACTURER' | 'FORMULATOR' | 'CNF_AGENT' | 'STOCKIST' | 'PHARMACY' | 'HOSPITAL_PHARMACY';

export interface Scheme {
  type: 'free' | 'slab' | 'cd';
  buy?: number;
  free?: number;
  cdPct?: number;
  slabs?: { minQty: number; pct: number }[];
}

export interface Product {
  id: string;
  brand: string;
  salt: string;
  strengthMg: number;
  form: string;
  packSize: number;
  schedule: Schedule;
  category: string;
  gstPct: number;
  mrp: number;
  ptr: number;
  pts: number;
  ceilingPrice: number | null;
  coldChain: boolean;
  drugClass: string;
  scheme: Scheme | null;
  schemeLabel: string;
  gtin: string;
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  gstin: string;
  gstValid: boolean;
  licenseNo: string | null;
  city: string | null;
  state: string | null;
  stateCode: string;
  verification: 'verified' | 'unverified' | 'duplicate_suspect';
  verificationNote?: string;
  source: string;
  participant: boolean;
}

export interface InventoryRow {
  id: string;
  entityId: string;
  kind: 'api' | 'fg';
  ref: string;
  batchNo: string;
  qty: number;
  uom: string;
  expiry: string;
  quarantined: boolean;
  name: string;
  schedule: Schedule | null;
  daysToExpiry: number;
}

export interface QcTest { key: string; label: string; value: number | null; min: number; max: number; unit: string; pass: boolean }
export interface Signature { role: 'MAKER' | 'CHECKER' | 'QA'; user: string; meaning: string; ts: string; hash: string }

export interface ApiBatch {
  id: string;
  batchNo: string;
  salt: string;
  quantityKg: number;
  status: string;
  dispensing: { actualKg: number; capturedKg?: number; scale?: string; withinTolerance?: boolean };
  qc: Record<string, number> | null;
  qcEval: { pass: boolean; tests: QcTest[] } | null;
  agentReport: {
    verdict: 'PASS' | 'FAIL' | 'HOLD';
    summary: string;
    findings?: string[];
    agent?: string;
    deviationDraft?: { deviationNo: string; classification: string; immediateAction: string; proposedCapa: string } | null;
  } | null;
  signatures: Signature[];
  retestDate: string;
  createdAt: string;
  quarantineReason?: string;
  drumLabels: string[];
  coa?: { coaNo: string; manufacturer: string; license: string; pharmacopoeia: string; conclusion: string; releasedBy: string; releasedAt: string; signatureHash: string };
}

export interface PackSample { serial: number; gs1: string; epc: string; h2Qr: Record<string, string> }

export interface FgBatch {
  id: string;
  batchNo: string;
  productId: string;
  brand?: string;
  apiBatchNo: string | null;
  coaLinks?: string[];
  packs: number;
  mfgDate: string;
  expDate: string;
  status: string;
  serialized: boolean;
  serialStart: number | null;
  aggregation?: { packs: number; cases: number; pallets: number };
  product?: Product;
  samples?: PackSample[];
  computeMs?: number;
}

export interface ShipmentItem { kind: 'api' | 'fg'; ref: string; productId?: string; batchNo: string; qty: number; uom: string; expiry: string }

export interface Shipment {
  id: string;
  asnNo: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  items: ShipmentItem[];
  itemsLabel: string;
  ssccs: string[];
  status: 'in_transit' | 'arrived' | 'received' | 'quarantined';
  progress: number;
  coldChain: boolean;
  temps: number[];
  mkt: number | null;
  signal: Signal;
  excursion?: boolean;
  ewayBill: string | null;
  receivedAt: string | null;
}

export interface Train {
  id: string;
  asnNo: string;
  fromStage: number;
  toStage: number;
  fromName: string;
  toName: string;
  progress: number;
  status: string;
  signal: Signal;
  category: string;
  coldChain: boolean;
  mkt: number | null;
  lastTemp: number | null;
  durationMs: number;
  ewayBill: string | null;
  items: { batchNo: string; qty: number; uom: string; label: string }[];
}

export interface Alert { id: string; level: Signal; title: string; detail: string; ts: string }

export interface TowerState {
  categories: { id: string; name: string; color: string }[];
  stations: { stage: number; label: string; entities: { id: string; name: string }[] }[];
  trains: Train[];
  kpis: Record<'inTransit' | 'red' | 'amber' | 'green' | 'quarantinedBatches' | 'nearExpiryLots' | 'entities' | 'epcisEvents', number>;
  quarantined: { batchNo: string; reason: string }[];
  alerts: Alert[];
}

export interface QuoteLine {
  productId: string;
  brand: string;
  scheme: string;
  qty: number;
  free: number;
  tradeDiscount: number;
  cashDiscount: number;
  taxable: number;
  gst: number;
  gstPct: number;
  igst: number;
  total: number;
  picks: { batchNo: string; qty: number }[];
  shortfall: number;
}

export interface Quote {
  buyerName: string;
  supplyType: string;
  lines: QuoteLine[];
  totals: { total: number; freeGoodsValue: number };
  computeMs: number;
}

export interface Invoice extends Quote {
  id: string;
  invoiceNo: string;
  status: string;
  irn: string;
  irnNote: string;
  ackNo: string;
  ewayBill: string | null;
  asnNo: string;
}

export interface Claim { id: string; type: string; debitNoteNo: string; brand: string; freeQty: number; value: number }

export interface ExpiryItem { inventoryId: string; brand: string; batchNo: string; qty: number; daysToExpiry: number }
export interface ExpiryAlerts {
  summary: Record<string, { count: number; value: number }>;
  buckets: Record<string, ExpiryItem[]>;
}

export interface SearchResult extends Pick<Product, 'id' | 'brand' | 'salt' | 'strengthMg' | 'form' | 'packSize' | 'schedule' | 'mrp' | 'coldChain'> {
  stock: number;
  marginPct: number;
  marginRs: number;
  substitutes: SearchResult[];
}

export interface ClinicalAlert { type: string; severity: 'contraindicated' | 'major' | 'moderate' | 'minor'; title: string; detail: string }
export interface ClinicalResult { alerts: ClinicalAlert[]; blocking: boolean; knowledgeBase: string }

export interface VerifyResult {
  status: string;
  verified: boolean;
  product: { id: string; brand: string } | null;
  batchNo: string | null;
  checks: { name: string; pass: boolean; detail: string }[];
}

export interface Sale { id: string; billNo: string; ts: string; lines: { brand: string }[]; totals: { amount: number }; computeMs: number; overrideReason: string | null }

export interface RegisterEntry {
  id: string; ts: string; schedule: Schedule; brand: string; qty: number; unit: string; batches: string;
  patientName: string; patientAge: string | number; patientId: string; prescriberName: string; prescriberRegNo: string;
}

export interface ProcurementRec {
  productId: string; brand: string; stock: number; reorderQty: number; savingVsWorst: number;
  plan: { name: string; qty: number; netPerUnit: number }[];
  options: { name: string; offer: string }[];
}

export interface EpcisEvent {
  eventID: string; type: string; eventTime: string; bizStep: string; disposition: string;
  'pcx:batchNo': string | null; 'pcx:summary': string;
  [k: string]: unknown;
}

export interface AuditRecord { seq: number; ts: string; user: string; action: string; ref: string | null; hash: string; prevHash: string }
