import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MARKET_SYMBOL, type MarketSymbol } from '../config/marketSymbols';
import { SYSTEM_CONFIG, type TradingMode } from '../config/system';

export type BottomTab = 'events' | 'trades' | 'signals' | 'logs';
export type WorkspacePage = 'chart' | 'eventFilters';
export type BacktestTimeframe = 'htf' | 'ltf';
export type BacktestReplaySpeed = 1 | 2 | 5 | 10;
export type { MarketSymbol } from '../config/marketSymbols';

export type BacktestNavigationTarget =
  | {
    type: 'htfMarketStructure';
    marketStructureNumber: number;
    marketStructureTime: number;
  }
  | {
    type: 'marketStructure';
    setupId: string;
    marketStructureNumber: number;
    marketStructureTime: number;
  }
  | {
    type: 'trade';
    setupId: string;
    marketStructureTime: number;
    tradeNumber: number;
  };

interface WorkspaceState {
  sidebarCollapsed: boolean;
  activeTab: BottomTab;
  activeWorkspacePage: WorkspacePage;
  mode: TradingMode;
  selectedSymbol: MarketSymbol;
  backtestTimeframe: BacktestTimeframe;
  selectedSetupId: string;
  backtestHtfSearchValue: string;
  backtestLtfSearchValue: string;
  backtestTimeRangeFrom: string;
  backtestTimeRangeTo: string;
  backtestNavigationTarget: BacktestNavigationTarget | null;
  replayIndex: number;
  replayLastIndex: number;
  replayPlaying: boolean;
  autoReplay: boolean;
  replaySpeed: BacktestReplaySpeed;
  workspaceHistory: WorkspaceNavigationSnapshot[];
  workspaceForwardHistory: WorkspaceNavigationSnapshot[];
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveTab: (tab: BottomTab) => void;
  setActiveWorkspacePage: (page: WorkspacePage) => void;
  setMode: (mode: TradingMode) => void;
  navigateToWorkspace: (target: WorkspaceRouteTarget) => void;
  goBack: () => void;
  goForward: () => void;
  setSelectedSymbol: (symbol: MarketSymbol) => void;
  setBacktestTimeframe: (timeframe: BacktestTimeframe) => void;
  setSelectedSetupId: (setupId: string) => void;
  setBacktestSearchValue: (timeframe: BacktestTimeframe, value: string) => void;
  setBacktestTimeRange: (range: Partial<Pick<WorkspaceState, 'backtestTimeRangeFrom' | 'backtestTimeRangeTo'>>) => void;
  setBacktestNavigationTarget: (target: BacktestNavigationTarget | null) => void;
  setReplayLastIndex: (lastIndex: number) => void;
  setReplayIndex: (index: number) => void;
  jumpToReplayStart: () => void;
  jumpToReplayEnd: () => void;
  toggleReplay: () => void;
  advanceReplay: () => void;
  setAutoReplay: (enabled: boolean) => void;
  setReplaySpeed: (speed: BacktestReplaySpeed) => void;
}

type WorkspaceNavigationSnapshot = Pick<
  WorkspaceState,
  | 'activeTab'
  | 'activeWorkspacePage'
  | 'mode'
  | 'selectedSymbol'
  | 'backtestTimeframe'
  | 'selectedSetupId'
  | 'backtestHtfSearchValue'
  | 'backtestLtfSearchValue'
  | 'backtestTimeRangeFrom'
  | 'backtestTimeRangeTo'
  | 'backtestNavigationTarget'
  | 'replayIndex'
  | 'replayLastIndex'
  | 'replayPlaying'
  | 'autoReplay'
  | 'replaySpeed'
>;

export type WorkspaceRouteTarget = Partial<
  Pick<WorkspaceNavigationSnapshot, 'activeWorkspacePage' | 'mode'>
>;

function createNavigationSnapshot(state: WorkspaceState): WorkspaceNavigationSnapshot {
  return {
    activeTab: state.activeTab,
    activeWorkspacePage: state.activeWorkspacePage,
    mode: state.mode,
    selectedSymbol: state.selectedSymbol,
    backtestTimeframe: state.backtestTimeframe,
    selectedSetupId: state.selectedSetupId,
    backtestHtfSearchValue: state.backtestHtfSearchValue,
    backtestLtfSearchValue: state.backtestLtfSearchValue,
    backtestTimeRangeFrom: state.backtestTimeRangeFrom,
    backtestTimeRangeTo: state.backtestTimeRangeTo,
    backtestNavigationTarget: state.backtestNavigationTarget,
    replayIndex: state.replayIndex,
    replayLastIndex: state.replayLastIndex,
    replayPlaying: state.replayPlaying,
    autoReplay: state.autoReplay,
    replaySpeed: state.replaySpeed,
  };
}

function createWorkspaceNavigationChange(
  state: WorkspaceState,
  target: WorkspaceRouteTarget,
): Partial<WorkspaceState> {
  const activeWorkspacePage = target.activeWorkspacePage ?? state.activeWorkspacePage;
  const mode = target.mode ?? state.mode;
  if (activeWorkspacePage === state.activeWorkspacePage && mode === state.mode) {
    return target.mode === undefined ? {} : { replayPlaying: false };
  }

  return {
    activeWorkspacePage,
    mode,
    replayPlaying: target.mode === undefined ? state.replayPlaying : false,
    workspaceHistory: [...state.workspaceHistory, createNavigationSnapshot(state)].slice(-50),
    workspaceForwardHistory: [],
  };
}

