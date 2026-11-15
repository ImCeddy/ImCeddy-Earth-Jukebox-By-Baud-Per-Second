import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { preloadImagery } from './preloadImagery'

void preloadImagery().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
