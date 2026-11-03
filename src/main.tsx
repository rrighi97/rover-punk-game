import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './player-console.css';

// Telefono in orizzontale: lato del notch/Dynamic Island, letto da styles.css (data-notch) per
// restringere il margine di sicurezza sul lato libero. 90 = parte alta del telefono a sinistra.
const syncNotch=()=>{
  const angle=typeof window.orientation==='number'?window.orientation:(screen.orientation?.angle??0);
  document.documentElement.dataset.notch=angle===90?'left':angle===-90||angle===270?'right':'';
};
syncNotch();
window.addEventListener('orientationchange',syncNotch);
window.addEventListener('resize',syncNotch);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
