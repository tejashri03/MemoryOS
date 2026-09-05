import { useMemo, useState } from 'react';
import DashboardPage from './pages/Dashboard/MemoryWorkspace';

const navigation = [
  { id: 'Dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'My Images', label: 'My Images', icon: GalleryIcon },
  { id: 'Categories', label: 'Categories', icon: CategoryIcon },
  { id: 'Important', label: 'Important', icon: StarIcon },
  { id: 'Duplicates', label: 'Duplicates', icon: DuplicateIcon },
  { id: 'Recent', label: 'Recent', icon: RecentIcon },
  { id: 'Search', label: 'Search', icon: SearchIcon },
  { id: 'Settings', label: 'Settings', icon: SettingsIcon },
  { id: 'Security', label: 'Security', icon: ShieldIcon },
];

export default function App() {
  const [activeSection, setActiveSection] = useState('Dashboard');

  const activeConfig = useMemo(
    () => navigation.find((item) => item.id === activeSection) ?? navigation[0],
    [activeSection],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span className="brand-mark-core">M</span>
          </div>
          <div>
            <p className="brand-kicker">Personal image memory</p>
            <h1 className="brand-name">MemoryOS</h1>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {navigation.map((item) => {
            const isActive = item.id === activeSection;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                className={isActive ? 'nav-item active' : 'nav-item'}
                onClick={() => setActiveSection(item.id)}
              >
                <Icon active={isActive} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <p className="sidebar-footer-label">LOCAL STORAGE</p>
          <strong>Offline-first</strong>
          <span>Images stay in their original folders.</span>
          <div className="storage-meter"><span /></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="page-kicker">{activeConfig.label}</p>
            <h2>MemoryOS</h2>
            <p className="topbar-subtitle">Your personal image memory</p>
          </div>

          <div className="topbar-actions">
            <button type="button" className="header-search" onClick={() => setActiveSection('Search')}>
              <SearchIcon active={false} />
              <span>Search images, categories, OCR text...</span>
              <kbd>/</kbd>
            </button>
            <button type="button" className="icon-button" aria-label="Notifications" title="Notifications" onClick={() => window.alert('No new notifications.') }><BellIcon /></button>
            <button type="button" className="icon-button" aria-label="Help" title="Help" onClick={() => window.alert('Select Scan Folder to index local images, then use Search or Categories to browse them.') }><HelpIcon /></button>
            <div className="profile-chip"><span className="profile-avatar">M</span><span>Local user</span></div>
          </div>
        </header>

        <DashboardPage activeSection={activeSection} onNavigate={setActiveSection} />
      </main>
    </div>
  );
}

function DashboardIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true">
      <path d="M4 5.5h6.5v6.5H4z" />
      <path d="M13.5 5.5H20V12h-6.5z" />
      <path d="M4 15h6.5v3.5H4z" />
      <path d="M13.5 14.5H20v4H13.5z" />
    </svg>
  );
}

function SearchIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true">
      <circle cx="11" cy="11" r="5.5" />
      <path d="M15.5 15.5 20 20" />
    </svg>
  );
}

function GalleryIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true">
      <path d="M4.5 6.5h15v11h-15z" />
      <path d="M7 14l3-3 3.5 4 2.5-2.5 2.5 3.5" />
      <circle cx="8.5" cy="9" r="1.2" />
    </svg>
  );
}

function DuplicateIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true">
      <rect x="5" y="6" width="10" height="12" rx="2" />
      <rect x="9" y="4" width="10" height="12" rx="2" />
    </svg>
  );
}

function SettingsIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 4.5v2" />
      <path d="M12 17.5v2" />
      <path d="M4.5 12h2" />
      <path d="M17.5 12h2" />
      <path d="m6.7 6.7 1.4 1.4" />
      <path d="m15.9 15.9 1.4 1.4" />
      <path d="m17.3 6.7-1.4 1.4" />
      <path d="m8.1 15.9-1.4 1.4" />
    </svg>
  );
}

function CategoryIcon({ active }) {
  return <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true"><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" /></svg>;
}

function StarIcon({ active }) {
  return <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true"><path d="m12 4 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L12 4Z" /></svg>;
}

function RecentIcon({ active }) {
  return <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true"><circle cx="12" cy="12" r="7.5" /><path d="M12 8v4l2.8 1.8" /></svg>;
}

function ShieldIcon({ active }) {
  return <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true"><path d="M12 3.8 19 6v5.2c0 4.5-2.9 7.5-7 9-4.1-1.5-7-4.5-7-9V6l7-2.2Z" /><path d="m9 12 2 2 4-4" /></svg>;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" className="utility-icon" aria-hidden="true"><path d="M6.5 16.5h11l-1.3-1.8V10a4.2 4.2 0 0 0-8.4 0v4.7l-1.3 1.8Z" /><path d="M10 19h4" /></svg>;
}

function HelpIcon() {
  return <svg viewBox="0 0 24 24" className="utility-icon" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M9.8 9.2a2.3 2.3 0 1 1 3.8 1.7c-.9.8-1.6 1.1-1.6 2.2M12 16.5h.01" /></svg>;
}

