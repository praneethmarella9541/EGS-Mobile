import Constants from 'expo-constants';

// Change this to your machine's local IP when testing on a physical device
const DEV_API_HOST = '192.168.1.16';

function getApiUrl() {
  if (__DEV__) {
    const host = Constants.expoConfig?.hostUri?.split(':')[0];
    if (host && host !== 'localhost') {
      return `http://${host}:3001/api`;
    }
    return `http://${DEV_API_HOST}:3001/api`;
  }
  return 'http://localhost:3001/api';
}

export const API_URL = getApiUrl();
