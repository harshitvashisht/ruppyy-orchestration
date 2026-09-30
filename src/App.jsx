import { useEffect, useState } from 'react';

const lenderColors = { northstar: '#5368e7', harbor: '#159c83', summit: '#d88138' };
const money = value => `₹${Number(value).toLocaleString('en-IN')}`;
const eventLabels = {
  'application.created': ['CREATED', 'application'],
  'application.completed': ['COMPLETED', 'complete'],
  'application.duplicate_prevented': ['IDEMPOTENT', 'application'],
  'lender.requested': ['LENDER CALL', 'lender'],
  'lender.retry': ['RETRY', 'retry'],
  'lender.offer_received': ['OFFER RECEIVED', 'lender'],
};

function MetricCard({ title, icon, tone, value, unit, lead, foot }) {
  return <article className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-number">{value}{unit && <small>{unit}</small>}</div><div className="metric-foot"><span className={lead.className}>{lead.text}</span><span>{foot}</span></div></article>;
}

function OfferResults({ app }) {
  const available = app.offers.filter(offer => offer.status === 'offer').sort((a, b) => a.emi - b.emi);
  const bestId = available[0]?.lenderId;
  return <div className="result-area" aria-live="polite">
    <div className="result-header"><span className="result-title">{app.status === 'completed' ? 'Offers returned' : 'Matching complete'}</span><span className="app-ref">{app.id}</span></div>
    <div className="result-list">{app.offers.map(offer => <article className={`offer-card ${offer.status !== 'offer' ? 'offer-unavailable' : ''}`} key={offer.lenderId}>
      <div className="offer-top"><i className="offer-dot" style={{ background: lenderColors[offer.lenderId] }} />{offer.lender}</div>
      {offer.status === 'offer' ? <><div className="offer-emi">{money(offer.emi)}<small> / mo</small></div><div className="offer-details">{offer.rate}% APR · {money(offer.fee)} fee</div>{offer.lenderId === bestId && <div className="offer-best">Lowest monthly payment</div>}</> : <><div className="offer-emi">Unavailable</div><div className="offer-details">{offer.error} · {offer.attempts} attempts</div></>}
    </article>)}</div>
    {app.idempotentReplay && <div className="replay-note">↻ Idempotent replay · existing application returned · no duplicate created</div>}
  </div>;
}

