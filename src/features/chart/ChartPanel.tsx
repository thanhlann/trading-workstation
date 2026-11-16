import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BaselineSeries,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { MarketSymbol } from '../../config/marketSymbols';
import { SYSTEM_CONFIG } from '../../config/system';
import { setChartData } from './chartData';
import type { Candle, CandleData, CandleTooltipData } from './candle.types';
import type { MarketStateOverlay, TradeChartOverlay } from './marketState.types';
import { getCandleTooltipData } from './candleTooltip';
import { initializeChart } from './chartSetup';
import { ChartPanelView } from './ChartPanelView';
import type { ChartPoiLabel } from './ChartPanelView.types';

interface ChartPanelProps {
  panelId: string;
  symbol: MarketSymbol;
  timeframe: string;
  subtitle: string;
  candlesData: CandleData[];
  currentCandle: Candle | null;
  chartOptions: () => DeepPartial<ChartOptions>;
  seriesOptions: CandlestickSeriesPartialOptions;
  statusLabel: string;
  toolbarContent?: ReactNode;
  markers?: SeriesMarker<Time>[];
  marketStateTimeframe?: 'htf' | 'ltf';
  marketState?: MarketStateOverlay | null;
  additionalMarketState?: MarketStateOverlay | null;
  focusAdditionalMarketState?: boolean;
  tradeOverlay?: TradeChartOverlay | null;
}

interface ChartDrawingSnapshot {
  marketState: MarketStateOverlay | null;
  additionalMarketState: MarketStateOverlay | null;
  tradeOverlay: TradeChartOverlay | null;
  marketStateTimeframe: 'htf' | 'ltf';
}

function getSnapshotPois(
  snapshot: ChartDrawingSnapshot,
): { poi: MarketStateOverlay['pois'][number]; isHtf: boolean }[] {
  if (snapshot.tradeOverlay) {
    const htfPois = snapshot.marketState?.pois
      ?? (snapshot.tradeOverlay.htf.poi ? [snapshot.tradeOverlay.htf.poi] : []);
    return [
      ...htfPois.map((poi) => ({ poi, isHtf: true })),
      ...(snapshot.tradeOverlay.ltf.poi
        ? [{ poi: snapshot.tradeOverlay.ltf.poi, isHtf: false }]
        : []),
    ];
  }

  return [
    ...(snapshot.marketState?.pois ?? []).map((poi) => ({
      poi,
      isHtf: false,
    })),
    ...(snapshot.additionalMarketState?.pois ?? []).map((poi) => ({ poi, isHtf: false })),
  ];
}

function getPoiEndTime(
  poi: MarketStateOverlay['pois'][number],
  candles: CandleData[],
): Time {
  return poi.endTime ?? candles[candles.length - 1]?.time ?? poi.startTime;
}

function getMarketStateVisibleRange(
  marketState: MarketStateOverlay,
  candles: CandleData[],
  includePoiRange = true,
) {
  const timestamps = [
    Number(marketState.marketStructure.eventPrice.time),
    Number(marketState.marketStructure.time),
    ...(includePoiRange
      ? marketState.pois.flatMap((poi) => [
        Number(poi.startTime),
        Number(getPoiEndTime(poi, candles)),
      ])
      : []),
  ];
  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps);
  const padding = Math.max((end - start) / 2, 60 * 60);

  return {
    from: (start - padding) as UTCTimestamp,
    to: (end + padding) as UTCTimestamp,
  };
}

function getTradeVisibleRange(
  trade: TradeChartOverlay,
  marketState?: MarketStateOverlay | null,
) {
  const timestamps = [
    Number(trade.htf.marketStructure.eventPrice.time),
    Number(trade.htf.marketStructure.time),
    Number(trade.ltf.marketStructure.eventPrice.time),
    Number(trade.ltf.marketStructure.time),
    Number(trade.trade.entry.time),
    Number(trade.trade.exit.time),
    ...(trade.htf.poi ? [Number(trade.htf.poi.startTime)] : []),
    ...(trade.ltf.poi ? [Number(trade.ltf.poi.startTime)] : []),
    ...(trade.ltf.sweep ? [Number(trade.ltf.sweep.time)] : []),
    ...(marketState?.pois.flatMap((poi) => [
      Number(poi.startTime),
      Number(poi.endTime ?? poi.startTime),
    ]) ?? []),
  ];
  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps);
  const padding = Math.max((end - start) / 4, 3 * 60 * 60);

  return {
    from: (start - padding) as UTCTimestamp,
    to: (end + padding) as UTCTimestamp,
  };
}

