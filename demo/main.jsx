import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import HolidayCalendar from '../src/frontend/HolidayCalendar.jsx';
import './style.css';

function Demo() {
  const [draft, setDraft] = useState('Holidays in 2026');
  const [query, setQuery] = useState(draft);
  return <main>
    <header><p>HYPERDART HACKATHON PROJECT</p><h1>Holiday Calendar & Smart PTO Optimizer</h1>
    <p>Explore public holidays and find longer breaks with fewer leave days.</p></header>
    <form onSubmit={e => { e.preventDefault(); setQuery(draft); }}>
      <label htmlFor="query">Date query</label>
      <div className="query"><input id="query" value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. July 2026 or December 25 2026"/><button>Explore</button></div>
      <small>Choose a country inside the calendar. Try “next year”, “July 2026”, or “December 25 2026”.</small>
    </form>
    <HolidayCalendar searchData={{query}} />
    <footer>Standalone demonstration of the original React component. Holiday coverage depends on the source and region; confirm your employer's leave calendar.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<Demo/>);
