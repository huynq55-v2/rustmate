import { useState, useEffect } from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import SmartLibraryLayout from "./components/SmartLibraryLayout";
import { initConfig, getLastOpenedVault } from "./utils/config";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initialPath, setInitialPath] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        await initConfig();
        const path = await getLastOpenedVault();
        setInitialPath(path);
      } catch (e) {
        console.error("Failed to load config", e);
      } finally {
        setIsLoading(false);
      }
    }
    init();
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