function getTradeRangeAroundCurrentView(
  trade: TradeChartOverlay,
  currentRange: { from: Time; to: Time },
) {
  const from = Number(currentRange.from);
  const to = Number(currentRange.to);
  const tradeTime = Number(trade.ltf.marketStructure.time);
  const width = to - from;

  if (tradeTime >= from && tradeTime <= to) return currentRange;

  const nextTo = tradeTime + width * 0.2;
  return {
    from: (nextTo - width) as UTCTimestamp,
    to: nextTo as UTCTimestamp,
  };
}

function getMarketStateLabelTime(
  candles: CandleData[],
  startTime: Time,
  endTime: Time,
): Time {
  const start = Number(startTime);
  const end = Number(endTime);
  const midpoint = (start + end) / 2;
  let closestTime: Time | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const candle of candles) {
    const time = Number(candle.time);
    if (time <= start || time >= end) continue;

    const distance = Math.abs(time - midpoint);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestTime = candle.time;
    }
  }

  return closestTime ?? Math.floor(midpoint) as UTCTimestamp;
}

function getPoiLineColor(poi: MarketStateOverlay['pois'][number]): string {
  const color = poi.type === 'FVG'
    ? '#8b5cf6'
    : poi.direction === 'BULLISH'
      ? '#20b887'
      : '#ef626c';
  return color;
}