type PersistedWorkspaceState = Pick<
  WorkspaceState,
  | 'sidebarCollapsed'
  | 'activeTab'
  | 'activeWorkspacePage'
  | 'mode'
  | 'selectedSymbol'
  | 'backtestTimeframe'
  | 'selectedSetupId'
  | 'backtestHtfSearchValue'
  | 'backtestLtfSearchValue'
  | 'backtestTimeRangeFrom'
  | 'backtestTimeRangeTo'
  | 'autoReplay'
  | 'replaySpeed'
>;

export const useWorkspaceStore = create<WorkspaceState>()(persist((set) => ({
  sidebarCollapsed: false,
  activeTab: 'events',
  activeWorkspacePage: 'chart',
  mode: SYSTEM_CONFIG.defaultMode,
  selectedSymbol: DEFAULT_MARKET_SYMBOL,
  backtestTimeframe: 'htf',
  selectedSetupId: '',
  backtestHtfSearchValue: '',
  backtestLtfSearchValue: '',
  backtestTimeRangeFrom: '',
  backtestTimeRangeTo: '',
  backtestNavigationTarget: null,
  replayIndex: 0,
  replayLastIndex: -1,
  replayPlaying: false,
  autoReplay: false,
  replaySpeed: 1,
  workspaceHistory: [],
  workspaceForwardHistory: [],
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setActiveWorkspacePage: (activeWorkspacePage) => set((state) => (
    createWorkspaceNavigationChange(state, { activeWorkspacePage })
  )),
  setMode: (mode) => set((state) => createWorkspaceNavigationChange(state, { mode })),
  navigateToWorkspace: (target) => set((state) => createWorkspaceNavigationChange(state, target)),
  goBack: () => set((state) => {
    if (state.workspaceHistory.length === 0) return {};
    const previousState = state.workspaceHistory[state.workspaceHistory.length - 1];
    return {
      ...previousState,
      workspaceHistory: state.workspaceHistory.slice(0, -1),
      workspaceForwardHistory: [
        ...state.workspaceForwardHistory,
        createNavigationSnapshot(state),
      ].slice(-50),
    };
  }),
  goForward: () => set((state) => {
    if (state.workspaceForwardHistory.length === 0) return {};
    const nextState = state.workspaceForwardHistory[state.workspaceForwardHistory.length - 1];
    return {
      ...nextState,
      workspaceHistory: [
        ...state.workspaceHistory,
        createNavigationSnapshot(state),
      ].slice(-50),
      workspaceForwardHistory: state.workspaceForwardHistory.slice(0, -1),
    };
  }),
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
  setBacktestTimeframe: (backtestTimeframe) => set((state) => (
    state.backtestTimeframe === backtestTimeframe
      ? {}
      : { backtestTimeframe, replayIndex: 0, replayLastIndex: -1, replayPlaying: false }
  )),
  setSelectedSetupId: (selectedSetupId) => set({ selectedSetupId }),
  setBacktestSearchValue: (timeframe, value) => set(
    timeframe === 'htf'
      ? { backtestHtfSearchValue: value }
      : { backtestLtfSearchValue: value },
  ),
  setBacktestTimeRange: (range) => set({
    ...range,
    replayIndex: 0,
    replayPlaying: false,
  }),
  setBacktestNavigationTarget: (backtestNavigationTarget) => set({ backtestNavigationTarget }),
  setReplayLastIndex: (replayLastIndex) => set({
    replayLastIndex,
    replayIndex: 0,
    replayPlaying: false,
  }),
  setReplayIndex: (index) => set((state) => ({
    replayIndex: Math.max(0, Math.min(index, Math.max(0, state.replayLastIndex))),
    replayPlaying: false,
  })),
  jumpToReplayStart: () => set({ replayIndex: 0, replayPlaying: false }),
  jumpToReplayEnd: () => set((state) => ({
    replayIndex: Math.max(0, state.replayLastIndex),
    replayPlaying: false,
  })),
  toggleReplay: () => set((state) => {
    if (state.replayLastIndex <= 0) return { replayPlaying: false };
    if (state.replayPlaying) return { replayPlaying: false };
    return {
      replayIndex: state.replayIndex >= state.replayLastIndex ? 0 : state.replayIndex,
      replayPlaying: true,
    };
  }),
  advanceReplay: () => set((state) => {
    if (!state.replayPlaying || state.replayLastIndex <= 0) return {};
    if (state.replayIndex >= state.replayLastIndex) {
      return state.autoReplay
        ? { replayIndex: 0 }
        : { replayPlaying: false };
    }

    const replayIndex = state.replayIndex + 1;
    return {
      replayIndex,
      replayPlaying: replayIndex < state.replayLastIndex || state.autoReplay,
    };
  }),
  setAutoReplay: (autoReplay) => set({ autoReplay }),
  setReplaySpeed: (replaySpeed) => set({ replaySpeed }),
}), {
  name: 'trading-workstation-workspace',
  partialize: (state): PersistedWorkspaceState => ({
    sidebarCollapsed: state.sidebarCollapsed,
    activeTab: state.activeTab,
    activeWorkspacePage: state.activeWorkspacePage,
    mode: state.mode,
    selectedSymbol: state.selectedSymbol,
    backtestTimeframe: state.backtestTimeframe,
    selectedSetupId: state.selectedSetupId,
    backtestHtfSearchValue: state.backtestHtfSearchValue,
    backtestLtfSearchValue: state.backtestLtfSearchValue,
    backtestTimeRangeFrom: state.backtestTimeRangeFrom,
    backtestTimeRangeTo: state.backtestTimeRangeTo,
    autoReplay: state.autoReplay,
    replaySpeed: state.replaySpeed,
  }),
}));
