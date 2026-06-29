import {
  BUSINESS_UNITS,
  type ColumnarDataStructures,
  type ColumnarBusinessRecords,
  type DataStructures,
  type DatasetStructures,
  type GenerationProgress,
  type Company,
  type BusinessDataset,
  type BusinessRecord
} from "../types";

export const RECORD_COUNT_OPTIONS = [
  10_000,
  100_000,
  1_000_000,
  5_000_000,
  10_000_000,
  20_000_000,
  50_000_000
] as const;

export const DEFAULT_RECORD_COUNT = 50_000_000;

export const OBJECT_DATASET_LIMIT = 5_000_000;

export const COLUMNAR_BYTES_PER_RECORD =
  Uint8Array.BYTES_PER_ELEMENT * 3 +
  Uint32Array.BYTES_PER_ELEMENT +
  Uint16Array.BYTES_PER_ELEMENT * 3;

export const COMPANIES: Company[] = Array.from({ length: 100 }, (_, index) => {
  const id = index + 1;
  return {
    id,
    name: `サンプル会社 ${String(id).padStart(3, "0")}`
  };
});

export const MONTHS: string[] = Array.from({ length: 60 }, (_, index) => {
  const year = 2021 + Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
});

const randomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const BUSINESS_UNIT_REVENUE_FACTORS = [1.35, 1.75, 1.12, 0.92, 0.52, 0.46] as const;

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const companyScale = (companyIndex: number) => {
  const tier = Math.floor(companyIndex / 10);
  const rankInTier = companyIndex % 10;
  return 0.35 + tier * 0.22 + rankInTier * 0.035;
};

const monthSeasonality = (monthIndex: number) => {
  const month = monthIndex % 12;
  const wave = 1 + Math.sin((month / 12) * Math.PI * 2) * 0.32;
  const quarterEndBoost = month === 2 || month === 5 || month === 8 || month === 11 ? 1.32 : 1;
  return wave * quarterEndBoost;
};

const randomSkew = () => {
  const base = Math.random() ** 2.35;
  const spike = Math.random() < 0.045 ? randomInt(2, 7) : 1;
  return (0.35 + base * 2.9) * spike;
};

const randomBusinessValues = (companyIndex: number, businessUnitIndex: number, monthIndex: number) => {
  const scale =
    companyScale(companyIndex) *
    BUSINESS_UNIT_REVENUE_FACTORS[businessUnitIndex] *
    monthSeasonality(monthIndex) *
    randomSkew();
  const revenue = Math.round(clamp(35_000 + scale * randomInt(120_000, 4_800_000), 20_000, 95_000_000));
  const customerCount = Math.round(clamp(8 + scale * randomInt(12, 2700), 1, 60_000));
  const projectCount = Math.round(
    clamp(Math.random() * customerCount * randomInt(2, 36) * 0.01 + scale * randomInt(0, 75), 0, 20_000)
  );
  const utilization = Math.round(clamp(18 + scale * 18 + Math.random() * 55, 5, 99.8) * 10) / 10;

  return {
    revenue,
    customerCount,
    projectCount,
    utilization
  };
};

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof MessageChannel === "function") {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
      return;
    }

    window.setTimeout(resolve, 0);
  });

const assertNotAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    const error = new Error("生成をキャンセルしました");
    error.name = "AbortError";
    throw error;
  }
};

const reportProgress = (
  onProgress: ((progress: GenerationProgress) => void) | undefined,
  startedAt: number,
  progress: Omit<GenerationProgress, "elapsedMs" | "percent">
) => {
  onProgress?.({
    ...progress,
    elapsedMs: performance.now() - startedAt,
    percent: progress.total === 0 ? 0 : Math.min(100, (progress.generated / progress.total) * 100)
  });
};

const createNumericArray = <T extends Uint8Array | Uint16Array | Uint32Array>(
  ArrayType: {
    readonly BYTES_PER_ELEMENT: number;
    new (buffer: ArrayBufferLike): T;
  },
  count: number,
  useSharedMemory: boolean
) => {
  const byteLength = count * ArrayType.BYTES_PER_ELEMENT;
  const buffer =
    useSharedMemory && typeof SharedArrayBuffer === "function"
      ? new SharedArrayBuffer(byteLength)
      : new ArrayBuffer(byteLength);
  return new ArrayType(buffer);
};

