// Public demonstration: no updater or ATS-operated remote service is enabled.
export const REMOTE_UPDATES_CONFIGURED: boolean = false;
export const REMOTE_UPDATES_CHECK_ONLY: boolean = false;
export const REMOTE_UPDATE_VALIDATION_URL = 'https://updates.example.invalid/';
export const REMOTE_TELEMETRY_CONFIGURED = false;
export const REMOTE_TAX_CATALOG_CONFIGURED = false;
export const REMOTE_EMAIL_CONFIGURED = false;
export const REMOTE_SUPPORT_CONFIGURED = false;

export const CLOUD_CONFIGURATION_ERROR = 'Cloud service is not configured. Configure an explicit HTTPS endpoint before enabling it.';

export function assertCloudDestination(url: URL): void {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (['flopos.com', 'flocafe.com', 'flo.local'].some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error('This upstream infrastructure is unavailable for ATS Serve. Configure your own cloud endpoint.');
  }
  if (host === 'soflo.codify.tech' || host.endsWith('.soflo.codify.tech')) {
    throw new Error('Upstream infrastructure is unavailable for ATS Serve');
  }
  if (['github.com', 'api.github.com', 'www.github.com', 'raw.githubusercontent.com'].includes(host)
    && /^\/+(?:repos\/)?FreeOpenSourcePOS\/FloCafe(?:-Plugins)?(?:\/|$)/i.test(decodeURIComponent(url.pathname))) {
    throw new Error('Upstream release infrastructure is unavailable for ATS Serve');
  }
  if (url.username || url.password) throw new Error('Cloud server URL must not contain credentials');
}
