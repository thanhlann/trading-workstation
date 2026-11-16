import type { CandleData, CandleTooltipData } from './candle.types';

const ATR_PERIOD = 14;
const RSI_PERIOD = 14;
const VOLUME_AVERAGE_PERIOD = 20;

export interface CandleStructureMetrics {
  bodyAtr: number | null;
  bodyRatio: number;
  closePos: number;
}

function createCandleStructureMetrics(
  candle: CandleData,
  body: number,
  range: number,
  atr: number | null,
): CandleStructureMetrics {
  return {
    bodyAtr: atr === null || atr === 0 ? null : body / atr,
    bodyRatio: candle.bodyRatio ?? (range === 0 ? 0 : body / range),
    closePos: candle.closePos ?? (range === 0 ? 0 : (candle.close - candle.low) / range),
  };
}

function calculateTrueRange(candle: CandleData, previousClose?: number): number {
  if (previousClose === undefined) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

function calculateAtr(candles: CandleData[], index: number): number | null {
  const firstIndex = Math.max(0, index - ATR_PERIOD + 1);
  const ranges = candles
    .slice(firstIndex, index + 1)
    .map((candle, offset) => {
      const candleIndex = firstIndex + offset;
      return calculateTrueRange(candle, candles[candleIndex - 1]?.close);
    });

  if (ranges.length < ATR_PERIOD) return null;
  return ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
}

function calculateRsi(candles: CandleData[], index: number): number | null {
  if (index < RSI_PERIOD) return null;

  let averageGain = 0;
  let averageLoss = 0;
  for (let candleIndex = 1; candleIndex <= RSI_PERIOD; candleIndex += 1) {
    const change = candles[candleIndex].close - candles[candleIndex - 1].close;
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= RSI_PERIOD;
  averageLoss /= RSI_PERIOD;

  for (let candleIndex = RSI_PERIOD + 1; candleIndex <= index; candleIndex += 1) {
    const change = candles[candleIndex].close - candles[candleIndex - 1].close;
    averageGain = (averageGain * (RSI_PERIOD - 1) + Math.max(change, 0)) / RSI_PERIOD;
    averageLoss = (averageLoss * (RSI_PERIOD - 1) + Math.max(-change, 0)) / RSI_PERIOD;
  }

  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function calculateVolumeRatio(candles: CandleData[], index: number): number | null {
  const volume = candles[index].volume;
  const previousCandles = candles.slice(Math.max(0, index - VOLUME_AVERAGE_PERIOD), index);
  if (volume === undefined || previousCandles.length === 0) return null;

  const previousVolumes = previousCandles
    .map((candle) => candle.volume)
    .filter((value): value is number => value !== undefined);
  if (previousVolumes.length !== previousCandles.length) return null;

  const averageVolume = previousVolumes.reduce((sum, value) => sum + value, 0) / previousVolumes.length;
  return averageVolume === 0 ? null : volume / averageVolume;
}

export function getCandleTooltipData(
  candles: CandleData[],
  index: number,
): CandleTooltipData {
  const candle = candles[index];
  if (!candle || typeof candle.time !== 'number') {
    throw new Error('Cannot create candle details for an invalid candle.');
  }

  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const atr = calculateAtr(candles, index);
  const metrics = createCandleStructureMetrics(candle, body, range, atr);
  const timestampMilliseconds = candle.time * 1000;

  return {
    timestamp: new Date(timestampMilliseconds).toISOString().replace('T', ' ').slice(0, 19),
    timestampMilliseconds,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    upperWick: candle.high - Math.max(candle.open, candle.close),
    lowerWick: Math.min(candle.open, candle.close) - candle.low,
    body,
    bodyRatio: metrics.bodyRatio,
    bodyAtr: metrics.bodyAtr,
    closePos: metrics.closePos,
    range,
    rangeAtr: atr === null || atr === 0 ? null : range / atr,
    volume: candle.volume ?? null,
    atr,
    rsi: calculateRsi(candles, index),
    volumeRatio: calculateVolumeRatio(candles, index),
  };
}

export function getCandleStructureMetrics(
  candles: CandleData[],
  index: number,
): CandleStructureMetrics {
  const candle = candles[index];
  if (!candle) {
    throw new Error('Cannot create candle metrics for an invalid candle.');
  }

  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  return createCandleStructureMetrics(candle, body, range, calculateAtr(candles, index));
}
