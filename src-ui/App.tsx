import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { UserDashboard } from './UserDashboard';
import { Auth } from './components/Auth';
import { SupportPage } from './components/SupportPage';
import { api } from './api/client';
import './index.css';

function App() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'auth' | 'support'>('auth');
  // State to track which dashboard view is active for Admins
  const [adminViewMode, setAdminViewMode] = useState<'admin' | 'user'>('admin');

  const checkAuth = async () => {
    try {
      const res = await api.getMe();
      if (res.success) {
        setProfile(res.profile);
      }
    } catch (e) {
      console.log('Not logged in');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
    // Signal to Electron that React has mounted and is ready to show
    if ((window as any).electron && (window as any).electron.sendAppReady) {
      // Small delay to ensure hydration/painting is done
      setTimeout(() => {
        (window as any).electron.sendAppReady();
      }, 100);
    }
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
      </div>
    );
  }

  // Not logged in routing
  if (!profile) {
    if (currentView === 'support') {
      return <SupportPage onBack={() => setCurrentView('auth')} />;
    }
    return (
      <Auth
        onSuccess={(p) => setProfile(p)}
        onSupportClick={() => setCurrentView('support')}
      />
    );
  }



  // Admin access with View Switching
  if (profile.role === 'admin') {
    if (adminViewMode === 'admin') {
      return (
        <div className="h-screen w-screen overflow-hidden">
          <Dashboard
            username={profile.username}
            onLogout={() => setProfile(null)}
            onSwitchToUser={() => setAdminViewMode('user')}
          />
        </div>
      );
    } else {
      // Render UserDashboard for Admin but with extra prop to switch back
      return (
        <UserDashboard
          username={profile.username}
          onLogout={() => setProfile(null)}
          isAdmin={true}
          onSwitchToAdmin={() => setAdminViewMode('admin')}
        />
      );
    }
  }

  // Default User Dashboard (Non-Admin)
  return (
    <UserDashboard
      username={profile.username}
      onLogout={() => setProfile(null)}
    />
  );
}

export default App;
