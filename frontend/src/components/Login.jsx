import * as React from 'react';
import { useState } from 'react';
import { Package, LogIn, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { login } from '../services/api';
import { assetUrl } from '../utils/assetUrl';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Call login API
      const response = await login(username, password);
      
      // Check if response has required data (api_key, api_secret, token)
      if (response && (response.api_key || response.token)) {
        // Credentials are already stored by the login function
        localStorage.setItem('isAuthenticated', 'true');
        localStorage.setItem('username', username);
        onLogin();
      } else {
        setError('Login failed. Invalid response from server.');
      }
    } catch (err) {
      // Show API error message
      console.error('Login API error:', err);
      setError(err.message || 'Login failed. Please check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'white',
      padding: 'var(--space-4)'
    }}>
      <div className="card" style={{
        maxWidth: '400px',
        width: '100%',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1), 0 8px 40px rgba(0, 0, 0, 0.08)'
      }}>
        <div style={{
          textAlign: 'center',
          marginBottom: 'var(--space-8)'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
            marginBottom: 'var(--space-4)',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
            padding: '12px'
          }}>
            <img src={assetUrl('icon.png')} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <h1 style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            color: 'var(--gray-900)',
            marginBottom: 'var(--space-2)'
          }}>
            Badria
          </h1>
          <p style={{
            color: 'var(--gray-600)',
            fontSize: '0.875rem'
          }}>
            Sign in to continue
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              marginBottom: 'var(--space-4)',
              background: '#fee2e2',
              border: '1px solid #fecaca',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.1)'
            }}>
              <div style={{
                flexShrink: 0,
                marginTop: '2px'
              }}>
                <AlertCircle size={20} color="#dc2626" />
              </div>
              <div style={{
                flex: 1,
                color: '#991b1b',
                fontSize: '0.875rem',
                lineHeight: '1.5',
                fontWeight: 500
              }}>
                {error}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Username or Email</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username or email"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                style={{ paddingRight: '45px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--gray-500)',
                  transition: 'color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--gray-700)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--gray-500)'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff size={20} />
                ) : (
                  <Eye size={20} />
                )}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-6)' }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Signing In...
                </>
              ) : (
                <>
                  <LogIn size={20} />
                  Sign In
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Login;

