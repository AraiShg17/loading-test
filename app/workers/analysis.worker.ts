import { buildDatasetStructures, COMPANIES } from "../lib/data";
import { analyzeDataset } from "../lib/analyze";
import type { DatasetStructures, Filters, OptimizationFlags, BusinessDataset } from "../types";

type InitMessage = {
  type: "init";
  requestId: number;
  dataset: BusinessDataset;
};

type AnalyzeMessage = {
  type: "analyze";
  requestId: number;
  filters: Filters;
  flags: Pick<OptimizationFlags, "useMap" | "useIndex">;
};

type WorkerMessage = InitMessage | AnalyzeMessage;

let dataset: BusinessDataset | null = null;
let structures: DatasetStructures | null = null;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    const setupStart = performance.now();
    dataset = message.dataset;
    structures = buildDatasetStructures(dataset);
    const setupMs = performance.now() - setupStart;

    self.postMessage({
      type: "ready",
      requestId: message.requestId,
      recordCount: dataset.count,
      setupMs,
      buildMapMs: structures.data.buildMapMs,
      buildIndexMs: structures.data.buildIndexMs
    });
    return;
  }

  if (message.type === "analyze") {
    if (!dataset) {
      self.postMessage({
        type: "error",
        requestId: message.requestId,
        message: "Dataset is not initialized."
      });
      return;
    }

    const startedAt = performance.now();
    const result = analyzeDataset({
      dataset,
      filters: message.filters,
      flags: message.flags,
      structures,
      companies: COMPANIES
    });
    const workerComputeMs = performance.now() - startedAt;

    self.postMessage({
      type: "result",
      requestId: message.requestId,
      result,
      workerComputeMs
    });
  }
};

export {};
