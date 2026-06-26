import {
  type ColumnarDataStructures,
  type ColumnarBusinessRecords,
  BUSINESS_UNITS,
  type AnalysisResult,
  type ChartPoint,
  type DataStructures,
  type DatasetStructures,
  type BusinessUnit,
  type Filters,
  type Company,
  type OptimizationFlags,
  type BusinessDataset,
  type BusinessRecord
} from "../types";
import { MONTHS } from "./data";

type RunningAggregate = {
  count: number;
  revenue: number;
  customerCount: number;
  projectCount: number;
  utilization: number;
};

const emptyAggregate = (): RunningAggregate => ({
  count: 0,
  revenue: 0,
  customerCount: 0,
  projectCount: 0,
  utilization: 0
});

const addToAggregate = (aggregate: RunningAggregate, record: BusinessRecord) => {
  aggregate.count += 1;
  aggregate.revenue += record.revenue;
  aggregate.customerCount += record.customerCount;
  aggregate.projectCount += record.projectCount;
  aggregate.utilization += record.utilization;
};

const addValuesToAggregate = (
  aggregate: RunningAggregate,
  revenue: number,
  customerCount: number,
  projectCount: number,
  utilization: number
) => {
  aggregate.count += 1;
  aggregate.revenue += revenue;
  aggregate.customerCount += customerCount;
  aggregate.projectCount += projectCount;
  aggregate.utilization += utilization;
};

const mergeAggregate = (aggregate: RunningAggregate, values: RunningAggregate) => {
  aggregate.count += values.count;
  aggregate.revenue += values.revenue;
  aggregate.customerCount += values.customerCount;
  aggregate.projectCount += values.projectCount;
  aggregate.utilization += values.utilization;
};

const round = (value: number) => Math.round(value * 10) / 10;

const average = (total: number, count: number) => (count === 0 ? 0 : total / count);

const matchesFilters = (record: BusinessRecord, filters: Filters) => {
  return (
    (filters.companyId === "all" || record.companyId === filters.companyId) &&
    (filters.businessUnit === "all" || record.businessUnit === filters.businessUnit) &&
    (filters.month === "all" || record.month === filters.month)
  );
};

const filterIds = (filters: Filters) => {
  const companyId = filters.companyId === "all" ? "all" : filters.companyId - 1;
  const businessUnitId =
    filters.businessUnit === "all" ? "all" : BUSINESS_UNITS.indexOf(filters.businessUnit);
  const monthId = filters.month === "all" ? "all" : MONTHS.indexOf(filters.month);

  return {
    companyId,
    businessUnitId,
    monthId
  };
};

const matchesColumnarFilters = (
  records: ColumnarBusinessRecords,
  index: number,
  ids: ReturnType<typeof filterIds>
) => {
  return (
    (ids.companyId === "all" || records.companyIds[index] === ids.companyId) &&
    (ids.businessUnitId === "all" || records.businessUnitIds[index] === ids.businessUnitId) &&
    (ids.monthId === "all" || records.monthIds[index] === ids.monthId)
  );
};

const pickIndexedCandidates = (
  records: BusinessRecord[],
  filters: Filters,
  structures: DataStructures | null
) => {
  if (!structures) {
    return records;
  }

  const candidates: BusinessRecord[][] = [];

  if (filters.companyId !== "all") {
    candidates.push(structures.byCompany.get(filters.companyId) ?? []);
  }

  if (filters.businessUnit !== "all") {
    candidates.push(structures.byBusinessUnit.get(filters.businessUnit) ?? []);
  }

  if (filters.month !== "all") {
    candidates.push(structures.byMonth.get(filters.month) ?? []);
  }

  if (candidates.length === 0) {
    return records;
  }

  return candidates.reduce((smallest, candidate) =>
    candidate.length < smallest.length ? candidate : smallest
  );
};

