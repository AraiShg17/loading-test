"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend as ChartJsLegend,
  LinearScale,
  LineElement,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip as ChartJsTooltip
} from "chart.js";
import type { ChartOptions, TooltipItem } from "chart.js";
import { Bar as ChartJsBar, Line as ChartJsLine, Radar as ChartJsRadar } from "react-chartjs-2";
import {
  Bar as RechartsBar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Legend,
  Line as RechartsLine,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { analyzeDataset } from "../lib/analyze";
import {
  buildDatasetStructuresProgressively,
  estimateColumnarBytes,
  formatBytes,
  generateBusinessDatasetProgressively,
  COMPANIES,
  MONTHS,
  RECORD_COUNT_OPTIONS
} from "../lib/data";
import {
  BUSINESS_UNITS,
  type AnalysisResult,
  type ChartPoint,
  type DatasetStructures,
  type Filters,
  type GenerationProgress,
  type HistoryRow,
  type OptimizationFlags,
  type BusinessDataset
} from "../types";

const initialFilters: Filters = {
  companyId: "all",
  businessUnit: "all",
  month: "all"
};

const initialFlags: OptimizationFlags = {
  useMemo: false,
  useWorker: false,
  useMap: false,
  useIndex: false
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  RadarController,
  Filler,
  ChartJsTooltip,
  ChartJsLegend
);

const initialGenerationProgress: GenerationProgress = {
  stage: "idle",
  generated: 0,
  total: 0,
  percent: 0,
  elapsedMs: 0,
  message: "待機中"
};

type WorkerStatus = "idle" | "initializing" | "ready" | "running" | "error";

type WorkerReadyMessage = {
  type: "ready";
  requestId: number;
  recordCount: number;
  setupMs: number;
  buildMapMs: number;
  buildIndexMs: number;
};

type WorkerResultMessage = {
  type: "result";
  requestId: number;
  result: AnalysisResult;
  workerComputeMs: number;
};

type WorkerErrorMessage = {
  type: "error";
  requestId: number;
  message: string;
};

type WorkerResponse = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage;

type PendingChartMeasurement = {
  result: AnalysisResult;
  label: string;
  chartRenderer: string;
  recordCount: number;
  memoHit: boolean;
  chartStart: number;
  uiMaxBlockMs: number;
  workerRoundTripMs?: number;
  workerSetupMs?: number;
};

type UiBlockMonitor = {
  stop: () => number;
};

const formatMs = (value: number | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  if (value >= 1000) {
    return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}ms`;
  }
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}ms`;
};

const formatNumber = (value: number) => {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
};

const makeCaseLabel = (flags: OptimizationFlags) => {
  const labels: string[] = [];
  if (flags.useMemo) labels.push("useMemo");
  if (flags.useMap) labels.push("Map");
  if (flags.useIndex) labels.push("Index");
  if (flags.useWorker) labels.push("Worker");
  return labels.length === 0 ? "なし" : labels.join(" + ");
};

const createUiBlockMonitor = (): UiBlockMonitor => {
  let active = true;
  let last = performance.now();
  let maxGap = 0;
  let frameId = 0;

  const tick = () => {
    if (!active) {
      return;
    }
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);

  return {
    stop: () => {
      active = false;
      cancelAnimationFrame(frameId);
      return Math.max(0, maxGap - 16.7);
    }
  };
};

export function PerformanceLab() {
  const [recordCount, setRecordCount] = useState<number>(RECORD_COUNT_OPTIONS[0]);
  const [dataset, setDataset] = useState<BusinessDataset | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [flags, setFlags] = useState<OptimizationFlags>(initialFlags);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMs, setGenerationMs] = useState<number | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("idle");
  const [workerSetupMs, setWorkerSetupMs] = useState<number | null>(null);
  const [workerMessage, setWorkerMessage] = useState("未初期化");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] =
    useState<GenerationProgress>(initialGenerationProgress);
  const [structures, setStructures] = useState<DatasetStructures | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const workerDataVersionRef = useRef<number | null>(null);
  const workerInitInFlightVersionRef = useRef<number | null>(null);
  const latestWorkerRequestRef = useRef<number | null>(null);
  const pendingWorkerStartedAtRef = useRef<number | null>(null);
  const pendingMonitorRef = useRef<UiBlockMonitor | null>(null);
  const pendingChartMeasurementRef = useRef<PendingChartMeasurement | null>(null);
  const lastMemoKeyRef = useRef<string>("");
  const workerAnalysisSignatureRef = useRef<string>("");
  const flagsRef = useRef(flags);
  const dataVersionRef = useRef(dataVersion);
  const recordsLengthRef = useRef(dataset?.count ?? 0);
  const workerSetupMsRef = useRef<number | null>(workerSetupMs);
  const generationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    flagsRef.current = flags;
  }, [flags]);

  useEffect(() => {
    dataVersionRef.current = dataVersion;
  }, [dataVersion]);

  useEffect(() => {
    recordsLengthRef.current = dataset?.count ?? 0;
  }, [dataset?.count]);

  useEffect(() => {
    workerSetupMsRef.current = workerSetupMs;
  }, [workerSetupMs]);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const timerId = window.setInterval(() => {
      setGenerationProgress((current) => ({
        ...current,
        elapsedMs: current.elapsedMs + 250
      }));
    }, 250);

    return () => window.clearInterval(timerId);
  }, [isGenerating]);

  const memoDependencyKey = useMemo(
    () =>
      JSON.stringify({
        dataVersion,
        filters,
        useMap: flags.useMap,
        useIndex: flags.useIndex
      }),
    [dataVersion, filters, flags.useMap, flags.useIndex]
  );

  const publishResult = useCallback(
    ({
      nextResult,
      label,
      memoHit,
      uiMaxBlockMs,
      workerRoundTripMs,
      workerSetupMs: nextWorkerSetupMs
    }: {
      nextResult: AnalysisResult;
      label: string;
      memoHit: boolean;
      uiMaxBlockMs: number;
      workerRoundTripMs?: number;
      workerSetupMs?: number;
    }) => {
      pendingChartMeasurementRef.current = {
        result: nextResult,
        label,
        chartRenderer: "Recharts + Chart.js",
        recordCount: recordsLengthRef.current,
        memoHit,
        chartStart: performance.now(),
        uiMaxBlockMs,
        workerRoundTripMs,
        workerSetupMs: nextWorkerSetupMs
      };
      setResult(nextResult);
    },
    []
  );

  const runSyncAnalysis = useCallback(
    (memoHit: boolean) => {
      if (!dataset) {
        return null;
      }

      const nextResult = analyzeDataset({
        dataset,
        filters,
        flags: {
          useMap: flags.useMap,
          useIndex: flags.useIndex
        },
        structures,
        companies: COMPANIES
      });
      const uiMaxBlockMs = Math.max(0, nextResult.metrics.totalMs - 16.7);

      return {
        nextResult,
        uiMaxBlockMs,
        memoHit
      };
    },
    [dataset, filters, flags.useIndex, flags.useMap, structures]
  );

  const memoizedAnalysis = useMemo(() => {
    if (!flags.useMemo || flags.useWorker || !dataset) {
      return null;
    }
    return runSyncAnalysis(false);
  }, [dataset, flags.useMemo, flags.useWorker, runSyncAnalysis]);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), {
      type: "module"
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.type === "ready") {
        if (message.requestId !== latestWorkerRequestRef.current) {
          return;
        }
        workerDataVersionRef.current = dataVersionRef.current;
        workerInitInFlightVersionRef.current = null;
        setWorkerStatus("ready");
        setWorkerSetupMs(message.setupMs);
        setWorkerMessage(
          `${message.recordCount.toLocaleString()}件をWorkerへ転送済み / Index ${formatMs(
            message.buildIndexMs
          )}`
        );
        return;
      }

      if (message.type === "result") {
        if (message.requestId !== latestWorkerRequestRef.current) {
          return;
        }
        const startedAt = pendingWorkerStartedAtRef.current ?? performance.now();
        const roundTripMs = performance.now() - startedAt;
        const uiMaxBlockMs = pendingMonitorRef.current?.stop() ?? 0;
        pendingMonitorRef.current = null;
        pendingWorkerStartedAtRef.current = null;
        setWorkerStatus("ready");
        setWorkerMessage(`Worker処理 ${formatMs(message.workerComputeMs)} / 往復 ${formatMs(roundTripMs)}`);

        const currentWorkerSetupMs = workerSetupMsRef.current ?? undefined;
        publishResult({
          nextResult: {
            ...message.result,
            metrics: {
              ...message.result.metrics,
              totalMs: message.workerComputeMs,
              workerRoundTripMs: roundTripMs,
              workerSetupMs: currentWorkerSetupMs
            }
          },
          label: makeCaseLabel(flagsRef.current),
          memoHit: false,
          uiMaxBlockMs,
          workerRoundTripMs: roundTripMs,
          workerSetupMs: currentWorkerSetupMs
        });
      }

      if (message.type === "error") {
        if (message.requestId !== latestWorkerRequestRef.current) {
          return;
        }
        pendingMonitorRef.current?.stop();
        pendingMonitorRef.current = null;
        setWorkerStatus("error");
        setWorkerMessage(message.message);
      }
    };

    worker.onerror = () => {
      setWorkerStatus("error");
      setWorkerMessage("Workerでエラーが発生しました");
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [publishResult]);

  useEffect(() => {
    if (!dataset || !flags.useWorker || !workerRef.current) {
      return;
    }

    if (workerDataVersionRef.current !== dataVersion) {
      if (workerInitInFlightVersionRef.current === dataVersion) {
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      latestWorkerRequestRef.current = requestId;
      workerInitInFlightVersionRef.current = dataVersion;
      setWorkerStatus("initializing");
      setWorkerSetupMs(null);
      setWorkerMessage("Workerへデータを転送し、Indexを構築中");
      workerRef.current.postMessage({
        type: "init",
        requestId,
        dataset
      });
      return;
    }

    if (workerStatus === "initializing" || workerStatus === "running") {
      return;
    }

    const analysisSignature = JSON.stringify({
      dataVersion,
      filters,
      useMap: flags.useMap,
      useIndex: flags.useIndex,
      renderNonce
    });

    if (workerAnalysisSignatureRef.current === analysisSignature) {
      return;
    }

    workerAnalysisSignatureRef.current = analysisSignature;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    latestWorkerRequestRef.current = requestId;
    pendingWorkerStartedAtRef.current = performance.now();
    pendingMonitorRef.current?.stop();
    pendingMonitorRef.current = createUiBlockMonitor();
    setWorkerStatus("running");
    setWorkerMessage("Workerでフィルターと集計を実行中");
    workerRef.current.postMessage({
      type: "analyze",
      requestId,
      filters,
      flags: {
        useMap: flags.useMap,
        useIndex: flags.useIndex
      }
    });
  }, [
    dataVersion,
    dataset,
    filters,
    flags.useIndex,
    flags.useMap,
    flags.useWorker,
    renderNonce,
    workerStatus
  ]);

  useEffect(() => {
    if (!dataset || flags.useWorker) {
      return;
    }

    if (flags.useMemo) {
      const memoHit = lastMemoKeyRef.current === memoDependencyKey;
      lastMemoKeyRef.current = memoDependencyKey;
      if (memoizedAnalysis) {
        publishResult({
          nextResult: memoizedAnalysis.nextResult,
          label: makeCaseLabel(flags),
          memoHit,
          uiMaxBlockMs: memoizedAnalysis.uiMaxBlockMs
        });
      }
      return;
    }

    const syncAnalysis = runSyncAnalysis(false);
    if (syncAnalysis) {
      publishResult({
        nextResult: syncAnalysis.nextResult,
        label: makeCaseLabel(flags),
        memoHit: false,
        uiMaxBlockMs: syncAnalysis.uiMaxBlockMs
      });
    }
  }, [
    flags,
    flags.useMemo ? 0 : renderNonce,
    memoDependencyKey,
    memoizedAnalysis,
    publishResult,
    dataset,
    runSyncAnalysis
  ]);

  useEffect(() => {
    if (!pendingChartMeasurementRef.current) {
      return;
    }

    let committed = false;

    const commitMeasurement = () => {
      if (committed) {
        return;
      }
      committed = true;
      const pending = pendingChartMeasurementRef.current;
      if (!pending) {
        return;
      }
      pendingChartMeasurementRef.current = null;
      const chartMs = performance.now() - pending.chartStart;
      const totalMs = pending.result.metrics.totalMs + chartMs;
      const timestamp = new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date());

      const nextResult: AnalysisResult = {
        ...pending.result,
        metrics: {
          ...pending.result.metrics,
          chartMs,
          totalMs,
          uiMaxBlockMs: pending.uiMaxBlockMs,
          workerRoundTripMs: pending.workerRoundTripMs,
          workerSetupMs: pending.workerSetupMs
        }
      };

      setResult(nextResult);
      setHistory((current) =>
        [
          {
            id: Date.now(),
            label: pending.label,
            chartRenderer: pending.chartRenderer,
            recordCount: pending.recordCount,
            memoHit: pending.memoHit,
            timestamp,
            ...nextResult.metrics
          },
          ...current
        ].slice(0, 30)
      );
    };

    const frameId = requestAnimationFrame(commitMeasurement);
    const timeoutId = window.setTimeout(commitMeasurement, 300);

    return () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [result]);

  const handleGenerate = async () => {
    generationAbortRef.current?.abort();
    const abortController = new AbortController();
    generationAbortRef.current = abortController;

    setIsGenerating(true);
    setDataset(null);
    setStructures(null);
    setResult(null);
    setGenerationMs(null);
    setGenerationError(null);
    setGenerationProgress({
      ...initialGenerationProgress,
      stage: "allocating",
      total: recordCount,
      message: "準備中"
    });
    setWorkerStatus("idle");
    setWorkerMessage("未初期化");
    workerDataVersionRef.current = null;
    workerInitInFlightVersionRef.current = null;
    workerAnalysisSignatureRef.current = "";
    pendingMonitorRef.current?.stop();
    pendingMonitorRef.current = null;

    try {
      const startedAt = performance.now();
      const nextDataset = await generateBusinessDatasetProgressively({
        count: recordCount,
        signal: abortController.signal,
        onProgress: setGenerationProgress
      });
      const nextStructures = await buildDatasetStructuresProgressively({
        dataset: nextDataset,
        signal: abortController.signal,
        onProgress: setGenerationProgress
      });
      const elapsed = performance.now() - startedAt;

      setDataset(nextDataset);
      setStructures(nextStructures);
      setGenerationMs(elapsed);
      setDataVersion((current) => current + 1);
      setFilters(initialFilters);
      setGenerationProgress({
        stage: "done",
        generated: recordCount,
        total: recordCount,
        percent: 100,
        elapsedMs: elapsed,
        message: "生成とIndex構築が完了"
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const message = isAbort
        ? "生成をキャンセルしました"
        : error instanceof Error
          ? error.message
          : "データ生成に失敗しました";
      setDataset(null);
      setStructures(null);
      setGenerationError(message);
      setGenerationProgress((current) => ({
        ...current,
        message,
        elapsedMs: current.elapsedMs
      }));
    } finally {
      if (generationAbortRef.current === abortController) {
        generationAbortRef.current = null;
      }
      setIsGenerating(false);
    }
  };

  const handleCancelGeneration = () => {
    generationAbortRef.current?.abort();
  };

  const updateFlag = (key: keyof OptimizationFlags) => {
    if (key === "useWorker") {
      workerAnalysisSignatureRef.current = "";
    }
    setFlags((current) => ({
      ...current,
      [key]: !current[key]
    }));
  };

  const updateCompanyFilter = (value: string) => {
    setFilters((current) => ({
      ...current,
      companyId: value === "all" ? "all" : Number(value)
    }));
  };

  const handleRerenderOnly = () => {
    setRenderNonce((current) => current + 1);

    if (flags.useMemo && !flags.useWorker && result) {
      publishResult({
        nextResult: {
          ...result,
          metrics: {
            ...result.metrics,
            filterMs: 0,
            averageMs: 0,
            lookupMs: 0,
            totalMs: 0
          }
        },
        label: makeCaseLabel(flags),
        memoHit: true,
        uiMaxBlockMs: 0
      });
    }
  };

  const analysisDisabled = !dataset || isGenerating;
  const activeLabel = makeCaseLabel(flags);
  const estimatedMemory =
    recordCount > 5_000_000 ? formatBytes(estimateColumnarBytes(recordCount)) : "Object配列";

  return (
    <main className="app-shell">
      <section className="sidebar" aria-label="操作パネル">
        <div className="title-block">
          <p className="eyebrow">Frontend performance lab</p>
          <h1>大量データ検証</h1>
          <p className="title-copy">filter / reduce / chart更新 / Workerを同じ画面で計測</p>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <h2>データ生成</h2>
          </div>
          <label className="field">
            <span>レコード数</span>
            <select
              value={recordCount}
              onChange={(event) => setRecordCount(Number(event.target.value))}
              disabled={isGenerating}
            >
              {RECORD_COUNT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option.toLocaleString()} 件
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="button" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? "処理中..." : "ランダムデータ生成"}
          </button>
          {isGenerating ? (
            <button className="secondary-button cancel-button" type="button" onClick={handleCancelGeneration}>
              キャンセル
            </button>
          ) : null}
          {isGenerating || generationProgress.stage !== "idle" ? (
            <div className="progress-panel" aria-live="polite">
              <div className="progress-row">
                <span className={`pulse-dot ${isGenerating ? "active" : ""}`} />
                <strong>{generationProgress.message}</strong>
                <span>{formatMs(generationProgress.elapsedMs)}</span>
              </div>
              <div className="progress-track" aria-label="データ生成進捗">
                <span style={{ width: `${generationProgress.percent}%` }} />
              </div>
              <div className="progress-meta">
                <span>
                  {generationProgress.generated.toLocaleString()} /{" "}
                  {generationProgress.total.toLocaleString()}件
                </span>
                <span>{generationProgress.percent.toFixed(1)}%</span>
              </div>
            </div>
          ) : null}
          <div className="metric-grid compact">
            <Metric label="生成時間" value={generationMs === null ? "-" : formatMs(generationMs)} />
            <Metric label="保持件数" value={`${(dataset?.count ?? 0).toLocaleString()}件`} />
            <Metric label="保存形式" value={dataset?.storageLabel ?? estimatedMemory} />
            <Metric label="概算メモリ" value={dataset?.kind === "columnar" ? formatBytes(estimateColumnarBytes(dataset.count)) : "-"} />
            <Metric label="Map構築" value={structures ? formatMs(structures.data.buildMapMs) : "-"} />
            <Metric label="Index構築" value={structures ? formatMs(structures.data.buildIndexMs) : "-"} />
          </div>
          {generationError ? <p className="error-text">{generationError}</p> : null}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>フィルター</h2>
          </div>
          <label className="field">
            <span>会社</span>
            <select
              value={filters.companyId}
              onChange={(event) => updateCompanyFilter(event.target.value)}
              disabled={analysisDisabled}
            >
              <option value="all">全会社</option>
              {COMPANIES.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>部門</span>
            <select
              value={filters.businessUnit}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  businessUnit: event.target.value as Filters["businessUnit"]
                }))
              }
              disabled={analysisDisabled}
            >
              <option value="all">全部門</option>
              {BUSINESS_UNITS.map((businessUnit) => (
                <option key={businessUnit} value={businessUnit}>
                  {businessUnit}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>年月</span>
            <select
              value={filters.month}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  month: event.target.value
                }))
              }
              disabled={analysisDisabled}
            >
              <option value="all">全期間</option>
              {MONTHS.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>改善機能</h2>
            <span className="case-pill">{activeLabel}</span>
          </div>
          <Toggle
            label="useMemo"
            detail="同じ条件の再描画で再計算を避ける"
            checked={flags.useMemo}
            onChange={() => updateFlag("useMemo")}
            disabled={analysisDisabled}
          />
          <Toggle
            label="Web Worker"
            detail="filterと集計を別スレッドへ移す"
            checked={flags.useWorker}
            onChange={() => updateFlag("useWorker")}
            disabled={analysisDisabled}
          />
          <Toggle
            label="Map"
            detail="会社名解決をfindからMap.getへ変更"
            checked={flags.useMap}
            onChange={() => updateFlag("useMap")}
            disabled={analysisDisabled}
          />
          <Toggle
            label="Index"
            detail="絞り込み候補を事前Mapから取得"
            checked={flags.useIndex}
            onChange={() => updateFlag("useIndex")}
            disabled={analysisDisabled}
          />
          <button
            className="secondary-button"
            type="button"
            onClick={handleRerenderOnly}
            disabled={analysisDisabled}
          >
            再レンダーだけ実行
          </button>
          <p className="helper-text">useMemoの比較は、このボタンで条件を変えずに再描画すると差が出ます。</p>
        </section>

        <section className="panel status-panel">
          <div className="panel-heading">
            <h2>Worker状態</h2>
            <span className={`status-dot ${workerStatus}`} />
          </div>
          <p>{workerMessage}</p>
          <div className="heartbeat" aria-hidden="true">
            <span />
          </div>
        </section>
      </section>

      <section className="content">
        <div className="summary-strip">
          <Metric label="Filter" value={result ? formatMs(result.metrics.filterMs) : "-"} />
          <Metric label="平均計算" value={result ? formatMs(result.metrics.averageMs) : "-"} />
          <Metric label="Chart更新" value={result ? formatMs(result.metrics.chartMs) : "-"} />
          <Metric label="合計" value={result ? formatMs(result.metrics.totalMs) : "-"} />
          <Metric label="UI最大停止" value={result ? formatMs(result.metrics.uiMaxBlockMs) : "-"} />
        </div>

        <section className="charts-grid">
          <article className="chart-panel wide">
            <div className="chart-header">
              <div>
                <h2>部門別売上平均</h2>
                <p>Recharts / 棒グラフ</p>
              </div>
              <span>{result?.metrics.matchedRecords.toLocaleString() ?? 0}件</span>
            </div>
            <div className="chart-area">
              {result ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={result.businessUnitRevenue}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万`} />
                    <Tooltip formatter={(value) => `${Number(value).toLocaleString()}円`} />
                    <RechartsBar dataKey="value" name="平均売上" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
          </article>

          <article className="chart-panel">
            <div className="chart-header">
              <div>
                <h2>会社別売上平均</h2>
                <p>Chart.js / 横棒グラフ / 上位12社</p>
              </div>
            </div>
            <div className="chart-area">
              {result ? (
                <ChartJsValueBar data={result.companyRevenue} label="平均売上" color="#0891b2" horizontal />
              ) : (
                <EmptyState />
              )}
            </div>
          </article>

          <article className="chart-panel">
            <div className="chart-header">
              <div>
                <h2>月別稼働率平均</h2>
                <p>Recharts / 折れ線グラフ</p>
              </div>
            </div>
            <div className="chart-area">
              {result ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={result.utilizationByMonth}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" minTickGap={24} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                    <Tooltip formatter={(value) => `${Number(value).toLocaleString()}%`} />
                    <Legend />
                    <RechartsLine
                      type="monotone"
                      dataKey="value"
                      name="稼働率"
                      stroke="#16a34a"
                      strokeWidth={2}
                      dot={false}
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
          </article>

          <article className="chart-panel">
            <div className="chart-header">
              <div>
                <h2>月別顧客数平均</h2>
                <p>Chart.js / 折れ線グラフ</p>
              </div>
            </div>
            <div className="chart-area">
              {result ? (
                <ChartJsLineChart
                  data={result.customerCountByMonth}
                  label="顧客数平均"
                  color="#dc2626"
                  fillColor="rgba(220, 38, 38, 0.14)"
                  suffix="件"
                  yMin={0}
                />
              ) : (
                <EmptyState />
              )}
            </div>
          </article>

          <article className="chart-panel">
            <div className="chart-header">
              <div>
                <h2>部門別案件数平均</h2>
                <p>Recharts / 棒グラフ</p>
              </div>
            </div>
            <div className="chart-area">
              {result ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={result.projectCountByBusinessUnit}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => `${value}件`} />
                    <Tooltip formatter={(value) => `${Number(value).toLocaleString()}件`} />
                    <RechartsBar dataKey="value" name="案件数平均" fill="#ca8a04" radius={[4, 4, 0, 0]} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
          </article>

          <article className="chart-panel">
            <div className="chart-header">
              <div>
                <h2>部門別稼働率平均</h2>
                <p>Chart.js / レーダーチャート</p>
              </div>
            </div>
            <div className="chart-area">
              {result ? (
                <ChartJsRadarChart
                  data={result.utilizationByBusinessUnit}
                  label="稼働率平均"
                  color="#db2777"
                  fillColor="rgba(219, 39, 119, 0.16)"
                  suffix="%"
                  max={100}
                />
              ) : (
                <EmptyState />
              )}
            </div>
          </article>
        </section>

        <section className="numbers-panel">
          <Metric label="全体平均売上" value={result ? `${formatNumber(result.summary.averageRevenue)}円` : "-"} />
          <Metric
            label="会社平均売上"
            value={result ? `${result.summary.averageRevenuePerCompany.toLocaleString()}円` : "-"}
          />
          <Metric label="顧客数平均" value={result ? `${formatNumber(result.summary.averageCustomerCount)}件` : "-"} />
          <Metric label="案件数平均" value={result ? `${formatNumber(result.summary.averageProjectCount)}件` : "-"} />
          <Metric label="稼働率平均" value={result ? `${formatNumber(result.summary.averageUtilization)}%` : "-"} />
          <Metric
            label="走査件数"
            value={result ? `${result.metrics.scannedRecords.toLocaleString()}件` : "-"}
          />
        </section>

        <section className="history-panel">
          <div className="history-heading">
            <div>
              <h2>比較履歴</h2>
              <p>フィルター変更やトグル変更ごとに最新30件を記録</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setHistory([])}>
              履歴クリア
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>改善</th>
                  <th>件数</th>
                  <th>対象</th>
                  <th>Filter</th>
                  <th>平均計算</th>
                  <th>Chart更新</th>
                  <th>描画</th>
                  <th>合計</th>
                  <th>Map lookup</th>
                  <th>UI最大停止</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="empty-cell">
                      データ生成後に計測結果がここへ残ります
                    </td>
                  </tr>
                ) : (
                  history.map((row) => (
                    <tr key={row.id}>
                      <td>{row.timestamp}</td>
                      <td>
                        {row.label}
                        {row.memoHit ? <span className="memo-hit">memo hit</span> : null}
                        {row.workerRoundTripMs ? (
                          <span className="memo-hit">往復 {formatMs(row.workerRoundTripMs)}</span>
                        ) : null}
                      </td>
                      <td>{row.recordCount.toLocaleString()}</td>
                      <td>{row.matchedRecords.toLocaleString()}</td>
                      <td>{formatMs(row.filterMs)}</td>
                      <td>{formatMs(row.averageMs)}</td>
                      <td>{formatMs(row.chartMs)}</td>
                      <td>{row.chartRenderer}</td>
                      <td>{formatMs(row.totalMs)}</td>
                      <td>{formatMs(row.lookupMs)}</td>
                      <td>{formatMs(row.uiMaxBlockMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChartJsValueBar({
  data,
  label,
  color,
  horizontal = false,
  suffix = "円"
}: {
  data: ChartPoint[];
  label: string;
  color: string;
  horizontal?: boolean;
  suffix?: string;
}) {
  const chartData = useMemo(
    () => ({
      labels: data.map((point) => point.name),
      datasets: [
        {
          label,
          data: data.map((point) => point.value),
          backgroundColor: color,
          borderRadius: 4,
          maxBarThickness: horizontal ? 18 : 42
        }
      ]
    }),
    [color, data, horizontal, label]
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      indexAxis: horizontal ? ("y" as const) : ("x" as const),
      plugins: {
        legend: {
          display: true
        },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<"bar">) => {
              const value = horizontal ? context.parsed.x : context.parsed.y;
              return `${label}: ${Number(value ?? 0).toLocaleString()}${suffix}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            callback: (value: string | number) => Number(value).toLocaleString()
          }
        },
        y: {
          ticks: {
            autoSkip: !horizontal
          }
        }
      }
    }),
    [horizontal, label, suffix]
  );

  return <ChartJsBar data={chartData} options={options} />;
}

