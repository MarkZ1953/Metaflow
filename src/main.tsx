import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './app/providers/app-provider';
import { AppLayout } from './app/layouts/app-layout';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el punto de montaje de Metaflow.');
createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <AppLayout />
    </AppProvider>
  </StrictMode>,
);
