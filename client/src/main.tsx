import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AppLayout } from "./components/Layout";
import { Spinner, ToastProvider } from "./components/ui";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import AccountPage from "./pages/Account";
import AuditPage from "./pages/Audit";
import DashboardPage from "./pages/Dashboard";
import LoginPage from "./pages/Login";
import MonitoringPage from "./pages/Monitoring";
import { ForbiddenPage, NotFoundPage } from "./pages/NotFound";
import OdometerPage from "./pages/Odometer";
import ReportsPage from "./pages/Reports";
import RequestDetailPage from "./pages/RequestDetail";
import RequestFormPage from "./pages/RequestForm";
import RequestsPage from "./pages/Requests";
import SettingsPage from "./pages/Settings";
import TransactionDetailPage from "./pages/TransactionDetail";
import TransactionsPage from "./pages/Transactions";
import UsersPage from "./pages/Users";
import VehicleDetailPage from "./pages/VehicleDetail";
import VehiclesPage from "./pages/Vehicles";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: (n, e) => n < 1 && !(e as { status?: number }).status } },
});

function Protected({ children, perms }: { children: ReactNode; perms?: string[] }) {
  const { user, loading, can } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Loading FUELTRACK…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.mustChangePassword && loc.pathname !== "/account") return <Navigate to="/account" replace />;
  if (perms && !can(...perms)) return <ForbiddenPage />;
  return <>{children}</>;
}

const REQUEST_VIEW = ["request.view_own", "request.view_all", "request.view_assigned", "request.view_issuable"];

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<Protected perms={["dashboard.view"]}><DashboardPage /></Protected>} />
        <Route path="requests" element={<Protected perms={REQUEST_VIEW}><RequestsPage /></Protected>} />
        <Route path="requests/new" element={<Protected perms={["request.create"]}><RequestFormPage /></Protected>} />
        <Route path="requests/:id" element={<Protected perms={REQUEST_VIEW}><RequestDetailPage /></Protected>} />
        <Route path="requests/:id/edit" element={<Protected perms={["request.create"]}><RequestFormPage /></Protected>} />
        <Route path="transactions" element={<Protected perms={["transaction.view"]}><TransactionsPage /></Protected>} />
        <Route path="transactions/:id" element={<Protected perms={["transaction.view"]}><TransactionDetailPage /></Protected>} />
        <Route path="odometer" element={<Protected perms={["odometer.view"]}><OdometerPage /></Protected>} />
        <Route path="vehicles" element={<Protected perms={["vehicle.view"]}><VehiclesPage /></Protected>} />
        <Route path="vehicles/:id" element={<Protected perms={["vehicle.view"]}><VehicleDetailPage /></Protected>} />
        <Route path="monitoring" element={<Protected perms={["monitoring.view"]}><MonitoringPage /></Protected>} />
        <Route path="reports" element={<Protected perms={["report.view"]}><ReportsPage /></Protected>} />
        <Route path="users" element={<Protected perms={["user.manage"]}><UsersPage /></Protected>} />
        <Route path="settings" element={<Protected perms={["settings.manage"]}><SettingsPage /></Protected>} />
        <Route path="audit" element={<Protected perms={["audit.view"]}><AuditPage /></Protected>} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
