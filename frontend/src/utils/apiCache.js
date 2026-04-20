// API Response Cache with TTL (Time To Live)
// Provides in-memory caching for API responses to reduce server load

const cache = new Map();
const pendingRequests = new Map(); // For request deduplication

// Default TTL values (in milliseconds)
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes for list endpoints
const DASHBOARD_TTL = 1 * 60 * 1000; // 1 minute for dashboard stats
const SEARCH_TTL = 2 * 60 * 1000; // 2 minutes for search results

/**
 * Generate a cache key from endpoint and parameters
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Optional parameters object
 * @returns {string} Cache key
 */
const generateCacheKey = (endpoint, params = {}) => {
  const paramsStr = Object.keys(params)
    .sort()
    .map(key => `${key}=${JSON.stringify(params[key])}`)
    .join('&');
  return paramsStr ? `${endpoint}?${paramsStr}` : endpoint;
};

/**
 * Check if cached data is still valid
 * @param {Object} cacheEntry - Cache entry with timestamp and ttl
 * @returns {boolean} True if cache is valid
 */
const isCacheValid = (cacheEntry) => {
  if (!cacheEntry) return false;
  const now = Date.now();
  const age = now - cacheEntry.timestamp;
  return age < cacheEntry.ttl;
};

/**
 * Get cached data if available and valid
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Optional parameters
 * @returns {any|null} Cached data or null if not available/expired
 */
export const getCached = (endpoint, params = {}) => {
  const key = generateCacheKey(endpoint, params);
  const entry = cache.get(key);
  
  if (entry && isCacheValid(entry)) {
    return entry.data;
  }
  
  if (entry && !isCacheValid(entry)) {
    // Remove expired entry
    cache.delete(key);
  }
  
  return null;
};

/**
 * Store data in cache
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Optional parameters
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in milliseconds (optional, uses default if not provided)
 */
export const setCached = (endpoint, params = {}, data, ttl = null) => {
  const key = generateCacheKey(endpoint, params);
  const cacheTTL = ttl || getDefaultTTL(endpoint);
  
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: cacheTTL
  });
};

/**
 * Get default TTL based on endpoint type
 * @param {string} endpoint - API endpoint
 * @returns {number} TTL in milliseconds
 */
const getDefaultTTL = (endpoint) => {
  // Dashboard stats have shorter TTL
  if (endpoint.includes('get_today') || endpoint.includes('dashboard')) {
    return DASHBOARD_TTL;
  }
  
  // Search endpoints have medium TTL
  if (endpoint.includes('search') || endpoint.includes('get_items_list')) {
    return SEARCH_TTL;
  }
  
  // Default TTL for list endpoints
  return DEFAULT_TTL;
};

/**
 * Invalidate cache for specific endpoint pattern
 * @param {string} pattern - Endpoint pattern (supports partial matches)
 */
export const invalidateCache = (pattern) => {
  const keysToDelete = [];
  
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => {
    cache.delete(key);
  });
  
  return keysToDelete.length;
};

/**
 * Invalidate all cache entries
 */
export const clearCache = () => {
  const size = cache.size;
  cache.clear();
  return size;
};

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
export const getCacheStats = () => {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;
  
  for (const entry of cache.values()) {
    if (isCacheValid(entry)) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }
  
  return {
    total: cache.size,
    valid: validEntries,
    expired: expiredEntries,
    pendingRequests: pendingRequests.size
  };
};

/**
 * Track a pending request to prevent duplicate concurrent requests
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Optional parameters
 * @returns {Promise|null} Existing promise if request is pending, null otherwise
 */
export const getPendingRequest = (endpoint, params = {}) => {
  const key = generateCacheKey(endpoint, params);
  return pendingRequests.get(key) || null;
};

/**
 * Set a pending request
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Optional parameters
 * @param {Promise} promise - Request promise
 */
export const setPendingRequest = (endpoint, params = {}, promise) => {
  const key = generateCacheKey(endpoint, params);
  pendingRequests.set(key, promise);
  
  // Clean up when promise resolves/rejects
  promise.finally(() => {
    pendingRequests.delete(key);
  });
};

/**
 * Clear expired cache entries (cleanup function)
 */
export const cleanupExpiredCache = () => {
  const now = Date.now();
  const keysToDelete = [];
  
  for (const [key, entry] of cache.entries()) {
    if (!isCacheValid(entry)) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => cache.delete(key));
  
  return keysToDelete.length;
};

// Clean up expired cache entries every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(cleanupExpiredCache, 5 * 60 * 1000);
}

export default {
  getCached,
  setCached,
  invalidateCache,
  clearCache,
  getCacheStats,
  getPendingRequest,
  setPendingRequest,
  cleanupExpiredCache
};