function ChartJsLineChart({
  data,
  label,
  color,
  fillColor = "rgba(22, 163, 74, 0.16)",
  suffix = "%",
  yMin,
  yMax
}: {
  data: ChartPoint[];
  label: string;
  color: string;
  fillColor?: string;
  suffix?: string;
  yMin?: number;
  yMax?: number;
}) {
  const chartData = useMemo(
    () => ({
      labels: data.map((point) => point.name),
      datasets: [
        {
          label,
          data: data.map((point) => point.value),
          borderColor: color,
          backgroundColor: fillColor,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.28
        }
      ]
    }),
    [color, data, fillColor, label]
  );

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      plugins: {
        legend: {
          display: true
        },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<"line">) =>
              `${label}: ${Number(context.parsed.y ?? 0).toLocaleString()}${suffix}`
          }
        }
      },
      scales: {
        y: {
          min: yMin,
          max: yMax,
          ticks: {
            callback: (value: string | number) => `${value}${suffix}`
          }
        },
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true
          }
        }
      }
    }),
    [label, suffix, yMax, yMin]
  );

  return <ChartJsLine data={chartData} options={options} />;
}

function ChartJsRadarChart({
  data,
  label,
  color,
  fillColor,
  suffix,
  max
}: {
  data: ChartPoint[];
  label: string;
  color: string;
  fillColor: string;
  suffix: string;
  max: number;
}) {
  const chartData = useMemo(
    () => ({
      labels: data.map((point) => point.name),
      datasets: [
        {
          label,
          data: data.map((point) => point.value),
          borderColor: color,
          backgroundColor: fillColor,
          pointBackgroundColor: color,
          pointBorderColor: "#ffffff",
          borderWidth: 2
        }
      ]
    }),
    [color, data, fillColor, label]
  );

  const options = useMemo<ChartOptions<"radar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      plugins: {
        legend: {
          display: true
        },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<"radar">) =>
              `${label}: ${Number(context.parsed.r ?? 0).toLocaleString()}${suffix}`
          }
        }
      },
      scales: {
        r: {
          min: 0,
          max,
          ticks: {
            backdropColor: "transparent",
            callback: (value: string | number) => `${value}${suffix}`
          },
          pointLabels: {
            color: "#334155",
            font: {
              size: 12,
              weight: 700
            }
          },
          angleLines: {
            color: "rgba(148, 163, 184, 0.32)"
          },
          grid: {
            color: "rgba(148, 163, 184, 0.28)"
          }
        }
      }
    }),
    [label, max, suffix]
  );

  return <ChartJsRadar data={chartData} options={options} />;
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
  disabled
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <label className={`toggle ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="toggle-control" aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function EmptyState() {
  return <div className="empty-state">データを生成してください</div>;
}
