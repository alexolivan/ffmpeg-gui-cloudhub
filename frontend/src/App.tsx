import React, { useState, useEffect } from 'react';
import type { User, Organization } from './types/hub';
import { Sidebar } from './components/Sidebar';
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
  const [publicBranding, setPublicBranding] = useState<{
    login_logo_text?: string;
    login_logo_url?: string;
    hub_name?: string;
  }>({});
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const fetchPublicBranding = async () => {
    try {
      const res = await fetch('/api/hub/public-branding');
      if (res.ok) {
        const data = await res.json();
        setPublicBranding(data);
        if (data.login_logo_url) {
          let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
          if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
          }
          link.href = data.login_logo_url;
        }
      }
    } catch {
      // Non-blocking
    }
  };

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
    fetchPublicBranding();
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
        branding={publicBranding}
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
        logoText={hubSettings?.login_logo_text || publicBranding?.login_logo_text || 'CH'}
        logoPath={hubSettings?.login_logo_url || publicBranding?.login_logo_url || undefined}
        organizations={organizations}
        selectedOrgId={selectedOrgId}
        onSelectOrg={setSelectedOrgId}
      />

      {/* ── Main Canvas (Parity with ffmpeg-gui: No global topbar, full horizontal canvas) ── */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        {activeView === 'fleet' && (
          <FleetView currentUser={currentUser} selectedOrgId={selectedOrgId} />
        )}

        {activeView === 'audit' &&
          (currentUser.role === 'superadmin' ||
            currentUser.role === 'org_admin' ||
            currentUser.role === 'tenant_admin') && (
            <AuditLogsView currentUser={currentUser} selectedOrgId={selectedOrgId} />
          )}

        {activeView === 'settings' &&
          (currentUser.role === 'superadmin' ||
            currentUser.role === 'org_admin' ||
            currentUser.role === 'tenant_admin') && (
            <SettingsView
              currentUser={currentUser}
              selectedOrgId={selectedOrgId}
              currentTheme={theme}
              onThemeChange={setTheme}
              onSettingsUpdated={fetchAppData}
              onUserUpdated={checkAuth}
            />
          )}
      </main>
    </div>
  );
};

export default App;
