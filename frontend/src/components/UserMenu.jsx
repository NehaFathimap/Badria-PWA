import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { User, LogOut } from 'lucide-react';
import { getUserInfo } from '../services/api';

function UserMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef(null);

  // Fetch user info
  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const userData = await getUserInfo();
        setUserInfo(userData);
      } catch (error) {
        console.error('Error fetching user info:', error);
        // Fallback to localStorage or default
        const apiKey = localStorage.getItem('api_key');
        setUserInfo({
          name: apiKey || 'User',
          email: '',
          full_name: apiKey || 'User',
          company: '',
        });
      } finally {
        setLoading(false);
      }
    };
    fetchUserInfo();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleLogoutClick = async () => {
    setIsOpen(false);
    if (onLogout) {
      onLogout();
    }
  };

  const displayName = userInfo?.full_name || userInfo?.name || 'User';
  const email = userInfo?.email || '';
  const userImage = userInfo?.user_image || null;

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="nav-item-secondary"
        style={{
          padding: '0.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          width: '36px',
          height: '36px',
          overflow: 'hidden',
          border: '2px solid var(--gray-300)',
          backgroundColor: 'var(--gray-50)',
        }}
        title={displayName}
      >
        {userImage ? (
          <img 
            src={userImage} 
            alt={displayName}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <User size={20} />
        )}
      </button>
      
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.5rem',
            backgroundColor: 'white',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            minWidth: '200px',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          {loading ? (
            <div style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--gray-500)' }}>
              Loading...
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--gray-200)', marginBottom: '0.75rem' }}>
                {userImage ? (
                  <img 
                    src={userImage} 
                    alt={displayName}
                    style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                    <User size={20} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayName}
                  </div>
                  {email && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email}
                    </div>
                  )}
                </div>
              </div>
              
              {userInfo?.company && (
                <div style={{ paddingBottom: '0.75rem', marginBottom: '0.75rem', borderBottom: '1px solid var(--gray-200)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>Company</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--gray-900)', fontWeight: 500 }}>
                    {userInfo.company}
                  </div>
                </div>
              )}
              
              <button
                onClick={handleLogoutClick}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  color: 'var(--danger)',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <LogOut size={16} />
                Logout
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default UserMenu;
