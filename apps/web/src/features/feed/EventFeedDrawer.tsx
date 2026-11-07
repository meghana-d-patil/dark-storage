import React, { useState, useEffect } from 'react';
import { useRealtimeStore, FeedEvent } from '../../stores/realtimeStore.js';
import { formatEventSummary, formatRelativeTime, getEventCategory, EventCategory } from './eventFormatter.js';

interface EventFeedDrawerProps {
  defaultOpen?: boolean;
}

export const EventFeedDrawer: React.FC<EventFeedDrawerProps> = ({ defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState<EventCategory>('all');
  const [isPaused, setIsPaused] = useState(false);
  const [pausedEvents, setPausedEvents] = useState<FeedEvent[]>([]);
  const [now, setNow] = useState<number>(Date.now());

  const { events: storeEvents, connected, statusText, clearEvents } = useRealtimeStore();

  // Relative timestamps 1 Hz interval active ONLY while drawer is open
  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleTogglePause = () => {
    if (isPaused) {
      // Resume: unfreeze view to latest store state
      setIsPaused(false);
      setPausedEvents([]);
    } else {
      // Pause: freeze snapshot of current events
      setIsPaused(true);
      setPausedEvents([...storeEvents]);
    }
  };

  const handleClear = () => {
    clearEvents();
    setPausedEvents([]);
  };

  const activeEvents = isPaused ? pausedEvents : storeEvents;

  // Filter events
  const displayedEvents = activeEvents.filter((ev) => {
    if (filter === 'all') return true;
    const cat = getEventCategory(ev.event_type);
    return cat === filter;
  });

  // Calculate new events buffered while paused
  const bufferedCount = isPaused
    ? Math.max(0, storeEvents.filter((se) => !pausedEvents.some((pe) => pe.seq === se.seq)).length)
    : 0;

  const filterOptions: { id: EventCategory; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'orders', label: 'Orders' },
    { id: 'missions', label: 'Missions' },
    { id: 'picks', label: 'Picks' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'exceptions', label: 'Exceptions' }
  ];

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* Header bar / Toggle */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 18px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: isOpen ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-md)',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.1rem' }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Live Event Feed</span>
          <span className="live-pill" style={{ fontSize: '11px', padding: '2px 8px' }}>
            <span className={`live-dot ${connected ? 'live' : ''}`} />
            {connected ? 'Live' : statusText}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            ({storeEvents.length} events)
          </span>
          {isPaused && (
            <span
              className="badge badge-warning"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              PAUSED {bufferedCount > 0 ? `(${bufferedCount} new)` : ''}
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setIsOpen(!isOpen)}
          data-testid="event-feed-toggle"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {isOpen ? 'Collapse Feed ▲' : 'Open Feed ▼'}
        </button>
      </div>

      {/* Collapsible Panel Content */}
      {isOpen && (
        <div
          data-testid="event-feed"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderTop: 'none',
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
            padding: '16px 20px',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          {/* Controls Bar: Filters & Actions */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              paddingBottom: '14px',
              borderBottom: '1px solid var(--border-color)',
              marginBottom: '14px'
            }}
          >
            {/* Filter Chips */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {filterOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFilter(opt.id)}
                  data-testid={`event-feed-filter-${opt.id}`}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full, 9999px)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid var(--border-color)',
                    backgroundColor:
                      filter === opt.id ? 'var(--accent-primary)' : 'var(--bg-surface-elevated, var(--bg-surface))',
                    color: filter === opt.id ? '#ffffff' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Actions: Pause/Resume & Clear */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={`btn btn-sm ${isPaused ? 'btn-primary' : 'btn-secondary'}`}
                onClick={handleTogglePause}
                data-testid="event-feed-pause"
                style={{ fontSize: '12px' }}
              >
                {isPaused ? `▶ Resume ${bufferedCount > 0 ? `(${bufferedCount})` : ''}` : '⏸ Pause'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleClear}
                data-testid="event-feed-clear"
                style={{ fontSize: '12px', color: 'var(--accent-danger)' }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Events List */}
          <div
            style={{
              maxHeight: '340px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            {displayedEvents.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '2rem 1rem',
                  color: 'var(--text-muted)',
                  fontSize: '13px'
                }}
              >
                {activeEvents.length === 0
                  ? 'No outbox events recorded yet. Receive stock, create orders, or confirm picks to see realtime events.'
                  : `No events matching filter "${filter}".`}
              </div>
            ) : (
              displayedEvents.map((ev) => {
                const summary = formatEventSummary(ev);
                const relTime = formatRelativeTime(ev.created_at, now);

                return (
                  <div
                    key={ev.seq}
                    data-testid={`event-feed-item-${ev.seq}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '8px 12px',
                      backgroundColor: 'var(--bg-surface-elevated, var(--bg-surface))',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '13px'
                    }}
                  >
                    {/* Left: seq, badges, summary */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: 'var(--text-muted)'
                        }}
                      >
                        #{ev.seq}
                      </span>

                      <span
                        className="badge badge-info"
                        style={{
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}
                      >
                        {ev.event_type}
                      </span>

                      {ev.replay && (
                        <span
                          className="badge"
                          data-testid={`event-feed-replay-${ev.seq}`}
                          style={{
                            fontSize: '10px',
                            backgroundColor: 'var(--text-muted)',
                            color: '#ffffff',
                            opacity: 0.75
                          }}
                        >
                          replay
                        </span>
                      )}

                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {summary}
                      </span>
                    </div>

                    {/* Right: entity ref & relative timestamp */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {ev.entity_id && (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            color: 'var(--text-muted)'
                          }}
                        >
                          {ev.entity_id}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          minWidth: '55px',
                          textAlign: 'right'
                        }}
                      >
                        {relTime}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
