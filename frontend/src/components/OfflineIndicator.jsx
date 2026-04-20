import * as React from 'react';
import { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle', 'syncing', 'success', 'error'
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncStatus('syncing');
      // Simulate sync process
      setTimeout(() => {
        setSyncStatus('success');
        setQueuedCount(0);
        setTimeout(() => setSyncStatus('idle'), 2000);
      }, 1000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus('idle');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check for queued items in IndexedDB or localStorage
    const checkQueuedItems = () => {
      try {
        // This would check IndexedDB for queued requests
        // For now, we'll use a simple approach
        const queued = localStorage.getItem('pwa-queued-requests');
        if (queued) {
          const requests = JSON.parse(queued);
          setQueuedCount(requests.length || 0);
        }
      } catch (error) {
        console.error('Error checking queued items:', error);
      }
    };

    checkQueuedItems();
    const interval = setInterval(checkQueuedItems, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  if (isOnline && syncStatus === 'idle' && queuedCount === 0) {
    return null; // Don't show when online and nothing to sync
  }

  const getStatusMessage = () => {
    if (!isOnline) {
      return 'You are offline';
    }
    if (syncStatus === 'syncing') {
      return 'Syncing...';
    }
    if (syncStatus === 'success') {
      return 'Synced successfully';
    }
    if (queuedCount > 0) {
      return `${queuedCount} item(s) queued for sync`;
    }
    return 'Online';
  };

  const getStatusColor = () => {
    if (!isOnline) return 'var(--danger)';
    if (syncStatus === 'syncing') return 'var(--warning)';
    if (syncStatus === 'success') return 'var(--secondary)';
    if (queuedCount > 0) return 'var(--info)';
    return 'var(--secondary)';
  };

  return (
    <div className="offline-indicator" style={{ borderLeftColor: getStatusColor() }}>
      <div className="offline-indicator-content">
        <div className="offline-indicator-icon">
          {!isOnline ? (
            <WifiOff size={16} />
          ) : syncStatus === 'syncing' ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            <Wifi size={16} />
          )}
        </div>
        <div className="offline-indicator-text">
          {getStatusMessage()}
        </div>
      </div>
    </div>
  );
}

export default OfflineIndicator;

