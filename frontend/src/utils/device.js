const KEY = 'gpp_device_id';

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}
