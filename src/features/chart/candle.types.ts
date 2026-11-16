import type { CandlestickData, Time } from 'lightweight-charts';

export interface CandleData extends CandlestickData<Time> {
  volume?: number;
  bodyRatio?: number;
  closePos?: number;
}

export interface Candle {
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface CandleTooltipData {
  timestamp: string;
  timestampMilliseconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  upperWick: number;
  lowerWick: number;
  body: number;
  bodyRatio: number;
  bodyAtr: number | null;
  closePos: number;
  range: number;
  rangeAtr: number | null;
  volume: number | null;
  atr: number | null;
  rsi: number | null;
  volumeRatio: number | null;
}
