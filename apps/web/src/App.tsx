import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore.js';
import { AppShell } from './components/AppShell.js';
import { LoginPage } from './pages/LoginPage.js';
import { HomePage } from './pages/HomePage.js';
import { InventoryPage } from './pages/InventoryPage.js';
import { WarehousePage } from './pages/WarehousePage.js';
import { ReceivingPage } from './pages/ReceivingPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { OrdersPage } from './pages/OrdersPage.js';
import { NewOrderPage } from './pages/NewOrderPage.js';
import { OrderDetailPage } from './pages/OrderDetailPage.js';
import { PickingPage } from './pages/PickingPage.js';
import { MissionDetailPage } from './pages/MissionDetailPage.js';
import { ExceptionsPage } from './pages/ExceptionsPage.js';
import { PackingPage } from './pages/PackingPage.js';
import { AdminPage } from './pages/AdminPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true
    }
  }
});

const ProtectedLayout: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <AppShell />;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/warehouse" element={<WarehousePage />} />
            <Route path="/receiving" element={<ReceivingPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/new" element={<NewOrderPage />} />
            <Route path="/orders/:ref" element={<OrderDetailPage />} />
            <Route path="/picking" element={<PickingPage />} />
            <Route path="/picking/:ref" element={<MissionDetailPage />} />
            <Route path="/packing" element={<PackingPage />} />
            <Route path="/exceptions" element={<ExceptionsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};
