export const BUSINESS_UNITS = [
  "営業",
  "開発",
  "マーケティング",
  "カスタマーサクセス",
  "管理",
  "人事"
] as const;

export type BusinessUnit = (typeof BUSINESS_UNITS)[number];

export type BusinessRecord = {
  id: number;
  companyId: number;
  companyName: string;
  businessUnit: BusinessUnit;
  month: string;
  revenue: number;
  customerCount: number;
  projectCount: number;
  utilization: number;
};

export type ColumnarBusinessRecords = {
  kind: "columnar";
  count: number;
  sharedMemory: boolean;
  companyIds: Uint8Array;
  businessUnitIds: Uint8Array;
  monthIds: Uint8Array;
  revenues: Uint32Array;
  customerCounts: Uint16Array;
  projectCounts: Uint16Array;
  utilizationTenth: Uint16Array;
};

export type BusinessDataset =
  | {
      kind: "object";
      count: number;
      storageLabel: string;
      records: BusinessRecord[];
    }
  | {
      kind: "columnar";
      count: number;
      storageLabel: string;
      records: ColumnarBusinessRecords;
    };

export type GenerationProgress = {
  stage: "idle" | "allocating" | "generating" | "indexing" | "done";
  generated: number;
  total: number;
  percent: number;
  elapsedMs: number;
  message: string;
};

export type Company = {
  id: number;
  name: string;
};

export type Filters = {
  companyId: number | "all";
  businessUnit: BusinessUnit | "all";
  month: string | "all";
};

export type OptimizationFlags = {
  useMemo: boolean;
  useWorker: boolean;
  useMap: boolean;
  useIndex: boolean;
};

export type AggregationMetrics = {
  filterMs: number;
  averageMs: number;
  chartMs: number;
  totalMs: number;
  lookupMs: number;
  matchedRecords: number;
  scannedRecords: number;
  uiMaxBlockMs: number;
  workerRoundTripMs?: number;
  workerSetupMs?: number;
};

export type NumericSummary = {
  averageRevenue: number;
  averageRevenuePerCompany: number;
  averageCustomerCount: number;
  averageProjectCount: number;
  averageUtilization: number;
  totalRevenue: number;
};

export type ChartPoint = {
  name: string;
  value: number;
  count?: number;
};

export type AnalysisResult = {
  businessUnitRevenue: ChartPoint[];
  companyRevenue: ChartPoint[];
  utilizationByMonth: ChartPoint[];
  customerCountByMonth: ChartPoint[];
  projectCountByBusinessUnit: ChartPoint[];
  utilizationByBusinessUnit: ChartPoint[];
  summary: NumericSummary;
  metrics: AggregationMetrics;
};

export type HistoryRow = AggregationMetrics & {
  id: number;
  label: string;
  chartRenderer: string;
  recordCount: number;
  memoHit: boolean;
  timestamp: string;
};

export type DataStructures = {
  companyNameMap: Map<number, string>;
  byCompany: Map<number, BusinessRecord[]>;
  byBusinessUnit: Map<BusinessUnit, BusinessRecord[]>;
  byMonth: Map<string, BusinessRecord[]>;
  buildMapMs: number;
  buildIndexMs: number;
};

export type ColumnarAggregateIndex = {
  counts: Uint32Array;
  revenues: Float64Array;
  customerCounts: Float64Array;
  projectCounts: Float64Array;
  utilizationTenth: Float64Array;
};

export type ColumnarDataStructures = {
  companyNameMap: Map<number, string>;
  aggregateIndex: ColumnarAggregateIndex;
  buildMapMs: number;
  buildIndexMs: number;
};

export type DatasetStructures =
  | {
      kind: "object";
      data: DataStructures;
    }
  | {
      kind: "columnar";
      data: ColumnarDataStructures;
    };
