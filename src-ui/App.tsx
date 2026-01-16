import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { UserDashboard } from './UserDashboard';
import { Auth } from './components/Auth';
import { api } from './api/client';
import './index.css';

function App() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
      </div>
    );
  }

  if (!profile) {
    return <Auth onSuccess={(p) => setProfile(p)} />;
  }

  // Admin access
  if (profile.role === 'admin') {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <Dashboard username={profile.username} onLogout={() => setProfile(null)} />
      </div>
    );
  }

  // Default User Dashboard
  return (
    <UserDashboard
      username={profile.username}
      onLogout={() => setProfile(null)}
    />
  );
}

export default App;
