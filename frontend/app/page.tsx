"use client";

import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import * as api from "../lib/tauri";

type Tab = "jobs" | "upload" | "settings";

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [appKey, setAppKey] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [currentTab, setCurrentTab] = useState<Tab>("jobs");

  // Jobs state
  const [jobs, setJobs] = useState<api.JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Upload state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  // Settings state
  const [credsLocation, setCredsLocation] = useState("");
  const [downloadDir, setDownloadDir] = useState("");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [editingDownloadDir, setEditingDownloadDir] = useState(false);
  const [tempDownloadDir, setTempDownloadDir] = useState("");

  // Updater state
  const [checking, setChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<api.UpdateInfo | null>(
    null
  );
  const [installing, setInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Showcase mode state
  const [isShowcaseMode, setIsShowcaseMode] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Show toast helper
  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "info"
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000); // Auto-hide after 5 seconds
  };

  // Anonymization helpers for display
  const anonymizeUsername = (name: string) => {
    return isShowcaseMode ? "demo_user" : name;
  };

  const anonymizeAppKey = (key: string) => {
    return isShowcaseMode ? "DEMO-APP-KEY-" + "X".repeat(32) : key;
  };

  useEffect(() => {
    // Load credentials on mount
    loadStoredCredentials();
    fetchMetadata();

    // Check if showcase mode is active
    const checkShowcaseMode = async () => {
      try {
        const showcaseMode = await api.getShowcaseMode();
        setIsShowcaseMode(showcaseMode);
      } catch (err) {
        console.error("Failed to check showcase mode:", err);
      }
    };
    checkShowcaseMode();
  }, []);

  // Load and apply saved zoom level
  useEffect(() => {
    const loadZoom = async () => {
      try {
        const zoom = await api.getZoom();
        if (zoom !== 1.0) {
          document.body.style.zoom = zoom.toString();
        }
      } catch (err) {
        console.error("Failed to load zoom:", err);
      }
    };
    loadZoom();
  }, []);

  // Load and apply saved theme
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await api.getTheme();
        setTheme(savedTheme as "light" | "dark" | "system");
        applyTheme(savedTheme as "light" | "dark" | "system");
      } catch (err) {
        console.error("Failed to load theme:", err);
      }
    };
    loadTheme();
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      applyTheme("system");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // Apply theme to document
  const applyTheme = (themeValue: "light" | "dark" | "system") => {
    if (themeValue === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute(
        "data-theme",
        isDark ? "dark" : "light"
      );
    } else {
      document.documentElement.setAttribute("data-theme", themeValue);
    }
  };

  // Handle theme change
  const handleThemeChange = async (newTheme: "light" | "dark" | "system") => {
    try {
      await api.setTheme(newTheme);
      setTheme(newTheme);
      applyTheme(newTheme);
    } catch (err) {
      console.error("Failed to set theme:", err);
    }
  };

  // Handle download directory editing
  const handleEditDownloadDir = () => {
    setTempDownloadDir(downloadDir);
    setEditingDownloadDir(true);
  };

  const handleSelectDownloadDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: tempDownloadDir || downloadDir,
      });
      if (selected && typeof selected === "string") {
        setTempDownloadDir(selected);
      }
    } catch (err) {
      console.error("Failed to select directory:", err);
    }
  };

  const handleSaveDownloadDir = async () => {
    try {
      await api.setDownloadDir(tempDownloadDir);
      setDownloadDir(tempDownloadDir);
      setEditingDownloadDir(false);
      showToast("Download directory updated", "success");
    } catch (err: any) {
      showToast(`Failed to set directory: ${err}`, "error");
    }
  };

  const handleCancelEditDownloadDir = () => {
    setTempDownloadDir("");
    setEditingDownloadDir(false);
  };

  // Handle update checking
  const handleCheckForUpdates = async () => {
    setChecking(true);
    setUpdateAvailable(null);
    try {
      const update = await api.checkForUpdates();
      if (update) {
        setUpdateAvailable(update);
        showToast(`Update available: v${update.version}`, "success");
      } else {
        showToast("You are running the latest version", "info");
      }
    } catch (err: any) {
      showToast(`Failed to check for updates: ${err}`, "error");
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateAvailable) return;

    setInstalling(true);
    setDownloadProgress(0);
    try {
      await api.installUpdate((progress, total) => {
        if (total > 0) {
          setDownloadProgress((progress / total) * 100);
        }
      });
      // App will relaunch automatically
    } catch (err: any) {
      showToast(`Failed to install update: ${err}`, "error");
      setInstalling(false);
    }
  };

  // Keyboard shortcuts for zoom
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === "=") {
        e.preventDefault();
        try {
          await api.zoomIn();
        } catch (err) {
          console.error("Zoom in failed:", err);
        }
      } else if (modifier && e.key === "-") {
        e.preventDefault();
        try {
          await api.zoomOut();
        } catch (err) {
          console.error("Zoom out failed:", err);
        }
      } else if (modifier && e.key === "0") {
        e.preventDefault();
        try {
          await api.resetZoom();
        } catch (err) {
          console.error("Reset zoom failed:", err);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const fetchMetadata = async () => {
    try {
      const creds = await api.getCredentialsLocation();
      const downloads = await api.getDownloadDir();
      setCredsLocation(creds);
      setDownloadDir(downloads);
    } catch (err) {
      console.error("Failed to fetch metadata:", err);
    }
  };

  const loadStoredCredentials = async () => {
    try {
      const creds = await api.loadCredentials();
      if (creds) {
        setUsername(creds.username);
        setPassword(creds.password);
        setAppKey(creds.app_key);
        setStatus("Loaded credentials, connecting...");
        await handleConnect(creds.username, creds.password, creds.app_key);
      }
    } catch (err) {
      console.error("Failed to load credentials:", err);
    }
  };

  const handleConnect = async (user?: string, pass?: string, key?: string) => {
    try {
      setStatus("Connecting...");
      const msg = await api.connect(
        user || username,
        pass || password,
        key || appKey
      );
      setStatus(msg);
      setIsConnected(true);
      await refreshJobs();
    } catch (err: any) {
      setStatus(`Connection failed: ${err}`);
      setIsConnected(false);
    }
  };

  const refreshJobs = async () => {
    setJobsLoading(true);
    try {
      const jobList = await api.listJobs();
      setJobs(jobList);
    } catch (err: any) {
      setStatus(`Failed to load jobs: ${err}`);
    } finally {
      setJobsLoading(false);
    }
  };

  const handleSelectFile = async () => {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "ZIP files", extensions: ["zip"] }],
      });
      if (file && typeof file === 'string') {
        setSelectedFile(file);
      }
    } catch (err) {
      console.error("File selection error:", err);
    }
  };

  const handleSubmitJob = async () => {
    if (!selectedFile || !selectedTool) {
      setUploadStatus("Please select a file and tool");
      return;
    }

    setUploading(true);
    setUploadStatus("Submitting job...");
    try {
      const jobId = await api.submitJob(selectedFile, selectedTool);
      setUploadStatus(`Job submitted: ${jobId}`);
      setSelectedFile(null);
      setSelectedTool("");
      await refreshJobs();
    } catch (err: any) {
      setUploadStatus(`Failed to submit job: ${err}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (jobUrl: string) => {
    try {
      const dir = await api.getDownloadDir();
      const zipPath = await api.downloadResults(jobUrl, dir);
      const filename = zipPath.split("/").pop() || "archive.zip";
      showToast(`Downloaded ${filename} to Downloads`, "success");
    } catch (err: any) {
      showToast(`Download failed: ${err}`, "error");
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body">
            <div className="flex flex-col items-center mb-6">
              <img
                src="/NSG_header_logo_v2.png"
                alt="NSG Logo"
                className="h-16 w-auto mb-4"
              />
              <p className="text-sm text-base-content/70 text-center">
                Neuroscience Gateway
              </p>
            </div>

            <div className="space-y-5">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Username</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input input-bordered w-full"
                  placeholder="Enter username"
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Password</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input input-bordered w-full"
                  placeholder="Enter password"
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">App Key</span>
                </label>
                <input
                  type="text"
                  value={appKey}
                  onChange={(e) => setAppKey(e.target.value)}
                  className="input input-bordered w-full"
                  placeholder="Enter app key"
                />
              </div>

              <button
                onClick={() => handleConnect()}
                className="btn btn-primary w-full mt-4"
              >
                Connect
              </button>

              {status && (
                <div className="text-sm text-center text-base-content/60 mt-2">
                  {status}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-lg">
        <div className="navbar-start">
          <img
            src="/NSG_header_logo_v2.png"
            alt="NSG Logo"
            className="h-12 w-auto"
          />
        </div>
        <div className="navbar-center">
          <p className="text-sm">
            Connected as:{" "}
            <span className="font-semibold">{anonymizeUsername(username)}</span>
          </p>
        </div>
        <div className="navbar-end">
          <button
            onClick={() => {
              setIsConnected(false);
              setStatus("Disconnected");
            }}
            className="btn btn-error btn-sm"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div role="tablist" className="tabs tabs-bordered">
          {(["jobs", "upload", "settings"] as Tab[]).map((tab) => (
            <button
              key={tab}
              role="tab"
              onClick={() => setCurrentTab(tab)}
              className={`tab capitalize ${
                currentTab === tab ? "tab-active" : ""
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentTab === "jobs" && (
          <div>
            {/* Header with Search */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <h2 className="text-2xl font-bold">Jobs</h2>
              <div className="flex-1">
                <div className="form-control">
                  <div className="input-group">
                    <input
                      type="text"
                      placeholder="Search jobs by ID or URL..."
                      className="input input-bordered w-full"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        className="btn btn-square"
                        onClick={() => setSearchQuery("")}
                      >
                        ✕
                      </button>
                    )}
                    <button className="btn btn-square">🔍</button>
                  </div>
                </div>
              </div>
              <button
                onClick={refreshJobs}
                disabled={jobsLoading}
                className="btn btn-primary btn-sm sm:btn-md"
              >
                {jobsLoading && (
                  <span className="loading loading-spinner"></span>
                )}
                {jobsLoading ? "Loading..." : "Refresh"}
              </button>
            </div>

            {(() => {
              const filteredJobs = jobs.filter((job) => {
                const query = searchQuery.toLowerCase();
                return (
                  job.job_id.toLowerCase().includes(query) ||
                  job.url.toLowerCase().includes(query)
                );
              });

              if (jobs.length === 0) {
                return (
                  <div className="card bg-base-100 shadow-xl">
                    <div className="card-body text-center">
                      <p>No jobs found</p>
                    </div>
                  </div>
                );
              }

              if (filteredJobs.length === 0) {
                return (
                  <div className="card bg-base-100 shadow-xl">
                    <div className="card-body text-center">
                      <p>No jobs match your search &quot;{searchQuery}&quot;</p>
                      <button
                        onClick={() => setSearchQuery("")}
                        className="btn btn-sm btn-ghost"
                      >
                        Clear search
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <>
                  {searchQuery && (
                    <div className="alert alert-info mb-4">
                      <span>
                        Showing {filteredJobs.length} of {jobs.length} jobs
                      </span>
                    </div>
                  )}
                  <div className="space-y-4">
                    {filteredJobs.map((job) => (
                      <div key={job.url} className="card bg-base-100 shadow-xl">
                        <div className="card-body">
                          <div className="flex justify-between items-center">
                            <div>
                              <h3 className="card-title text-base">
                                Job ID: {job.job_id}
                              </h3>
                              <p className="text-sm opacity-70 mt-1">
                                {job.url}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDownload(job.url)}
                              className="btn btn-success btn-sm"
                            >
                              Download Results
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {currentTab === "upload" && (
          <div>
            <h2 className="text-2xl font-bold mb-6">Submit Job</h2>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body space-y-6">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Job File (ZIP)</span>
                  </label>
                  <div className="join w-full">
                    <button
                      onClick={handleSelectFile}
                      className="btn btn-primary join-item"
                    >
                      Select File
                    </button>
                    <div className="input input-bordered join-item flex-1 flex items-center">
                      {selectedFile || "No file selected"}
                    </div>
                  </div>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Tool</span>
                  </label>
                  <select
                    value={selectedTool}
                    onChange={(e) => setSelectedTool(e.target.value)}
                    className="select select-bordered w-full"
                  >
                    <option value="">Select a tool...</option>
                    <option value="NEURON">NEURON</option>
                    <option value="PYTHON">Python</option>
                    <option value="RSCRIPT">R Script</option>
                  </select>
                </div>

                <button
                  onClick={handleSubmitJob}
                  disabled={uploading}
                  className="btn btn-primary w-full"
                >
                  {uploading && (
                    <span className="loading loading-spinner"></span>
                  )}
                  {uploading ? "Submitting..." : "Submit Job"}
                </button>

                {uploadStatus && (
                  <div className="alert alert-info">
                    <span>{uploadStatus}</span>
                  </div>
                )}

                <div className="divider"></div>

                <div>
                  <h3 className="font-semibold mb-2">Instructions:</h3>
                  <ol className="list-decimal list-inside space-y-1 text-sm opacity-70">
                    <li>Prepare your job data in a ZIP file</li>
                    <li>Select the ZIP file using the button above</li>
                    <li>Choose the tool/application to run</li>
                    <li>Click Submit Job to start processing</li>
                    <li>View submitted jobs in the Jobs tab</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentTab === "settings" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Settings</h2>

            {/* Theme Settings */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title">Appearance</h3>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Theme</span>
                  </label>
                  <div className="join">
                    <button
                      onClick={() => handleThemeChange("light")}
                      className={`btn join-item ${
                        theme === "light" ? "btn-active" : ""
                      }`}
                    >
                      ☀️ Light
                    </button>
                    <button
                      onClick={() => handleThemeChange("dark")}
                      className={`btn join-item ${
                        theme === "dark" ? "btn-active" : ""
                      }`}
                    >
                      🌙 Dark
                    </button>
                    <button
                      onClick={() => handleThemeChange("system")}
                      className={`btn join-item ${
                        theme === "system" ? "btn-active" : ""
                      }`}
                    >
                      💻 System
                    </button>
                  </div>
                  <label className="label">
                    <span className="label-text-alt">
                      {theme === "system"
                        ? "Theme follows your system preferences"
                        : `Current theme: ${theme}`}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Updates */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title">Updates</h3>
                <div className="space-y-4">
                  <p className="text-sm text-base-content/70">
                    Check for new versions of NSG GUI and install them
                    automatically.
                  </p>

                  {updateAvailable && (
                    <div className="alert alert-success">
                      <div>
                        <div className="font-bold">
                          Update Available: v{updateAvailable.version}
                        </div>
                        {updateAvailable.body && (
                          <div className="text-sm mt-1">
                            {updateAvailable.body}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {installing && (
                    <div className="space-y-2">
                      <div className="text-sm">
                        Downloading and installing update...
                      </div>
                      <progress
                        className="progress progress-primary w-full"
                        value={downloadProgress}
                        max="100"
                      ></progress>
                      <div className="text-xs text-center">
                        {Math.round(downloadProgress)}%
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleCheckForUpdates}
                      disabled={checking || installing}
                      className="btn btn-primary"
                    >
                      {checking && (
                        <span className="loading loading-spinner"></span>
                      )}
                      {checking ? "Checking..." : "Check for Updates"}
                    </button>

                    {updateAvailable && !installing && (
                      <button
                        onClick={handleInstallUpdate}
                        className="btn btn-success"
                      >
                        Install Update
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Configuration */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title">Current Configuration</h3>

                <div className="overflow-x-auto">
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="font-semibold">Username:</td>
                        <td>{anonymizeUsername(username)}</td>
                      </tr>
                      <tr>
                        <td className="font-semibold">API Endpoint:</td>
                        <td className="text-xs">
                          https://nsgr.sdsc.edu:8443/cipresrest/v1
                        </td>
                      </tr>
                      <tr>
                        <td className="font-semibold">App Key:</td>
                        <td>
                          <code className="text-xs bg-base-200 p-2 rounded">
                            {appKey ? anonymizeAppKey(appKey) : "Not set"}
                          </code>
                        </td>
                      </tr>
                      <tr>
                        <td className="font-semibold">Credentials file:</td>
                        <td className="text-xs font-mono">{credsLocation}</td>
                      </tr>
                      <tr>
                        <td className="font-semibold">Download directory:</td>
                        <td>
                          {!editingDownloadDir ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono">
                                {downloadDir}
                              </span>
                              <button
                                onClick={handleEditDownloadDir}
                                className="btn btn-xs btn-ghost"
                              >
                                Edit
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={tempDownloadDir}
                                  onChange={(e) =>
                                    setTempDownloadDir(e.target.value)
                                  }
                                  className="input input-bordered input-sm flex-1 font-mono text-xs"
                                  placeholder="Enter path or use Browse button"
                                />
                                <button
                                  onClick={handleSelectDownloadDir}
                                  className="btn btn-sm btn-primary"
                                >
                                  Browse
                                </button>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={handleCancelEditDownloadDir}
                                  className="btn btn-xs btn-ghost"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={handleSaveDownloadDir}
                                  className="btn btn-xs btn-success"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* About */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title">About</h3>
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-semibold">Version:</span> 0.1.0
                  </p>
                  <p>
                    <span className="font-semibold">Repository:</span>{" "}
                    <a
                      href="https://github.com/sdraeger/nsg-gui"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary"
                    >
                      github.com/sdraeger/nsg-gui
                    </a>
                  </p>
                  <p>
                    <span className="font-semibold">Contact:</span>{" "}
                    <a
                      href="mailto:sdraeger@salk.edu"
                      className="link link-primary"
                    >
                      sdraeger@salk.edu
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="toast toast-top toast-end">
          <div
            className={`alert ${
              toast.type === "success"
                ? "alert-success"
                : toast.type === "error"
                ? "alert-error"
                : "alert-info"
            }`}
          >
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="btn btn-sm btn-ghost btn-circle"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