export function estimateColumnarBytes(count: number) {
  return count * COLUMNAR_BYTES_PER_RECORD;
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}MB`;
  }
  return `${bytes.toLocaleString("ja-JP")}B`;
}

export function generateBusinessRecords(count: number): BusinessRecord[] {
  const records = new Array<BusinessRecord>(count);

  for (let index = 0; index < count; index += 1) {
    const companyIndex = randomInt(0, COMPANIES.length - 1);
    const businessUnitIndex = randomInt(0, BUSINESS_UNITS.length - 1);
    const monthIndex = randomInt(0, MONTHS.length - 1);
    const company = COMPANIES[companyIndex];
    const values = randomBusinessValues(companyIndex, businessUnitIndex, monthIndex);

    records[index] = {
      id: index + 1,
      companyId: company.id,
      companyName: company.name,
      businessUnit: BUSINESS_UNITS[businessUnitIndex],
      month: MONTHS[monthIndex],
      revenue: values.revenue,
      customerCount: values.customerCount,
      projectCount: values.projectCount,
      utilization: values.utilization
    };
  }

  return records;
}

export function generateColumnarBusinessRecords(count: number): ColumnarBusinessRecords {
  const useSharedMemory =
    typeof SharedArrayBuffer === "function" &&
    typeof crossOriginIsolated === "boolean" &&
    crossOriginIsolated;

  const companyIds = createNumericArray(Uint8Array, count, useSharedMemory);
  const businessUnitIds = createNumericArray(Uint8Array, count, useSharedMemory);
  const monthIds = createNumericArray(Uint8Array, count, useSharedMemory);
  const revenues = createNumericArray(Uint32Array, count, useSharedMemory);
  const customerCounts = createNumericArray(Uint16Array, count, useSharedMemory);
  const projectCounts = createNumericArray(Uint16Array, count, useSharedMemory);
  const utilizationTenth = createNumericArray(Uint16Array, count, useSharedMemory);

  for (let index = 0; index < count; index += 1) {
    const companyIndex = randomInt(0, COMPANIES.length - 1);
    const businessUnitIndex = randomInt(0, BUSINESS_UNITS.length - 1);
    const monthIndex = randomInt(0, MONTHS.length - 1);
    const values = randomBusinessValues(companyIndex, businessUnitIndex, monthIndex);
    companyIds[index] = companyIndex;
    businessUnitIds[index] = businessUnitIndex;
    monthIds[index] = monthIndex;
    revenues[index] = values.revenue;
    customerCounts[index] = values.customerCount;
    projectCounts[index] = values.projectCount;
    utilizationTenth[index] = Math.round(values.utilization * 10);
  }

  return {
    kind: "columnar",
    count,
    sharedMemory: useSharedMemory,
    companyIds,
    businessUnitIds,
    monthIds,
    revenues,
    customerCounts,
    projectCounts,
    utilizationTenth
  };
}

export function generateBusinessDataset(count: number): BusinessDataset {
  if (count <= OBJECT_DATASET_LIMIT) {
    return {
      kind: "object",
      count,
      storageLabel: "Object配列",
      records: generateBusinessRecords(count)
    };
  }

  const records = generateColumnarBusinessRecords(count);

  return {
    kind: "columnar",
    count,
    storageLabel: records.sharedMemory ? "TypedArray + SharedArrayBuffer" : "TypedArray",
    records
  };
}

export async function generateBusinessDatasetProgressively({
  count,
  onProgress,
  signal
}: {
  count: number;
  onProgress?: (progress: GenerationProgress) => void;
  signal?: AbortSignal;
}): Promise<BusinessDataset> {
  const startedAt = performance.now();
  assertNotAborted(signal);
  reportProgress(onProgress, startedAt, {
    stage: "allocating",
    generated: 0,
    total: count,
    message: "メモリを確保中"
  });
  await yieldToBrowser();

  if (count <= OBJECT_DATASET_LIMIT) {
    const records = new Array<BusinessRecord>(count);
    const chunkSize = count >= 1_000_000 ? 50_000 : 10_000;

    for (let offset = 0; offset < count; offset += chunkSize) {
      assertNotAborted(signal);
      const limit = Math.min(count, offset + chunkSize);

      for (let index = offset; index < limit; index += 1) {
        const companyIndex = randomInt(0, COMPANIES.length - 1);
        const businessUnitIndex = randomInt(0, BUSINESS_UNITS.length - 1);
        const monthIndex = randomInt(0, MONTHS.length - 1);
        const company = COMPANIES[companyIndex];
        const values = randomBusinessValues(companyIndex, businessUnitIndex, monthIndex);

        records[index] = {
          id: index + 1,
          companyId: company.id,
          companyName: company.name,
          businessUnit: BUSINESS_UNITS[businessUnitIndex],
          month: MONTHS[monthIndex],
          revenue: values.revenue,
          customerCount: values.customerCount,
          projectCount: values.projectCount,
          utilization: values.utilization
        };
      }

      reportProgress(onProgress, startedAt, {
        stage: "generating",
        generated: limit,
        total: count,
        message: `${limit.toLocaleString()}件を生成済み`
      });
      await yieldToBrowser();
    }

    return {
      kind: "object",
      count,
      storageLabel: "Object配列",
      records
    };
  }

  const records: ColumnarBusinessRecords = {
    kind: "columnar",
    count,
    sharedMemory:
      typeof SharedArrayBuffer === "function" &&
      typeof crossOriginIsolated === "boolean" &&
      crossOriginIsolated,
    companyIds: createNumericArray(
      Uint8Array,
      count,
      typeof SharedArrayBuffer === "function" &&
        typeof crossOriginIsolated === "boolean" &&
        crossOriginIsolated
    ),
    businessUnitIds: createNumericArray(
      Uint8Array,
      count,
      typeof SharedArrayBuffer === "function" &&
        typeof crossOriginIsolated === "boolean" &&
        crossOriginIsolated
    ),
    monthIds: createNumericArray(
      Uint8Array,
      count,
      typeof SharedArrayBuffer === "function" &&
        typeof crossOriginIsolated === "boolean" &&
        crossOriginIsolated
    ),
    revenues: createNumericArray(
      Uint32Array,
      count,
      typeof SharedArrayBuffer === "function" &&
        typeof crossOriginIsolated === "boolean" &&
        crossOriginIsolated
    ),
    customerCounts: createNumericArray(
      Uint16Array,
      count,
      typeof SharedArrayBuffer === "function" &&
        typeof crossOriginIsolated === "boolean" &&
        crossOriginIsolated
    ),
    projectCounts: createNumericArray(
      Uint16Array,
      count,
      typeof SharedArrayBuffer === "function" &&
        typeof crossOriginIsolated === "boolean" &&
        crossOriginIsolated
    ),
    utilizationTenth: createNumericArray(
      Uint16Array,
      count,
      typeof SharedArrayBuffer === "function" &&
        typeof crossOriginIsolated === "boolean" &&
        crossOriginIsolated
    )
  };

  const chunkSize = count >= 20_000_000 ? 250_000 : 200_000;

  for (let offset = 0; offset < count; offset += chunkSize) {
    assertNotAborted(signal);
    const limit = Math.min(count, offset + chunkSize);

    for (let index = offset; index < limit; index += 1) {
      const companyIndex = randomInt(0, COMPANIES.length - 1);
      const businessUnitIndex = randomInt(0, BUSINESS_UNITS.length - 1);
      const monthIndex = randomInt(0, MONTHS.length - 1);
      const values = randomBusinessValues(companyIndex, businessUnitIndex, monthIndex);
      records.companyIds[index] = companyIndex;
      records.businessUnitIds[index] = businessUnitIndex;
      records.monthIds[index] = monthIndex;
      records.revenues[index] = values.revenue;
      records.customerCounts[index] = values.customerCount;
      records.projectCounts[index] = values.projectCount;
      records.utilizationTenth[index] = Math.round(values.utilization * 10);
    }

    reportProgress(onProgress, startedAt, {
      stage: "generating",
      generated: limit,
      total: count,
      message: `${limit.toLocaleString()}件を生成済み`
    });
    await yieldToBrowser();
  }

  return {
    kind: "columnar",
    count,
    storageLabel: records.sharedMemory ? "TypedArray + SharedArrayBuffer" : "TypedArray",
    records
  };
}

export function buildDataStructures(records: BusinessRecord[]): DataStructures {
  const mapStart = performance.now();
  const companyNameMap = new Map<number, string>();
  for (const company of COMPANIES) {
    companyNameMap.set(company.id, company.name);
  }
  const buildMapMs = performance.now() - mapStart;

  const indexStart = performance.now();
  const byCompany = new Map<number, BusinessRecord[]>();
  const byBusinessUnit = new Map<(typeof BUSINESS_UNITS)[number], BusinessRecord[]>();
  const byMonth = new Map<string, BusinessRecord[]>();

  for (const record of records) {
    let companyBucket = byCompany.get(record.companyId);
    if (!companyBucket) {
      companyBucket = [];
      byCompany.set(record.companyId, companyBucket);
    }
    companyBucket.push(record);

    let businessUnitBucket = byBusinessUnit.get(record.businessUnit);
    if (!businessUnitBucket) {
      businessUnitBucket = [];
      byBusinessUnit.set(record.businessUnit, businessUnitBucket);
    }
    businessUnitBucket.push(record);

    let monthBucket = byMonth.get(record.month);
    if (!monthBucket) {
      monthBucket = [];
      byMonth.set(record.month, monthBucket);
    }
    monthBucket.push(record);
  }

  const buildIndexMs = performance.now() - indexStart;

  return {
    companyNameMap,
    byCompany,
    byBusinessUnit,
    byMonth,
    buildMapMs,
    buildIndexMs
  };
}

const aggregateIndexOffset = (companyId: number, businessUnitId: number, monthId: number) => {
  return (companyId * BUSINESS_UNITS.length + businessUnitId) * MONTHS.length + monthId;
};

export function buildColumnarDataStructures(records: ColumnarBusinessRecords): ColumnarDataStructures {
  const mapStart = performance.now();
  const companyNameMap = new Map<number, string>();
  for (const company of COMPANIES) {
    companyNameMap.set(company.id, company.name);
  }
  const buildMapMs = performance.now() - mapStart;

  const indexStart = performance.now();
  const bucketCount = COMPANIES.length * BUSINESS_UNITS.length * MONTHS.length;
  const counts = new Uint32Array(bucketCount);
  const revenues = new Float64Array(bucketCount);
  const customerCounts = new Float64Array(bucketCount);
  const projectCounts = new Float64Array(bucketCount);
  const utilizationTenth = new Float64Array(bucketCount);

  for (let index = 0; index < records.count; index += 1) {
    const offset = aggregateIndexOffset(
      records.companyIds[index],
      records.businessUnitIds[index],
      records.monthIds[index]
    );
    counts[offset] += 1;
    revenues[offset] += records.revenues[index];
    customerCounts[offset] += records.customerCounts[index];
    projectCounts[offset] += records.projectCounts[index];
    utilizationTenth[offset] += records.utilizationTenth[index];
  }

  const buildIndexMs = performance.now() - indexStart;

  return {
    companyNameMap,
    aggregateIndex: {
      counts,
      revenues,
      customerCounts,
      projectCounts,
      utilizationTenth
    },
    buildMapMs,
    buildIndexMs
  };
}

export function buildDatasetStructures(dataset: BusinessDataset): DatasetStructures {
  if (dataset.kind === "object") {
    return {
      kind: "object",
      data: buildDataStructures(dataset.records)
    };
  }

  return {
    kind: "columnar",
    data: buildColumnarDataStructures(dataset.records)
  };
}

export async function buildDatasetStructuresProgressively({
  dataset,
  onProgress,
  signal
}: {
  dataset: BusinessDataset;
  onProgress?: (progress: GenerationProgress) => void;
  signal?: AbortSignal;
}): Promise<DatasetStructures> {
  const startedAt = performance.now();
  const total = dataset.count;
  assertNotAborted(signal);

  const mapStart = performance.now();
  const companyNameMap = new Map<number, string>();
  for (const company of COMPANIES) {
    companyNameMap.set(company.id, company.name);
  }
  const buildMapMs = performance.now() - mapStart;

  reportProgress(onProgress, startedAt, {
    stage: "indexing",
    generated: 0,
    total,
    message: "Indexを構築中"
  });
  await yieldToBrowser();

  if (dataset.kind === "object") {
    const indexStart = performance.now();
    const byCompany = new Map<number, BusinessRecord[]>();
    const byBusinessUnit = new Map<(typeof BUSINESS_UNITS)[number], BusinessRecord[]>();
    const byMonth = new Map<string, BusinessRecord[]>();
    const chunkSize = dataset.count >= 1_000_000 ? 100_000 : 25_000;

    for (let offset = 0; offset < dataset.count; offset += chunkSize) {
      assertNotAborted(signal);
      const limit = Math.min(dataset.count, offset + chunkSize);

      for (let index = offset; index < limit; index += 1) {
        const record = dataset.records[index];
        let companyBucket = byCompany.get(record.companyId);
        if (!companyBucket) {
          companyBucket = [];
          byCompany.set(record.companyId, companyBucket);
        }
        companyBucket.push(record);

        let businessUnitBucket = byBusinessUnit.get(record.businessUnit);
        if (!businessUnitBucket) {
          businessUnitBucket = [];
          byBusinessUnit.set(record.businessUnit, businessUnitBucket);
        }
        businessUnitBucket.push(record);

        let monthBucket = byMonth.get(record.month);
        if (!monthBucket) {
          monthBucket = [];
          byMonth.set(record.month, monthBucket);
        }
        monthBucket.push(record);
      }

      reportProgress(onProgress, startedAt, {
        stage: "indexing",
        generated: limit,
        total,
        message: `${limit.toLocaleString()}件をIndex化`
      });
      await yieldToBrowser();
    }

    return {
      kind: "object",
      data: {
        companyNameMap,
        byCompany,
        byBusinessUnit,
        byMonth,
        buildMapMs,
        buildIndexMs: performance.now() - indexStart
      }
    };
  }

  const indexStart = performance.now();
  const bucketCount = COMPANIES.length * BUSINESS_UNITS.length * MONTHS.length;
  const counts = new Uint32Array(bucketCount);
  const revenues = new Float64Array(bucketCount);
  const customerCounts = new Float64Array(bucketCount);
  const projectCounts = new Float64Array(bucketCount);
  const utilizationTenth = new Float64Array(bucketCount);
  const records = dataset.records;
  const chunkSize = dataset.count >= 20_000_000 ? 500_000 : 250_000;

  for (let offset = 0; offset < dataset.count; offset += chunkSize) {
    assertNotAborted(signal);
    const limit = Math.min(dataset.count, offset + chunkSize);

    for (let index = offset; index < limit; index += 1) {
      const aggregateOffset = aggregateIndexOffset(
        records.companyIds[index],
        records.businessUnitIds[index],
        records.monthIds[index]
      );
      counts[aggregateOffset] += 1;
      revenues[aggregateOffset] += records.revenues[index];
      customerCounts[aggregateOffset] += records.customerCounts[index];
      projectCounts[aggregateOffset] += records.projectCounts[index];
      utilizationTenth[aggregateOffset] += records.utilizationTenth[index];
    }

    reportProgress(onProgress, startedAt, {
      stage: "indexing",
      generated: limit,
      total,
      message: `${limit.toLocaleString()}件をIndex化`
    });
    await yieldToBrowser();
  }

  return {
    kind: "columnar",
    data: {
      companyNameMap,
      aggregateIndex: {
        counts,
        revenues,
        customerCounts,
        projectCounts,
        utilizationTenth
      },
      buildMapMs,
      buildIndexMs: performance.now() - indexStart
    }
  };
}
