import { invoke } from '@tauri-apps/api/core';

export interface Credentials {
  username: string;
  password: string;
  app_key: string;
}

export interface JobSummary {
  job_id: string;
  url: string;
  tool: string | null;
  job_stage: string | null;
  failed: boolean;
  date_submitted: string | null;
  date_completed: string | null;
}

export interface JobDetails {
  job_id: string;
  job_stage: string;
  failed: boolean;
  date_submitted: string | null;
  self_uri: string;
  results_uri: string | null;
}

export interface DownloadInfo {
  filename: string;
  path: string;
  size: number;
}

export async function loadCredentials(): Promise<Credentials | null> {
  return await invoke<Credentials | null>('load_credentials');
}

export async function connect(
  username: string,
  password: string,
  appKey: string
): Promise<string> {
  return await invoke<string>('connect', {
    username,
    password,
    appKey,
  });
}

export async function listJobs(): Promise<JobSummary[]> {
  return await invoke<JobSummary[]>('list_jobs');
}

export async function getJobStatus(jobUrl: string): Promise<JobDetails> {
  return await invoke<JobDetails>('get_job_status', { jobUrl });
}

export async function submitJob(
  filePath: string,
  tool: string
): Promise<string> {
  return await invoke<string>('submit_job', { filePath, tool });
}

export async function downloadResults(
  jobUrl: string,
  outputDir: string
): Promise<string> {
  return await invoke<string>('download_results', {
    jobUrl,
    outputDir,
  });
}

export async function getDownloadDir(): Promise<string> {
  return await invoke<string>('get_download_dir');
}

export async function setDownloadDir(dir: string): Promise<void> {
  return await invoke<void>('set_download_dir', { dir });
}

export async function getCredentialsLocation(): Promise<string> {
  return await invoke<string>('get_credentials_location');
}

// Zoom functions
export async function getZoom(): Promise<number> {
  return await invoke<number>('get_zoom');
}

export async function zoomIn(): Promise<number> {
  return await invoke<number>('zoom_in');
}

export async function zoomOut(): Promise<number> {
  return await invoke<number>('zoom_out');
}

export async function resetZoom(): Promise<number> {
  return await invoke<number>('reset_zoom');
}

// Theme functions
export async function getTheme(): Promise<string> {
  return await invoke<string>('get_theme');
}

export async function setTheme(theme: string): Promise<void> {
  return await invoke<void>('set_theme', { theme });
}

// Showcase mode
export async function getShowcaseMode(): Promise<boolean> {
  return await invoke<boolean>('get_showcase_mode');
}

// Auto-refresh functions
export async function getAutoRefresh(): Promise<boolean> {
  return await invoke<boolean>('get_auto_refresh');
}

export async function setAutoRefresh(enabled: boolean): Promise<void> {
  return await invoke<void>('set_auto_refresh', { enabled });
}

export async function getAutoRefreshInterval(): Promise<number> {
  return await invoke<number>('get_auto_refresh_interval');
}

export async function setAutoRefreshInterval(interval: number): Promise<void> {
  return await invoke<void>('set_auto_refresh_interval', { interval });
}

// Updater functions
export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();

    if (update?.available) {
      return {
        version: update.version,
        date: update.date,
        body: update.body,
      };
    }
    return null;
  } catch (error) {
    throw new Error(`Failed to check for updates: ${error}`);
  }
}

export async function installUpdate(
  onProgress?: (progress: number, total: number) => void
): Promise<void> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();

    if (!update?.available) {
      throw new Error('No update available');
    }

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          if (onProgress) onProgress(0, event.data.contentLength || 0);
          break;
        case 'Progress':
          if (onProgress) onProgress(event.data.chunkLength, 0);
          break;
        case 'Finished':
          break;
      }
    });

    // Restart the app after update
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (error) {
    throw new Error(`Failed to install update: ${error}`);
  }
}
