import React, { useState, useEffect } from 'react';
import type { User } from './types/hub';
import { Navbar } from './components/Navbar';
import { LoginView } from './components/views/LoginView';
import { FleetDirectoryView } from './components/views/FleetDirectoryView';
import { TenantsAndGroupsView } from './components/views/TenantsAndGroupsView';
import { UsersAndAccessView } from './components/views/UsersAndAccessView';
import { AuditLogsView } from './components/views/AuditLogsView';
import { HubSettingsView } from './components/views/HubSettingsView';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<string>('directory');
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

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/hub/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      localStorage.removeItem('cloudhub_token');
      setCurrentUser(null);
      setActiveTab('directory');
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xs text-[var(--text-secondary)] font-mono">
        Loading CloudHub...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setActiveTab('directory');
        }}
        currentTheme={theme}
        onThemeChange={setTheme}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-dark)] text-[var(--text-primary)]">
      <Navbar
        currentUser={currentUser}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onLogout={handleLogout}
        currentTheme={theme}
        onThemeChange={setTheme}
      />

      <main className="flex-1">
        {activeTab === 'directory' && <FleetDirectoryView currentUser={currentUser} />}
        {activeTab === 'tenants' && <TenantsAndGroupsView currentUser={currentUser} />}
        {activeTab === 'users' && <UsersAndAccessView currentUser={currentUser} />}
        {activeTab === 'audit' && <AuditLogsView />}
        {activeTab === 'settings' && <HubSettingsView />}
      </main>
    </div>
  );
};
