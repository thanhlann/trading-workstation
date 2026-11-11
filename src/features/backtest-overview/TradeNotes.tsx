import { Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { SYSTEM_CONFIG } from '../../config/system';
import { loadTradeNote, saveTradeNote } from './tradeNotesStorage';

type NoteStatus = 'loading' | 'saved' | 'saving' | 'error';

interface TradeNotesProps {
  tradeId: string;
  onHasNoteChange?: (hasNote: boolean) => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TradeNotes({ tradeId, onHasNoteChange }: TradeNotesProps) {
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<NoteStatus>('loading');
  const [errorType, setErrorType] = useState<'load' | 'save' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const saveRevision = useRef(0);
  const onHasNoteChangeRef = useRef(onHasNoteChange);
  onHasNoteChangeRef.current = onHasNoteChange;
  const editorId = useId();
  const labels = SYSTEM_CONFIG.ui.backtestReplay;
  const preview = note.trim()
    ? note.split(/\r?\n/).slice(0, 3).join('\n')
    : '';

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
        setNote(savedNote);
        setHasLoaded(true);
        setStatus('saved');
        onHasNoteChangeRef.current?.(savedNote.trim().length > 0);
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
    saveTradeNote(tradeId, text).then(
      () => {
        if (revision !== saveRevision.current) return;
        setStatus('saved');
        onHasNoteChangeRef.current?.(text.trim().length > 0);
      },
      (error: unknown) => {
        if (revision !== saveRevision.current) return;
        setStatus('error');
        setErrorType('save');
        setErrorMessage(getErrorMessage(error));
      },
    );
  };

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
        <h3 className="backtest-replay__trade-card-title">
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
        aria-expanded={expanded}
        aria-controls={editorId}
        disabled={!hasLoaded}
        onClick={() => setExpanded((isExpanded) => !isExpanded)}
      >
        {preview || (
          <span className="backtest-replay__trade-notes-add">
            <Plus size={12} aria-hidden="true" />
            {labels.tradeNotesAdd}
          </span>
        )}
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
        hidden={!expanded}
      >
        <textarea
          aria-label={labels.tradeNotesTitle}
          placeholder={labels.tradeNotesPlaceholder}
          value={note}
          rows={5}
          onChange={(event) => handleNoteChange(event.target.value)}
        />
      </div>
    </div>
  );
}