export function analyzeRecords({
  records,
  filters,
  flags,
  structures,
  companies
}: {
  records: BusinessRecord[];
  filters: Filters;
  flags: Pick<OptimizationFlags, "useMap" | "useIndex">;
  structures: DataStructures | null;
  companies: Company[];
}): AnalysisResult {
  performance.mark("analysis-start");
  const totalStart = performance.now();
  const filterStart = performance.now();
  const candidates = flags.useIndex ? pickIndexedCandidates(records, filters, structures) : records;
  const filtered: BusinessRecord[] = [];

  for (const record of candidates) {
    if (matchesFilters(record, filters)) {
      filtered.push(record);
    }
  }

  const filterMs = performance.now() - filterStart;

  const averageStart = performance.now();
  const allAggregate = emptyAggregate();
  const businessUnitAggregates = new Map<BusinessUnit, RunningAggregate>();
  const companyAggregates = new Map<number, RunningAggregate>();
  const monthAggregates = new Map<string, RunningAggregate>();

  for (const businessUnit of BUSINESS_UNITS) {
    businessUnitAggregates.set(businessUnit, emptyAggregate());
  }

  for (const record of filtered) {
    addToAggregate(allAggregate, record);

    const businessUnitAggregate = businessUnitAggregates.get(record.businessUnit);
    if (businessUnitAggregate) {
      addToAggregate(businessUnitAggregate, record);
    }

    let companyAggregate = companyAggregates.get(record.companyId);
    if (!companyAggregate) {
      companyAggregate = emptyAggregate();
      companyAggregates.set(record.companyId, companyAggregate);
    }
    addToAggregate(companyAggregate, record);

    let monthAggregate = monthAggregates.get(record.month);
    if (!monthAggregate) {
      monthAggregate = emptyAggregate();
      monthAggregates.set(record.month, monthAggregate);
    }
    addToAggregate(monthAggregate, record);
  }

  const businessUnitRevenue: ChartPoint[] = Array.from(businessUnitAggregates.entries()).map(
    ([businessUnit, aggregate]) => ({
      name: businessUnit,
      value: round(average(aggregate.revenue, aggregate.count)),
      count: aggregate.count
    })
  );

  const projectCountByBusinessUnit: ChartPoint[] = Array.from(
    businessUnitAggregates.entries()
  ).map(([businessUnit, aggregate]) => ({
    name: businessUnit,
    value: round(average(aggregate.projectCount, aggregate.count)),
    count: aggregate.count
  }));

  const utilizationByBusinessUnit: ChartPoint[] = Array.from(
    businessUnitAggregates.entries()
  ).map(([businessUnit, aggregate]) => ({
    name: businessUnit,
    value: round(average(aggregate.utilization, aggregate.count)),
    count: aggregate.count
  }));

  const lookupStart = performance.now();
  const companyRevenue: ChartPoint[] = Array.from(companyAggregates.entries())
    .map(([companyId, aggregate]) => {
      const name = flags.useMap
        ? structures?.companyNameMap.get(companyId) ?? `会社 ${companyId}`
        : companies.find((company) => company.id === companyId)?.name ?? `会社 ${companyId}`;

      return {
        name,
        value: round(average(aggregate.revenue, aggregate.count)),
        count: aggregate.count
      };
    })
    .sort((left, right) => right.value - left.value)
    .slice(0, 12);
  const lookupMs = performance.now() - lookupStart;

  const utilizationByMonth: ChartPoint[] = Array.from(monthAggregates.entries())
    .map(([month, aggregate]) => ({
      name: month,
      value: round(average(aggregate.utilization, aggregate.count)),
      count: aggregate.count
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const customerCountByMonth: ChartPoint[] = Array.from(monthAggregates.entries())
    .map(([month, aggregate]) => ({
      name: month,
      value: round(average(aggregate.customerCount, aggregate.count)),
      count: aggregate.count
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const averageMs = performance.now() - averageStart;
  const totalMs = performance.now() - totalStart;
  performance.mark("analysis-end");
  performance.measure("analysis-total", "analysis-start", "analysis-end");

  const companyCount = companyAggregates.size || 1;

  return {
    businessUnitRevenue,
    companyRevenue,
    utilizationByMonth,
    customerCountByMonth,
    projectCountByBusinessUnit,
    utilizationByBusinessUnit,
    summary: {
      averageRevenue: round(average(allAggregate.revenue, allAggregate.count)),
      averageRevenuePerCompany: Math.round(allAggregate.revenue / companyCount),
      averageCustomerCount: round(average(allAggregate.customerCount, allAggregate.count)),
      averageProjectCount: round(average(allAggregate.projectCount, allAggregate.count)),
      averageUtilization: round(average(allAggregate.utilization, allAggregate.count)),
      totalRevenue: Math.round(allAggregate.revenue)
    },
    metrics: {
      filterMs,
      averageMs,
      chartMs: 0,
      totalMs,
      lookupMs,
      matchedRecords: filtered.length,
      scannedRecords: candidates.length,
      uiMaxBlockMs: 0
    }
  };
}

const aggregateIndexOffset = (companyId: number, businessUnitId: number, monthId: number) => {
  return (companyId * BUSINESS_UNITS.length + businessUnitId) * MONTHS.length + monthId;
};

const makeRange = (length: number) => Array.from({ length }, (_, index) => index);

const COMPANY_ID_RANGE = makeRange(100);
const BUSINESS_UNIT_ID_RANGE = makeRange(BUSINESS_UNITS.length);
const MONTH_ID_RANGE = makeRange(MONTHS.length);

function buildResultFromAggregates({
  allAggregate,
  businessUnitAggregates,
  companyAggregates,
  monthAggregates,
  companies,
  flags,
  structures,
  filterMs,
  averageMs,
  totalMs,
  matchedRecords,
  scannedRecords
}: {
  allAggregate: RunningAggregate;
  businessUnitAggregates: RunningAggregate[];
  companyAggregates: Map<number, RunningAggregate>;
  monthAggregates: Map<number, RunningAggregate>;
  companies: Company[];
  flags: Pick<OptimizationFlags, "useMap" | "useIndex">;
  structures: ColumnarDataStructures | null;
  filterMs: number;
  averageMs: number;
  totalMs: number;
  matchedRecords: number;
  scannedRecords: number;
}): AnalysisResult {
  const businessUnitRevenue: ChartPoint[] = BUSINESS_UNITS.map((businessUnit, index) => {
    const aggregate = businessUnitAggregates[index];
    return {
      name: businessUnit,
      value: round(average(aggregate.revenue, aggregate.count)),
      count: aggregate.count
    };
  });

  const projectCountByBusinessUnit: ChartPoint[] = BUSINESS_UNITS.map((businessUnit, index) => {
    const aggregate = businessUnitAggregates[index];
    return {
      name: businessUnit,
      value: round(average(aggregate.projectCount, aggregate.count)),
      count: aggregate.count
    };
  });

  const utilizationByBusinessUnit: ChartPoint[] = BUSINESS_UNITS.map((businessUnit, index) => {
    const aggregate = businessUnitAggregates[index];
    return {
      name: businessUnit,
      value: round(average(aggregate.utilization, aggregate.count)),
      count: aggregate.count
    };
  });

  const lookupStart = performance.now();
  const companyRevenue: ChartPoint[] = Array.from(companyAggregates.entries())
    .map(([companyIndex, aggregate]) => {
      const companyId = companyIndex + 1;
      const name = flags.useMap
        ? structures?.companyNameMap.get(companyId) ?? `会社 ${companyId}`
        : companies.find((company) => company.id === companyId)?.name ?? `会社 ${companyId}`;

      return {
        name,
        value: round(average(aggregate.revenue, aggregate.count)),
        count: aggregate.count
      };
    })
    .sort((left, right) => right.value - left.value)
    .slice(0, 12);
  const lookupMs = performance.now() - lookupStart;

  const utilizationByMonth: ChartPoint[] = Array.from(monthAggregates.entries())
    .map(([monthIndex, aggregate]) => ({
      name: MONTHS[monthIndex] ?? `month-${monthIndex + 1}`,
      value: round(average(aggregate.utilization, aggregate.count)),
      count: aggregate.count
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const customerCountByMonth: ChartPoint[] = Array.from(monthAggregates.entries())
    .map(([monthIndex, aggregate]) => ({
      name: MONTHS[monthIndex] ?? `month-${monthIndex + 1}`,
      value: round(average(aggregate.customerCount, aggregate.count)),
      count: aggregate.count
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const companyCount = companyAggregates.size || 1;

  return {
    businessUnitRevenue,
    companyRevenue,
    utilizationByMonth,
    customerCountByMonth,
    projectCountByBusinessUnit,
    utilizationByBusinessUnit,
    summary: {
      averageRevenue: round(average(allAggregate.revenue, allAggregate.count)),
      averageRevenuePerCompany: Math.round(allAggregate.revenue / companyCount),
      averageCustomerCount: round(average(allAggregate.customerCount, allAggregate.count)),
      averageProjectCount: round(average(allAggregate.projectCount, allAggregate.count)),
      averageUtilization: round(average(allAggregate.utilization, allAggregate.count)),
      totalRevenue: Math.round(allAggregate.revenue)
    },
    metrics: {
      filterMs,
      averageMs,
      chartMs: 0,
      totalMs,
      lookupMs,
      matchedRecords,
      scannedRecords,
      uiMaxBlockMs: 0
    }
  };
}

function analyzeColumnarByScan({
  records,
  filters,
  flags,
  structures,
  companies
}: {
  records: ColumnarBusinessRecords;
  filters: Filters;
  flags: Pick<OptimizationFlags, "useMap" | "useIndex">;
  structures: ColumnarDataStructures | null;
  companies: Company[];
}): AnalysisResult {
  const ids = filterIds(filters);
  const totalStart = performance.now();
  const filterStart = performance.now();
  let matchedRecords = 0;

  for (let index = 0; index < records.count; index += 1) {
    if (matchesColumnarFilters(records, index, ids)) {
      matchedRecords += 1;
    }
  }

  const filterMs = performance.now() - filterStart;
  const averageStart = performance.now();
  const allAggregate = emptyAggregate();
  const businessUnitAggregates = BUSINESS_UNITS.map(() => emptyAggregate());
  const companyAggregates = new Map<number, RunningAggregate>();
  const monthAggregates = new Map<number, RunningAggregate>();

  for (let index = 0; index < records.count; index += 1) {
    if (!matchesColumnarFilters(records, index, ids)) {
      continue;
    }

    const companyIndex = records.companyIds[index];
    const businessUnitIndex = records.businessUnitIds[index];
    const monthIndex = records.monthIds[index];
    const revenue = records.revenues[index];
    const customerCount = records.customerCounts[index];
    const projectCount = records.projectCounts[index];
    const utilization = records.utilizationTenth[index] / 10;

    addValuesToAggregate(allAggregate, revenue, customerCount, projectCount, utilization);
    addValuesToAggregate(
      businessUnitAggregates[businessUnitIndex],
      revenue,
      customerCount,
      projectCount,
      utilization
    );

    let companyAggregate = companyAggregates.get(companyIndex);
    if (!companyAggregate) {
      companyAggregate = emptyAggregate();
      companyAggregates.set(companyIndex, companyAggregate);
    }
    addValuesToAggregate(companyAggregate, revenue, customerCount, projectCount, utilization);

    let monthAggregate = monthAggregates.get(monthIndex);
    if (!monthAggregate) {
      monthAggregate = emptyAggregate();
      monthAggregates.set(monthIndex, monthAggregate);
    }
    addValuesToAggregate(monthAggregate, revenue, customerCount, projectCount, utilization);
  }

  const averageMs = performance.now() - averageStart;
  const totalMs = performance.now() - totalStart;

  return buildResultFromAggregates({
    allAggregate,
    businessUnitAggregates,
    companyAggregates,
    monthAggregates,
    companies,
    flags,
    structures,
    filterMs,
    averageMs,
    totalMs,
    matchedRecords,
    scannedRecords: records.count
  });
}

function analyzeColumnarByIndex({
  records,
  filters,
  flags,
  structures,
  companies
}: {
  records: ColumnarBusinessRecords;
  filters: Filters;
  flags: Pick<OptimizationFlags, "useMap" | "useIndex">;
  structures: ColumnarDataStructures | null;
  companies: Company[];
}): AnalysisResult {
  if (!structures) {
    return analyzeColumnarByScan({ records, filters, flags, structures, companies });
  }

  const ids = filterIds(filters);
  const totalStart = performance.now();
  const filterStart = performance.now();
  const companyIds: number[] =
    ids.companyId === "all" ? COMPANY_ID_RANGE : [Number(ids.companyId)];
  const businessUnitIds: number[] =
    ids.businessUnitId === "all" ? BUSINESS_UNIT_ID_RANGE : [Number(ids.businessUnitId)];
  const monthIds: number[] = ids.monthId === "all" ? MONTH_ID_RANGE : [Number(ids.monthId)];
  const scannedRecords = companyIds.length * businessUnitIds.length * monthIds.length;
  const filterMs = performance.now() - filterStart;

  const averageStart = performance.now();
  const allAggregate = emptyAggregate();
  const businessUnitAggregates = BUSINESS_UNITS.map(() => emptyAggregate());
  const companyAggregates = new Map<number, RunningAggregate>();
  const monthAggregates = new Map<number, RunningAggregate>();
  const index = structures.aggregateIndex;

  for (const companyIndex of companyIds) {
    for (const businessUnitIndex of businessUnitIds) {
      for (const monthIndex of monthIds) {
        const offset = aggregateIndexOffset(companyIndex, businessUnitIndex, monthIndex);
        const count = index.counts[offset];

        if (count === 0) {
          continue;
        }

        const aggregate = {
          count,
          revenue: index.revenues[offset],
          customerCount: index.customerCounts[offset],
          projectCount: index.projectCounts[offset],
          utilization: index.utilizationTenth[offset] / 10
        };

        mergeAggregate(allAggregate, aggregate);
        mergeAggregate(businessUnitAggregates[businessUnitIndex], aggregate);

        let companyAggregate = companyAggregates.get(companyIndex);
        if (!companyAggregate) {
          companyAggregate = emptyAggregate();
          companyAggregates.set(companyIndex, companyAggregate);
        }
        mergeAggregate(companyAggregate, aggregate);

        let monthAggregate = monthAggregates.get(monthIndex);
        if (!monthAggregate) {
          monthAggregate = emptyAggregate();
          monthAggregates.set(monthIndex, monthAggregate);
        }
        mergeAggregate(monthAggregate, aggregate);
      }
    }
  }

  const averageMs = performance.now() - averageStart;
  const totalMs = performance.now() - totalStart;

  return buildResultFromAggregates({
    allAggregate,
    businessUnitAggregates,
    companyAggregates,
    monthAggregates,
    companies,
    flags,
    structures,
    filterMs,
    averageMs,
    totalMs,
    matchedRecords: allAggregate.count,
    scannedRecords
  });
}

export function analyzeColumnarRecords({
  records,
  filters,
  flags,
  structures,
  companies
}: {
  records: ColumnarBusinessRecords;
  filters: Filters;
  flags: Pick<OptimizationFlags, "useMap" | "useIndex">;
  structures: ColumnarDataStructures | null;
  companies: Company[];
}): AnalysisResult {
  return flags.useIndex
    ? analyzeColumnarByIndex({ records, filters, flags, structures, companies })
    : analyzeColumnarByScan({ records, filters, flags, structures, companies });
}

export function analyzeDataset({
  dataset,
  filters,
  flags,
  structures,
  companies
}: {
  dataset: BusinessDataset;
  filters: Filters;
  flags: Pick<OptimizationFlags, "useMap" | "useIndex">;
  structures: DatasetStructures | null;
  companies: Company[];
}): AnalysisResult {
  if (dataset.kind === "object") {
    return analyzeRecords({
      records: dataset.records,
      filters,
      flags,
      structures: structures?.kind === "object" ? structures.data : null,
      companies
    });
  }

  return analyzeColumnarRecords({
    records: dataset.records,
    filters,
    flags,
    structures: structures?.kind === "columnar" ? structures.data : null,
    companies
  });
}