function EventTable({ events }) {
  return <div className="event-table-wrap"><table><thead><tr><th>EVENT</th><th>APPLICATION</th><th>DETAIL</th><th>TIME</th></tr></thead><tbody>
    {events.length ? events.map(event => {
      const [label, type] = eventLabels[event.type] || [event.type.toUpperCase(), 'application'];
      return <tr key={event.id}><td><span className={`event-badge ${type}`}>{label}</span></td><td className="event-ref">{event.applicationId}</td><td className="event-detail">{event.message}</td><td className="event-time">{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td></tr>;
    }) : <tr className="no-events"><td colSpan="4"><span className="table-empty-icon">◷</span>Waiting for the first application…</td></tr>}
  </tbody></table></div>;
}

function App() {
  const [form, setForm] = useState({ product: 'used-car', amount: '450000', tenure: '36', scenario: 'normal' });
  const [application, setApplication] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [apiHealthy, setApiHealthy] = useState(false);
  const [activeNav, setActiveNav] = useState('overview');
  const [metrics, setMetrics] = useState({ apps: 0, received: 0, calls: 0, retries: 0, ms: 0 });

  async function refreshEvents() {
    try {
      const response = await fetch('/api/events');
      const data = await response.json();
      setEvents(data.events);
    } catch { /* Keep the last successful event snapshot visible. */ }
  }

  useEffect(() => {
    fetch('/api/health').then(response => response.json()).then(data => setApiHealthy(data.ok)).catch(() => setApiHealthy(false));
    refreshEvents();
    const interval = window.setInterval(refreshEvents, 2000);
    return () => window.clearInterval(interval);
  }, []);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const started = performance.now();
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      const elapsed = performance.now() - started;
      setApplication(data);
      setMetrics(current => ({
        apps: current.apps + 1,
        received: current.received + data.offers.filter(offer => offer.status === 'offer').length,
        calls: current.calls + data.offers.length,
        retries: current.retries + data.offers.reduce((sum, offer) => sum + Math.max(0, offer.attempts - 1), 0),
        ms: current.ms + elapsed,
      }));
      await refreshEvents();
      notify(`Lender match finished in ${(elapsed / 1000).toFixed(1)}s.`);
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  }

  const responseRate = metrics.calls ? Math.round(metrics.received / metrics.calls * 100) : '—';
  const averageSeconds = metrics.apps ? (metrics.ms / metrics.apps / 1000).toFixed(1) : '—';

  return <div className="min-h-screen">
    <aside className="rail">
      <a className="brand" href="#overview" aria-label="Relay home"><span className="brand-mark">r</span><span>relay<span className="brand-dot">.</span></span></a>
      <div className="rail-label">WORKSPACE</div>
      {[['overview', '◫', 'Overview'], ['application', '↗', 'New application'], ['activity', '◷', 'Event stream']].map(([id, icon, label]) => <a key={id} className={`nav-item ${activeNav === id ? 'active' : ''}`} href={`#${id}`} onClick={() => setActiveNav(id)}><span className="nav-icon">{icon}</span>{label}</a>)}
      <div className="rail-bottom"><span className="live-dot" /><span>Mock environment</span><span className="rail-version">v1.0</span></div>
    </aside>

    <main className="main" id="overview">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>Orchestration</strong></div><div className="top-actions"><span className="env-pill"><i /> SANDBOX</span><span className="avatar">DE</span></div></header>
      <section className="welcome"><div><div className="eyebrow">LENDER OPERATIONS <span className="eyebrow-line" /> LIVE SIMULATION</div><h1>Good morning<span className="period">.</span></h1><p>See how one application travels across multiple lenders.</p></div><div className="welcome-date"><span className="date-dot" /> All systems operational</div></section>

      <section className="metric-grid" aria-label="Simulation metrics">
        <MetricCard title="Applications today" icon="↗" tone="purple" value={metrics.apps} lead={{ text: 'This session', className: 'neutral-change' }} foot="since you opened Relay" />
        <MetricCard title="Lender response rate" icon="⌁" tone="green" value={responseRate} unit="%" lead={{ text: 'Mock network', className: 'green-text' }} foot="responses received" />
        <MetricCard title="Avg. response time" icon="◷" tone="amber" value={averageSeconds} unit="s" lead={{ text: 'Parallel requests', className: 'neutral-change' }} foot="per application" />
        <MetricCard title="Retries handled" icon="↻" tone="blue" value={metrics.retries} lead={{ text: 'Resilience layer', className: 'blue-text' }} foot="automatic retries" />
      </section>

      <section className="work-grid">
        <article className="panel application-panel" id="application">
          <div className="panel-heading"><div><div className="section-kicker">APPLICATION PLAYGROUND</div><h2>Run a lender match</h2><p>Submit synthetic data to three mock lender APIs.</p></div><span className="step-count">01 <span>/</span> 02</span></div>
          <form onSubmit={submit}>
            <div className="field-row"><label>Loan product<select value={form.product} onChange={event => setForm({ ...form, product: event.target.value })}><option value="used-car">Used car</option><option value="two-wheeler">Two-wheeler</option></select></label><label>Loan amount<div className="input-prefix"><span>₹</span><input type="number" value={form.amount} min="25000" max="2500000" step="5000" required onChange={event => setForm({ ...form, amount: event.target.value })} /></div></label></div>
            <div className="field-row"><label>Repayment tenure<select value={form.tenure} onChange={event => setForm({ ...form, tenure: event.target.value })}>{[12, 24, 36, 48, 60].map(months => <option key={months} value={months}>{months} months</option>)}</select></label><label>Network scenario<select value={form.scenario} onChange={event => setForm({ ...form, scenario: event.target.value })}><option value="normal">Healthy network</option><option value="one-timeout">One lender times out</option></select></label></div>
            <div className="privacy-note"><span className="lock-icon">▣</span><span>Demo only. No personal data collected. Lenders and offers are simulated.</span></div>
            <div className="form-actions"><button className="primary-button" type="submit" disabled={busy}><span>{busy ? 'Matching lenders…' : 'Run lender match'}</span><span className="button-arrow">↗</span></button><span className="request-hint"><kbd>POST</kbd> /api/applications</span></div>
          </form>
          {application ? <OfferResults app={application} /> : <div className="result-area"><div className="empty-result"><div className="empty-orbit"><span>↗</span></div><strong>Your results will appear here</strong><span>Submit an application to start orchestration.</span></div></div>}
        </article>

        <article className="panel network-panel"><div className="panel-heading compact"><div><div className="section-kicker">CONNECTED SERVICES</div><h2>Lender network</h2></div><span className="connected-count"><i /> 3 connected</span></div>
          <div className="lender-list">{[['N', 'northstar', 'Northstar Bank', 'Vehicle finance · v2 API'], ['H', 'harbor', 'Harbor Finance', 'Consumer lending · v1 API'], ['S', 'summit', 'Summit Credit', 'Auto loans · v3 API']].map(([initial, id, name, description]) => <div className="lender-row" key={id}><div className={`lender-logo ${id}`}>{initial}</div><div className="lender-info"><strong>{name}</strong><span>{description}</span></div><span className="lender-status"><i /> Ready</span></div>)}</div>
          <div className="architecture"><div className="arch-label">REQUEST FLOW</div><div className="flow"><div className="flow-node">Application</div><span>→</span><div className="flow-node orchestrator">Relay<br /><small>orchestrator</small></div><span>→</span><div className="flow-stack"><div className="flow-node mini">Northstar</div><div className="flow-node mini">Harbor</div><div className="flow-node mini">Summit</div></div></div><div className="flow-caption"><span>Parallel fan-out</span><span>Timeout · retry · aggregate</span></div></div>
          <div className="idempotency-card"><div className="idempotency-symbol">⟲</div><div><strong>Idempotency protection</strong><p>Replayed requests return the original application.</p></div><span className="on-tag">ON</span></div>
        </article>
      </section>

      <section className="panel activity-panel" id="activity"><div className="activity-heading"><div><div className="section-kicker">SYSTEM TRACE</div><h2>Event stream <span className="live-label"><i /> LIVE</span></h2></div><button className="text-button" type="button" onClick={() => { setEvents([]); notify('Event stream view cleared. The server history is unchanged.'); }}>Clear view <span>↗</span></button></div><EventTable events={events} /></section>
      <footer className="footer"><span>RELAY <span className="footer-dot">●</span> ENGINEERING DEMO</span><span>All lender responses are simulated · Built for learning</span><span>API <b className="api-state"><i style={{ background: apiHealthy ? undefined : '#db7777' }} /> {apiHealthy ? 'HEALTHY' : 'OFFLINE'}</b></span></footer>
    </main>
    <div className={`toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
  </div>;
}

export default App;
