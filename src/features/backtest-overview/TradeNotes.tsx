import { Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { SYSTEM_CONFIG } from '../../config/system';
import {
  loadTradeNote,
  saveTradeNote,
  TRADE_NOTE_PRIORITIES,
  type TradeNotePriority,
} from './tradeNotesStorage';

type NoteStatus = 'loading' | 'saved' | 'saving' | 'error';

export const TRADE_NOTE_PRIORITY_COLORS: Record<TradeNotePriority, string> = {
  Critical: '#DC2626',
  High: '#F97316',
  Medium: '#EAB308',
  Low: '#3B82F6',
  None: '#64748B',
};

interface TradeNotesProps {
  tradeId: string;
  onHasNoteChange?: (hasNote: boolean, priority: TradeNotePriority) => void;
}

function hasTradeNote(text: string, priority: TradeNotePriority): boolean {
  return text.trim().length > 0 || priority !== 'None';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TradeNotes({ tradeId, onHasNoteChange }: TradeNotesProps) {
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<TradeNotePriority>('None');
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hasExistingNote, setHasExistingNote] = useState(false);
  const [status, setStatus] = useState<NoteStatus>('loading');
  const [errorType, setErrorType] = useState<'load' | 'save' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const saveRevision = useRef(0);
  const onHasNoteChangeRef = useRef(onHasNoteChange);
  onHasNoteChangeRef.current = onHasNoteChange;
  const editorId = useId();
  const dialogId = useId();
  const dialogTitleId = useId();
  const priorityId = useId();
  const dialogPriorityId = useId();
  const labels = SYSTEM_CONFIG.ui.backtestReplay;
  const preview = note.trim() ? note : '';

  useEffect(() => {
    let active = true;
    setHasLoaded(false);
    setStatus('loading');
    setErrorType(null);
    setErrorMessage('');
    saveRevision.current += 1;

    loadTradeNote(tradeId).then(
      (savedNote) => {
        if (!active) return;
        setNote(savedNote.text);
        setPriority(savedNote.priority);
        setHasExistingNote(hasTradeNote(savedNote.text, savedNote.priority));
        setHasLoaded(true);
        setStatus('saved');
        onHasNoteChangeRef.current?.(
          hasTradeNote(savedNote.text, savedNote.priority),
          savedNote.priority,
        );
      },
      (error: unknown) => {
        if (!active) return;
        setStatus('error');
        setErrorType('load');
        setErrorMessage(getErrorMessage(error));
      },
    );

    return () => {
      active = false;
    };
  }, [loadAttempt, tradeId]);

  const handleNoteChange = (text: string) => {
    const revision = ++saveRevision.current;
    setNote(text);
    setStatus('saving');
    setErrorType(null);
    setErrorMessage('');
    saveTradeNote(tradeId, text, priority).then(
      () => {
        if (revision !== saveRevision.current) return;
        setStatus('saved');
        onHasNoteChangeRef.current?.(hasTradeNote(text, priority), priority);
      },
      (error: unknown) => {
        if (revision !== saveRevision.current) return;
        setStatus('error');
        setErrorType('save');
        setErrorMessage(getErrorMessage(error));
      },
    );
  };

  const handleDialogSave = () => {
    const revision = ++saveRevision.current;
    setStatus('saving');
    setErrorType(null);
    setErrorMessage('');
    saveTradeNote(tradeId, note, priority).then(
      () => {
        if (revision !== saveRevision.current) return;
        setStatus('saved');
        setHasExistingNote(hasTradeNote(note, priority));
        onHasNoteChangeRef.current?.(hasTradeNote(note, priority), priority);
        setDialogOpen(false);
      },
      (error: unknown) => {
        if (revision !== saveRevision.current) return;
        setStatus('error');
        setErrorType('save');
        setErrorMessage(getErrorMessage(error));
      },
    );
  };

  const handlePreviewClick = () => {
    if (hasExistingNote) {
      setDialogOpen(true);
      return;
    }

    setExpanded((isExpanded) => !isExpanded);
  };

  const handlePriorityChange = (nextPriority: TradeNotePriority) => {
    const revision = ++saveRevision.current;
    setPriority(nextPriority);
    setStatus('saving');
    setErrorType(null);
    setErrorMessage('');
    saveTradeNote(tradeId, note, nextPriority).then(
      () => {
        if (revision !== saveRevision.current) return;
        setStatus('saved');
        setHasExistingNote(hasTradeNote(note, nextPriority));
        onHasNoteChangeRef.current?.(hasTradeNote(note, nextPriority), nextPriority);
      },
      (error: unknown) => {
        if (revision !== saveRevision.current) return;
        setStatus('error');
        setErrorType('save');
        setErrorMessage(getErrorMessage(error));
      },
    );
  };

  const renderPrioritySelect = (id: string) => (
    <div className="backtest-replay__trade-notes-priority">
      <label htmlFor={id}>{labels.tradeNotesPriority}</label>
      <span
        className="backtest-replay__trade-notes-priority-dot"
        style={{ backgroundColor: TRADE_NOTE_PRIORITY_COLORS[priority] }}
        aria-hidden="true"
      />
      <select
        id={id}
        value={priority}
        disabled={!hasLoaded}
        onChange={(event) => handlePriorityChange(event.target.value as TradeNotePriority)}
      >
        {TRADE_NOTE_PRIORITIES.map((option) => (
          <option key={option} value={option}>
            {labels[`tradeNotesPriority${option}` as keyof typeof labels]}
          </option>
        ))}
      </select>
    </div>
  );

  const statusLabel = status === 'loading'
    ? labels.tradeNotesLoading
    : status === 'saving'
      ? labels.tradeNotesSaving
      : status === 'error'
        ? errorType === 'load'
          ? labels.tradeNotesLoadFailed
          : labels.tradeNotesSaveFailed
        : labels.tradeNotesSaved;

  return (
    <div className="backtest-replay__trade-card backtest-replay__trade-notes">
      <div className="backtest-replay__trade-card-heading">
        <h3
          className="backtest-replay__trade-card-title"
          style={hasTradeNote(note, priority)
            ? { color: TRADE_NOTE_PRIORITY_COLORS[priority] }
            : undefined}
        >
          {labels.tradeNotesTitle}
        </h3>
        <span
          className={`backtest-replay__trade-notes-status${status === 'error' ? ' backtest-replay__trade-notes-status--error' : ''}`}
          role={status === 'error' ? 'alert' : 'status'}
        >
          {statusLabel}
        </span>
      </div>
      <button
        type="button"
        className="backtest-replay__trade-notes-toggle"
        aria-expanded={hasExistingNote ? dialogOpen : expanded}
        aria-controls={hasExistingNote ? dialogId : editorId}
        disabled={!hasLoaded}
        onClick={handlePreviewClick}
      >
        {!dialogOpen && (preview
          ? <span className="backtest-replay__trade-notes-preview">{preview}</span>
          : (
            <span className="backtest-replay__trade-notes-add">
              <Plus size={12} aria-hidden="true" />
              {labels.tradeNotesAdd}
            </span>
          ))}
      </button>
      {status === 'error' && (
        <div className="backtest-replay__trade-notes-error" role="alert">
          <span>
            {errorType === 'load'
              ? labels.tradeNotesLoadError
              : labels.tradeNotesSaveError}
            {' '}
            {errorMessage}
          </span>
          {errorType === 'load' && (
            <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              {labels.tradeNotesRetry}
            </button>
          )}
        </div>
      )}
      <div
        id={editorId}
        className="backtest-replay__trade-notes-editor"
        hidden={!expanded || hasExistingNote}
      >
        {renderPrioritySelect(priorityId)}
        <textarea
          aria-label={labels.tradeNotesTitle}
          placeholder={labels.tradeNotesPlaceholder}
          value={note}
          rows={5}
          onChange={(event) => handleNoteChange(event.target.value)}
        />
      </div>
      {dialogOpen && createPortal(
        <div
          className="backtest-replay__trade-notes-backdrop"
          onClick={() => setDialogOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDialogOpen(false);
          }}
        >
          <section
            id={dialogId}
            className="backtest-replay__trade-notes-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="backtest-replay__trade-notes-dialog-heading">
              <h3
                id={dialogTitleId}
                style={hasTradeNote(note, priority)
                  ? { color: TRADE_NOTE_PRIORITY_COLORS[priority] }
                  : undefined}
              >
                {labels.tradeNotesTitle}
              </h3>
              <span
                className={`backtest-replay__trade-notes-status${status === 'error' ? ' backtest-replay__trade-notes-status--error' : ''}`}
                role={status === 'error' ? 'alert' : 'status'}
              >
                {statusLabel}
              </span>
            </header>
            {renderPrioritySelect(dialogPriorityId)}
            <textarea
              aria-label={labels.tradeNotesTitle}
              placeholder={labels.tradeNotesPlaceholder}
              value={note}
              rows={8}
              autoFocus
              onChange={(event) => handleNoteChange(event.target.value)}
            />
            {status === 'error' && (
              <div className="backtest-replay__trade-notes-error" role="alert">
                {labels.tradeNotesSaveError} {errorMessage}
              </div>
            )}
            <div className="backtest-replay__trade-notes-dialog-actions">
              <button type="button" onClick={() => setDialogOpen(false)}>
                {labels.tradeNotesClose}
              </button>
              <button type="button" onClick={handleDialogSave}>
                {labels.tradeNotesSave}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
