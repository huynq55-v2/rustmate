import { useState, useEffect } from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import SmartLibraryLayout from "./components/SmartLibraryLayout";
import { initConfig, getLastOpenedVault } from "./utils/config";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadConfig() {
      try {
        await initConfig();
        const path = await getLastOpenedVault();
        if (path) {
          // We don't automatically open it here anymore, we wait for WelcomeScreen to handle unlock
          // But we pass it as initialPath
        }
        setVaultPath(path); // This is wrong if we want to force unlock.
        // Actually, if we setVaultPath here, we skip WelcomeScreen.
        // We should ONLY setVaultPath if we are sure it's open.
        // But `getLastOpenedVault` just returns the path. 
        // So we should NOT setVaultPath(path) here if we want the lock screen.
        // Let's reset vaultPath to null so WelcomeScreen shows up.
      } catch (error) {
        console.error("Failed to load config:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, []);

  // Correct logic:
  // 1. App starts. isLoading=true.
  // 2. loadConfig finishes. vaultPath is NULL. initialPath is retrieved (need to fetch it again or change logic).
  // 3. WelcomeScreen shows up with initialPath.
  // 4. User unlocks -> onVaultOpened -> vaultPath set -> SmartLibraryLayout shows.

  // Refetch initial path for WelcomeScreen
  const [initialPath, setInitialPath] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLast() {
      const path = await getLastOpenedVault();
      setInitialPath(path);
      setIsLoading(false);
    }
    initConfig().then(fetchLast);
  }, []);

  const handleCloseVault = async () => {
    await invoke('close_vault');
    setVaultPath(null);
  };

  if (isLoading) {
    return <div className="container">Loading configuration...</div>;
  }

  if (vaultPath) {
    return <SmartLibraryLayout vaultPath={vaultPath} onCloseVault={handleCloseVault} />;
  }

  return <WelcomeScreen onVaultOpened={(path) => setVaultPath(path)} initialPath={initialPath} />;
}

export default App;
