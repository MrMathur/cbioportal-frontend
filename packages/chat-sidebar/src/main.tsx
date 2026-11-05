import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initCatalog } from './lib/catalog';
import { listenForPageEvents } from './lib/page-events';
import './styles.css';

// Here rather than in App so StrictMode's double effects don't announce the
// iframe as ready twice.
initCatalog();
listenForPageEvents();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
    <StrictMode>
        <App />
    </StrictMode>
);
