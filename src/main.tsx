import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/charts.css';
import App from './App';
import { bindSettingsToDocument } from './store/ui';

// Darstellung vor dem ersten Rendern anwenden (kein Aufblitzen im falschen Modus)
bindSettingsToDocument();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Übergänge erst nach dem ersten Bild einschalten (:root:not(.ready) * { transition: none })
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('ready')));
