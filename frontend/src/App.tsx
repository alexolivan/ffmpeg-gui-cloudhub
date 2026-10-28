import React, { useState, useEffect } from 'react';
import type { User, Organization } from './types/hub';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/views/LoginView';
import { FleetView } from './components/views/FleetView';
import { AuditLogsView } from './components/views/AuditLogsView';
import { SettingsView } from './components/views/SettingsView';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeView, setActiveView] = useState<string>('fleet');
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [hubSettings, setHubSettings] = useState<Record<string, any>>({});
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const [theme, setTheme] = useState<string>(() => {
    return localStorage.getItem('cloudhub_theme') || 'studio-dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cloudhub_theme', theme);
  }, [theme]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/hub/auth/me', { credentials: 'include' });
      if (res.ok) {
        const user = await res.json();
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const fetchAppData = async () => {
    try {
      const orgsRes = await fetch('/api/hub/orgs', { credentials: 'include' });
      if (orgsRes.ok) {
        setOrganizations(await orgsRes.json());
      }
    } catch {
      // Non-blocking
    }

    try {
      const setRes = await fetch('/api/hub/settings', { credentials: 'include' });
      if (setRes.ok) {
        setHubSettings(await setRes.json());
      }
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchAppData();
      if (currentUser.org_id) {
        setSelectedOrgId(currentUser.org_id);
      }
    }
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      await fetch('/api/hub/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      localStorage.removeItem('cloudhub_token');
      setCurrentUser(null);
      setActiveView('fleet');
      setSelectedOrgId(null);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xs text-[var(--text-secondary)] font-mono bg-[var(--bg-dark)]">
        Loading CloudHub...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setActiveView('fleet');
        }}
        currentTheme={theme}
        onThemeChange={setTheme}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-dark)] text-[var(--text-primary)] transition-colors duration-300">
      {/* ── Left Lateral Sidebar ── */}
      <Sidebar
        activeView={activeView}
        onViewChange={(v) => {
          if (v === 'settings' && (currentUser.role === 'operator' || currentUser.role === 'group_operator')) {
            setActiveView('fleet');
          } else {
            setActiveView(v);
          }
        }}
        currentUser={currentUser}
        onLogout={handleLogout}
        logoText={hubSettings?.login_logo_text || 'CH'}
        logoPath={hubSettings?.login_logo_url || undefined}
      />

      {/* ── Main Canvas with Header and Scrollable View ── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header
          activeView={activeView}
          currentUser={currentUser}
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          onSelectOrg={setSelectedOrgId}
          currentTheme={theme}
          onThemeChange={setTheme}
        />

        <main className="flex-1 overflow-y-auto">
          {activeView === 'fleet' && (
            <FleetView currentUser={currentUser} selectedOrgId={selectedOrgId} />
          )}

          {activeView === 'audit' && (
            <AuditLogsView currentUser={currentUser} selectedOrgId={selectedOrgId} />
          )}

          {activeView === 'settings' &&
            (currentUser.role === 'superadmin' ||
              currentUser.role === 'org_admin' ||
              currentUser.role === 'tenant_admin') && (
              <SettingsView currentUser={currentUser} selectedOrgId={selectedOrgId} />
            )}
        </main>
      </div>
    </div>
  );
};

export default App;