function getPoiLineColorWithOpacity(
  poi: MarketStateOverlay['pois'][number],
  opacity: number,
): string {
  const color = getPoiLineColor(poi);
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function getPoiFillColor(
  poi: MarketStateOverlay['pois'][number],
  opacity = 0.14,
): string {
  if (poi.type === 'FVG') return `rgba(139, 92, 246, ${opacity})`;
  return poi.direction === 'BULLISH'
    ? `rgba(32, 184, 135, ${opacity})`
    : `rgba(239, 98, 108, ${opacity})`;
}

function getTradePoiLabel(
  chart: IChartApi,
  candles: ISeriesApi<'Candlestick'>,
  chartHost: HTMLDivElement,
  candlesData: CandleData[],
  poi: MarketStateOverlay['pois'][number] | null,
  timeframe: ChartPoiLabel['timeframe'],
): ChartPoiLabel | null {
  if (!poi) return null;

  const visibleRange = chart.timeScale().getVisibleRange();
  if (!visibleRange) return null;

  const labelStart = Math.max(Number(visibleRange.from), Number(poi.startTime));
  const labelEnd = Math.min(Number(visibleRange.to), Number(getPoiEndTime(poi, candlesData)));
  if (labelStart > labelEnd) return null;

  const labelTime = getMarketStateLabelTime(
    candlesData,
    labelStart as UTCTimestamp,
    labelEnd as UTCTimestamp,
  );
  const left = chart.timeScale().timeToCoordinate(labelTime);
  const top = candles.priceToCoordinate(poi.high);
  if (
    left === null
    || top === null
    || left < 0
    || left > chartHost.clientWidth
    || top < 0
    || top > chartHost.clientHeight
  ) {
    return null;
  }

  return {
    timeframe,
    text: `${poi.type === 'FVG'
      ? timeframe === 'ltf' ? 'fvg' : 'FVG'
      : timeframe === 'ltf' ? 'order block' : 'OB'}: ${poi.score.toFixed(1)}`,
    color: timeframe === 'htf'
      ? getPoiLineColorWithOpacity(poi, 0.58)
      : getPoiLineColor(poi),
    left,
    top,
  };
}

export function ChartPanel({
  panelId,
  symbol,
  timeframe,
  subtitle,
  candlesData,
  currentCandle,
  chartOptions,
  seriesOptions,
  statusLabel,
  toolbarContent,
  markers,
  marketStateTimeframe = timeframe === '1h' ? 'htf' : 'ltf',
  marketState,
  additionalMarketState,
  focusAdditionalMarketState = false,
  tradeOverlay,
}: ChartPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const marketStructureRef = useRef<ISeriesApi<'Line'> | null>(null);
  const additionalMarketStructureRef = useRef<ISeriesApi<'Line'> | null>(null);
  const marketStructureSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const stopLossSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const poiSeriesRef = useRef<ISeriesApi<'Baseline'>[]>([]);
  const marketStateRangeRef = useRef<{ from: Time; to: Time } | null>(null);
  const hasTradeRangeRef = useRef(false);
  const candlesDataRef = useRef(candlesData);
  const hasInitialDataRef = useRef(false);
  const previousDataLengthRef = useRef(0);
  const [showSwings, setShowSwings] = useState(false);
  const [showFVG, setShowFVG] = useState(true);
  const [showOB, setShowOB] = useState(true);
  const [keepDraw, setKeepDraw] = useState(false);
  const [preservedDrawings, setPreservedDrawings] = useState<ChartDrawingSnapshot[]>([]);
  const previousDrawingRef = useRef<{ key: string; snapshot: ChartDrawingSnapshot } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [poiLabels, setPoiLabels] = useState<ChartPoiLabel[]>([]);
  const [poiLabelRevision, setPoiLabelRevision] = useState(0);
  const [selectedCandle, setSelectedCandle] = useState<{
    data: CandleTooltipData;
    left: number;
    top: number;
  } | null>(null);

  candlesDataRef.current = candlesData;

  useEffect(() => {
    const snapshot: ChartDrawingSnapshot = {
      marketState: marketState ?? null,
      additionalMarketState: additionalMarketState ?? null,
      tradeOverlay: tradeOverlay ?? null,
      marketStateTimeframe,
    };
    const key = JSON.stringify({ symbol, timeframe, snapshot });
    const previousDrawing = previousDrawingRef.current;
    const hasPreviousDrawing = previousDrawing !== null && (
      previousDrawing.snapshot.marketState !== null
      || previousDrawing.snapshot.additionalMarketState !== null
      || previousDrawing.snapshot.tradeOverlay !== null
    );

    if (keepDraw && previousDrawing && previousDrawing.key !== key && hasPreviousDrawing) {
      setPreservedDrawings((drawings) => [...drawings, previousDrawing.snapshot]);
    } else if (!keepDraw) {
      setPreservedDrawings((drawings) => drawings.length > 0 ? [] : drawings);
    }

    previousDrawingRef.current = { key, snapshot };
  }, [
    additionalMarketState,
    keepDraw,
    marketState,
    marketStateTimeframe,
    symbol,
    timeframe,
    tradeOverlay,
  ]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!hostRef.current) return;
    const { chart, candles } = initializeChart(
      hostRef.current,
      chartOptions(),
      seriesOptions,
    );
    chartRef.current = chart;
    candlesRef.current = candles;
    markersRef.current = createSeriesMarkers(candles, markers ?? []);
    const timeScale = chart.timeScale();
    let poiLabelUpdateFrame: number | null = null;
    const schedulePoiLabelUpdate = () => {
      if (poiLabelUpdateFrame !== null) return;
      poiLabelUpdateFrame = window.requestAnimationFrame(() => {
        poiLabelUpdateFrame = null;
        setPoiLabelRevision((revision) => revision + 1);
      });
    };
    const onVisibleTimeRangeChange = (range: { from: Time; to: Time } | null) => {
      marketStateRangeRef.current = range;
      schedulePoiLabelUpdate();
    };
    timeScale.subscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons > 0) schedulePoiLabelUpdate();
    };
    const onWheel = () => schedulePoiLabelUpdate();
    hostRef.current.addEventListener('pointermove', onPointerMove);
    hostRef.current.addEventListener('wheel', onWheel, { passive: true });
    const marketStructure = chart.addSeries(LineSeries, {
      color: '#20b887',
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const stopLoss = chart.addSeries(LineSeries, {
      color: '#ef626c',
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    stopLossSeriesRef.current = [stopLoss];
    marketStructureRef.current = marketStructure;
    const additionalMarketStructure = chart.addSeries(LineSeries, {
      color: '#ef626c',
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    additionalMarketStructureRef.current = additionalMarketStructure;
    marketStructureSeriesRef.current = [
      marketStructure,
      additionalMarketStructure,
    ];
    const onChartClick = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (param.time === undefined || !param.point || !hostRef.current) {
        setSelectedCandle(null);
        return;
      }

      const data = candlesDataRef.current;
      const index = data.findIndex((candle) => candle.time === param.time);
      if (index < 0) {
        setSelectedCandle(null);
        return;
      }

      const tooltipWidth = Math.min(282, hostRef.current.clientWidth - 16);
      const tooltipHeight = 180;
      setSelectedCandle({
        data: getCandleTooltipData(data, index),
        left: Math.max(8, Math.min(param.point.x + 12, hostRef.current.clientWidth - tooltipWidth - 8)),
        top: Math.max(8, Math.min(param.point.y + 12, hostRef.current.clientHeight - tooltipHeight - 8)),
      });
    };
    chart.subscribeClick(onChartClick);

    const resizeObserver = new ResizeObserver(() => {
      if (!hasInitialDataRef.current) return;
      const visibleRange = marketStateRangeRef.current;
      if (visibleRange) {
        chart.timeScale().setVisibleRange(visibleRange);
      } else {
        chart.timeScale().fitContent();
      }
      schedulePoiLabelUpdate();
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      resizeObserver.disconnect();
      hostRef.current?.removeEventListener('pointermove', onPointerMove);
      hostRef.current?.removeEventListener('wheel', onWheel);
      if (poiLabelUpdateFrame !== null) {
        window.cancelAnimationFrame(poiLabelUpdateFrame);
      }
      markersRef.current?.detach();
      markersRef.current = null;
      timeScale.unsubscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
      for (const series of poiSeriesRef.current) {
        chart.removeSeries(series);
      }
      poiSeriesRef.current = [];
      marketStructureSeriesRef.current = [];
      stopLossSeriesRef.current = [];
      marketStructureRef.current = null;
      additionalMarketStructureRef.current = null;
      marketStateRangeRef.current = null;
      chart.unsubscribeClick(onChartClick);
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const stopLossSeries = stopLossSeriesRef.current;
    if (!chart || stopLossSeries.length === 0) return;

    const currentDrawing: ChartDrawingSnapshot = {
      marketState: marketState ?? null,
      additionalMarketState: additionalMarketState ?? null,
      tradeOverlay: tradeOverlay ?? null,
      marketStateTimeframe,
    };
    const drawings = keepDraw
      ? [...preservedDrawings, currentDrawing]
      : [currentDrawing];
    const tradeOverlays = drawings.flatMap((drawing) => (
      drawing.tradeOverlay ? [drawing.tradeOverlay] : []
    ));
    tradeOverlays.forEach((overlay, index) => {
      let series = stopLossSeries[index];
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: '#ef626c',
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        stopLossSeries.push(series);
      }

      const { entry, exit } = overlay.trade;
      series.setData(
        Number(exit.time) > Number(entry.time)
          ? [
            { time: entry.time, value: exit.stopLoss },
            { time: exit.time, value: exit.stopLoss },
          ]
          : [],
      );
    });
    for (const series of stopLossSeries.slice(tradeOverlays.length)) {
      series.setData([]);
    }
  }, [
    additionalMarketState,
    keepDraw,
    marketState,
    marketStateTimeframe,
    preservedDrawings,
    timeframe,
    tradeOverlay,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const structureSeries = marketStructureSeriesRef.current;
    if (!chart || structureSeries.length === 0) return;

    for (const series of structureSeries) {
      series.setData([]);
    }
    for (const series of poiSeriesRef.current) {
      chart.removeSeries(series);
    }
    poiSeriesRef.current = [];

    const currentDrawing: ChartDrawingSnapshot = {
      marketState: marketState ?? null,
      additionalMarketState: additionalMarketState ?? null,
      tradeOverlay: tradeOverlay ?? null,
      marketStateTimeframe,
    };
    const drawings = keepDraw
      ? [...preservedDrawings, currentDrawing]
      : [currentDrawing];
    if (
      !drawings.some((drawing) => (
        drawing.marketState
        || drawing.additionalMarketState
        || drawing.tradeOverlay
      ))
      || candlesData.length === 0
    ) {
      return;
    }

    const structures: MarketStateOverlay['marketStructure'][] = [];
    for (const drawing of drawings) {
      const structure = drawing.marketState?.marketStructure
        ?? drawing.tradeOverlay?.htf.marketStructure;
      const additionalStructure = drawing.additionalMarketState?.marketStructure
        ?? drawing.tradeOverlay?.ltf.marketStructure;
      if (structure) structures.push(structure);
      if (additionalStructure) structures.push(additionalStructure);
    }
    structures.forEach((structure, index) => {
      let series = structureSeries[index];
      if (!series) {
        series = chart.addSeries(LineSeries, {
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        structureSeries.push(series);
      }
      series.applyOptions({
        color: structure.bias === 'BEARISH' ? '#ef626c' : '#20b887',
        lineStyle: LineStyle.Dashed,
      });
      const labelTime = getMarketStateLabelTime(
        candlesData,
        structure.eventPrice.time,
        structure.time,
      );
      series.setData([
        { time: structure.eventPrice.time, value: structure.eventPrice.price },
        { time: labelTime, value: structure.eventPrice.price },
        { time: structure.time, value: structure.eventPrice.price },
      ]);
    });
    for (const series of structureSeries.slice(structures.length)) {
      series.setData([]);
    }

    const rangeMarketState = focusAdditionalMarketState
      ? additionalMarketState ?? marketState
      : marketState;
    const marketStateVisibleRange = rangeMarketState
      ? getMarketStateVisibleRange(rangeMarketState, candlesData, !focusAdditionalMarketState)
      : null;
    if (marketStateVisibleRange) marketStateRangeRef.current = marketStateVisibleRange;

    if (!tradeOverlay) {
      const visiblePois = drawings
        .flatMap(getSnapshotPois)
        .filter(({ poi }) => (poi.type === 'FVG' ? showFVG : showOB));
      for (const { poi } of visiblePois) {
        const endTime = getPoiEndTime(poi, candlesData);
        const color = getPoiFillColor(poi);
        const lineColor = getPoiLineColor(poi);
        const series = chart.addSeries(BaselineSeries, {
          baseValue: { type: 'price', price: poi.low },
          topLineColor: lineColor,
          bottomLineColor: lineColor,
          topFillColor1: color,
          topFillColor2: color,
          bottomFillColor1: color,
          bottomFillColor2: color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData([
          { time: poi.startTime, value: poi.high },
          { time: endTime, value: poi.high },
        ]);
        poiSeriesRef.current.push(series);
      }
    }

    if (marketStateVisibleRange && hasInitialDataRef.current) {
      chart.timeScale().setVisibleRange(marketStateVisibleRange);
    }
  }, [
    additionalMarketState,
    candlesData,
    focusAdditionalMarketState,
    keepDraw,
    marketState,
    marketStateTimeframe,
    preservedDrawings,
    showFVG,
    showOB,
    tradeOverlay,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!tradeOverlay) {
      hasTradeRangeRef.current = false;
      if (!marketState) {
        marketStateRangeRef.current = null;
      }
      return;
    }

    if (candlesData.length === 0) return;

    const timeScale = chart.timeScale();
    const currentRange = timeScale.getVisibleRange();
    const visibleRange = hasTradeRangeRef.current && currentRange
      ? getTradeRangeAroundCurrentView(tradeOverlay, currentRange)
      : getTradeVisibleRange(tradeOverlay, marketState);
    marketStateRangeRef.current = visibleRange;
    hasTradeRangeRef.current = true;
    const rangeChanged = !currentRange
      || currentRange.from !== visibleRange.from
      || currentRange.to !== visibleRange.to;
    if (hasInitialDataRef.current && rangeChanged) {
      timeScale.setVisibleRange(visibleRange);
    }
  }, [candlesData, marketState, tradeOverlay]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!tradeOverlay) return;

    for (const series of poiSeriesRef.current) {
      chart.removeSeries(series);
    }
    poiSeriesRef.current = [];

    const currentDrawing: ChartDrawingSnapshot = {
      marketState: marketState ?? null,
      additionalMarketState: additionalMarketState ?? null,
      tradeOverlay,
      marketStateTimeframe,
    };
    const drawings = keepDraw
      ? [...preservedDrawings, currentDrawing]
      : [currentDrawing];
    const tradePois = drawings
      .flatMap(getSnapshotPois)
      .filter(({ poi }) => (poi.type === 'FVG' ? showFVG : showOB));
    for (const { poi, isHtf } of tradePois) {
      const endTime = getPoiEndTime(poi, candlesData);
      const color = getPoiFillColor(poi, isHtf ? 0.06 : 0.14);
      const lineColor = isHtf
        ? getPoiLineColorWithOpacity(poi, 0.5)
        : getPoiLineColor(poi);
      const series = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: poi.low },
        topLineColor: lineColor,
        bottomLineColor: lineColor,
        topFillColor1: color,
        topFillColor2: color,
        bottomFillColor1: color,
        bottomFillColor2: color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData([
        { time: poi.startTime, value: poi.high },
        { time: endTime, value: poi.high },
      ]);
      poiSeriesRef.current.push(series);
    }
  }, [
    additionalMarketState,
    candlesData,
    keepDraw,
    marketState,
    marketStateTimeframe,
    preservedDrawings,
    showFVG,
    showOB,
    tradeOverlay,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    const chartHost = hostRef.current;
    const labels = chart && candles && chartHost && tradeOverlay
      ? [
        ...(!marketState
          ? [{ poi: tradeOverlay.htf.poi, timeframe: 'htf' as const }]
          : []),
        { poi: tradeOverlay.ltf.poi, timeframe: 'ltf' as const },
      ].flatMap(({ poi, timeframe }) => {
        if (!poi || (poi.type === 'FVG' ? !showFVG : !showOB)) return [];
        const label = getTradePoiLabel(
          chart,
          candles,
          chartHost,
          candlesData,
          poi,
          timeframe,
        );
        return label ? [label] : [];
      })
      : [];
    setPoiLabels((current) => (
      current.length === labels.length
      && current.every((label, index) => (
        label.timeframe === labels[index].timeframe
        && label.text === labels[index].text
        && label.color === labels[index].color
        && label.left === labels[index].left
        && label.top === labels[index].top
      ))
        ? current
        : labels
    ));
  }, [candlesData, poiLabelRevision, showFVG, showOB, tradeOverlay]);

  useEffect(() => {
    candlesRef.current?.setData([]);
    hasInitialDataRef.current = false;
    previousDataLengthRef.current = 0;
    setSelectedCandle(null);
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!chartRef.current || !candlesRef.current || candlesData.length === 0) return;
    const targetVisibleRange = marketStateRangeRef.current;
    if (!hasInitialDataRef.current) {
      setChartData(chartRef.current, candlesRef.current, candlesData);
      hasInitialDataRef.current = true;
    } else if (candlesData.length < previousDataLengthRef.current) {
      candlesRef.current.setData(candlesData);
    } else {
      candlesRef.current.update(candlesData[candlesData.length - 1]);
    }

    previousDataLengthRef.current = candlesData.length;
    const visibleRange = targetVisibleRange ?? marketStateRangeRef.current;
    if (visibleRange) {
      marketStateRangeRef.current = visibleRange;
      chartRef.current.timeScale().setVisibleRange(visibleRange);
    }
  }, [candlesData]);

  useEffect(() => {
    const currentDrawing: ChartDrawingSnapshot = {
      marketState: marketState ?? null,
      additionalMarketState: additionalMarketState ?? null,
      tradeOverlay: tradeOverlay ?? null,
      marketStateTimeframe,
    };
    const drawings = keepDraw
      ? [...preservedDrawings, currentDrawing]
      : [currentDrawing];
    const marketStateMarkers: SeriesMarker<Time>[] = drawings.flatMap((drawing) => {
      const state = drawing.marketState;
      if (!state) return [];
      return [
        {
          time: getMarketStateLabelTime(
            candlesData,
            state.marketStructure.eventPrice.time,
            state.marketStructure.time,
          ),
          position: state.marketStructure.bias === 'BEARISH'
            ? 'atPriceBottom' as const
            : 'atPriceTop' as const,
          price: state.marketStructure.eventPrice.price,
          shape: 'circle' as const,
          color: state.marketStructure.bias === 'BEARISH' ? '#ef626c' : '#20b887',
          text: `${drawing.marketStateTimeframe === 'htf'
            ? state.marketStructure.event.toUpperCase()
            : state.marketStructure.event.toLowerCase()}: ${state.marketStructure.score.toFixed(2)}`,
          size: 0,
        },
        ...state.pois
          .filter((poi) => (poi.type === 'FVG' ? showFVG : showOB))
          .map((poi) => ({
            time: getMarketStateLabelTime(candlesData, poi.startTime, getPoiEndTime(poi, candlesData)),
            position: 'atPriceMiddle' as const,
            price: poi.high,
            shape: 'circle' as const,
            color: getPoiLineColor(poi),
            text: `${drawing.marketStateTimeframe === 'htf'
              ? poi.type === 'FVG' ? 'FVG' : 'OB'
              : poi.type === 'FVG' ? 'fvg' : 'ob'}: ${poi.score.toFixed(1)}`,
            size: 0,
          })),
      ];
    });
    const additionalMarketStateMarkers: SeriesMarker<Time>[] = drawings.flatMap((drawing) => {
      const state = drawing.additionalMarketState;
      if (!state) return [];
      return [
        {
          time: getMarketStateLabelTime(
            candlesData,
            state.marketStructure.eventPrice.time,
            state.marketStructure.time,
          ),
          position: state.marketStructure.bias === 'BEARISH'
            ? 'atPriceBottom' as const
            : 'atPriceTop' as const,
          price: state.marketStructure.eventPrice.price,
          shape: 'circle' as const,
          color: state.marketStructure.bias === 'BEARISH' ? '#ef626c' : '#20b887',
          text: `${state.marketStructure.event.toLowerCase()}: ${state.marketStructure.score.toFixed(2)}`,
          size: 0,
        },
        ...state.pois
          .filter((poi) => (poi.type === 'FVG' ? showFVG : showOB))
          .map((poi) => ({
            time: getMarketStateLabelTime(candlesData, poi.startTime, getPoiEndTime(poi, candlesData)),
            position: 'atPriceMiddle' as const,
            price: poi.high,
            shape: 'circle' as const,
            color: getPoiLineColor(poi),
            text: `${poi.type === 'FVG' ? 'fvg' : 'ob'}: ${poi.score.toFixed(1)}`,
            size: 0,
          })),
      ];
    });
    const tradeStructureMarkers: SeriesMarker<Time>[] = drawings.flatMap((drawing) => {
      const overlay = drawing.tradeOverlay;
      if (!overlay) return [];
      return [
        ...(!drawing.marketState ? [{
          time: getMarketStateLabelTime(
            candlesData,
            overlay.htf.marketStructure.eventPrice.time,
            overlay.htf.marketStructure.time,
          ),
          position: overlay.htf.marketStructure.bias === 'BEARISH'
            ? 'atPriceBottom' as const
            : 'atPriceTop' as const,
          price: overlay.htf.marketStructure.eventPrice.price,
          shape: 'square' as const,
          color: overlay.htf.marketStructure.bias === 'BEARISH' ? '#ef626c' : '#20b887',
          text: `${overlay.htf.marketStructure.event.toUpperCase()}: ${overlay.htf.marketStructure.score.toFixed(2)}`,
          size: 1,
        }] : []),
        {
          time: getMarketStateLabelTime(
            candlesData,
            overlay.ltf.marketStructure.eventPrice.time,
            overlay.ltf.marketStructure.time,
          ),
          position: overlay.ltf.marketStructure.bias === 'BEARISH'
            ? 'atPriceBottom' as const
            : 'atPriceTop' as const,
          price: overlay.ltf.marketStructure.eventPrice.price,
          shape: 'circle',
          color: overlay.ltf.marketStructure.bias === 'BEARISH' ? '#ef626c' : '#20b887',
          text: `${overlay.ltf.marketStructure.event.toLowerCase()}: ${overlay.ltf.marketStructure.score.toFixed(2)}`,
          size: 1,
        },
        {
          time: overlay.trade.entry.time,
          position: 'atPriceMiddle',
          price: overlay.trade.entry.price,
          shape: 'circle',
          color: '#60a5fa',
          text: 'Entry',
          size: 1,
        },
        {
          time: overlay.trade.exit.time,
          position: 'atPriceMiddle',
          price: overlay.trade.exit.type === 'TP'
            ? overlay.trade.exit.price
            : overlay.trade.exit.stopLoss,
          shape: 'circle',
          color: overlay.trade.exit.type === 'TP' ? '#20b887' : '#ef626c',
          text: overlay.trade.exit.type,
          size: 1,
        },
        {
          time: getMarketStateLabelTime(
            candlesData,
            overlay.trade.entry.time,
            overlay.trade.exit.time,
          ),
          position: 'atPriceMiddle',
          price: overlay.trade.exit.stopLoss,
          shape: 'circle',
          color: '#ef626c',
          text: SYSTEM_CONFIG.ui.backtestReplay.stopLossLabel,
          size: 0,
        },
        ...(overlay.ltf.sweep
          ? [{
            time: overlay.ltf.sweep.time,
            position: overlay.ltf.sweep.direction === 'BEARISH'
              ? 'aboveBar' as const
              : 'belowBar' as const,
            shape: overlay.ltf.sweep.direction === 'BEARISH'
              ? 'arrowDown' as const
              : 'arrowUp' as const,
            color: overlay.ltf.sweep.direction === 'BEARISH' ? '#ef626c' : '#20b887',
            text: typeof overlay.ltf.sweep.score === 'number'
              ? `sweep: ${overlay.ltf.sweep.score.toFixed(2)}`
              : 'sweep',
            size: 1,
          }]
          : []),
        ...[
          { poi: overlay.htf.poi, shape: 'square' as const, isHtf: true },
          { poi: overlay.ltf.poi, shape: 'circle' as const, isHtf: false },
        ].flatMap(({ poi, shape, isHtf }) => {
          if (!poi || (poi.type === 'FVG' ? !showFVG : !showOB)) return [];

          const label = poi.type === 'FVG' ? 'FVG' : 'OB';
          return [{
            time: poi.startTime,
            position: 'atPriceMiddle' as const,
            price: poi.high,
            shape,
            color: isHtf ? getPoiLineColorWithOpacity(poi, 0.5) : getPoiLineColor(poi),
            text: '',
            size: isHtf ? 1.5 : 1,
          }];
        }),
      ];
    });
    const allMarkers = [
      ...(showSwings ? markers ?? [] : []),
      ...marketStateMarkers,
      ...additionalMarketStateMarkers,
      ...tradeStructureMarkers,
    ];
    allMarkers.sort((left, right) => Number(left.time) - Number(right.time));
    markersRef.current?.setMarkers(allMarkers);
  }, [
    additionalMarketState,
    candlesData,
    keepDraw,
    markers,
    marketState,
    marketStateTimeframe,
    preservedDrawings,
    showFVG,
    showOB,
    showSwings,
    tradeOverlay,
  ]);

  return (
    <ChartPanelView
      panelId={panelId}
      symbol={symbol}
      timeframe={timeframe}
      subtitle={subtitle}
      chartHostRef={hostRef}
      showSwings={showSwings}
      onShowSwingsChange={setShowSwings}
      showFVG={showFVG}
      onShowFVGChange={setShowFVG}
      showOB={showOB}
      onShowOBChange={setShowOB}
      keepDraw={keepDraw}
      onKeepDrawChange={setKeepDraw}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((isExpanded) => !isExpanded)}
      statusLabel={statusLabel}
      currentCandle={currentCandle}
      selectedCandle={selectedCandle}
      poiLabels={poiLabels}
      onCloseCandleTooltip={() => setSelectedCandle(null)}
      toolbarContent={toolbarContent}
    />
  );
}
