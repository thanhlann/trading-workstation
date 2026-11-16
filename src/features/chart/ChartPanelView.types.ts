import type { RefObject } from 'react';
import type { ReactNode } from 'react';
import type { MarketSymbol } from '../../config/marketSymbols';
import type { Candle, CandleTooltipData } from './candle.types';

export interface ChartPoiLabel {
  timeframe: 'htf' | 'ltf';
  text: string;
  color: string;
  left: number;
  top: number;
}

export interface ChartPanelViewProps {
  panelId: string;
  symbol: MarketSymbol;
  timeframe: string;
  subtitle: string;
  chartHostRef: RefObject<HTMLDivElement>;
  showSwings: boolean;
  onShowSwingsChange: (show: boolean) => void;
  showFVG: boolean;
  onShowFVGChange: (show: boolean) => void;
  showOB: boolean;
  onShowOBChange: (show: boolean) => void;
  keepDraw: boolean;
  onKeepDrawChange: (keep: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  statusLabel: string;
  currentCandle: Candle | null;
  poiLabels: ChartPoiLabel[];
  selectedCandle: {
    data: CandleTooltipData;
    left: number;
    top: number;
  } | null;
  onCloseCandleTooltip: () => void;
  toolbarContent?: ReactNode;
}
