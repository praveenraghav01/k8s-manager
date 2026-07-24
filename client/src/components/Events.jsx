import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Icon from './Icons';
import Loader from './Loader';

export default function Events({ namespace = 'all' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchEvents();
  }, [namespace]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const ns = namespace || 'all';
      const response = await axios.get(`/api/events/${ns}`);
      setEvents(response.data.events || []);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch events: ${err.message}`);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const formatAge = (seconds) => {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  return (
    <div className="events-container">
      <div className="events-toolbar">
        <h3>Cluster Events</h3>
        <button className="events-refresh-btn" onClick={fetchEvents} disabled={loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      <div className="events-content">
        {loading && <Loader label="Loading events…" />}
        {error && <div className="events-error">{error}</div>}
        {!loading && !error && events.length === 0 && (
          <div className="events-empty">No recent events</div>
        )}
        {!loading && !error && events.length > 0 && (
          <table className="events-table">
            <thead>
              <tr>
                <th>Message</th>
                <th>Namespace</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Object</th>
                <th>Count</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, idx) => (
                <tr key={idx} className={`event-row event-${event.type.toLowerCase()}`}>
                  <td className="event-message">{event.message}</td>
                  <td className="event-namespace">{event.namespace}</td>
                  <td className="event-type">
                    <span className={`event-type-badge event-type-${event.type.toLowerCase()}`}>
                      {event.type}
                    </span>
                  </td>
                  <td className="event-reason">{event.reason}</td>
                  <td className="event-object">{event.involvedObject}</td>
                  <td className="event-count">{event.count}</td>
                  <td className="event-age">{formatAge(event.age)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
